"""أسعار الكتالوج (CAT-04/CAT-05): السعر سلسلة تواريخ لا قيمة واحدة؛ الاستيراد دفعةٌ بهوية.

- تغيير سعر صنف واحد للمالك (السعر قرار منشأة لا فرع)؛ مدير الفرع يرى السعر وتاريخه ويطلب تغييراً.
- «سعر دون التكلفة»: ننبّه ولا نمنع — تأكيد واحد؛ ولمن لا يرى التكلفة لا تنبيه أصلاً. متوسط التكلفة
  من مزوّد تسجّله INV/PUR حين تُبنى (`COST_PROVIDERS`)؛ حتى ذلك الحين لا تكلفة فلا تنبيه.
- الاستيراد (§١٤.٢): معاينة قبل الاعتماد بلا كتابة؛ الدفعة تُعرَّف ببصمة الملف فلا يكرّر رفعُه
  التطبيق؛ يُستورد السليم ويُصدَّر المرفوض بسببه ورقم سطره (R-06)؛ التطبيق على دفعات صغيرة
  فما اكتمل يبقى ويُستأنف؛ التراجع دفعةً خلال 24 ساعة ما لم يُبع بالسعر الجديد.
- التسعير الجماعي محجوب بعد انتهاء الاشتراك (§١١.٢) — من مزوّد `BULK_PRICING_BLOCKERS` (ORG لاحقاً).
"""

from __future__ import annotations

import csv
import hashlib
import io
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from catalog.limits import PRICE_MAX_MINOR, FieldError, Rejected, check_integer
from catalog.models import Item, ItemPrice, PriceChangeRequest, PriceImportBatch
from catalog.services import _iso, _log_item, record_price
from core.models import User
from core.money import line_total_minor
from core.search_normalize import normalize_search
from core.tenancy import require_tenant

#: متوسط تكلفة الصنف بالوحدة الصغرى أو None — تسجّله INV/PUR
COST_PROVIDERS: list[Callable[[Item], int | None]] = []
#: عدد سطور البيع بسعر (منذ وقت) — تسجّله POS؛ يمنع التراجع عن دفعة بيع بسعرها
PRICE_USAGE_PROVIDERS: list[Callable[[Item, int, Any], int]] = []
#: هل التسعير الجماعي محجوب لهذا المستأجر (انتهاء الاشتراك §١١.٢) — تسجّله ORG
BULK_PRICING_BLOCKERS: list[Callable[[uuid.UUID], bool]] = []

REVERT_WINDOW = timedelta(hours=24)
APPLY_CHUNK = 50
#: من يغيّر السعر: المالك (السعر قرار منشأة لا فرع)
PRICE_ROLES = {"owner"}
#: من يرى التكلفة حتى قرار G-03: المالك
COST_ROLES = {"owner"}


def average_cost_minor(item: Item) -> int | None:
    for p in COST_PROVIDERS:
        v = p(item)
        if v is not None:
            return v
    return None


def sold_at_price(item: Item, price_minor: int, since: Any) -> int:
    return sum(p(item, price_minor, since) for p in PRICE_USAGE_PROVIDERS)


def bulk_pricing_blocked(tenant_id: uuid.UUID) -> bool:
    return any(b(tenant_id) for b in BULK_PRICING_BLOCKERS)


def price_payload(p: ItemPrice) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "price_minor": str(p.price_minor),
        "effective_from": _iso(p.effective_from),
        "effective_to": _iso(p.effective_to),
        "changed_by_name": p.changed_by_name,
        "batch_id": str(p.batch_id) if p.batch_id else "",
        "note": p.note,
    }


