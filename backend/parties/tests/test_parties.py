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
from parties.models import Party
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
