"""استيراد بيانات بمعاينة (SYS-10؛ §١٤.٢؛ ACC-38، 72، 86، 93): قالب أصناف/وحدات/أسعار وقالب
أطراف/افتتاحيات.

- الملف يُقرأ كاملاً ويُعرض تقريره ثم يُكتب بعد موافقة — لا كتابة أثناء الفحص.
- المطابقة تُقترح من العناوين ولا تُفترض؛ الوحدة إلزامية للصنف (قاعدة CAT-02 نفسها).
- لا نرفض الملف كلّه: يُستورد السليم ويُصدَّر المرفوض بسبب كل صف ورقم سطره؛ المكرر داخل الملف
  بسعرين يحتاج قراراً لا اختياراً صامتاً.
- الدفعة بهوية: بصمة الملف داخل المستأجر — رفعه ثانيةً يُكتشف ولا يُضاعف؛ والاستئناف ببصمة كل صف.
- التراجع دفعةً خلال 24 ساعة ما لم تُبع أصنافها.
"""

from __future__ import annotations

import csv
import hashlib
import io
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from catalog.limits import NAME_MAX_LEN, Rejected
from catalog.models import DataImportBatch, Item
from catalog.prices import _parse_price, set_price, sold_at_price
from catalog.services import _iso, create_item, deactivate_item, movement_count
from core.models import Unit, User
from core.search_normalize import normalize_search
from core.tenancy import require_tenant
from parties.models import Party
from parties.services import create_party, record_opening_balance

REVERT_WINDOW = timedelta(hours=24)
APPLY_CHUNK = 50

ITEM_FIELDS = ("name", "unit", "price", "barcode")
PARTY_FIELDS = ("name", "phone", "opening", "side")

# تخمين المطابقة من العناوين — يُعرض للتعديل لا يُفترض
HEADER_HINTS: dict[str, tuple[str, ...]] = {
    "name": ("الصنف", "اسم", "name", "item", "الاسم", "الطرف", "العميل", "party"),
    "unit": ("الوحدة", "unit", "وحدة"),
    "price": ("السعر", "price", "سعر"),
    "barcode": ("باركود", "barcode", "الباركود"),
    "phone": ("هاتف", "الهاتف", "phone", "جوال"),
    "opening": ("افتتاحي", "opening", "الرصيد", "رصيد", "balance"),
    "side": ("صفة", "side", "نوع"),
}

REJECT_REASONS = {
    "name_required": "الاسم فارغ",
    "name_too_long": "الاسم أطول من المسموح",
    "unit_required": "الوحدة فارغة. بلا وحدة لا يمكن حساب مخزون ولا سعر بيع.",
    "unit_unknown": "الوحدة غير معرَّفة في المنشأة",
    "negative": "سعر سالب. لا نصحّحه نيابةً عنك ولا نستورده كصفر.",
    "not_a_number": "السعر ليس رقماً",
    "out_of_range": "السعر خارج المدى",
    "barcode_duplicate_in_file": "باركود مكرر داخل الملف نفسه",
    "barcode_taken": "الباركود مستعمل لصنف آخر",
    "duplicate_in_file": "مكرر داخل الملف",
    "opening_invalid": "الرصيد الافتتاحي ليس رقماً موجباً",
    "side_invalid": "الصفة يجب أن تكون «عميل» أو «مورد»",
    "phone_taken": "الهاتف مسجَّل لطرف آخر",
}


def suggest_mapping(headers: list[str], kind: str) -> dict[str, int]:
    """يخمّن عمود كل حقل من العناوين؛ ما لم يُعرف يبقى بلا عمود (−1) ليُطابقه المستخدم."""
    fields = ITEM_FIELDS if kind == "items" else PARTY_FIELDS
    out: dict[str, int] = {}
    for f in fields:
        out[f] = -1
        for i, h in enumerate(headers):
            hn = h.strip().lower()
            if any(k in hn for k in HEADER_HINTS.get(f, ())):
                if i not in out.values():
                    out[f] = i
                    break
    return out