def price_view(item: Item, *, can_change: bool, can_see_cost: bool) -> dict[str, Any]:
    """CAT-04 ready: السعر الساري وتاريخه، وأسعار الوحدات الأكبر التي تتبع تلقائياً، والتكلفة
    لمن يراها."""
    history = [price_payload(p) for p in item.prices.order_by("-effective_from", "-id")]
    units = [
        {
            "id": str(u.id),
            "name": u.unit.name,
            "factor_milli": str(u.factor_milli),
            "price_minor": str(line_total_minor(u.factor_milli, item.sale_price_minor)),
        }
        for u in item.units.select_related("unit").order_by("factor_milli")
    ]
    cost = average_cost_minor(item) if can_see_cost else None
    return {
        "item_id": str(item.id),
        "name": item.name,
        "base_unit_name": item.base_unit.name,
        "sale_price_minor": str(item.sale_price_minor),
        "price_updated_at": _iso(item.price_updated_at),
        "units": units,
        "history": history,
        "can_change": can_change,
        "can_see_cost": can_see_cost,
        "average_cost_minor": str(cost) if cost is not None else "",
        "pending_requests": [
            {
                "id": str(r.id),
                "proposed_price_minor": str(r.proposed_price_minor),
                "reason": r.reason,
                "requested_by_name": r.requested_by_name,
                "requested_at": _iso(r.requested_at),
            }
            for r in item.price_requests.filter(status="pending").order_by("requested_at")
        ],
    }


class BelowCost(Exception):
    """سعر دون التكلفة — ننبّه ولا نمنع: يحتاج تأكيداً واحداً."""

    def __init__(self, cost_minor: int, price_minor: int) -> None:
        super().__init__(str(price_minor))
        self.cost_minor = cost_minor
        self.price_minor = price_minor
        self.margin_minor = price_minor - cost_minor


def set_price(
    item: Item,
    price_minor: Any,
    *,
    changed_by: User | None,
    confirm_below_cost: bool = False,
    can_see_cost: bool,
    batch: PriceImportBatch | None = None,
    note: str = "",
) -> ItemPrice | None:
    """يسجّل سعراً جديداً يسري من الآن؛ الفواتير السابقة بأسعارها. السعر نفسه لا يُسجَّل سطراً."""
    errs = check_integer("price_minor", price_minor, 0, PRICE_MAX_MINOR)
    if errs:
        raise Rejected(errs)
    new = int(price_minor)
    if new == item.sale_price_minor:
        return None
    if can_see_cost and not confirm_below_cost:
        cost = average_cost_minor(item)
        if cost is not None and new < cost:
            raise BelowCost(cost, new)
    with transaction.atomic():
        row = record_price(item, new, changed_by=changed_by, batch=batch, note=note)
        item.save(update_fields=["sale_price_minor", "price_updated_at", "updated_at"])
        _log_item(item)
        return row


def request_change(
    item: Item, proposed_price_minor: Any, reason: str, *, requested_by: User | None
) -> PriceChangeRequest:
    errs = check_integer("proposed_price_minor", proposed_price_minor, 0, PRICE_MAX_MINOR)
    if len(reason) > 300:
        errs.append(FieldError("reason", "too_long", limit=300, actual=len(reason)))
    if errs:
        raise Rejected(errs)
    req: PriceChangeRequest = PriceChangeRequest.objects.create(
        tenant_id=require_tenant(),
        item=item,
        proposed_price_minor=int(proposed_price_minor),
        reason=reason.strip(),
        requested_by=requested_by,
        requested_by_name=requested_by.display_name if requested_by else "",
    )
    return req


# ─── الاستيراد المتعدد (CAT-05) ──────────────────────────────────────────────

REJECT_REASONS = {
    "not_a_number": "سعر غير رقمي",
    "negative": "سعر سالب",
    "out_of_range": "سعر خارج الحدّ",
    "item_not_found": "لا صنف بهذا المعرّف",
    "duplicate": "الصنف مكرّر في الملف",
    "missing_item": "بلا معرّف صنف",
}


@dataclass(frozen=True)
class ParsedFile:
    rows: list[dict[str, Any]]
    ready: int
    rejected: int
    unchanged: int


def _parse_price(text: str) -> tuple[int | None, str]:
    latin = (
        text.strip()
        .replace("٫", ".")
        .replace("،", "")
        .replace(",", "")
        .translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    )
    if not latin:
        return None, "not_a_number"
    neg = latin.startswith("-")
    body = latin[1:] if neg else latin
    whole, _, frac = body.partition(".")
    if not whole.isdigit() or (frac and not frac.isdigit()) or len(frac) > 2:
        return None, "not_a_number"
    minor = int(whole) * 100 + int((frac or "0").ljust(2, "0"))
    if neg:
        return None, "negative"
    if minor > PRICE_MAX_MINOR:
        return None, "out_of_range"
    return minor, ""


