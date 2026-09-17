"""POS-03 (T1.15): سقوف الخصم بحسب الدور (G-09 مؤقتاً) تصل الجهاز مع `shifts/current`؛ تجاوز السقف
حدث `discount_override` يُنسب للكاشير ويُراجع عند الاتصال (§٧.٤)؛ متكرّر الأثر وبسبب إلزامي.
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
from sales import services
from sales.models import DiscountOverride
from sync.counter import ensure_state
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
        owner = User.objects.create_user(
            tenant=two_tenants.a, username="nada", display_name="ندى", is_owner=True
        )
        UserBranchAccess.unscoped.create(
            tenant=two_tenants.a, user=owner, branch=two_tenants.a_branches[0], role=role
        )
    with tenant_context(two_tenants.a.id):
        reg = register_device(user=cashier, branch=two_tenants.a_branches[0], name="كاشير 2")
        reg_owner = register_device(user=owner, branch=two_tenants.a_branches[0], name="مكتب")
        epoch = ensure_state(two_tenants.a.id).sync_epoch
    return {
        "tenant": two_tenants.a,
        "branch": two_tenants.a_branches[0],
        "user": cashier,
        "device": reg.device,
        "access": reg.access,
        "owner_access": reg_owner.access,
        "epoch": epoch,
    }


def test_caps_by_role_reach_device_with_current_shift(ctx: dict[str, Any]) -> None:
    c = Client()
    r = c.get("/api/shifts/current", HTTP_AUTHORIZATION=f"Bearer {ctx['access']}")
    caps = r.json()["discount_caps"]
    assert r.json()["role_code"] == "cashier"
    assert caps == {
        "per_op_minor": "1000",
        "daily_minor": "5000",
        "percent": 10,
        "used_today_minor": "0",
    }
    services.DISCOUNT_USAGE_PROVIDERS.append(lambda _uid: 2200)
    try:
        r = c.get("/api/shifts/current", HTTP_AUTHORIZATION=f"Bearer {ctx['access']}")
        assert r.json()["discount_caps"]["used_today_minor"] == "2200"
    finally:
        services.DISCOUNT_USAGE_PROVIDERS.clear()
    r = c.get("/api/shifts/current", HTTP_AUTHORIZATION=f"Bearer {ctx['owner_access']}")
    assert r.json()["discount_caps"]["per_op_minor"] == "0"  # المالك بلا حدّ


def test_discount_override_event_is_recorded_pending_and_requires_reason(
    ctx: dict[str, Any],
) -> None:
    rid = str(uuid.uuid4())

    def op(reason: str, value: str = "3500") -> dict[str, Any]:
        return {
            "operation_id": str(uuid.uuid4()),
            "kind": "discount_override",
            "op_version": 1,
            "dependencies": [],
            "members": [
                {
                    "entity": "sales.DiscountOverride",
                    "id": rid,
                    "schema_version": 1,
                    "payload": {
                        "request_id": rid,
                        "branch_id": str(ctx["branch"].id),
                        "mode": "amount",
                        "value": value,
                        "cap": "1000",
                        "reason": reason,
                        "cart_total_minor": "24000",
                        "occurred_at": "2026-09-16T11:00:00Z",
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

    assert do(op("")) == ["rejected"]
    good = op("عميل دائم")
    assert do(good) == ["accepted"]
    assert do(good) == ["duplicate"]
    with tenant_context(ctx["tenant"].id):
        row = DiscountOverride.objects.get(id=rid)
        assert row.status == "pending" and row.requested_by_name == "سميرة ع."
        assert row.value == "3500" and row.cap == "1000" and row.cart_total_minor == 24000