def read_rows(content: str) -> tuple[list[str], list[tuple[int, list[str]]]]:
    reader = csv.reader(io.StringIO(content.lstrip("﻿")))
    headers: list[str] = []
    rows: list[tuple[int, list[str]]] = []
    for n, raw in enumerate(reader, start=1):
        if n == 1:
            headers = [c.strip() for c in raw]
            continue
        if not any(c.strip() for c in raw):
            continue
        rows.append((n, raw))
    return headers, rows


def _cell(raw: list[str], idx: int) -> str:
    return raw[idx].strip() if 0 <= idx < len(raw) else ""


def _row_hash(kind: str, values: dict[str, str]) -> str:
    return hashlib.sha256(
        (kind + "|" + "|".join(f"{k}={values[k]}" for k in sorted(values))).encode()
    ).hexdigest()[:16]


def _parse_items(
    rows: list[tuple[int, list[str]]], mapping: dict[str, int]
) -> list[dict[str, Any]]:
    units = {u.code.lower(): u for u in Unit.objects.all()}
    units.update({normalize_search(u.name): u for u in Unit.objects.all()})
    items = list(Item.objects.select_related("base_unit"))
    by_barcode = {i.barcode: i for i in items if i.barcode}
    by_name = {i.name_normalized: i for i in items}
    out: list[dict[str, Any]] = []
    seen_barcode: dict[str, int] = {}
    seen_name: dict[str, dict[str, Any]] = {}
    for line, raw in rows:
        values = {f: _cell(raw, mapping.get(f, -1)) for f in ITEM_FIELDS}
        row: dict[str, Any] = {
            "line": line,
            "row_hash": _row_hash("items", values),
            "values": values,
            "item_id": "",
            "unit_id": "",
            "price_minor": "",
            "old_price_minor": "",
            "result": "rejected",
            "reason": "",
        }
        name = values["name"]
        unit_key = values["unit"]
        unit = (
            units.get(unit_key.lower()) or units.get(normalize_search(unit_key))
            if unit_key
            else None
        )
        price_minor, perr = _parse_price(values["price"]) if values["price"] else (0, "")
        existing = by_barcode.get(values["barcode"]) if values["barcode"] else None
        if existing is None:
            existing = by_name.get(normalize_search(name)) if name else None
        if not name:
            row["reason"] = "name_required"
        elif len(name) > NAME_MAX_LEN:
            row["reason"] = "name_too_long"
        elif existing is None and not unit_key:
            row["reason"] = "unit_required"
        elif existing is None and unit is None:
            row["reason"] = "unit_unknown"
        elif perr:
            row["reason"] = perr
        elif values["barcode"] and values["barcode"] in seen_barcode:
            row["reason"] = "barcode_duplicate_in_file"
            row["duplicate_of_line"] = seen_barcode[values["barcode"]]
        elif (
            values["barcode"]
            and values["barcode"] in by_barcode
            and existing is not None
            and by_barcode[values["barcode"]].id != existing.id
        ):
            row["reason"] = "barcode_taken"
        else:
            key = normalize_search(name)
            row["price_minor"] = str(price_minor)
            if existing is not None:
                row["item_id"] = str(existing.id)
                row["old_price_minor"] = str(existing.sale_price_minor)
            elif unit is not None:
                row["unit_id"] = str(unit.id)
            prior = seen_name.get(key)
            if prior is not None:
                if prior["price_minor"] != str(price_minor):
                    # مكرر بسعر مختلف: نسأل ولا نختار — الصفّان بأرقام أسطرهما
                    row["result"] = "needs_decision"
                    row["reason"] = "duplicate_in_file"
                    row["duplicate_of_line"] = prior["line"]
                    prior["result"] = "needs_decision"
                    prior["duplicate_of_line"] = line
                else:
                    row["reason"] = "duplicate_in_file"
                    row["duplicate_of_line"] = prior["line"]
                out.append(row)
                continue
            row["result"] = "update" if existing is not None else "create"
            row["reason"] = ""
            if values["barcode"]:
                seen_barcode[values["barcode"]] = line
            seen_name[key] = row
        out.append(row)
    return out