def _find_item(
    key: str, by_id: dict[str, Item], by_barcode: dict[str, Item], by_name: dict[str, Item]
) -> Item | None:
    k = key.strip()
    if not k:
        return None
    try:
        uid = str(uuid.UUID(k))
    except ValueError:
        uid = ""
    return by_id.get(uid) or by_barcode.get(k) or by_name.get(normalize_search(k))


def parse_prices_csv(content: str) -> ParsedFile:
    """CSV بعمودين: الصنف (معرّف أو باركود أو اسم) والسعر؛ الصف الأول رؤوس. المطابقة بالمعرّف
    لا بالترتيب."""
    items = list(Item.objects.select_related("base_unit"))
    by_id = {str(i.id): i for i in items}
    by_barcode = {i.barcode: i for i in items if i.barcode}
    by_name = {i.name_normalized: i for i in items}
    reader = csv.reader(io.StringIO(content.lstrip("﻿")))
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    ready = rejected = unchanged = 0
    for n, raw in enumerate(reader, start=1):
        if n == 1 or not any(c.strip() for c in raw):
            continue
        key = raw[0] if len(raw) > 0 else ""
        price_text = raw[1] if len(raw) > 1 else ""
        item = _find_item(key, by_id, by_barcode, by_name)
        row: dict[str, Any] = {
            "line": n,
            "key": key.strip(),
            "price_text": price_text.strip(),
            "item_id": str(item.id) if item else "",
            "name": item.name if item else key.strip(),
            "old_price_minor": str(item.sale_price_minor) if item else "",
            "new_price_minor": "",
            "result": "rejected",
            "reason": "",
        }
        minor, err = _parse_price(price_text)
        if not key.strip():
            row["reason"] = "missing_item"
        elif item is None:
            row["reason"] = "item_not_found"
        elif err:
            row["reason"] = err
        elif str(item.id) in seen:
            row["reason"] = "duplicate"
        else:
            seen.add(str(item.id))
            assert minor is not None
            row["new_price_minor"] = str(minor)
            row["reason"] = ""
            if minor == item.sale_price_minor:
                row["result"] = "unchanged"
                unchanged += 1
            else:
                row["result"] = "update"
                ready += 1
        if row["result"] == "rejected":
            rejected += 1
        rows.append(row)
    return ParsedFile(rows, ready, rejected, unchanged)


