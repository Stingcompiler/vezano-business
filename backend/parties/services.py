"""خدمات الأطراف: الحمولة المرجعية، البحث بالبادئة، فحص التشابه المضلل، الإنشاء السريع، وتطبيق
حدث الإنشاء من PUSH. كل كتابة تمرّ بـ`log_reference` داخل معاملة لتصل الأجهزة."""

from __future__ import annotations

import html
import math
import secrets
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import Branch, Tenant, User
from core.search_normalize import normalize_search
from core.tenancy import require_tenant
from parties.models import (
    OpeningBalance,
    Party,
    PartyMerge,
    PaymentReceipt,
    ReceiptCorrection,
    StatementExport,
    normalize_phone,
)
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
        "merged_into": str(party.merged_into_id) if party.merged_into_id else "",
        "balance_minor": str(balance_minor(party)),
        # وقت تغطية الرصيد الخادمي (§١٤.١): ما بعده على الجهاز يُركَّب فوقه ولو أُكِّد لاحقاً (ACC-02)
        "balance_as_of": timezone.now().isoformat(),
        "last_sale_at": _iso(last_sale_at(party)),
        "is_active": party.is_active,
        "deactivated_at": _iso(party.deactivated_at),
        "updated_at": _iso(party.updated_at),
    }


def search_parties(q: str, *, limit: int = 20) -> list[Party]:
    """بادئة الاسم (بعد التطبيع) أو بادئة الهاتف؛ المعطَّل لا يظهر (ACC-45)، والمدموج يُخفى
    والوارث يظهر."""
    qs = Party.objects.filter(is_active=True, merged_into__isnull=True)
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
        from core import audit

        audit.record(
            kind="party.distinct",
            title="رفض دمج طرفين متشابهي الاسم",
            actor=None,
            detail=f"وُسم «{party.name}» و«{other.name}» مراجَعين ومنفصلين.",
            ref_entity="parties.Party",
            ref_id=party.id,
        )
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
    total = OpeningBalance.objects.filter(
        party_id__in=identity_ids(party), side="customer_due"
    ).aggregate(s=Sum("amount_minor"))["s"]
    return int(total or 0)


def _opening_supplier(party: Party) -> int:
    total = OpeningBalance.objects.filter(
        party_id__in=identity_ids(party), side="supplier_owed"
    ).aggregate(s=Sum("amount_minor"))["s"]
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
    #: الطرف الأصلي للحركة — يختلف عن الوارث بعد الدمج فيُوسم بمصدره (ACC-78)
    party_id: uuid.UUID | None = None


#: سطور الكشف من الوحدات (البيع، المرتجع، السداد…): party → [StatementLine]
STATEMENT_LINE_PROVIDERS: list[Callable[[Party], list[StatementLine]]] = []


def statement_lines(party: Party) -> list[StatementLine]:
    lines: list[StatementLine] = []
    for ob in OpeningBalance.objects.filter(party_id__in=identity_ids(party), side="customer_due"):
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
    names = {p.id: p.name for p in Party.objects.filter(id__in=identity_ids(party))}
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
                # الحركة المتأخرة/القديمة باسم المصدر تظهر في كشف الوارث موسومةً بمصدره (ACC-78)
                "source_party": (
                    names.get(ln.party_id, "")
                    if ln.party_id is not None and ln.party_id != party.id
                    else ""
                ),
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
        "tenant_name": _tenant_name(),
    }


def _tenant_name() -> str:
    t = Tenant.unscoped.filter(id=require_tenant()).first()
    return t.name if t else ""


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


@dataclass(frozen=True)
class EffectiveReceipt:
    """السند بعد تطبيق تصحيحاته (PTY-09) — الأصل ثابت والأثر من الأصل + التصحيحات."""

    kind: str
    method: str
    reference: str
    amount_minor: int
    business_date: date
    reversed: bool
    #: التحويل يؤثر بعد المطابقة فقط (ACC-133)
    effective: bool


