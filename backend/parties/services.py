"""خدمات الأطراف: الحمولة المرجعية، البحث بالبادئة، فحص التشابه المضلل، الإنشاء السريع، وتطبيق
حدث الإنشاء من PUSH. كل كتابة تمرّ بـ`log_reference` داخل معاملة لتصل الأجهزة."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.models import User
from core.search_normalize import normalize_search
from core.tenancy import require_tenant
from parties.models import Party, normalize_phone
from sync.reference import log_reference

#: رصيد الطرف بالوحدة الصغرى (موجب = عليه) — تسجّله PTY من الدفتر؛ حتى ذلك الحين صفر بصدق
BALANCE_PROVIDERS: list[Callable[[Party], int]] = []
#: آخر بيع للطرف — تسجّله POS/PTY
LAST_SALE_PROVIDERS: list[Callable[[Party], datetime | None]] = []


def balance_minor(party: Party) -> int:
    return sum(p(party) for p in BALANCE_PROVIDERS)


def last_sale_at(party: Party) -> datetime | None:
    stamps = [d for p in LAST_SALE_PROVIDERS if (d := p(party)) is not None]
    return max(stamps) if stamps else None


def _iso(dt: datetime | None) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def party_payload(party: Party) -> dict[str, Any]:
    return {
        "id": str(party.id),
        "name": party.name,
        "name_normalized": party.name_normalized,
        "phone": party.phone,
        "aliases": [str(a) for a in (party.aliases or [])],
        "credit_limit_minor": str(party.credit_limit_minor),
        "is_customer": party.is_customer,
        "is_supplier": party.is_supplier,
        "distinct_from_id": str(party.distinct_from_id) if party.distinct_from_id else "",
        "balance_minor": str(balance_minor(party)),
        # وقت تغطية الرصيد الخادمي (§١٤.١): ما بعده على الجهاز يُركَّب فوقه ولو أُكِّد لاحقاً (ACC-02)
        "balance_as_of": timezone.now().isoformat(),
        "last_sale_at": _iso(last_sale_at(party)),
        "is_active": party.is_active,
        "deactivated_at": _iso(party.deactivated_at),
        "updated_at": _iso(party.updated_at),
    }


def search_parties(q: str, *, limit: int = 20) -> list[Party]:
    """بادئة الاسم (بعد التطبيع) أو بادئة الهاتف؛ المعطَّل لا يظهر (ACC-45)."""
    qs = Party.objects.filter(is_active=True)
    n = normalize_search(q.strip())
    digits = normalize_phone(q)
    if n:
        cond = (
            Q(name_normalized__startswith=n)
            | Q(name_normalized__contains=" " + n)
            | Q(aliases_normalized__startswith=n)
            | Q(aliases_normalized__contains=" " + n)
        )
        if digits:
            cond |= Q(phone_normalized__startswith=digits)
        qs = qs.filter(cond)
    return list(qs.order_by("name_normalized")[:limit])


@dataclass(frozen=True)
class Similar:
    """تشابه مضلل قبل الإنشاء (POS-04 validation_error): الاسم نفسه أو الهاتف مسجَّل على طرف قائم."""

    by_name: list[Party]
    by_phone: list[Party]

    @property
    def any(self) -> bool:
        return bool(self.by_name or self.by_phone)


def find_similar(name: str, phone: str) -> Similar:
    n = normalize_search(name.strip())
    digits = normalize_phone(phone)
    by_name = list(Party.objects.filter(is_active=True, name_normalized=n)) if n else []
    by_phone = list(Party.objects.filter(is_active=True, phone_normalized=digits)) if digits else []
    return Similar(by_name=by_name, by_phone=by_phone)


def create_party(
    *,
    party_id: uuid.UUID | None,
    name: str,
    phone: str,
    created_by: User | None,
    distinct_from: Party | None,
) -> Party:
    with transaction.atomic():
        party: Party = Party.objects.create(
            tenant_id=require_tenant(),
            **({"id": party_id} if party_id else {}),
            name=name.strip(),
            phone=phone.strip(),
            created_by_user_id=created_by.id if created_by else None,
            distinct_from=distinct_from,
        )
        log_reference(require_tenant(), "parties.Party", party.id)
    return party


def apply_party_created(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """الإنشاء السريع بلا اتصال يصل حدثاً: يُنشأ الطرف بمعرّفه (متكرّر الأثر) ويُسجَّل مرجعاً
    ليصل الأجهزة الأخرى؛ فحص «الرقم مسجَّل على طرف آخر» يكتمل هنا وقد ينتج مراجعة دمج (PTY-07)."""
    if Party.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    distinct_id = payload.get("distinct_from_party_id") or None
    distinct = (
        Party.unscoped.filter(tenant_id=tenant_id, id=distinct_id).first() if distinct_id else None
    )
    Party.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        name=str(payload["name"]).strip(),
        phone=str(payload.get("phone", "")).strip(),
        created_by_user_id=actor_user_id,
        distinct_from=distinct,
    )
    log_reference(tenant_id, "parties.Party", entity_id)


# ---------------------------------------------------------------- القوائم (PTY-01/02)

#: ما للمورد علينا بالوحدة الصغرى — تسجّله INV (الاستلام والشراء)؛ حتى ذلك الحين صفر بصدق
SUPPLIER_OWED_PROVIDERS: list[Callable[[Party], int]] = []


def supplier_owed_minor(party: Party) -> int:
    return sum(p(party) for p in SUPPLIER_OWED_PROVIDERS)


def list_payload(party: Party, *, with_balances: bool) -> dict[str, Any]:
    """صف قائمة الأطراف: الرصيد وآخر حركة لمن يرى المال؛ الأسماء للجميع (أمين المخزن يرى
    الأسماء)."""
    row = party_payload(party)
    if not with_balances:
        row["balance_minor"] = ""
        row["balance_as_of"] = ""
    row["supplier_owed_minor"] = str(supplier_owed_minor(party)) if with_balances else ""
    row["last_movement_at"] = row["last_sale_at"]
    # صلة السوق: لا ربط تلقائي بالاسم (ACC-118) — تأتي مع MP-08
    row["market_linked"] = False
    return row
