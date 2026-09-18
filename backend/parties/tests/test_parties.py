"""POS-04 (T1.15): الطرف يُنشأ بالاسم فقط، البحث بالبادئة بعد التطبيع، التشابه المضلل يُعرض ويُسأل
عنه لا يُمنع ولا يُدمج، الإنشاء السريع بلا اتصال حدث PUSH متكرّر الأثر يصل الأجهزة مرجعاً (§٧.٥؛
ACC-12).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from conftest import TwoTenants
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from parties import services
from parties.models import Party, PaymentReceipt
from sync.counter import ensure_state
from sync.models_log import SyncLog
from sync.push import PROTOCOL_VERSION, push

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    with platform_context():
        cashier = User.objects.create_user(
            tenant=two_tenants.a, username="samira", display_name="سميرة ع."
        )
        role = Role.unscoped.create(tenant=two_tenants.a, code="cashier", name="كاشير")
        UserBranchAccess.unscoped.create(
            tenant=two_tenants.a, user=cashier, branch=two_tenants.a_branches[0], role=role
        )
    with tenant_context(two_tenants.a.id):
        reg = register_device(user=cashier, branch=two_tenants.a_branches[0], name="كاشير 2")
        epoch = ensure_state(two_tenants.a.id).sync_epoch
    return {
        "tenant": two_tenants.a,
        "other": two_tenants.b,
        "branch": two_tenants.a_branches[0],
        "user": cashier,
        "device": reg.device,
        "access": reg.access,
        "refresh": reg.refresh,
        "epoch": epoch,
    }


def api(c: dict[str, Any]) -> tuple[Client, dict[str, str]]:
    return Client(), {"HTTP_AUTHORIZATION": f"Bearer {c['access']}"}


def test_create_by_name_search_by_prefix_and_similarity_warns(ctx: dict[str, Any]) -> None:
    client, h = api(ctx)
    r = client.post(
        "/api/parties",
        {"name": "أحمد الطيب", "phone": "0912555447"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["balance_minor"] == "0"
    first = r.json()["id"]
    # البادئة بعد التطبيع: «احمد» يطابق «أحمد»؛ الهاتف بالأرقام العربية يطابق
    assert [p["name"] for p in client.get("/api/parties?q=احمد", **h).json()["parties"]] == [  # type: ignore[arg-type]
        "أحمد الطيب"
    ]
    assert len(client.get("/api/parties?q=٠٩١٢", **h).json()["parties"]) == 1  # type: ignore[arg-type]
    assert client.get("/api/parties?q=زيد", **h).json()["parties"] == []  # type: ignore[arg-type]
    # الاسم نفسه → تشابه مضلل يُعرض (409) لا يُمنع ولا يُدمج
    r = client.post(
        "/api/parties",
        {"name": "احمد الطيّب"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 409 and r.json()["by_name"][0]["id"] == first
    # الهاتف مسجَّل على طرف قائم
    r = client.post(
        "/api/parties",
        {"name": "مطعم الواحة", "phone": "0912-555-447"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 409 and r.json()["by_phone"][0]["name"] == "أحمد الطيب"
    # «إنشاء منفصل مع تمييز» — قرار هوية صريح
    r = client.post(
        "/api/parties",
        {"name": "أحمد الطيب", "distinct_from_party_id": first},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["distinct_from_id"] == first
    with tenant_context(ctx["tenant"].id):
        assert Party.objects.count() == 2
        assert (
            SyncLog.unscoped.filter(tenant_id=ctx["tenant"].id, entity="parties.Party").count() == 2
        )
    # عزل: المستأجر الآخر لا يرى شيئاً
    with tenant_context(ctx["other"].id):
        assert Party.objects.count() == 0
    r = client.post("/api/parties", {"name": "   "}, content_type="application/json", **h)  # type: ignore[arg-type]
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "name"
    assert Client().get("/api/parties").status_code == 401


def test_quick_create_offline_arrives_as_event_and_is_idempotent(ctx: dict[str, Any]) -> None:
    pid = str(uuid.uuid4())
    op = {
        "operation_id": str(uuid.uuid4()),
        "kind": "party_create",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {
                "entity": "parties.PartyCreated",
                "id": pid,
                "schema_version": 1,
                "payload": {
                    "party_id": pid,
                    "name": "مطعم الروضة",
                    "phone": "0911222203",
                    "occurred_at": "2026-09-16T10:00:00Z",
                },
            }
        ],
    }

    def do(o: dict[str, Any]) -> list[str]:
        with tenant_context(ctx["tenant"].id):
            resp = push(
                device_id=ctx["device"].id,
                actor_user_id=ctx["user"].id,
                envelope={
                    "protocol_version": PROTOCOL_VERSION,
                    "sync_epoch": ctx["epoch"],
                    "request_id": str(uuid.uuid4()),
                    "operations": [o],
                },
                branch_id=str(ctx["branch"].id),
            ).as_dict()
        return [r["status"] for r in resp["results"]]

    assert do(op) == ["accepted"]
    assert do(op) == ["duplicate"]
    with tenant_context(ctx["tenant"].id):
        p = Party.objects.get(id=pid)
        assert p.name == "مطعم الروضة" and p.created_by_user_id == ctx["user"].id
        assert p.phone_normalized == "0911222203"
        # وصل مرجعاً ليصل الأجهزة الأخرى؛ وBALANCE من المزوّدين
        assert SyncLog.unscoped.filter(tenant_id=ctx["tenant"].id, entity_id=pid).exists()
        saved = list(services.BALANCE_PROVIDERS)
        services.BALANCE_PROVIDERS.append(lambda _p: 12000)
        try:
            assert services.party_payload(p)["balance_minor"] == "12000"
        finally:
            services.BALANCE_PROVIDERS[:] = saved
    member: dict[str, Any] = dict(op["members"][0])  # type: ignore[index]
    member["id"] = str(uuid.uuid4())
    member["payload"] = {**member["payload"], "party_id": member["id"], "name": "  "}
    bad = dict(op, operation_id=str(uuid.uuid4()), members=[member])
    assert do(bad) == ["rejected"]


def test_lists_customers_for_finance_only_and_suppliers_names_for_all(ctx: dict[str, Any]) -> None:
    """PTY-01: القائمة الكاملة صورة مالية — الكاشير يرى من يبيع له فقط (403 finance_required)؛
    المالك يرى الأرصدة والمجموع. PTY-02: الأسماء للجميع والمستحقّ لمن يرى المال (ACC-118: لا ربط
    سوق تلقائي). الأسماء البديلة تُبحث ولا تثبت هوية."""
    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None,
            name="أحمد الطيب",
            phone="0912555447",
            created_by=None,
            distinct_from=None,
        )
        ahmed.aliases = ["أبو محمد", "الطيب"]
        ahmed.save()
        sup = services.create_party(
            party_id=None,
            name="مخزن البركة",
            phone="0155000200",
            created_by=None,
            distinct_from=None,
        )
        sup.is_supplier = True
        sup.is_customer = False
        sup.save()
        assert [p.name for p in services.search_parties("أبو")] == ["أحمد الطيب"]
    c, h = api(ctx)
    r = c.get("/api/parties/list", **h)  # type: ignore[arg-type]
    assert r.status_code == 403 and r.json()["detail"] == "finance_required"
    r = c.get("/api/parties/list?kind=suppliers", **h)  # type: ignore[arg-type]
    assert r.status_code == 200
    body = r.json()
    assert body["can_see_balances"] is False
    assert [x["name"] for x in body["rows"]] == ["مخزن البركة"]
    assert (
        body["rows"][0]["supplier_owed_minor"] == "" and body["rows"][0]["market_linked"] is False
    )

    with platform_context():
        owner = User.objects.create_user(
            tenant=ctx["tenant"], username="salem", display_name="سالم", is_owner=True
        )
        orole = Role.unscoped.create(tenant=ctx["tenant"], code="owner", name="مالك")
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=owner, branch=ctx["branch"], role=orole
        )
    with tenant_context(ctx["tenant"].id):
        reg = register_device(user=owner, branch=ctx["branch"], name="مكتب")
    ho = {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}
    r = c.get("/api/parties/list", **ho)  # type: ignore[arg-type]
    assert r.status_code == 200
    body = r.json()
    assert body["can_see_balances"] is True and body["kind"] == "customers"
    assert [x["name"] for x in body["rows"]] == ["أحمد الطيب"]
    assert body["rows"][0]["aliases"] == ["أبو محمد", "الطيب"]
    assert body["rows"][0]["balance_minor"] == "0" and body["rows"][0]["balance_as_of"]
    assert body["summary"] == {"count": 1, "total_due_minor": "0", "total_owed_minor": "0"}


def _owner_client(ctx: dict[str, Any]) -> tuple[Client, dict[str, str]]:
    with platform_context():
        owner = User.objects.create_user(
            tenant=ctx["tenant"], username="salem2", display_name="سالم", is_owner=True
        )
        orole = Role.unscoped.create(tenant=ctx["tenant"], code="owner", name="مالك")
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=owner, branch=ctx["branch"], role=orole
        )
    with tenant_context(ctx["tenant"].id):
        reg = register_device(user=owner, branch=ctx["branch"], name="مكتب")
    return Client(), {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}


def test_party_card_edit_distinct_and_opening_balance(ctx: dict[str, Any]) -> None:
    """PTY-03: الكاشير يُنشئ ولا يعدّل (403)؛ المالك يعدّل البطاقة (اسم فقط إلزامي، أسماء بديلة،
    حدّ، صفتان) ويُسجَّل مرجعاً؛ التقارب يُعرض ولا يُدمج و«منفصلان» قرار صريح (ACC-131).
    PTY-04: الافتتاحي للمالك وحده، بسبب، مرة لكل صفة، وقبل أول حركة؛ رصيدان منفصلان (ACC-28)."""
    with tenant_context(ctx["tenant"].id):
        khalid = services.create_party(
            party_id=None,
            name="خالد إبراهيم",
            phone="0918333902",
            created_by=None,
            distinct_from=None,
        )
        twin = services.create_party(
            party_id=None, name="خالد ابراهيم", phone="", created_by=None, distinct_from=None
        )
    c, hc = api(ctx)
    r = c.patch(f"/api/parties/{khalid.id}", {"name": "x"}, content_type="application/json", **hc)  # type: ignore[arg-type]
    assert r.status_code == 403 and r.json()["detail"] == "manager_required"
    co, ho = _owner_client(ctx)
    r = co.get(f"/api/parties/{khalid.id}", **ho)  # type: ignore[arg-type]
    assert r.status_code == 200
    card = r.json()
    assert card["can_edit"] and card["can_open_balance"] and card["has_movements"] is False
    assert [p["name"] for p in card["potential_duplicates"]] == ["خالد ابراهيم"]
    r = co.patch(
        f"/api/parties/{khalid.id}",
        {"name": " ", "phone": ""},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "name"
    r = co.patch(
        f"/api/parties/{khalid.id}",
        {
            "name": "خالد إبراهيم — تجريبي",
            "phone": "0918333902",
            "aliases": ["أبو أحمد"],
            "credit_limit_minor": "60000",
            "is_customer": True,
            "is_supplier": True,
            "note": "يشتري بالتجزئة، ويورّدنا بيضاً أسبوعياً",
        },
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 200
    assert r.json()["aliases"] == ["أبو أحمد"] and r.json()["is_supplier"] is True
    with tenant_context(ctx["tenant"].id):
        assert SyncLog.unscoped.filter(entity="parties.Party", entity_id=khalid.id).exists()
    # «منفصلان» يغلق الاشتباه
    r = co.post(
        f"/api/parties/{twin.id}/distinct",
        {"other_id": str(khalid.id)},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 200
    assert co.get(f"/api/parties/{khalid.id}", **ho).json()["potential_duplicates"] == []  # type: ignore[arg-type]

    # الافتتاحي: الكاشير ممنوع؛ السبب إلزامي؛ مرة لكل صفة؛ رصيدان منفصلان
    body = {"side": "customer_due", "amount_minor": "34000", "reason": "دفتر 2024"}
    r = c.post(
        f"/api/parties/{khalid.id}/opening-balance",
        body,
        content_type="application/json",
        **hc,  # type: ignore[arg-type]
    )
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    r = co.post(
        f"/api/parties/{khalid.id}/opening-balance",
        {**body, "reason": ""},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "reason"
    r = co.post(
        f"/api/parties/{khalid.id}/opening-balance",
        body,
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    assert r.json()["party"]["balance_minor"] == "34000"
    assert r.json()["opening"]["business_date"] == ""  # قبل النظام
    r = co.post(
        f"/api/parties/{khalid.id}/opening-balance",
        body,
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "opening"
    assert r.json()["errors"][0]["code"] == "already_recorded"
    r = co.post(
        f"/api/parties/{khalid.id}/opening-balance",
        {"side": "supplier_owed", "amount_minor": "115000", "reason": "بيض الأسبوع الماضي"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    party = r.json()["party"]
    assert party["balance_minor"] == "34000" and party["supplier_owed_minor"] == "115000"
    with tenant_context(ctx["tenant"].id):
        assert SyncLog.unscoped.filter(entity="parties.OpeningBalance").count() == 2


def test_statement_sequential_with_opening_and_branch_scope(ctx: dict[str, Any]) -> None:
    """PTY-05: الكشف يبدأ بسطر «رصيد افتتاحي» ثم البيع الآجل مديناً والمرتجع خصماً دائناً بالرصيد
    الجاري؛ البيع النقدي سطر «لا أثر آجل»؛ الكاشير 403؛ مدير فرع آخر يرى الرصيد المؤسسي كاملاً
    وتُحجب سطور الفرع الآخر (ACC-46)؛ «لا يوجد سداد مسجل» = `last_payment_at` فارغ."""
    from sales.tests.test_sale import do_push, sale_op

    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=None, distinct_from=None
        )
    co, ho = _owner_client(ctx)
    r = co.post(
        f"/api/parties/{ahmed.id}/opening-balance",
        {"side": "customer_due", "amount_minor": "20000", "reason": "دفتر قديم"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    # بيع مختلط 100 = 40 نقداً + 60 آجلاً على أحمد، ثم بيع نقدي بلا أثر — من الجهاز (المالك)
    oc = dict(ctx, owner=ctx["user"], epoch=ctx["epoch"])
    mixed = sale_op(
        oc,
        invoice="INV-1043",
        party_id=str(ahmed.id),
        payments=[("cash", "4000"), ("credit", "6000")],
    )
    assert do_push(oc, mixed) == ["accepted"]
    assert do_push(oc, sale_op(oc, invoice="INV-1039", party_id=str(ahmed.id))) == ["accepted"]
    c, hc = api(ctx)
    r = c.get(f"/api/parties/{ahmed.id}/statement", **hc)  # type: ignore[arg-type]
    assert r.status_code == 403 and r.json()["detail"] == "finance_required"
    r = co.get(f"/api/parties/{ahmed.id}/statement?range=all", **ho)  # type: ignore[arg-type]
    assert r.status_code == 200
    body = r.json()
    assert [x["label"] for x in body["rows"]] == [
        "رصيد افتتاحي",
        "بيع مختلط — الجزء الآجل",
        "بيع نقدي — لا أثر آجل",
    ]
    assert [x["balance_minor"] for x in body["rows"]] == ["20000", "26000", "26000"]
    assert body["balance_minor"] == "26000" and body["last_payment_at"] == ""
    assert body["oldest_unpaid_at"] and body["hidden_other_branch"] == 0
    assert body["rows"][2]["info"] is True and body["rows"][2]["debit_minor"] == ""
    # مدير الفرع الآخر: الرصيد المؤسسي كاملاً وسطور الفرع الرئيسي محجوبة
    with tenant_context(ctx["tenant"].id):
        from core.models import Branch

        other_branch = Branch.objects.exclude(id=ctx["branch"].id).first()
    assert other_branch is not None
    with platform_context():
        manager = User.objects.create_user(
            tenant=ctx["tenant"], username="nada", display_name="ندى", is_owner=False
        )
        mrole = Role.unscoped.create(tenant=ctx["tenant"], code="manager", name="مدير فرع")
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=manager, branch=other_branch, role=mrole
        )
    with tenant_context(ctx["tenant"].id):
        reg = register_device(user=manager, branch=other_branch, name="مكتب بحري")
    hm = {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}
    r = co.get(f"/api/parties/{ahmed.id}/statement?range=all", **hm)  # type: ignore[arg-type]
    assert r.status_code == 200
    body = r.json()
    assert body["scope"] == "branch" and body["balance_minor"] == "26000"
    assert [x["label"] for x in body["rows"]] == ["رصيد افتتاحي"]
    assert body["hidden_other_branch"] == 2


def _receipt_op(
    c: dict[str, Any],
    party_id: str,
    *,
    amount: str,
    method: str = "cash",
    kind: str = "receipt",
    reference: str = "",
    reason: str = "",
    number: str = "REC-KRT-A2-26-000001",
    shift_id: str | None = None,
) -> dict[str, Any]:
    rid = str(uuid.uuid4())
    payload: dict[str, Any] = {
        "receipt_id": rid,
        "receipt_number": number,
        "party_id": party_id,
        "branch_id": str(c["branch"].id),
        "device_id": str(c["device"].id),
        "user_id": str(c["user"].id),
        "kind": kind,
        "method": method,
        "amount_minor": amount,
        "reference": reference,
        "reason": reason,
        "business_date": "2026-09-17",
        "occurred_at": "2026-09-17T11:00:00Z",
    }
    if shift_id:
        payload["shift_id"] = shift_id
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "payment_receipt",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {"entity": "parties.PaymentReceipt", "id": rid, "schema_version": 1, "payload": payload}
        ],
    }


def test_payment_receipt_effects_bank_matching_and_reference_once(ctx: dict[str, Any]) -> None:
    """PTY-06 / §٧.٢: سداد دين 40 نقداً → الذمّة 60 والدرج +40 (ACC-03)؛ التحويل «مسجَّل» لا يُسقط
    الذمّة حتى «مطابق» بفعل المالك (ACC-133)؛ مرجع التحويل لا يُستهلك مرتين (ACC-15)؛ الردّ يحتاج
    سبباً ويرفع الذمّة ويُخرج نقداً؛ الكشف يعرض السطور بأثرها الفعلي."""
    from sales.tests.test_sale import do_push, sale_op

    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=None, distinct_from=None
        )
    oc = dict(ctx, owner=ctx["user"])
    do_push(
        oc,
        {
            "operation_id": str(uuid.uuid4()),
            "kind": "shift_open",
            "op_version": 1,
            "dependencies": [],
            "members": [
                {
                    "entity": "shifts.ShiftOpened",
                    "id": (sid := str(uuid.uuid4())),
                    "schema_version": 1,
                    "payload": {
                        "shift_id": sid,
                        "branch_id": str(ctx["branch"].id),
                        "device_id": str(ctx["device"].id),
                        "user_id": str(ctx["user"].id),
                        "opening_float_minor": "50000",
                        "business_date": "2026-09-17",
                        "occurred_at": "2026-09-17T08:00:00Z",
                    },
                }
            ],
        },
    )
    credit = sale_op(oc, invoice="INV-1", party_id=str(ahmed.id), payments=[("credit", "10000")])
    assert do_push(oc, credit) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert services.party_payload(ahmed)["balance_minor"] == "10000"
    # سداد نقدي 40
    op = _receipt_op(ctx, str(ahmed.id), amount="4000", shift_id=sid)
    assert do_push(oc, op) == ["accepted"]
    assert do_push(oc, op) == ["duplicate"]
    with tenant_context(ctx["tenant"].id):
        from shifts import services as shift_services
        from shifts.models import Shift

        assert services.party_payload(ahmed)["balance_minor"] == "6000"
        t = shift_services.cash_totals(Shift.objects.get(id=sid))
        assert t.cash_debt_receipts_minor == 4000
    # تحويل بنكي 30 — مسجَّل غير مطابق: الذمّة لا تتغير
    bank = _receipt_op(
        ctx, str(ahmed.id), amount="3000", method="bank", reference="TRF-88214", number="REC-2"
    )
    assert do_push(oc, bank) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert services.party_payload(ahmed)["balance_minor"] == "6000"
        rec = PaymentReceipt.objects.get(receipt_number="REC-2")
    # المرجع نفسه مرة ثانية → مرفوض
    dup = _receipt_op(
        ctx, str(ahmed.id), amount="1000", method="bank", reference="TRF-88214", number="REC-3"
    )
    assert do_push(oc, dup) == ["rejected"]
    # تحويل بلا مرجع، وردّ بلا سبب → مرفوضان في التحقق
    assert do_push(
        oc, _receipt_op(ctx, str(ahmed.id), amount="100", method="bank", number="R4")
    ) == ["rejected"]
    assert do_push(
        oc, _receipt_op(ctx, str(ahmed.id), amount="100", kind="refund", number="R5")
    ) == ["rejected"]
    # المطابقة للمالك — الكاشير 403؛ بعدها الذمّة 30
    c, hc = api(ctx)
    r = c.post(f"/api/parties/receipts/{rec.id}/match", **hc)  # type: ignore[arg-type]
    assert r.status_code == 403
    co, ho = _owner_client(ctx)
    r = co.post(f"/api/parties/receipts/{rec.id}/match", **ho)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["party"]["balance_minor"] == "3000"
    r = co.post(f"/api/parties/receipts/{rec.id}/match", **ho)  # type: ignore[arg-type]
    assert r.status_code == 400
    # ردّ نقدي 10 بسبب: الذمّة 40 والدرج −10
    refund = _receipt_op(
        ctx,
        str(ahmed.id),
        amount="1000",
        kind="refund",
        reason="بضاعة ناقصة",
        number="R6",
        shift_id=sid,
    )
    assert do_push(oc, refund) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert services.party_payload(ahmed)["balance_minor"] == "4000"
        t = shift_services.cash_totals(Shift.objects.get(id=sid))
        assert t.cash_refunds_minor == 1000
    r = co.get(f"/api/parties/{ahmed.id}/statement?range=all", **ho)  # type: ignore[arg-type]
    body = r.json()
    assert [x["label"] for x in body["rows"]] == [
        "بيع آجل",
        "سداد نقدي",
        "سداد بتحويل بنكي — مطابق",
        "ردّ مبلغ",
    ]
    assert [x["balance_minor"] for x in body["rows"]] == ["10000", "6000", "3000", "4000"]
    assert body["last_payment_at"]


def test_merge_identity_map_late_events_and_undo(ctx: dict[str, Any]) -> None:
    """PTY-07 / ACC-78: الدمج للمالك بتأكيد مزدوج؛ الرصيد المجمّع من خريطة هوية (الحركات تبقى
    بهويتها)؛ حدث متأخر باسم المصدر بعد الدمج يظهر في كشف الوارث موسوماً بمصدره؛ لا حلقات؛ التراجع
    ممكن ما لم تُسجَّل حركة جديدة على الوارث."""
    from sales.tests.test_sale import do_push, sale_op

    with tenant_context(ctx["tenant"].id):
        src = services.create_party(
            party_id=None,
            name="أحمد الطيب محمد",
            phone="0912555447",
            created_by=None,
            distinct_from=None,
        )
        tgt = services.create_party(
            party_id=None,
            name="أحمد الطيب",
            phone="0912555447",
            created_by=None,
            distinct_from=None,
        )
    oc = dict(ctx, owner=ctx["user"])
    assert do_push(
        oc,
        sale_op(
            oc, invoice="S-1", party_id=str(src.id), payments=[("credit", "6000")], price="6000"
        ),
    ) == ["accepted"]
    assert do_push(
        oc, sale_op(oc, invoice="T-1", party_id=str(tgt.id), payments=[("credit", "10000")])
    ) == ["accepted"]
    c, hc = api(ctx)
    r = c.get(f"/api/parties/{src.id}/merge?target={tgt.id}", **hc)  # type: ignore[arg-type]
    assert r.status_code == 403
    co, ho = _owner_client(ctx)
    r = co.get(f"/api/parties/{src.id}/merge?target={tgt.id}", **ho)  # type: ignore[arg-type]
    assert r.status_code == 200
    pv = r.json()
    assert pv["source"]["balance_minor"] == "6000" and pv["target"]["balance_minor"] == "10000"
    assert pv["balance_after_minor"] == "16000" and pv["movements_after"] == 2
    assert pv["phones_differ"] is False
    r = co.post(
        f"/api/parties/{src.id}/merge",
        {"target_id": str(tgt.id), "confirm": "nope"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 400
    r = co.post(
        f"/api/parties/{src.id}/merge",
        {"target_id": str(tgt.id), "confirm": "MERGE", "reason": "نفس الشخص"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    merge_id = r.json()["merge"]["id"]
    assert r.json()["target"]["balance_minor"] == "16000"
    with tenant_context(ctx["tenant"].id):
        src.refresh_from_db()
        assert src.merged_into_id == tgt.id
        # المدموج لا يظهر في البحث؛ الوارث يظهر
        assert [p.id for p in services.search_parties("أحمد")] == [tgt.id]
        # لا حلقات: الوارث لا يُدمج في مدموجه، والمدموج لا يُدمج ثانيةً
        import pytest as _pt

        with _pt.raises(services.CardRejected):
            services.merge_parties(tgt, src, actor=ctx["user"], reason="")
    # حدث متأخر باسم المصدر بعد الدمج: يظهر في كشف الوارث موسوماً بمصدره ويدخل رصيده
    late = sale_op(
        oc, invoice="S-2", party_id=str(src.id), payments=[("credit", "2000")], price="2000"
    )
    assert do_push(oc, late) == ["accepted"]
    r = co.get(f"/api/parties/{tgt.id}/statement?range=all", **ho)  # type: ignore[arg-type]
    body = r.json()
    assert body["balance_minor"] == "18000"
    late_row = next(x for x in body["rows"] if x["doc"] == "S-2")
    assert late_row["source_party"] == "أحمد الطيب محمد"
    assert next(x for x in body["rows"] if x["doc"] == "T-1")["source_party"] == ""
    # التراجع ممنوع بعد حركة جديدة
    r = co.post(f"/api/parties/merges/{merge_id}/undo", **ho)  # type: ignore[arg-type]
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "has_new_movements"


def test_receipt_correction_document(ctx: dict[str, Any]) -> None:
    """PTY-09: التصحيح مستند مستقل بسبب — الأصل لا يتغير: تصحيح الوسيلة (نقد → تحويل يُلغي أثر
    الدرج حتى المطابقة)، تصحيح المبلغ، عكس الحركة، وتاريخ داخل فترة مقفلة يُمنع بسبب؛ الكشف يعرض
    الأصل «مصحَّح» والتصحيح «يصحّح حركة …»."""
    from datetime import date, timedelta

    from sales.tests.test_sale import do_push, sale_op

    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=None, distinct_from=None
        )
    oc = dict(ctx, owner=ctx["user"])
    assert do_push(
        oc, sale_op(oc, invoice="INV-1", party_id=str(ahmed.id), payments=[("credit", "10000")])
    ) == ["accepted"]
    assert do_push(oc, _receipt_op(ctx, str(ahmed.id), amount="20000")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        rec = PaymentReceipt.objects.get()
        assert services.party_payload(ahmed)["balance_minor"] == "-10000"
    co, ho = _owner_client(ctx)
    c, hc = api(ctx)
    r = c.post(
        f"/api/parties/receipts/{rec.id}/correct",
        {"kind": "amount", "new_amount_minor": "1", "reason": "x"},
        content_type="application/json",
        **hc,  # type: ignore[arg-type]
    )
    assert r.status_code == 403
    r = co.get(f"/api/parties/receipts/{rec.id}/correct", **ho)  # type: ignore[arg-type]
    assert r.status_code == 200
    assert r.json()["effective"]["amount_minor"] == "20000" and r.json()["corrections"] == []
    assert r.json()["locked_before"] < date.today().isoformat()
    # السبب إلزامي
    r = co.post(
        f"/api/parties/receipts/{rec.id}/correct",
        {"kind": "amount", "new_amount_minor": "8000", "reason": " "},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "reason"
    # تصحيح المبلغ 200 → 80: الذمّة 100 − 80 = 20
    r = co.post(
        f"/api/parties/receipts/{rec.id}/correct",
        {"kind": "amount", "new_amount_minor": "8000", "reason": "خطأ إدخال"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["party"]["balance_minor"] == "2000"
    with tenant_context(ctx["tenant"].id):
        rec.refresh_from_db()
        assert rec.amount_minor == 20000  # الأصل ثابت
    # تاريخ داخل فترة مقفلة
    locked = (date.today().replace(day=1) - timedelta(days=40)).isoformat()
    r = co.post(
        f"/api/parties/receipts/{rec.id}/correct",
        {"kind": "date", "new_business_date": locked, "reason": "تاريخ خاطئ"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "period_locked"
    # تصحيح الوسيلة نقد → تحويل: الأثر يعود إلى «مسجَّل غير مطابق» فالذمّة 100 حتى المطابقة
    r = co.post(
        f"/api/parties/receipts/{rec.id}/correct",
        {
            "kind": "method",
            "new_method": "bank",
            "new_reference": "TRF-88190",
            "reason": "سُجّل نقداً بالخطأ",
        },
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["party"]["balance_minor"] == "10000"
    r = co.get(f"/api/parties/{ahmed.id}/statement?range=all", **ho)  # type: ignore[arg-type]
    labels = [x["label"] for x in r.json()["rows"]]
    assert "سداد بتحويل بنكي — مسجَّل غير مطابق — مصحَّح" in labels
    assert any(lbl.startswith("يصحّح حركة") for lbl in labels)
    # عكس الحركة بالكامل ثم لا تصحيح بعده
    r = co.post(
        f"/api/parties/receipts/{rec.id}/correct",
        {"kind": "reverse", "reason": "سند بالخطأ"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    r = co.post(
        f"/api/parties/receipts/{rec.id}/correct",
        {"kind": "amount", "new_amount_minor": "100", "reason": "x"},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "already_reversed"


def test_statement_export_and_authorized_link(ctx: dict[str, Any]) -> None:
    """PTY-08 / ACC-85: التوليد للمالك؛ الملف بمداه في اسمه ووقت توليده وعدد صفحاته؛ الرابط
    المخوَّل يفتح المستند بلا جلسة ويسجّل «تم الاطلاع» — «أُرسل» ليست «وصل»؛ الحقول المختارة تظهر."""
    from sales.tests.test_sale import do_push, sale_op

    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=None, distinct_from=None
        )
    oc = dict(ctx, owner=ctx["user"])
    s7 = sale_op(
        oc, invoice="INV-7", party_id=str(ahmed.id), payments=[("credit", "18000")], price="18000"
    )
    assert do_push(oc, s7) == ["accepted"]
    c, hc = api(ctx)
    r = c.post(
        f"/api/parties/{ahmed.id}/statement/export",
        {"kind": "link"},
        content_type="application/json",
        **hc,  # type: ignore[arg-type]
    )
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    co, ho = _owner_client(ctx)
    r = co.post(
        f"/api/parties/{ahmed.id}/statement/export",
        {"kind": "link", "range": "all", "include_invoices": True, "include_branch": True},
        content_type="application/json",
        **ho,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    exp = r.json()["export"]
    assert exp["file_name"].startswith("كشف-حساب-أحمد الطيب-كامل-") and exp["page_count"] == 1
    assert exp["opened_at"] == "" and exp["open_count"] == 0
    # الرابط المخوَّل بلا جلسة: المستند بترويسته وسطوره وحقوله المختارة
    r = Client().get(exp["url"])
    assert r.status_code == 200
    doc = r.content.decode()
    assert "كشف حساب: أحمد الطيب" in doc and "INV-7" in doc and "180.00" in doc
    assert "الرصيد المستحق" in doc and "وُلِّد" in doc
    # الحالة بصدق: فُتح مرة
    r = co.get(f"/api/parties/statement-exports/{exp['id']}", **ho)  # type: ignore[arg-type]
    assert r.status_code == 200
    assert r.json()["export"]["open_count"] == 1 and r.json()["export"]["opened_at"] != ""
    assert Client().get("/api/parties/exports/nope").status_code == 404
    # الكشف الطويل يُرفض بسبب — البديل مدى أقصر أو طباعة مباشرة
    services.MAX_EXPORT_ROWS, keep = 0, services.MAX_EXPORT_ROWS
    try:
        r = co.post(
            f"/api/parties/{ahmed.id}/statement/export",
            {"kind": "pdf"},
            content_type="application/json",
            **ho,  # type: ignore[arg-type]
        )
        assert r.status_code == 400 and r.json()["errors"][0]["code"] == "too_long"
    finally:
        services.MAX_EXPORT_ROWS = keep