def effective_receipt(r: PaymentReceipt) -> EffectiveReceipt:
    method, amount, bdate, reversed_ = r.method, r.amount_minor, r.business_date, False
    reference = r.reference
    for c in r.corrections.order_by("occurred_at"):
        if c.kind == "method" and c.new_method:
            method = c.new_method
            reference = c.new_reference
        elif c.kind == "amount" and c.new_amount_minor is not None:
            amount = c.new_amount_minor
        elif c.kind == "date" and c.new_business_date is not None:
            bdate = c.new_business_date
        elif c.kind == "reverse":
            reversed_ = True
    effective = (method == "cash" or r.matched_at is not None) and not reversed_
    return EffectiveReceipt(
        kind=r.kind,
        method=method,
        reference=reference,
        amount_minor=amount,
        business_date=bdate,
        reversed=reversed_,
        effective=effective,
    )


def identity_ids(party: Party) -> list[uuid.UUID]:
    """خريطة الهوية (ACC-78): الطرف وكل من دُمج فيه (تعاقبياً) — الحركات تبقى بهويتها وتُحسب
    للوارث؛ لا حلقات لأن الدمج يمنعها."""
    out: list[uuid.UUID] = [party.id]
    frontier = [party.id]
    while frontier:
        nxt = list(Party.objects.filter(merged_into_id__in=frontier).values_list("id", flat=True))
        nxt = [i for i in nxt if i not in out]
        out.extend(nxt)
        frontier = nxt
    return out


def _receipts_balance(party: Party) -> int:
    """السداد يخفّض ذمّة الطرف والردّ يرفعها (§٧.٢: سداد دين 40 نقداً → دائن 40)."""
    total = 0
    for r in PaymentReceipt.objects.filter(party_id__in=identity_ids(party)):
        e = effective_receipt(r)
        if not e.effective:
            continue
        total += -e.amount_minor if r.kind == "receipt" else e.amount_minor
    return total


BALANCE_PROVIDERS.append(_receipts_balance)
MOVEMENT_PROVIDERS.append(lambda party: PaymentReceipt.objects.filter(party=party).exists())


def _receipt_lines(party: Party) -> list[StatementLine]:
    out: list[StatementLine] = []
    ids = identity_ids(party)
    for r in PaymentReceipt.objects.filter(party_id__in=ids).order_by("occurred_at"):
        e = effective_receipt(r)
        corrected = r.corrections.exists()
        if r.kind == "receipt":
            if e.method == "cash":
                label = "سداد نقدي"
            elif e.effective:
                label = "سداد بتحويل بنكي — مطابق"
            else:
                label = "سداد بتحويل بنكي — مسجَّل غير مطابق"
            if corrected:
                label += " — مصحَّح"
            out.append(
                StatementLine(
                    doc=r.receipt_number,
                    doc_id=str(r.id),
                    kind="payment" if e.effective else "payment_pending",
                    label=label,
                    occurred_at=r.occurred_at,
                    business_date=e.business_date,
                    debit_minor=0,
                    credit_minor=e.amount_minor if e.effective else 0,
                    branch_id=r.branch_id,
                    info=not e.effective,
                    party_id=r.party_id,
                )
            )
        else:
            out.append(
                StatementLine(
                    doc=r.receipt_number,
                    doc_id=str(r.id),
                    kind="refund",
                    label="ردّ مبلغ"
                    + ("" if e.method == "cash" else " — تحويل بنكي")
                    + (" — مصحَّح" if corrected else ""),
                    occurred_at=r.occurred_at,
                    business_date=e.business_date,
                    debit_minor=e.amount_minor if e.effective else 0,
                    credit_minor=0,
                    branch_id=r.branch_id,
                    info=not e.effective,
                    party_id=r.party_id,
                )
            )
        for c in r.corrections.order_by("occurred_at"):
            out.append(
                StatementLine(
                    doc=f"COR-{r.receipt_number}",
                    doc_id=str(c.id),
                    kind="correction",
                    label=f"يصحّح حركة {r.business_date.isoformat()} — {c.get_kind_display()}",
                    occurred_at=c.occurred_at,
                    business_date=c.occurred_at.date(),
                    debit_minor=0,
                    credit_minor=0,
                    branch_id=r.branch_id,
                    info=True,
                    party_id=r.party_id,
                )
            )
    return out


