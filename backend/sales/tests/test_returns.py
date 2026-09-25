"""T1.20 — POS-10 المرتجع (§٧.٢–٧.٣؛ ACC-09/10/11): مستند مستقل يشير إلى أصله؛ صالح نقداً يعيد
المخزون والنقد بالضبط، تالف لا يزيد المخزون الصالح وأثر الحجر ظاهر، خصم ذمّة يخفّض الدين؛ الخادم يشتق
الآثار ولا يثق بالمرسل؛ التجاوز التراكمي للأصل يُقبل ويُوسم ليُراجع مركزياً لا يُمحى."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from catalog import services as catalog_services
from core.tenancy import tenant_context
from inventory import services as inventory_services
from parties import services as party_services
from sales.models import Sale, SaleReturn
from sales.tests.test_duplicates import _open_shift
from sales.tests.test_duplicates import ctx as ctx_fixture
from sales.tests.test_sale import ITEM, do_push, sale_op
from shifts import services as shift_services
from shifts.models import Shift

pytestmark = pytest.mark.django_db(transaction=True)
ctx = ctx_fixture


def return_op(
    c: dict[str, Any],
    sale: Sale,
    *,
    qty: str,
    condition: str = "good",
    destination: str = "cash",
    number: str = "RET-KRT-A2-26-000001",
    shift_id: str | None = None,
    movements: str = "auto",
) -> dict[str, Any]:
    with tenant_context(c["tenant"].id):
        line = sale.lines.get()
    rid = str(uuid.uuid4())
    q = int(qty)
    total = (q * line.unit_price_minor + 500) // 1000
    head: dict[str, Any] = {
        "return_id": rid,
        "return_number": number,
        "sale_id": str(sale.id),
        "branch_id": str(c["branch"].id),
        "device_id": str(c["device"].id),
        "user_id": str(c["owner"].id),
        "condition": condition,
        "destination": destination,
        "total_minor": str(total),
        "business_date": "2026-09-17",
        "occurred_at": "2026-09-17T11:00:00Z",
    }
    if shift_id:
        head["shift_id"] = shift_id
    if sale.party_id:
        head["party_id"] = str(sale.party_id)
    base = q * line.factor_milli // 1000
    members: list[dict[str, Any]] = [
        {"entity": "sales.SaleReturn", "id": rid, "schema_version": 1, "payload": head},
        {
            "entity": "sales.SaleReturnLine",
            "id": str(uuid.uuid4()),
            "schema_version": 1,
            "payload": {
                "line_id": "x",
                "return_id": rid,
                "sale_line_id": str(line.id),
                "item_id": ITEM,
                "factor_milli": str(line.factor_milli),
                "qty_milli": qty,
                "unit_price_minor": str(line.unit_price_minor),
                "line_total_minor": str(total),
            },
        },
    ]
    if movements == "auto":
        movements = "stock" if condition == "good" else "quarantine"
    if movements == "stock":
        members.append(
            {
                "entity": "inventory.StockMovement",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "movement_id": "m",
                    "branch_id": str(c["branch"].id),
                    "item_id": ITEM,
                    "delta_base_qty_milli": str(base),
                    "reason": "return",
                    "source_entity": "sales.SaleReturn",
                    "source_id": rid,
                    "occurred_at": "2026-09-17T11:00:00Z",
                },
            }
        )
    elif movements == "quarantine":
        members.append(
            {
                "entity": "inventory.QuarantineMovement",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "movement_id": "m",
                    "branch_id": str(c["branch"].id),
                    "item_id": ITEM,
                    "base_qty_milli": str(base),
                    "reason": "return_damaged",
                    "source_entity": "sales.SaleReturn",
                    "source_id": rid,
                    "occurred_at": "2026-09-17T11:00:00Z",
                },
            }
        )
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "sale_return",
        "op_version": 1,
        "dependencies": [],
        "members": members,
    }


def test_full_good_cash_return_restores_stock_and_cash_exactly(ctx: dict[str, Any]) -> None:
    """ACC-09 / §٧.٢: بيع نقدي 100 لقطعة ثم مرتجع صالح كامل نقداً → مخزون 0 (كما قبل البيع)،
    الدرج صفر، لا قيد ذمّة؛ الأصل باقٍ كما كان ومتكرّر الأثر."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    assert do_push(ctx, sale_op(ctx, invoice="INV-1", shift_id=sid)) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(invoice_number="INV-1")
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "-1000"}
    op = return_op(ctx, sale, qty="1000", shift_id=sid)
    assert do_push(ctx, op) == ["accepted"]
    assert do_push(ctx, op) == ["duplicate"]
    with tenant_context(ctx["tenant"].id):
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "0"}
        t = shift_services.cash_totals(Shift.objects.get(id=sid))
        assert t.cash_sales_minor == 10000 and t.cash_refunds_minor == 10000
        r = SaleReturn.objects.get()
        assert r.sale_id == sale.id and r.cash_minor == 10000 and r.credit_minor == 0
        assert r.exceeds_original is False
        assert Sale.objects.get(id=sale.id).total_minor == 10000  # الأصل لم يُمسّ
        assert inventory_services.branch_quarantine(ctx["branch"].id) == {}