def _parse_parties(
    rows: list[tuple[int, list[str]]], mapping: dict[str, int]
) -> list[dict[str, Any]]:
    parties = list(Party.objects.all())
    by_phone = {p.phone: p for p in parties if p.phone}
    by_name = {p.name_normalized: p for p in parties}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line, raw in rows:
        values = {f: _cell(raw, mapping.get(f, -1)) for f in PARTY_FIELDS}
        row: dict[str, Any] = {
            "line": line,
            "row_hash": _row_hash("parties", values),
            "values": values,
            "party_id": "",
            "opening_minor": "",
            "side": "",
            "result": "rejected",
            "reason": "",
        }
        name = values["name"]
        opening, oerr = _parse_price(values["opening"]) if values["opening"] else (0, "")
        side_raw = values["side"].strip().lower()
        side = (
            "supplier_owed"
            if side_raw in ("مورد", "supplier", "supplier_owed")
            else "customer_due"
            if side_raw in ("", "عميل", "customer", "customer_due")
            else ""
        )
        key = normalize_search(name)
        if not name:
            row["reason"] = "name_required"
        elif oerr:
            row["reason"] = "opening_invalid"
        elif not side:
            row["reason"] = "side_invalid"
        elif key in seen:
            row["reason"] = "duplicate_in_file"
        elif (
            values["phone"]
            and values["phone"] in by_phone
            and by_phone[values["phone"]].name_normalized != key
        ):
            row["reason"] = "phone_taken"
        else:
            seen.add(key)
            row["opening_minor"] = str(opening or 0)
            row["side"] = side
            existing = by_name.get(key)
            if existing is not None:
                row["party_id"] = str(existing.id)
                row["result"] = "update"
            else:
                row["result"] = "create"
        out.append(row)
    return out


def _counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "create": sum(1 for r in rows if r["result"] == "create"),
        "update": sum(1 for r in rows if r["result"] == "update"),
        "rejected": sum(1 for r in rows if r["result"] == "rejected"),
        "decision": sum(1 for r in rows if r["result"] == "needs_decision"),
    }


def batch_payload(b: DataImportBatch) -> dict[str, Any]:
    return {
        "id": str(b.id),
        "kind": b.kind,
        "file_name": b.file_name,
        "status": b.status,
        "mapping": b.mapping,
        "rows": b.rows,
        "total_rows": len(b.rows),
        "create_count": b.create_count,
        "update_count": b.update_count,
        "rejected_count": b.rejected_count,
        "decision_count": b.decision_count,
        "applied_count": b.applied_count,
        "created_at": _iso(b.created_at),
        "applied_at": _iso(b.applied_at),
        "reverted_at": _iso(b.reverted_at),
        "revert_until": _iso(b.applied_at + REVERT_WINDOW) if b.applied_at else "",
        "already_imported": b.status in ("applied", "reverted"),
    }


def preview(
    *,
    kind: str,
    file_name: str,
    content: str,
    mapping: dict[str, int] | None,
    created_by: User | None,
) -> tuple[DataImportBatch, list[str], dict[str, int]]:
    """يقرأ كاملاً ولا يكتب؛ الملف نفسه (بصمته) يعيد دفعته — رفعه ثانيةً يُكتشف ولا يُضاعف."""
    if kind not in DataImportBatch.KINDS:
        raise ValueError("kind")
    digest = hashlib.sha256((kind + "\n" + content).encode("utf-8")).hexdigest()
    headers, rows = read_rows(content)
    suggested = suggest_mapping(headers, kind)
    existing: DataImportBatch | None = DataImportBatch.objects.filter(file_sha256=digest).first()
    if existing is not None and (mapping is None or mapping == existing.mapping):
        return existing, headers, suggested
    use = {**suggested, **(mapping or {})}
    parsed = _parse_items(rows, use) if kind == "items" else _parse_parties(rows, use)
    c = _counts(parsed)
    if existing is not None and existing.status == "previewed":
        existing.mapping = use
        existing.rows = parsed
        existing.create_count = c["create"]
        existing.update_count = c["update"]
        existing.rejected_count = c["rejected"]
        existing.decision_count = c["decision"]
        existing.save(
            update_fields=[
                "mapping",
                "rows",
                "create_count",
                "update_count",
                "rejected_count",
                "decision_count",
            ]
        )
        return existing, headers, suggested
    if existing is not None:
        return existing, headers, suggested
    b: DataImportBatch = DataImportBatch.objects.create(
        tenant_id=require_tenant(),
        kind=kind,
        file_name=file_name[:200],
        file_sha256=digest,
        mapping=use,
        rows=parsed,
        create_count=c["create"],
        update_count=c["update"],
        rejected_count=c["rejected"],
        decision_count=c["decision"],
        created_by=created_by,
        created_by_name=created_by.display_name if created_by else "",
    )
    return b, headers, suggested