STATEMENT_LINE_PROVIDERS.append(_receipt_lines)


# ------------------------------------------------------------- الدمج والتصحيح (PTY-07/PTY-09)


def merge_preview(source: Party, target: Party) -> dict[str, Any]:
    """معاينة الأثر قبل الدمج: الحركات والرصيدان والمجمّع والدليل (أرقام مختلفة)."""
    src_lines = [ln for ln in statement_lines(source) if not ln.info]
    tgt_lines = [ln for ln in statement_lines(target) if not ln.info]
    src_bal = balance_minor(source)
    tgt_bal = balance_minor(target)
    phones_differ = bool(
        source.phone_normalized
        and target.phone_normalized
        and source.phone_normalized != target.phone_normalized
    )
    return {
        "source": {**party_payload(source), "movements": len(src_lines)},
        "target": {**party_payload(target), "movements": len(tgt_lines)},
        "movements_after": len(src_lines) + len(tgt_lines),
        "balance_after_minor": str(src_bal + tgt_bal),
        "phones_differ": phones_differ,
    }


def merge_parties(source: Party, target: Party, *, actor: User, reason: str) -> PartyMerge:
    """الدمج أونلاين بصلاحية مالك (§٧.٥): يحتفظ كل حدث بـ`party_id` الأصلي وتُطبَّق خريطة هوية
    عند بناء الحساب؛ لا حلقات؛ المدموج لا يُدمج مرة ثانية ولا يُدمج في مدموج."""
    if source.id == target.id:
        raise CardRejected("same_party")
    if source.merged_into_id is not None:
        raise CardRejected("already_merged", "source")
    if target.merged_into_id is not None:
        raise CardRejected("target_merged", "target")
    if target.id in identity_ids(source):
        raise CardRejected("cycle")
    with transaction.atomic():
        merge: PartyMerge = PartyMerge.objects.create(
            tenant_id=require_tenant(),
            source=source,
            target=target,
            decided_by_user_id=actor.id,
            decided_by_name=actor.display_name,
            reason=reason.strip(),
            movements_at_merge=_movement_count(source) + _movement_count(target),
        )
        source.merged_into = target
        source.save(update_fields=["merged_into", "updated_at"])
        log_reference(require_tenant(), "parties.Party", source.id)
        log_reference(require_tenant(), "parties.Party", target.id)
        from core import audit

        audit.record(
            kind="party.merged",
            title=f"دمج طرفين: «{source.name}» في «{target.name}»",
            actor=actor,
            reason=reason,
            ref_entity="parties.PartyMerge",
            ref_id=merge.id,
        )
    return merge


def _movement_count(party: Party) -> int:
    return sum(1 for ln in statement_lines(party) if ln.kind != "opening")


def undo_merge(merge: PartyMerge, *, actor: User) -> PartyMerge:
    """التراجع بحدث جديد ممكن ما لم تُسجَّل حركة جديدة على الوارث بعد الدمج (ACC-78)."""
    if merge.undone_at is not None:
        raise CardRejected("already_undone")
    # المقارنة بعدد الحركات لا بزمنها: الحدث المتأخر يحمل زمن أعمال قد يسبق الدمج
    if _movement_count(merge.target) > merge.movements_at_merge:
        raise CardRejected("has_new_movements")
    with transaction.atomic():
        merge.undone_at = timezone.now()
        merge.undone_by_name = actor.display_name
        merge.save(update_fields=["undone_at", "undone_by_name"])
        src = merge.source
        src.merged_into = None
        src.save(update_fields=["merged_into", "updated_at"])
        log_reference(require_tenant(), "parties.Party", src.id)
        log_reference(require_tenant(), "parties.Party", merge.target_id)
    return merge


