"""خدمات الأطراف: الحمولة المرجعية، البحث بالبادئة، فحص التشابه المضلل، الإنشاء السريع، وتطبيق
حدث الإنشاء من PUSH. كل كتابة تمرّ بـ`log_reference` داخل معاملة لتصل الأجهزة."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import User
from core.search_normalize import normalize_search
from core.tenancy import require_tenant
from parties.models import OpeningBalance, Party, PaymentReceipt, normalize_phone
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


# ------------------------------------------------------------------- كشف الحساب (PTY-05)


@dataclass(frozen=True)
class StatementLine:
    """سطر كشف: مستند وتاريخ وبيان وأثر موقَّع على ذمّة الطرف (مدين موجب) وفرعه ونوعه."""

    doc: str
    doc_id: str
    kind: str
    label: str
    occurred_at: datetime
    business_date: date | None
    debit_minor: int
    credit_minor: int
    branch_id: uuid.UUID | None
    #: سطر معلوماتي بلا أثر آجل («بيع نقدي — لا أثر آجل»)
    info: bool = False


#: سطور الكشف من الوحدات (البيع، المرتجع، السداد…): party → [StatementLine]
STATEMENT_LINE_PROVIDERS: list[Callable[[Party], list[StatementLine]]] = []


def statement_lines(party: Party) -> list[StatementLine]:
    lines: list[StatementLine] = []
    for ob in party.opening_balances.filter(side="customer_due"):
        lines.append(
            StatementLine(
                doc="OPEN",
                doc_id=str(ob.id),
                kind="opening",
                label="رصيد افتتاحي",
                occurred_at=ob.occurred_at,
                business_date=ob.business_date,
                debit_minor=ob.amount_minor,
                credit_minor=0,
                branch_id=None,
            )
        )
    for p in STATEMENT_LINE_PROVIDERS:
        lines.extend(p(party))
    lines.sort(key=lambda ln: (ln.business_date or date.min, ln.occurred_at))
    return lines


def statement_payload(
    party: Party, *, visible_branch_ids: list[uuid.UUID] | None, since: datetime | None
) -> dict[str, Any]:
    """الكشف المتتابع: الرصيد الجاري من كل الحركات (لا رصيد جزئي)، والفواتير المنشأة في فرع خارج
    نطاق المشاهد تدخل الرصيد المؤسسي دون أن تُعرض تفاصيلها (ACC-46)؛ آخر سداد و«أقدم حركة غير
    مسدَّدة» تاريخاً فقط — لا أعمار (G-15)."""
    running = 0
    rows: list[dict[str, Any]] = []
    hidden = 0
    last_payment: datetime | None = None
    oldest_unpaid: datetime | None = None
    for ln in statement_lines(party):
        running += ln.debit_minor - ln.credit_minor
        if ln.kind == "payment":
            last_payment = ln.occurred_at
        if ln.debit_minor > 0 and running > 0 and oldest_unpaid is None:
            oldest_unpaid = ln.occurred_at
        if running <= 0:
            oldest_unpaid = None
        visible = (
            visible_branch_ids is None or ln.branch_id is None or ln.branch_id in visible_branch_ids
        )
        if not visible:
            hidden += 1
            continue
        if since is not None and ln.occurred_at < since and ln.kind != "opening":
            continue
        rows.append(
            {
                "doc": ln.doc,
                "doc_id": ln.doc_id,
                "kind": ln.kind,
                "label": ln.label,
                "occurred_at": ln.occurred_at.isoformat(),
                "business_date": ln.business_date.isoformat() if ln.business_date else "",
                "debit_minor": str(ln.debit_minor) if ln.debit_minor else "",
                "credit_minor": str(ln.credit_minor) if ln.credit_minor else "",
                "balance_minor": str(running),
                "branch_id": str(ln.branch_id) if ln.branch_id else "",
                "info": ln.info,
            }
        )
    return {
        "party": list_payload(party, with_balances=True),
        "rows": rows,
        "balance_minor": str(running),
        "hidden_other_branch": hidden,
        "last_payment_at": _iso(last_payment),
        "oldest_unpaid_at": _iso(oldest_unpaid),
        "as_of": timezone.now().isoformat(),
    }


# ------------------------------------------------------------------- السداد والردّ (PTY-06)


def _dt(value: Any) -> datetime:
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        return timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def apply_payment_receipt(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """سند القبض/الردّ من PUSH (متكرّر الأثر): مرجع تحويل مستهلَك يفشل بقيد التفرد فتُرفض العملية
    (ACC-15)؛ الأثر على الذمّة والدرج عبر المزوّدين لا بكتابة حقل."""
    if PaymentReceipt.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    party = Party.unscoped.filter(tenant_id=tenant_id, id=payload["party_id"]).first()
    if party is None:
        return
    user = User.unscoped.filter(id=payload["user_id"]).first()
    PaymentReceipt.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        party=party,
        receipt_number=str(payload["receipt_number"]),
        kind=str(payload["kind"]),
        method=str(payload["method"]),
        amount_minor=int(payload["amount_minor"]),
        reference=str(payload.get("reference", "") or "").strip(),
        reason=str(payload.get("reason", "") or "").strip(),
        branch_id=uuid.UUID(str(payload["branch_id"])),
        device_id=device_id,
        shift_id=uuid.UUID(str(payload["shift_id"])) if payload.get("shift_id") else None,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        business_date=parse_date(str(payload["business_date"])) or timezone.localdate(),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def receipt_payload(r: PaymentReceipt) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "receipt_number": r.receipt_number,
        "party_id": str(r.party_id),
        "kind": r.kind,
        "method": r.method,
        "amount_minor": str(r.amount_minor),
        "reference": r.reference,
        "reason": r.reason,
        "branch_id": str(r.branch_id),
        "shift_id": str(r.shift_id) if r.shift_id else "",
        "user_name": r.user_name,
        "matched_at": _iso(r.matched_at),
        "matched_by_name": r.matched_by_name,
        "business_date": r.business_date.isoformat(),
        "occurred_at": _iso(r.occurred_at),
    }


def match_receipt(receipt: PaymentReceipt, *, actor: User) -> PaymentReceipt:
    """«مطابق» بفعل صريح من كشف البنك — عندها فقط يُسقط الدين (ACC-133)."""
    if receipt.method != "bank":
        raise CardRejected("invalid", "method")
    if receipt.matched_at is not None:
        raise CardRejected("already_matched")
    receipt.matched_at = timezone.now()
    receipt.matched_by_name = actor.display_name
    receipt.save(update_fields=["matched_at", "matched_by_name"])
    return receipt


def _effective(qs: Any) -> Any:
    """النقد فوراً؛ التحويل بعد المطابقة فقط."""
    return qs.filter(Q(method="cash") | Q(matched_at__isnull=False))


def _receipts_balance(party: Party) -> int:
    """السداد يخفّض ذمّة الطرف والردّ يرفعها (§٧.٢: سداد دين 40 نقداً → دائن 40)."""
    received = _effective(PaymentReceipt.objects.filter(party=party, kind="receipt")).aggregate(
        s=Sum("amount_minor")
    )["s"]
    refunded = _effective(PaymentReceipt.objects.filter(party=party, kind="refund")).aggregate(
        s=Sum("amount_minor")
    )["s"]
    return int(refunded or 0) - int(received or 0)


BALANCE_PROVIDERS.append(_receipts_balance)
MOVEMENT_PROVIDERS.append(lambda party: PaymentReceipt.objects.filter(party=party).exists())


def _receipt_lines(party: Party) -> list[StatementLine]:
    out: list[StatementLine] = []
    for r in PaymentReceipt.objects.filter(party=party).order_by("occurred_at"):
        effective = r.method == "cash" or r.matched_at is not None
        if r.kind == "receipt":
            if r.method == "cash":
                label = "سداد نقدي"
            elif effective:
                label = "سداد بتحويل بنكي — مطابق"
            else:
                label = "سداد بتحويل بنكي — مسجَّل غير مطابق"
            out.append(
                StatementLine(
                    doc=r.receipt_number,
                    doc_id=str(r.id),
                    kind="payment" if effective else "payment_pending",
                    label=label,
                    occurred_at=r.occurred_at,
                    business_date=r.business_date,
                    debit_minor=0,
                    credit_minor=r.amount_minor if effective else 0,
                    branch_id=r.branch_id,
                    info=not effective,
                )
            )
        else:
            out.append(
                StatementLine(
                    doc=r.receipt_number,
                    doc_id=str(r.id),
                    kind="refund",
                    label="ردّ مبلغ" + ("" if r.method == "cash" else " — تحويل بنكي"),
                    occurred_at=r.occurred_at,
                    business_date=r.business_date,
                    debit_minor=r.amount_minor if effective else 0,
                    credit_minor=0,
                    branch_id=r.branch_id,
                    info=not effective,
                )
            )
    return out


STATEMENT_LINE_PROVIDERS.append(_receipt_lines)