def decide(b: DataImportBatch, decisions: dict[str, str]) -> DataImportBatch:
    """قرار المكرر داخل الملف: `keep` يُدخل الصف (ويُرفض نظيره)، `skip` يرفضه — لا اختيار صامت."""
    rows = list(b.rows)
    by_line = {str(r["line"]): r for r in rows}
    for line, choice in decisions.items():
        r = by_line.get(str(line))
        if r is None or r["result"] != "needs_decision":
            continue
        other = by_line.get(str(r.get("duplicate_of_line", "")))
        if choice == "keep":
            r["result"] = "update" if r.get("item_id") or r.get("party_id") else "create"
            r["reason"] = ""
            if other is not None and other["result"] == "needs_decision":
                other["result"] = "rejected"
                other["reason"] = "duplicate_in_file"
        elif choice == "skip":
            r["result"] = "rejected"
            r["reason"] = "duplicate_in_file"
            if other is not None and other["result"] == "needs_decision":
                other["result"] = (
                    "update" if other.get("item_id") or other.get("party_id") else "create"
                )
                other["reason"] = ""
    c = _counts(rows)
    b.rows = rows
    b.create_count, b.update_count, b.rejected_count, b.decision_count = (
        c["create"],
        c["update"],
        c["rejected"],
        c["decision"],
    )
    b.save(
        update_fields=["rows", "create_count", "update_count", "rejected_count", "decision_count"]
    )
    return b


def _apply_item_row(r: dict[str, Any], b: DataImportBatch, actor: User | None) -> None:
    v = r["values"]
    item: Item | None
    if r["result"] == "create":
        unit = Unit.objects.filter(id=r["unit_id"]).first()
        item = create_item(
            name=v["name"], base_unit=unit, barcode=v["barcode"], sale_price_minor=r["price_minor"]
        )
        r["item_id"] = str(item.id)
    else:
        item = Item.objects.filter(id=r["item_id"]).select_related("base_unit").first()
        if item is not None and r["price_minor"] != r["old_price_minor"]:
            set_price(
                item,
                r["price_minor"],
                changed_by=actor,
                can_see_cost=False,
                note=f"استيراد {b.file_name}",
            )


def _apply_party_row(r: dict[str, Any], b: DataImportBatch, actor: User | None) -> None:
    v = r["values"]
    party: Party | None
    if r["result"] == "create":
        party = create_party(
            party_id=None, name=v["name"], phone=v["phone"], created_by=actor, distinct_from=None
        )
        r["party_id"] = str(party.id)
    else:
        party = Party.objects.filter(id=r["party_id"]).first()
    # المورد يُوسم صفةً — الافتتاحي على جانب المورد يتطلبها
    if party is not None and r["side"] == "supplier_owed" and not party.is_supplier:
        party.is_supplier = True
        party.save(update_fields=["is_supplier"])
    if party is not None and int(r["opening_minor"] or 0) > 0 and actor is not None:
        try:
            record_opening_balance(
                party,
                side=r["side"],
                amount_minor=int(r["opening_minor"]),
                reason=f"استيراد {b.file_name}",
                reference=f"import:{b.id}:{r['line']}",
                business_date=timezone.localdate(),
                actor=actor,
            )
        except Exception as e:  # noqa: BLE001 — الافتتاحي مرة واحدة وقبل أول حركة: يُسجَّل سبب الرفض
            r["opening_error"] = str(e)[:120]