def merge_payload(m: PartyMerge) -> dict[str, Any]:
    return {
        "id": str(m.id),
        "source_id": str(m.source_id),
        "source_name": m.source.name,
        "target_id": str(m.target_id),
        "target_name": m.target.name,
        "decided_by_name": m.decided_by_name,
        "reason": m.reason,
        "occurred_at": _iso(m.occurred_at),
        "undone_at": _iso(m.undone_at),
    }


#: الفترة المقفلة: ما قبل أول يوم من الشهر السابق (التقارير الشهرية صُدِّرت — افتراض حتى REP)
def period_locked(d: date) -> bool:
    return d < locked_before()


def correct_receipt(
    receipt: PaymentReceipt,
    *,
    kind: str,
    reason: str,
    actor: User,
    new_method: str = "",
    new_reference: str = "",
    new_amount_minor: int | None = None,
    new_business_date: date | None = None,
) -> ReceiptCorrection:
    """مستند تصحيح مستقل مرتبط بالأصل (PTY-09): الأصل لا يتغير؛ السبب إلزامي؛ تاريخ داخل فترة
    مقفلة يُمنع بسبب؛ الفعلان يظهران في الكشف."""
    if kind not in ("method", "reverse", "amount", "date"):
        raise CardRejected("invalid", "kind")
    if not reason.strip():
        raise CardRejected("required", "reason")
    e = effective_receipt(receipt)
    if e.reversed:
        raise CardRejected("already_reversed")
    if kind == "method":
        if new_method not in ("cash", "bank") or new_method == e.method:
            raise CardRejected("invalid", "new_method")
        if new_method == "bank" and not new_reference.strip():
            raise CardRejected("required", "new_reference")
    if kind == "amount" and (new_amount_minor is None or new_amount_minor <= 0):
        raise CardRejected("min", "new_amount_minor")
    if kind == "date":
        if new_business_date is None:
            raise CardRejected("required", "new_business_date")
        if period_locked(new_business_date) or period_locked(e.business_date):
            raise CardRejected("period_locked", "new_business_date")
    with transaction.atomic():
        c: ReceiptCorrection = ReceiptCorrection.objects.create(
            tenant_id=require_tenant(),
            receipt=receipt,
            kind=kind,
            new_method=new_method if kind == "method" else "",
            new_reference=new_reference.strip() if kind == "method" else "",
            new_amount_minor=new_amount_minor if kind == "amount" else None,
            new_business_date=new_business_date if kind == "date" else None,
            reason=reason.strip(),
            decided_by_user_id=actor.id,
            decided_by_name=actor.display_name,
        )
        log_reference(require_tenant(), "parties.Party", receipt.party_id)
    return c


def locked_before() -> date:
    """أول يوم غير مقفل: أول الشهر السابق (افتراض حتى REP)."""
    today = timezone.localdate()
    return (today.replace(day=1) - timedelta(days=1)).replace(day=1)


def correction_context(receipt: PaymentReceipt) -> dict[str, Any]:
    """سياق شاشة التصحيح: الأصل كما سُجّل، وقيمه الفعلية بعد التصحيحات، وحدّ الفترة المقفلة."""
    e = effective_receipt(receipt)
    return {
        "receipt": receipt_payload(receipt),
        "effective": {
            "method": e.method,
            "reference": e.reference,
            "amount_minor": str(e.amount_minor),
            "business_date": e.business_date.isoformat(),
            "reversed": e.reversed,
            "effective": e.effective,
        },
        "corrections": [correction_payload(c) for c in receipt.corrections.order_by("occurred_at")],
        "party": list_payload(receipt.party, with_balances=True),
        "locked_before": locked_before().isoformat(),
    }