def test_damaged_return_goes_to_quarantine_and_credit_refund_lowers_debt(
    ctx: dict[str, Any],
) -> None:
    """ACC-10 / §٧.٢: مرتجع تالف لا يزيد المخزون الصالح وأثر الحجر ظاهر؛ الردّ خصماً من ذمّة
    العميل يخفّض دينه (مدين 100 → صفر)؛ آجل بلا طرف مرفوض."""
    with tenant_context(ctx["tenant"].id):
        party = party_services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=ctx["owner"], distinct_from=None
        )
    credit_sale = sale_op(
        ctx, invoice="INV-C", party_id=str(party.id), payments=[("credit", "10000")]
    )
    assert do_push(ctx, credit_sale) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(invoice_number="INV-C")
        assert party_services.party_payload(party)["balance_minor"] == "10000"
    op = return_op(ctx, sale, qty="1000", condition="damaged", destination="credit")
    assert do_push(ctx, op) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "-1000"}
        assert inventory_services.branch_quarantine(ctx["branch"].id) == {uuid.UUID(ITEM): 1000}
        assert party_services.party_payload(party)["balance_minor"] == "0"
    # آجل بلا طرف: البيع النقدي بلا عميل لا يُردّ خصماً من ذمّة
    assert do_push(ctx, sale_op(ctx, invoice="INV-N")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        cash_sale = Sale.objects.get(invoice_number="INV-N")
    bad = return_op(ctx, cash_sale, qty="1000", destination="credit", number="RET-2")
    assert do_push(ctx, bad) == ["rejected"]


def test_server_derives_effects_and_flags_exceeding_returns(ctx: dict[str, Any]) -> None:
    """§٧.٣: حركة لا تطابق السطور، أو تالف يدخل المخزون الصالح، أو مجموع مرسل خاطئ — مرفوضة.
    ACC-11: ردّ 2 ثم ردّ 2 على مُباع 3 يُقبل ويُوسم `exceeds_original` للمراجعة، والتفاصيل تعرض
    المُرتجَع سابقاً لكل سطر."""
    assert do_push(ctx, sale_op(ctx, invoice="INV-3", qty="3000")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(invoice_number="INV-3")
    wrong_move = return_op(ctx, sale, qty="1000", number="R1")
    wrong_move["members"][2]["payload"]["delta_base_qty_milli"] = "2000"
    assert do_push(ctx, wrong_move) == ["rejected"]
    damaged_to_stock = return_op(ctx, sale, qty="1000", condition="damaged", movements="stock")
    assert do_push(ctx, damaged_to_stock) == ["rejected"]
    wrong_total = return_op(ctx, sale, qty="1000", number="R2")
    wrong_total["members"][0]["payload"]["total_minor"] = "9000"
    assert do_push(ctx, wrong_total) == ["rejected"]

    first = return_op(ctx, sale, qty="2000", number="R3")
    second = return_op(ctx, sale, qty="2000", number="R4")
    assert do_push(ctx, first) == ["accepted"]
    assert do_push(ctx, second) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        flags = {r.return_number: r.exceeds_original for r in SaleReturn.objects.all()}
        assert flags == {"R3": False, "R4": True}
        # المخزون عاد بالكمية المردودة كلها — الواقعة محفوظة ومسار تسويتها مركزي لا الرفض
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "1000"}
    c = Client()
    r = c.get(f"/api/sales/{sale.id}", HTTP_AUTHORIZATION=f"Bearer {ctx['access']}")
    assert r.status_code == 200
    body = r.json()
    assert body["lines"][0]["returned_qty_milli"] == "4000"
    assert [x["return_number"] for x in body["returns"]] == ["R3", "R4"]
    assert body["returns"][1]["exceeds_original"] is True


def test_late_cash_refund_listed_after_close(ctx: dict[str, Any]) -> None:
    """SHIFT-05: مرتجع نقدي وصل بعد إقفال الوردية يُعرض مستنداً متأخراً بإشارته السالبة."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    assert do_push(ctx, sale_op(ctx, invoice="INV-L", shift_id=sid)) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(invoice_number="INV-L")
        shift = Shift.objects.get(id=sid)
        shift.closed_at = timezone.now()
        shift.state = "closed"
        shift.save(update_fields=["closed_at", "state"])
    assert do_push(ctx, return_op(ctx, sale, qty="1000", shift_id=sid)) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        late = shift_services.late_items(Shift.objects.get(id=sid))
        assert [(i.kind, i.signed_amount_minor) for i in late] == [("refund", -10000)]


def _return_of(c: dict[str, Any], sale: dict[str, Any], *, op_id: str) -> dict[str, Any]:
    """مرتجع كامل لسطر البيع الأول من عملية بيع لم تُرفع بعد (بلا تبعية معلنة)."""
    head = sale["members"][0]["payload"]
    line = next(m for m in sale["members"] if m["entity"] == "sales.SaleLine")
    lp = line["payload"]
    rid = str(uuid.uuid4())
    return {
        "operation_id": op_id,
        "kind": "sale_return",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {
                "entity": "sales.SaleReturn",
                "id": rid,
                "schema_version": 1,
                "payload": {
                    "return_id": rid,
                    "return_number": "RET-KRT-A2-26-000009",
                    "sale_id": head["sale_id"],
                    "branch_id": str(c["branch"].id),
                    "device_id": str(c["device"].id),
                    "user_id": str(c["owner"].id),
                    "condition": "damaged",
                    "destination": "cash",
                    "total_minor": lp["line_total_minor"],
                    "business_date": "2026-09-17",
                    "occurred_at": "2026-09-17T11:00:00Z",
                },
            },
            {
                "entity": "sales.SaleReturnLine",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "line_id": "x",
                    "return_id": rid,
                    "sale_line_id": line["id"],
                    "item_id": ITEM,
                    "factor_milli": lp["factor_milli"],
                    "qty_milli": lp["qty_milli"],
                    "unit_price_minor": lp["unit_price_minor"],
                    "line_total_minor": lp["line_total_minor"],
                },
            },
            {
                "entity": "inventory.QuarantineMovement",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "movement_id": "m",
                    "branch_id": str(c["branch"].id),
                    "item_id": ITEM,
                    "base_qty_milli": lp["qty_milli"],
                    "reason": "return_damaged",
                    "source_entity": "sales.SaleReturn",
                    "source_id": rid,
                    "occurred_at": "2026-09-17T11:00:00Z",
                },
            },
        ],
    }


def test_return_after_its_sale_in_one_push_applies_in_device_order(ctx: dict[str, Any]) -> None:
    """0005 §١٣٠: ما لا تبعية بينه يُطبَّق بترتيب الجهاز لا بترتيب المعرّف — معرّف المرتجع أصغر
    من معرّف بيعه (UUIDv7 في الملّي ثانية نفسها) ولا يُسقط المرتجع."""
    sale = sale_op(ctx, invoice="INV-ORD")
    sale["operation_id"] = "ffffffff-ffff-4fff-bfff-ffffffffffff"
    ret = _return_of(ctx, sale, op_id="00000000-0000-4000-8000-000000000001")
    assert do_push(ctx, sale, ret) == ["accepted", "accepted"]
    with tenant_context(ctx["tenant"].id):
        r = SaleReturn.objects.get()
        assert r.sale.invoice_number == "INV-ORD" and r.lines.count() == 1


def test_return_of_unknown_sale_is_quarantined_not_dropped(ctx: dict[str, Any]) -> None:
    """مرتجع يشير إلى بيع لا يعرفه الخادم كان يُقبل صامتاً بلا أثر؛ الآن يُحجر بأصله للمراجعة."""
    from sync.models import QuarantinedOperation

    ghost = sale_op(ctx, invoice="INV-GHOST")  # لا يُرفع أبداً
    ret = _return_of(ctx, ghost, op_id=str(uuid.uuid4()))
    assert do_push(ctx, ret) == ["conflicted"]
    with tenant_context(ctx["tenant"].id):
        assert not SaleReturn.objects.exists()
        q = QuarantinedOperation.objects.get()
        assert q.reason == "conflicted" and q.code == "return_sale_unknown"