def apply(
    b: DataImportBatch, *, applied_by: User | None, stop_after: int | None = None
) -> DataImportBatch:
    """يكتب الصالح على دفعات صغيرة كلٌّ في معاملتها؛ الصف المكتوب موسوم ببصمته فالاستئناف لا
    يعيد كتابته ولا يكرّره. `stop_after` لمحاكاة الانقطاع."""
    if b.status in {"applied", "reverted"}:
        return b
    if b.decision_count > 0:
        raise Rejected([])
    b.status = "applying"
    b.save(update_fields=["status"])
    rows = list(b.rows)
    pending = [
        i
        for i, r in enumerate(rows)
        if r["result"] in ("create", "update") and not r.get("applied")
    ]
    done_now = 0
    cut = False
    for start in range(0, len(pending), APPLY_CHUNK):
        chunk = pending[start : start + APPLY_CHUNK]
        with transaction.atomic():
            for i in chunk:
                r = rows[i]
                try:
                    if b.kind == "items":
                        _apply_item_row(r, b, applied_by)
                    else:
                        _apply_party_row(r, b, applied_by)
                except Rejected as e:
                    r["result"] = "rejected"
                    r["reason"] = ", ".join(f"{x.field}:{x.code}" for x in e.errors)
                    continue
                r["applied"] = True
                r["applied_at"] = _iso(timezone.now())
                done_now += 1
                if stop_after is not None and done_now >= stop_after:
                    cut = True
                    break
            b.rows = rows
            b.applied_count = sum(1 for r in rows if r.get("applied"))
            c = _counts(rows)
            b.create_count, b.update_count, b.rejected_count = (
                c["create"],
                c["update"],
                c["rejected"],
            )
            b.save(
                update_fields=[
                    "rows",
                    "applied_count",
                    "create_count",
                    "update_count",
                    "rejected_count",
                ]
            )
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


def revert(b: DataImportBatch, *, reverted_by: User | None) -> DataImportBatch:
    """التراجع دفعةً خلال 24 ساعة ما لم تُباع أصنافها؛ الأصناف المنشأة تُعطَّل (لا حذف)."""
    if b.status != "applied" or b.applied_at is None:
        raise RevertRefused("not_applied")
    if timezone.now() > b.applied_at + REVERT_WINDOW:
        raise RevertRefused("window_passed", until=_iso(b.applied_at + REVERT_WINDOW))
    if b.kind != "items":
        raise RevertRefused("kind_not_revertible")
    applied = [r for r in b.rows if r.get("applied")]
    items = {
        str(i.id): i
        for i in Item.objects.filter(
            id__in=[r["item_id"] for r in applied if r["item_id"]]
        ).select_related("base_unit")
    }
    for r in applied:
        item = items.get(r["item_id"])
        if item is None:
            continue
        if r["result"] == "create" and movement_count(item) > 0:
            raise RevertRefused("item_sold", item_name=item.name)
        if r["result"] == "update" and sold_at_price(item, int(r["price_minor"]), b.applied_at) > 0:
            raise RevertRefused("sold_at_new_price", item_name=item.name)
    with transaction.atomic():
        for r in applied:
            item = items.get(r["item_id"])
            if item is None:
                continue
            if r["result"] == "create":
                deactivate_item(item)
            elif r["old_price_minor"] and r["old_price_minor"] != r["price_minor"]:
                set_price(
                    item,
                    r["old_price_minor"],
                    changed_by=reverted_by,
                    can_see_cost=False,
                    note=f"تراجع عن استيراد {b.file_name}",
                )
        b.status = "reverted"
        b.reverted_at = timezone.now()
        b.save(update_fields=["status", "reverted_at"])
    return b


def rejected_csv(b: DataImportBatch) -> str:
    """المرفوض بسببه ورقم سطره ليُصحَّح ويُعاد رفعه — رفض الملف كلّه لأجل بعضه إهدار."""
    fields = ITEM_FIELDS if b.kind == "items" else PARTY_FIELDS
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["السطر", *fields, "السبب"])
    for r in b.rows:
        if r["result"] in ("rejected", "needs_decision"):
            reason = REJECT_REASONS.get(r["reason"], r["reason"])
            if r.get("duplicate_of_line"):
                reason = f"{reason} (الصف {r['duplicate_of_line']})"
            w.writerow([r["line"], *(r["values"].get(f, "") for f in fields), reason])
    return "﻿" + out.getvalue()