def correction_payload(c: ReceiptCorrection) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "receipt_id": str(c.receipt_id),
        "kind": c.kind,
        "new_method": c.new_method,
        "new_reference": c.new_reference,
        "new_amount_minor": str(c.new_amount_minor) if c.new_amount_minor is not None else "",
        "new_business_date": c.new_business_date.isoformat() if c.new_business_date else "",
        "reason": c.reason,
        "decided_by_name": c.decided_by_name,
        "occurred_at": _iso(c.occurred_at),
    }


# ---------------------------------------------------------------------------
# PTY-08 — طباعة وتصدير ومشاركة الكشف (ACC-85)
# ---------------------------------------------------------------------------

#: الكشف الأطول من هذا لا يُولَّد ملفاً — «مدى أقصر، أو طباعة مباشرة من الشاشة» (افتراض)
MAX_EXPORT_ROWS = 500
#: سطور الصفحة A4 المتوقَّعة (افتراض لعدّ الصفحات قبل التوليد)
ROWS_PER_PAGE = 40

_MONTHS_AR = (
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
)


def _day_month(d: date) -> str:
    return f"{d.day:02d} {_MONTHS_AR[d.month - 1]}"


def create_statement_export(
    party: Party,
    *,
    kind: str,
    rng: str,
    include_invoices: bool,
    include_branch: bool,
    actor: User,
    visible_branch_ids: list[uuid.UUID] | None,
) -> StatementExport:
    """لقطة الكشف بحقولها المختارة ووقت توليدها: ملف (PDF بطباعة المستند) أو رابط مخوَّل. الطويل
    يُرفض بسبب (`too_long`) والبديل مدى أقصر أو الطباعة المباشرة."""
    if kind not in ("pdf", "link"):
        raise CardRejected("invalid", "kind")
    since = None if rng == "all" else timezone.now() - timedelta(days=30)
    body = statement_payload(party, visible_branch_ids=visible_branch_ids, since=since)
    if len(body["rows"]) > MAX_EXPORT_ROWS:
        raise CardRejected("too_long", "range")
    names = {str(b.id): b.name for b in Branch.objects.all()}
    rows = [{**r, "branch_name": names.get(str(r.get("branch_id", "")), "")} for r in body["rows"]]
    now = timezone.localtime()
    range_label = "كامل" if rng == "all" else "30-يوماً"
    file_name = f"كشف-حساب-{party.name}-{range_label}-{now:%Y%m%d-%H%M}.pdf"
    export: StatementExport = StatementExport.objects.create(
        tenant_id=require_tenant(),
        party=party,
        kind=kind,
        range="all" if rng == "all" else "30",
        include_invoices=include_invoices,
        include_branch=include_branch,
        file_name=file_name,
        page_count=max(1, math.ceil(len(body["rows"]) / ROWS_PER_PAGE)),
        token=secrets.token_urlsafe(24),
        snapshot={
            "tenant_name": body["tenant_name"],
            "party_name": party.name,
            "as_of": body["as_of"],
            "balance_minor": body["balance_minor"],
            "hidden_other_branch": body["hidden_other_branch"],
            "rows": rows,
        },
        generated_by_user_id=actor.id,
        generated_by_name=actor.display_name,
    )
    return export


def export_payload(e: StatementExport) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "party_id": str(e.party_id),
        "kind": e.kind,
        "range": e.range,
        "include_invoices": e.include_invoices,
        "include_branch": e.include_branch,
        "file_name": e.file_name,
        "page_count": e.page_count,
        "url": f"/api/parties/exports/{e.token}",
        "generated_at": _iso(e.generated_at),
        "generated_by_name": e.generated_by_name,
        "opened_at": _iso(e.opened_at),
        "open_count": e.open_count,
    }


