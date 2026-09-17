"""T1.16 خط حفظ البيع: عملية `sale` بأعضائها (Sale/SaleLine/Payment/StockMovement) — الخادم يشتق
الإجمالي وحركة المخزون ولا يثق بما يرسله الجهاز (§٧.٣)؛ بيع نقدي 100 لقطعة: مخزون −1، صندوق +100،
لا قيد ذمّة (§٧.٢)؛ متكرّر الأثر؛ ويغذّي مزوّدي الوردية والكتالوج والأطراف والرئيسية.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from catalog import services as catalog_services
from conftest import TwoTenants
from core import home
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from inventory.models import StockMovement
from parties import services as party_services
from parties.models import Party
from sales.models import Payment, Sale, SaleLine
from shifts import services as shift_services
from shifts.models import Shift
from sync.counter import ensure_state
from sync.push import PROTOCOL_VERSION, push

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    with platform_context():
        owner = User.objects.create_user(
            tenant=two_tenants.a, username="salem", display_name="سالم", is_owner=True
        )
        role = Role.unscoped.create(tenant=two_tenants.a, code="owner", name="مالك")
        UserBranchAccess.unscoped.create(
            tenant=two_tenants.a, user=owner, branch=two_tenants.a_branches[0], role=role
        )
    with tenant_context(two_tenants.a.id):
        reg = register_device(user=owner, branch=two_tenants.a_branches[0], name="كاشير 2")
        epoch = ensure_state(two_tenants.a.id).sync_epoch
    return {
        "tenant": two_tenants.a,
        "branch": two_tenants.a_branches[0],
        "owner": owner,
        "device": reg.device,
        "epoch": epoch,
    }


def do_push(c: dict[str, Any], *ops: dict[str, Any]) -> list[str]:
    with tenant_context(c["tenant"].id):
        resp = push(
            device_id=c["device"].id,
            actor_user_id=c["owner"].id,
            envelope={
                "protocol_version": PROTOCOL_VERSION,
                "sync_epoch": c["epoch"],
                "request_id": str(uuid.uuid4()),
                "operations": list(ops),
            },
            branch_id=str(c["branch"].id),
        ).as_dict()
    return [r["status"] for r in resp["results"]]


ITEM = str(uuid.uuid4())
UNIT = str(uuid.uuid4())


def sale_op(
    c: dict[str, Any],
    *,
    qty: str = "1000",
    price: str = "10000",
    factor: str = "1000",
    discount: tuple[str, str, str] | None = None,
    payments: list[tuple[str, str]] | None = None,
    party_id: str | None = None,
    stock_delta: str | None = None,
    shift_id: str | None = None,
    invoice: str = "INV-KRT-A2-26-000001",
) -> dict[str, Any]:
    sid = str(uuid.uuid4())
    q, p = int(qty), int(price)
    line_total = (q * p + 500) // 1000
    subtotal = line_total
    disc = 0
    head: dict[str, Any] = {
        "sale_id": sid,
        "invoice_number": invoice,
        "branch_id": str(c["branch"].id),
        "device_id": str(c["device"].id),
        "user_id": str(c["owner"].id),
        "subtotal_minor": str(subtotal),
        "total_minor": str(subtotal),
        "business_date": "2026-09-16",
        "occurred_at": "2026-09-16T10:34:00Z",
    }
    if shift_id:
        head["shift_id"] = shift_id
    if party_id:
        head["party_id"] = party_id
    if discount:
        mode, value, minor = discount
        disc = int(minor)
        head.update(
            discount_mode=mode,
            discount_value=value,
            discount_minor=minor,
            discount_reason="عميل دائم",
        )
        head["total_minor"] = str(subtotal - disc)
    total = subtotal - disc
    pays = payments or [("cash", str(total))]
    base = -(q * int(factor) // 1000)
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "sale",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {"entity": "sales.Sale", "id": sid, "schema_version": 1, "payload": head},
            {
                "entity": "sales.SaleLine",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "line_id": "x",
                    "sale_id": sid,
                    "item_id": ITEM,
                    "item_name": "سكر",
                    "unit_id": UNIT,
                    "unit_code": "كغ",
                    "factor_milli": factor,
                    "qty_milli": qty,
                    "unit_price_minor": price,
                    "line_total_minor": str(line_total),
                },
            },
            *[
                {
                    "entity": "sales.Payment",
                    "id": str(uuid.uuid4()),
                    "schema_version": 1,
                    "payload": {
                        "payment_id": "y",
                        "sale_id": sid,
                        "method": m,
                        "amount_minor": a,
                        **(
                            {"received_minor": "20000", "change_minor": "10000"}
                            if m == "cash"
                            else {}
                        ),
                    },
                }
                for m, a in pays
            ],
            {
                "entity": "inventory.StockMovement",
                "id": str(uuid.uuid4()),
                "schema_version": 1,
                "payload": {
                    "movement_id": "z",
                    "branch_id": str(c["branch"].id),
                    "item_id": ITEM,
                    "delta_base_qty_milli": stock_delta or str(base),
                    "reason": "sale",
                    "source_entity": "sales.Sale",
                    "source_id": sid,
                    "occurred_at": "2026-09-16T10:34:00Z",
                },
            },
        ],
    }


def test_cash_sale_effects_and_idempotence(ctx: dict[str, Any]) -> None:
    """§٧.٢ الصف الأول: بيع نقدي 100 لقطعة → مخزون −1، صندوق +100، لا قيد ذمّة؛ الإعادة duplicate."""
    op = sale_op(ctx)
    assert do_push(ctx, op) == ["accepted"]
    assert do_push(ctx, op) == ["duplicate"]
    with tenant_context(ctx["tenant"].id):
        s = Sale.objects.get(invoice_number="INV-KRT-A2-26-000001")
        assert s.total_minor == 10000 and s.cash_minor == 10000 and s.credit_minor == 0
        assert s.user_name == "سالم" and s.party_id is None
        assert SaleLine.objects.filter(sale=s).count() == 1
        assert Payment.objects.get(sale=s).change_minor == 10000
        mv = StockMovement.objects.get(source_id=s.id)
        assert mv.delta_base_qty_milli == -1000 and str(mv.branch_id) == str(ctx["branch"].id)
        # الرصيد الآن معروف: −1 (بلا استلام سابق) — سالب محفوظ بتنبيه لا ممنوع
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "-1000"}


def test_server_derives_totals_and_stock(ctx: dict[str, Any]) -> None:
    """لا يثق الخادم بإجمالي يرسله العميل (§٧.٣): سطر بمجموع خاطئ، دفع لا يساوي الإجمالي، حركة
    مخزون لا تطابق السطور، آجل بلا طرف — كلها مرفوضة."""
    bad_line = sale_op(ctx, invoice="INV-1")
    bad_line["members"][1]["payload"]["line_total_minor"] = "9999"
    assert do_push(ctx, bad_line) == ["rejected"]
    bad_pay = sale_op(ctx, invoice="INV-2", payments=[("cash", "9000")])
    assert do_push(ctx, bad_pay) == ["rejected"]
    bad_stock = sale_op(ctx, invoice="INV-3", stock_delta="-2000")
    assert do_push(ctx, bad_stock) == ["rejected"]
    credit_no_party = sale_op(ctx, invoice="INV-4", payments=[("credit", "10000")])
    assert do_push(ctx, credit_no_party) == ["rejected"]
    # الخصم مشتق: 10٪ من 100.00 = 10.00 والإجمالي 90.00
    ok = sale_op(ctx, invoice="INV-5", discount=("percent", "10", "1000"))
    assert do_push(ctx, ok) == ["accepted"]
    wrong_disc = sale_op(ctx, invoice="INV-6", discount=("percent", "10", "1500"))
    assert do_push(ctx, wrong_disc) == ["rejected"]
    # كرتونة = 12 كغ: حركة المخزون −12000 بالوحدة الأساسية
    carton = sale_op(ctx, invoice="INV-7", factor="12000", price="120000")
    assert do_push(ctx, carton) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: str(-1000 - 12000)}


def test_sale_feeds_shift_drawer_party_ledger_and_home(ctx: dict[str, Any]) -> None:
    """البيع النقدي يدخل درج الوردية (§١٠.٣)، الآجل يرفع ذمّة الطرف (§٧.٢)، والرئيسية تعدّ اليوم."""
    sid = str(uuid.uuid4())
    do_push(
        ctx,
        {
            "operation_id": str(uuid.uuid4()),
            "kind": "shift_open",
            "op_version": 1,
            "dependencies": [],
            "members": [
                {
                    "entity": "shifts.ShiftOpened",
                    "id": sid,
                    "schema_version": 1,
                    "payload": {
                        "shift_id": sid,
                        "branch_id": str(ctx["branch"].id),
                        "device_id": str(ctx["device"].id),
                        "user_id": str(ctx["owner"].id),
                        "opening_float_minor": "50000",
                        "business_date": "2026-09-16",
                        "occurred_at": "2026-09-16T08:00:00Z",
                    },
                }
            ],
        },
    )
    with tenant_context(ctx["tenant"].id):
        party = party_services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=ctx["owner"], distinct_from=None
        )
    assert do_push(ctx, sale_op(ctx, invoice="INV-A", shift_id=sid)) == ["accepted"]
    mixed = sale_op(
        ctx,
        invoice="INV-B",
        shift_id=sid,
        party_id=str(party.id),
        payments=[("cash", "4000"), ("credit", "6000")],
    )
    assert do_push(ctx, mixed) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        shift = Shift.objects.select_related("branch").get(id=sid)
        p = shift_services.shift_payload(shift)
        # 100 نقداً + 40 من المختلط = 140 في الدرج؛ الستون الآجلة لا تدخل (ACC-08/13)
        assert p["totals"]["cash_sales_minor"] == "14000"
        assert p["expected_cash_minor"] == str(50000 + 14000)
        party.refresh_from_db()
        assert party_services.balance_minor(party) == 6000
        assert party_services.last_sale_at(party) is not None
        viewer = home.viewer_for(ctx["owner"], ctx["device"])
        out = home.home_summary(ctx["tenant"].id, viewer)
        assert out["sales_today"]["count"] == 0  # business_date 2026-09-16 ليس اليوم بالضرورة
        found = home.search(viewer, "INV-B")
        docs = next(g for g in found["groups"] if g["kind"] == "documents")
        assert docs["results"][0]["title"] == "INV-B"
        assert Party.objects.count() == 1
