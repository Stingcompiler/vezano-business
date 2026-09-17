"""T1.19 — POS-09 قائمة الفواتير بنطاق المشاهد وجودة التاريخ (ACC-77)، وPOS-12 التكرار التجاري
(§٧.٣؛ ACC-16): جهازان سجّلا نفس البيع خلال دقيقة → اشتباه؛ القرار «عكس» مستند مستقل بآثاره لا حذف؛
«الاثنان بيعان حقيقيان» يُغلق الاشتباه؛ الكاشير يرى ويبلّغ ولا يقرّر."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from catalog import services as catalog_services
from conftest import TwoTenants
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from parties import services as party_services
from sales import duplicates
from sales.models import DuplicateDecision, DuplicateReport, Sale, SaleReversal
from sales.tests.test_sale import ITEM, do_push, sale_op
from shifts import services as shift_services
from shifts.models import Shift
from sync.counter import ensure_state
from sync.models_log import SyncLog

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
        cashier = User.objects.create_user(
            tenant=two_tenants.a, username="samira", display_name="سميرة ع.", is_owner=False
        )
        crole = Role.unscoped.create(tenant=two_tenants.a, code="cashier", name="كاشير")
        UserBranchAccess.unscoped.create(
            tenant=two_tenants.a, user=cashier, branch=two_tenants.a_branches[0], role=crole
        )
    with tenant_context(two_tenants.a.id):
        reg = register_device(user=owner, branch=two_tenants.a_branches[0], name="الكاشير 1")
        reg2 = register_device(user=cashier, branch=two_tenants.a_branches[0], name="الكاشير 2")
        epoch = ensure_state(two_tenants.a.id).sync_epoch
    return {
        "tenant": two_tenants.a,
        "branch": two_tenants.a_branches[0],
        "other_branch": two_tenants.a_branches[1],
        "owner": owner,
        "cashier": cashier,
        "device": reg.device,
        "access": reg.access,
        "device2": reg2.device,
        "access2": reg2.access,
        "epoch": epoch,
    }


def stamped(op: dict[str, Any], at: Any) -> dict[str, Any]:
    """يثبّت وقت البيع وحركة مخزونه ويوم أعماله على `at`."""
    iso = at.isoformat()
    for m in op["members"]:
        if "occurred_at" in m["payload"]:
            m["payload"]["occurred_at"] = iso
        if m["entity"] == "sales.Sale":
            m["payload"]["business_date"] = timezone.localtime(at).date().isoformat()
    return op


def push_as(c: dict[str, Any], device: Any, user: Any, op: dict[str, Any]) -> list[str]:
    c2 = dict(c, device=device, owner=user)
    op["members"][0]["payload"]["device_id"] = str(device.id)
    op["members"][0]["payload"]["user_id"] = str(user.id)
    return do_push(c2, op)


def test_list_scope_totals_and_date_quality(ctx: dict[str, Any]) -> None:
    """POS-09: المالك يرى فرعه ومجاميعه؛ الكاشير جهازه بلا مجاميع («يرى نطاقه»، «المجاميع
    تقارير»)؛ ساعة جهاز في يوم آخر → «تاريخ مشكوك فيه» معلَن والأصل لم يُعدَّل (ACC-77)."""
    now = timezone.now()
    assert push_as(
        ctx, ctx["device"], ctx["owner"], stamped(sale_op(ctx, invoice="INV-1"), now)
    ) == ["accepted"]
    assert push_as(
        ctx,
        ctx["device2"],
        ctx["cashier"],
        stamped(sale_op(ctx, invoice="INV-2", price="5000"), now - timedelta(minutes=3)),
    ) == ["accepted"]
    # ساعة الجهاز الثاني في سنة ماضية — يوم الأعمال من الوردية اليوم
    wrong = stamped(sale_op(ctx, invoice="INV-3", price="2000"), now - timedelta(days=400))
    wrong["members"][0]["payload"]["business_date"] = timezone.localdate().isoformat()
    assert push_as(ctx, ctx["device2"], ctx["cashier"], wrong) == ["accepted"]

    c = Client()
    r = c.get("/api/sales", HTTP_AUTHORIZATION=f"Bearer {ctx['access']}")
    assert r.status_code == 200
    body = r.json()
    assert body["scope"] == "branch" and body["can_all_branches"] and body["can_totals"]
    nums = [x["invoice_number"] for x in body["rows"]]
    assert nums == ["INV-1", "INV-2"]  # الفاتورة بساعة خاطئة خارج مدى «اليوم» بوقتها
    assert body["totals"] == {"count": 2, "total_minor": "15000"}
    r = c.get("/api/sales?range=week", HTTP_AUTHORIZATION=f"Bearer {ctx['access']}")
    assert [x["invoice_number"] for x in r.json()["rows"]] == ["INV-1", "INV-2"]

    r = c.get("/api/sales", HTTP_AUTHORIZATION=f"Bearer {ctx['access2']}")
    body = r.json()
    assert body["scope"] == "device" and not body["can_all_branches"] and not body["can_totals"]
    assert body["totals"] is None
    assert [x["invoice_number"] for x in body["rows"]] == ["INV-2"]
    r = c.get("/api/sales?branch=all", HTTP_AUTHORIZATION=f"Bearer {ctx['access2']}")
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"

    with tenant_context(ctx["tenant"].id):
        s3 = Sale.objects.get(invoice_number="INV-3")
        assert duplicates.date_suspect(s3) is True
        assert duplicates.date_suspect(Sale.objects.get(invoice_number="INV-1")) is False
        assert s3.occurred_at < now - timedelta(days=399)  # الأصل لم يُعدَّل
    r = c.get(f"/api/sales/{s3.id}", HTTP_AUTHORIZATION=f"Bearer {ctx['access']}")
    assert r.status_code == 200 and r.json()["date_suspect"] is True
    assert (
        r.json()["lines"][0]["item_name"] == "سكر" and r.json()["payments"][0]["method"] == "cash"
    )
    # الكاشير لا يفتح فاتورة جهاز آخر
    with tenant_context(ctx["tenant"].id):
        s1_id = Sale.objects.get(invoice_number="INV-1").id
    r = c.get(f"/api/sales/{s1_id}", HTTP_AUTHORIZATION=f"Bearer {ctx['access2']}")
    assert r.status_code == 403


def _open_shift(ctx: dict[str, Any], sid: str) -> None:
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
                        "business_date": timezone.localdate().isoformat(),
                        "occurred_at": (timezone.now() - timedelta(hours=1)).isoformat(),
                    },
                }
            ],
        },
    )


def test_duplicate_pair_detected_and_reversed_as_separate_document(ctx: dict[str, Any]) -> None:
    """ACC-16: نفس الصنف والكمية خلال دقيقة من جهازين → زوج مشتبه به (الأصل الأسبق)؛ «إلغاء
    المستند الثاني بسبب» ينشئ `SaleReversal` مرجعاً في sync_log، يعيد المخزون، ويُخرج النقد من
    درج الوردية، والأصل يبقى مقروءاً؛ بيع ثالث بنفس الجهاز أو بسطور مختلفة لا يُشتبه به."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    t0 = timezone.now() - timedelta(minutes=10)
    with tenant_context(ctx["tenant"].id):
        party = party_services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=ctx["owner"], distinct_from=None
        )
    first = stamped(sale_op(ctx, invoice="INV-1041", shift_id=sid), t0)
    second = stamped(
        sale_op(
            ctx,
            invoice="INV-1042",
            shift_id=sid,
            party_id=str(party.id),
            payments=[("cash", "4000"), ("credit", "6000")],
        ),
        t0 + timedelta(seconds=26),
    )
    # نفس الجهاز قبل الأصل بـ50 ث: لا يُشتبه به مع 1041 (جهاز واحد) ولا مع 1042 (76 ث)
    same_device = stamped(
        sale_op(ctx, invoice="INV-1040", shift_id=sid), t0 - timedelta(seconds=50)
    )
    other_lines = stamped(
        sale_op(ctx, invoice="INV-1044", shift_id=sid, qty="2000", price="5000"),
        t0 + timedelta(seconds=50),
    )
    assert push_as(ctx, ctx["device"], ctx["owner"], first) == ["accepted"]
    assert push_as(ctx, ctx["device2"], ctx["cashier"], second) == ["accepted"]
    assert push_as(ctx, ctx["device"], ctx["owner"], same_device) == ["accepted"]
    assert push_as(ctx, ctx["device2"], ctx["cashier"], other_lines) == ["accepted"]

    c = Client()
    h = {"HTTP_AUTHORIZATION": f"Bearer {ctx['access']}"}
    r = c.get("/api/sales/duplicates", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["can_decide"] is True
    pairs = r.json()["pairs"]
    assert [(p["first"]["invoice_number"], p["second"]["invoice_number"]) for p in pairs] == [
        ("INV-1041", "INV-1042")
    ]
    assert pairs[0]["seconds_apart"] == 26 and pairs[0]["source"] == "auto"
    assert pairs[0]["second"]["device_name"] == "الكاشير 2"

    with tenant_context(ctx["tenant"].id):
        shift = Shift.objects.get(id=sid)
        assert shift_services.cash_totals(shift).cash_sales_minor == 10000 + 4000 + 10000 + 10000
        assert party_services.party_payload(party)["balance_minor"] == "6000"
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: str(-1000 * 3 - 2000)}
        first_id = pairs[0]["first"]["id"]
        second_id = pairs[0]["second"]["id"]

    # السبب إلزامي للعكس
    r = c.post(
        "/api/sales/duplicates/decide",
        {"first_id": first_id, "second_id": second_id, "decision": "reverse", "reason": " "},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "reason"
    r = c.post(
        "/api/sales/duplicates/decide",
        {"first_id": first_id, "second_id": second_id, "decision": "reverse", "reason": "تكرار"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["decided_by_name"] == "سالم"
    assert r.json()["second"]["sync_state"] == "reversed"
    assert r.json()["second"]["reversal"]["kept_sale_id"] == first_id

    with tenant_context(ctx["tenant"].id):
        rev = SaleReversal.objects.get(sale_id=second_id)
        assert rev.kind == "duplicate" and rev.reason == "تكرار"
        # الأصل والملغاة كلاهما مقروء
        assert Sale.objects.filter(id__in=[first_id, second_id]).count() == 2
        assert SyncLog.unscoped.filter(entity="sales.SaleReversal", entity_id=rev.id).exists()
        # الآثار: المخزون يعود +1، النقد 40 يخرج من الدرج، الذمّة 60 تسقط
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: str(-1000 * 2 - 2000)}
        assert shift_services.cash_totals(shift).cash_sales_minor == 10000 + 10000 + 10000
        assert party_services.party_payload(party)["balance_minor"] == "0"
        assert DuplicateDecision.objects.get().decision == "reverse"
    # الزوج لا يعود إلى القائمة، ولا يُعكس مرتين
    assert c.get("/api/sales/duplicates", **h).json()["pairs"] == []  # type: ignore[arg-type]
    r = c.post(
        "/api/sales/duplicates/decide",
        {"first_id": first_id, "second_id": second_id, "decision": "reverse", "reason": "x"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "already_reversed"
    # القائمة تسمّي الملغاة ولا تجمعها
    body = c.get("/api/sales", **h).json()  # type: ignore[arg-type]
    states = {x["invoice_number"]: x["sync_state"] for x in body["rows"]}
    assert states["INV-1042"] == "reversed" and states["INV-1041"] == "synced"
    assert body["totals"] == {"count": 3, "total_minor": "30000"}


def test_both_real_and_cashier_report_only(ctx: dict[str, Any]) -> None:
    """«الاثنان بيعان حقيقيان» يُغلق الاشتباه بلا أثر؛ الكاشير يرى القائمة ويبلّغ («أبلغ عن
    اشتباه» يقرن الفاتورة بأقرب نظير) ولا يقرّر (403 manager_required)."""
    t0 = timezone.now() - timedelta(minutes=5)
    a = stamped(sale_op(ctx, invoice="INV-A"), t0)
    b = stamped(sale_op(ctx, invoice="INV-B"), t0 + timedelta(seconds=30))
    assert push_as(ctx, ctx["device"], ctx["owner"], a) == ["accepted"]
    assert push_as(ctx, ctx["device2"], ctx["cashier"], b) == ["accepted"]
    c = Client()
    h = {"HTTP_AUTHORIZATION": f"Bearer {ctx['access']}"}
    h2 = {"HTTP_AUTHORIZATION": f"Bearer {ctx['access2']}"}
    r = c.get("/api/sales/duplicates", **h2)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["can_decide"] is False
    pair = r.json()["pairs"][0]
    r = c.post(
        "/api/sales/duplicates/decide",
        {
            "first_id": pair["first"]["id"],
            "second_id": pair["second"]["id"],
            "decision": "both_real",
        },
        content_type="application/json",
        **h2,  # type: ignore[arg-type]
    )
    assert r.status_code == 403 and r.json()["detail"] == "manager_required"
    r = c.post(
        "/api/sales/duplicates/decide",
        {
            "first_id": pair["first"]["id"],
            "second_id": pair["second"]["id"],
            "decision": "both_real",
        },
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    with tenant_context(ctx["tenant"].id):
        assert SaleReversal.objects.count() == 0
        assert DuplicateDecision.objects.get().decision == "both_real"
    assert c.get("/api/sales/duplicates", **h).json()["pairs"] == []  # type: ignore[arg-type]

    # بلاغ الكاشير: فاتورتان بنفس الإجمالي على جهاز واحد بفارق 5 دقائق — لا اشتباه تلقائي
    x = stamped(sale_op(ctx, invoice="INV-X", price="7000"), t0 - timedelta(minutes=20))
    y = stamped(sale_op(ctx, invoice="INV-Y", price="7000"), t0 - timedelta(minutes=15))
    assert push_as(ctx, ctx["device2"], ctx["cashier"], x) == ["accepted"]
    assert push_as(ctx, ctx["device2"], ctx["cashier"], y) == ["accepted"]
    assert c.get("/api/sales/duplicates", **h).json()["pairs"] == []  # type: ignore[arg-type]
    with tenant_context(ctx["tenant"].id):
        y_id = Sale.objects.get(invoice_number="INV-Y").id
    r = c.post(
        f"/api/sales/{y_id}/duplicate-report",
        {"note": "الزبون قال إنه دفع مرة"},
        content_type="application/json",
        **h2,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["reported_by_name"] == "سميرة ع."
    pairs = c.get("/api/sales/duplicates", **h).json()["pairs"]  # type: ignore[arg-type]
    assert len(pairs) == 1 and pairs[0]["source"] == "report"
    assert (pairs[0]["first"]["invoice_number"], pairs[0]["second"]["invoice_number"]) == (
        "INV-X",
        "INV-Y",
    )
    assert pairs[0]["note"] == "الزبون قال إنه دفع مرة"
    # القرار يُغلق البلاغ
    r = c.post(
        "/api/sales/duplicates/decide",
        {
            "first_id": pairs[0]["first"]["id"],
            "second_id": pairs[0]["second"]["id"],
            "decision": "both_real",
        },
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    with tenant_context(ctx["tenant"].id):
        assert DuplicateReport.objects.get().resolved_at is not None
    assert c.get("/api/sales/duplicates", **h).json()["pairs"] == []  # type: ignore[arg-type]