def open_export(token: str) -> StatementExport | None:
    """فتح الرابط المخوَّل يُسجَّل «تم الاطلاع» — الشيء الوحيد الذي نعرفه عن الوصول (ACC-85)."""
    e: StatementExport | None = StatementExport.unscoped.filter(token=token).first()
    if e is None:
        return None
    e.open_count += 1
    if e.opened_at is None:
        e.opened_at = timezone.now()
    e.save(update_fields=["open_count", "opened_at"])
    return e


def _fmt_minor(v: str) -> str:
    n = int(v or "0")
    sign = "-" if n < 0 else ""
    n = abs(n)
    return f"{sign}{n // 100:,}.{n % 100:02d}"


def render_export_html(e: StatementExport) -> str:
    """المستند نفسه: ترويسة المنشأة والكشف حتى تاريخه ووقت التوليد، السطور بالحقول المختارة،
    والرصيد المستحق. RTL وأرقام لاتينية؛ يُطبع أو يُحفظ PDF من المتصفح."""
    snap = e.snapshot
    as_of = parse_datetime(str(snap.get("as_of", ""))) or e.generated_at
    gen = timezone.localtime(e.generated_at)
    esc = html.escape
    head = [esc("التاريخ"), esc("البيان")]
    if e.include_invoices:
        head.append(esc("المستند"))
    if e.include_branch:
        head.append(esc("الفرع"))
    head += [esc("عليه"), esc("له"), esc("الرصيد")]
    rows_html: list[str] = []
    for r in snap.get("rows", []):
        bd = (
            parse_date(str(r.get("business_date", "")))
            or (parse_datetime(str(r.get("occurred_at", ""))) or as_of).date()
        )
        cells = [f"<td class=m>{_day_month(bd)}</td>", f"<td>{esc(str(r.get('label', '')))}</td>"]
        if e.include_invoices:
            cells.append(f"<td class=m>{esc(str(r.get('doc', '')))}</td>")
        if e.include_branch:
            cells.append(f"<td>{esc(str(r.get('branch_name', '') or 'الرئيسي'))}</td>")
        debit = str(r.get("debit_minor", "") or "")
        credit = str(r.get("credit_minor", "") or "")
        cells += [
            f"<td class=m>{_fmt_minor(debit) if debit else '—'}</td>",
            f"<td class=m>{_fmt_minor(credit) if credit else '—'}</td>",
            f"<td class=m>{_fmt_minor(str(r.get('balance_minor', '0')))}</td>",
        ]
        rows_html.append("<tr>" + "".join(cells) + "</tr>")
    balance = _fmt_minor(str(snap.get("balance_minor", "0")))
    hidden = int(snap.get("hidden_other_branch", 0) or 0)
    hidden_note = (
        f"<p class=note>{hidden} حركة في فرع آخر تدخل الرصيد دون تفاصيلها.</p>" if hidden else ""
    )
    return f"""<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>{esc(e.file_name)}</title>
<style>
body{{font-family:system-ui,sans-serif;margin:24px;color:#0f172a}}
h1{{font-size:18px;margin:0}} .sub{{color:#475569;font-size:13px}}
table{{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}}
th,td{{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:start}}
.m{{font-family:ui-monospace,Menlo,monospace;direction:ltr;text-align:end;unicode-bidi:isolate}}
.total{{display:flex;justify-content:space-between;border-top:1px solid #cbd5e1;
  margin-top:10px;padding-top:8px;font-weight:600}}
.note{{color:#475569;font-size:12px}}
@page{{size:A4;margin:16mm}}
</style></head><body>
<h1>{esc(str(snap.get("tenant_name", "")))}</h1>
<p class=sub>كشف حساب: {esc(str(snap.get("party_name", "")))} · حتى {_day_month(as_of.date())}
 · وُلِّد <span class=m>{gen:%Y-%m-%d %H:%M}</span></p>
<table><thead><tr>{"".join(f"<th>{h}</th>" for h in head)}</tr></thead>
<tbody>{"".join(rows_html)}</tbody></table>
{hidden_note}
<div class=total><span>الرصيد المستحق</span><span class=m>{balance}</span></div>
</body></html>"""