def batch_payload(b: PriceImportBatch) -> dict[str, Any]:
    changes = [r for r in b.rows if r["result"] == "update"]
    max_increase_pct = 0
    for r in changes:
        old = int(r["old_price_minor"] or 0)
        new = int(r["new_price_minor"])
        if old > 0 and new > old:
            max_increase_pct = max(max_increase_pct, (new - old) * 100 // old)
    return {
        "id": str(b.id),
        "file_name": b.file_name,
        "status": b.status,
        "rows": b.rows,
        "ready_count": b.ready_count,
        "rejected_count": b.rejected_count,
        "unchanged_count": b.unchanged_count,
        "applied_count": b.applied_count,
        "max_increase_pct": max_increase_pct,
        "created_at": _iso(b.created_at),
        "applied_at": _iso(b.applied_at),
        "reverted_at": _iso(b.reverted_at),
        "revert_until": _iso(b.applied_at + REVERT_WINDOW) if b.applied_at else "",
        "applied": [r for r in changes if r.get("applied")],
    }


def preview_batch(*, file_name: str, content: str, created_by: User | None) -> PriceImportBatch:
    """المعاينة تقرأ كاملاً ولا تكتب شيئاً؛ الملف نفسه (بصمته) يعيد دفعته لا دفعة جديدة."""
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    existing: PriceImportBatch | None = PriceImportBatch.objects.filter(file_sha256=digest).first()
    if existing is not None:
        return existing
    parsed = parse_prices_csv(content)
    b: PriceImportBatch = PriceImportBatch.objects.create(
        tenant_id=require_tenant(),
        file_name=file_name[:200],
        file_sha256=digest,
        rows=parsed.rows,
        ready_count=parsed.ready,
        rejected_count=parsed.rejected,
        unchanged_count=parsed.unchanged,
        created_by=created_by,
        created_by_name=created_by.display_name if created_by else "",
    )
    return b


def apply_batch(
    b: PriceImportBatch, *, applied_by: User | None, stop_after: int | None = None
) -> PriceImportBatch:
    """يطبّق الصفوف الصالحة على دفعات صغيرة كلٌّ في معاملتها: ما اكتمل يبقى، وإعادة الاستدعاء
    تستأنف من حيث وقفت بلا تكرار (الصف المطبَّق موسوم)."""
    if b.status in {"applied", "reverted"}:
        return b
    b.status = "applying"
    b.save(update_fields=["status"])
    rows = list(b.rows)
    pending = [i for i, r in enumerate(rows) if r["result"] == "update" and not r.get("applied")]
    done_now = 0
    cut = False
    for start in range(0, len(pending), APPLY_CHUNK):
        chunk = pending[start : start + APPLY_CHUNK]
        with transaction.atomic():
            for i in chunk:
                r = rows[i]
                item = Item.objects.filter(id=r["item_id"]).select_related("base_unit").first()
                if item is not None:
                    set_price(
                        item,
                        r["new_price_minor"],
                        changed_by=applied_by,
                        can_see_cost=False,
                        batch=b,
                        note=f"دفعة {b.file_name}",
                    )
                r["applied"] = True
                r["applied_at"] = _iso(timezone.now())
                done_now += 1
                if stop_after is not None and done_now >= stop_after:
                    cut = True  # محاكاة انقطاع: ما اكتمل يبقى
                    break
            b.rows = rows
            b.applied_count = sum(1 for r in rows if r.get("applied"))
            b.save(update_fields=["rows", "applied_count"])
        if cut:
            return b
    b.status = "applied"
    b.applied_at = timezone.now()
    b.save(update_fields=["status", "applied_at"])
    return b


class RevertRefused(Exception):
    def __init__(self, reason: str, **extra: Any) -> None:
        super().__init__(reason)
        self.reason = reason
        self.extra = extra


def revert_batch(b: PriceImportBatch, *, reverted_by: User | None) -> PriceImportBatch:
    """التراجع دفعةً خلال 24 ساعة ما لم يُبع بالسعر الجديد — وبعدها تصير جزءاً من الدفتر."""
    if b.status != "applied" or b.applied_at is None:
        raise RevertRefused("not_applied")
    if timezone.now() > b.applied_at + REVERT_WINDOW:
        raise RevertRefused("window_passed", until=_iso(b.applied_at + REVERT_WINDOW))
    rows = list(b.rows)
    applied = [r for r in rows if r.get("applied")]
    items = {
        str(i.id): i
        for i in Item.objects.filter(id__in=[r["item_id"] for r in applied]).select_related(
            "base_unit"
        )
    }
    for r in applied:
        item = items.get(r["item_id"])
        if item is None:
            continue
        sold = sold_at_price(item, int(r["new_price_minor"]), b.applied_at)
        if sold > 0:
            raise RevertRefused("sold_at_new_price", item_name=item.name, sold=sold)
    with transaction.atomic():
        for r in applied:
            item = items.get(r["item_id"])
            if item is None:
                continue
            set_price(
                item,
                r["old_price_minor"] or "0",
                changed_by=reverted_by,
                can_see_cost=False,
                batch=b,
                note=f"تراجع عن دفعة {b.file_name}",
            )
        b.status = "reverted"
        b.reverted_at = timezone.now()
        b.save(update_fields=["status", "reverted_at"])
    return b


def rejected_csv(b: PriceImportBatch) -> str:
    """المرفوض بسببه ورقم سطره ليُصحَّح ويُعاد (R-06)."""
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["السطر", "الصنف", "السعر", "السبب"])
    for r in b.rows:
        if r["result"] == "rejected":
            w.writerow(
                [
                    r["line"],
                    r["key"],
                    r.get("price_text", ""),
                    REJECT_REASONS.get(r["reason"], r["reason"]),
                ]
            )
    return "﻿" + out.getvalue()
