"""خدمات الأطراف: الحمولة المرجعية، البحث بالبادئة، فحص التشابه المضلل، الإنشاء السريع، وتطبيق
حدث الإنشاء من PUSH. كل كتابة تمرّ بـ`log_reference` داخل معاملة لتصل الأجهزة."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from core.models import User
from core.search_normalize import normalize_search
from core.tenancy import require_tenant
from parties.models import OpeningBalance, Party, normalize_phone
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
        "note": party.note,
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


# ------------------------------------------------------- البطاقة والرصيد الافتتاحي (PTY-03/04)

#: هل للطرف حركات (فواتير، مرتجعات، سدادات…)؟ — تسجّله الوحدات؛ الافتتاحي قبل أول حركة
MOVEMENT_PROVIDERS: list[Callable[[Party], bool]] = []


class CardRejected(Exception):
    def __init__(self, code: str, field: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.field = field


def has_movements(party: Party) -> bool:
    return any(p(party) for p in MOVEMENT_PROVIDERS)


def update_party(
    party: Party,
    *,
    name: str,
    phone: str,
    aliases: list[str],
    credit_limit_minor: int,
    is_customer: bool,
    is_supplier: bool,
    note: str,
) -> Party:
    """تعديل البطاقة (PTY-03): الاسم فقط إلزامي، والصفتان لا تُنزعان عن طرف له حركات في دفترها."""
    if not name.strip():
        raise CardRejected("required", "name")
    if credit_limit_minor < 0:
        raise CardRejected("min", "credit_limit_minor")
    if not is_customer and not is_supplier:
        raise CardRejected("required", "role")
    with transaction.atomic():
        party.name = name.strip()
        party.phone = phone.strip()
        party.aliases = [a.strip() for a in aliases if a.strip()]
        party.credit_limit_minor = credit_limit_minor
        party.is_customer = is_customer
        party.is_supplier = is_supplier
        party.note = note.strip()
        party.save()
        log_reference(require_tenant(), "parties.Party", party.id)
    return party


def mark_distinct(party: Party, other: Party) -> Party:
    """«وسمهما مراجَعان ومنفصلان»: قرار هوية صريح يُسجَّل على الأحدث ويُغلق الاشتباه (ACC-131)."""
    with transaction.atomic():
        party.distinct_from = other
        party.save(update_fields=["distinct_from", "updated_at"])
        log_reference(require_tenant(), "parties.Party", party.id)
    return party


def potential_duplicates(party: Party) -> list[Party]:
    """أطراف باسم متقارب (بعد التطبيع) أو بنفس الهاتف لم يُقرَّر فيها «منفصلان» — لا دمج بالاسم."""
    n = party.name_normalized
    qs = Party.objects.filter(is_active=True).exclude(id=party.id)
    cond = Q(name_normalized=n)
    if party.phone_normalized:
        cond |= Q(phone_normalized=party.phone_normalized)
    out = []
    for p in qs.filter(cond):
        if p.distinct_from_id == party.id or party.distinct_from_id == p.id:
            continue
        out.append(p)
    return out


def opening_payload(ob: OpeningBalance) -> dict[str, Any]:
    return {
        "id": str(ob.id),
        "party_id": str(ob.party_id),
        "side": ob.side,
        "amount_minor": str(ob.amount_minor),
        "reason": ob.reason,
        "reference": ob.reference,
        "business_date": ob.business_date.isoformat() if ob.business_date else "",
        "decided_by_name": ob.decided_by_name,
        "occurred_at": ob.occurred_at.isoformat(),
    }


def record_opening_balance(
    party: Party,
    *,
    side: str,
    amount_minor: int,
    reason: str,
    reference: str,
    business_date: Any,
    actor: User,
) -> OpeningBalance:
    """الافتتاحي مرة واحدة لكل صفة وقبل أول حركة؛ السبب إلزامي؛ المبلغ موجب؛ يُسجَّل مرجعاً ليصل
    الأجهزة (الكشف يبدأ به)."""
    if side not in ("customer_due", "supplier_owed"):
        raise CardRejected("invalid", "side")
    if amount_minor <= 0:
        raise CardRejected("min", "amount_minor")
    if not reason.strip():
        raise CardRejected("required", "reason")
    if side == "customer_due" and not party.is_customer:
        raise CardRejected("invalid", "side")
    if side == "supplier_owed" and not party.is_supplier:
        raise CardRejected("invalid", "side")
    if has_movements(party):
        raise CardRejected("has_movements")
    if OpeningBalance.objects.filter(party=party, side=side).exists():
        raise CardRejected("already_recorded")
    with transaction.atomic():
        ob: OpeningBalance = OpeningBalance.objects.create(
            tenant_id=require_tenant(),
            party=party,
            side=side,
            amount_minor=amount_minor,
            reason=reason.strip(),
            reference=reference.strip(),
            business_date=business_date or None,
            decided_by_user_id=actor.id,
            decided_by_name=actor.display_name,
        )
        log_reference(require_tenant(), "parties.OpeningBalance", ob.id)
        log_reference(require_tenant(), "parties.Party", party.id)
    return ob


def _opening_customer(party: Party) -> int:
    total = OpeningBalance.objects.filter(party=party, side="customer_due").aggregate(
        s=Sum("amount_minor")
    )["s"]
    return int(total or 0)


def _opening_supplier(party: Party) -> int:
    total = OpeningBalance.objects.filter(party=party, side="supplier_owed").aggregate(
        s=Sum("amount_minor")
    )["s"]
    return int(total or 0)


BALANCE_PROVIDERS.append(_opening_customer)
SUPPLIER_OWED_PROVIDERS.append(_opening_supplier)
