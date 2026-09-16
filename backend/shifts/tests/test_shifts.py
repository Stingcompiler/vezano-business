"""SHIFT-01/02 (T1.11): ShiftOpened حدث ثابت متزامن بنطاق الفرع فور إنشائه (§١٠.٣)؛ الإسقاط
الخادمي من PUSH متكرّر الأثر؛ الوردية الحالية للفرع مع كشف وردية ثانية؛ expected_cash من الحركات؛
الرئيسية تقول «وردية مفتوحة منذ». معيارا §١٨ ACC-34، 66.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from conftest import TwoTenants
from core import home
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from shifts import services
from shifts.models import Shift, ShiftCashMovement
from sync.counter import ensure_state
from sync.push import PROTOCOL_VERSION, push

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _providers() -> Any:
    services.CASH_EFFECT_PROVIDERS.clear()
    yield
    services.CASH_EFFECT_PROVIDERS.clear()


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
        "other_branch": two_tenants.a_branches[1],
        "owner": owner,
        "device": reg.device,
        "access": reg.access,
        "epoch": epoch,
    }


def shift_open(c: dict[str, Any], shift_id: str, opening: str = "50000") -> dict[str, Any]:
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "shift_open",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {
                "entity": "shifts.ShiftOpened",
                "id": shift_id,
                "schema_version": 1,
                "payload": {
                    "shift_id": shift_id,
                    "branch_id": str(c["branch"].id),
                    "device_id": str(c["device"].id),
                    "user_id": str(c["owner"].id),
                    "opening_float_minor": opening,
                    "business_date": "2026-09-11",
                    "occurred_at": "2026-09-11T08:00:00Z",
                },
            }
        ],
    }


def cash_movement(shift_id: str, kind: str, amount: str, dep: str) -> dict[str, Any]:
    mid = str(uuid.uuid4())
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "cash_movement",
        "op_version": 1,
        "dependencies": [dep],
        "members": [
            {
                "entity": "shifts.CashMovement",
                "id": mid,
                "schema_version": 1,
                "payload": {
                    "movement_id": mid,
                    "shift_id": shift_id,
                    "kind": kind,
                    "signed_amount_minor": amount,
                    "reason": "صرف" if kind == "withdrawal" else "",
                    "actor_user_id": "00000000-0000-0000-0000-000000000001",
                    "occurred_at": "2026-09-11T09:00:00Z",
                },
            }
        ],
    }


def do_push(c: dict[str, Any], *ops: dict[str, Any]) -> dict[str, str]:
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
    return {r["operation_id"]: r["status"] for r in resp["results"]}


def test_shift_open_projects_and_replay_is_idempotent(ctx: dict[str, Any]) -> None:
    """ACC-34: فتح بلا اتصال ثم رفع — يُقبل فور وصوله قبل الإغلاق؛ الإعادة duplicate بلا إسقاط
    ثانٍ."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    assert list(do_push(ctx, op).values()) == ["accepted"]
    assert list(do_push(ctx, op).values()) == ["duplicate"]
    with tenant_context(ctx["tenant"].id):
        s = Shift.objects.get(id=sid)
        assert s.state == "open" and s.opening_float_minor == 50000
        assert s.user_name == "سالم" and s.device_name == "كاشير 2"
        cur = services.current_for_branch(ctx["branch"].id)
        assert cur["current"]["id"] == sid and cur["others_open"] == [] and cur["previous"] is None
        assert cur["current"]["expected_cash_minor"] == "50000"
        # الفرع الآخر بلا وردية
        assert services.current_for_branch(ctx["other_branch"].id)["current"] is None
        # الحدث موجود في sync_log بنطاق الفرع (يصل الأجهزة الأخرى)
        from sync.models_log import SyncLog

        row = SyncLog.unscoped.get(tenant_id=ctx["tenant"].id, entity_id=sid)
        assert row.scope == "branch" and row.scope_id == str(ctx["branch"].id)


def test_second_open_shift_same_branch_is_recorded_not_blocked(ctx: dict[str, Any]) -> None:
    """«أن تُفتح وردية ثانية للفرع نفسه من جهاز آخر. لا نمنعه ولا نستطيع — ويُكشف عند المزامنة»."""
    s1, s2 = str(uuid.uuid4()), str(uuid.uuid4())
    do_push(ctx, shift_open(ctx, s1))
    op2 = shift_open(ctx, s2)
    op2["members"][0]["payload"]["occurred_at"] = "2026-09-11T08:30:00Z"
    assert list(do_push(ctx, op2).values()) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        cur = services.current_for_branch(ctx["branch"].id)
        assert cur["current"]["id"] == s1
        assert [o["id"] for o in cur["others_open"]] == [s2]


def test_cash_movements_change_expected_cash_and_home_reports_shift(ctx: dict[str, Any]) -> None:
    """expected_cash = الافتتاح + إيداعات − سحوبات (§١٠.٣)؛ مزوّد الآثار النقدية لـPOS/PTY؛
    الرئيسية «وردية مفتوحة منذ 08:00»."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    do_push(ctx, op)
    res = do_push(
        ctx,
        cash_movement(sid, "deposit", "10000", op["operation_id"]),
        cash_movement(sid, "withdrawal", "-2500", op["operation_id"]),
    )
    assert set(res.values()) == {"accepted"}
    with tenant_context(ctx["tenant"].id):
        assert ShiftCashMovement.objects.filter(shift_id=sid).count() == 2
        p = services.shift_payload(Shift.objects.select_related("branch").get(id=sid))
        assert p["expected_cash_minor"] == "57500"
        assert p["totals"]["cash_deposits_minor"] == "10000"
        assert p["totals"]["cash_withdrawals_minor"] == "2500"
        services.CASH_EFFECT_PROVIDERS.append(
            lambda _s: {"cash_sales": 148000, "cash_debt_receipts": 14000, "cash_refunds": 40000}
        )
        p = services.shift_payload(Shift.objects.select_related("branch").get(id=sid))
        assert p["expected_cash_minor"] == str(50000 + 148000 + 14000 + 10000 - 40000 - 2500)
        viewer = home.viewer_for(ctx["owner"], ctx["device"])
        out = home.home_summary(ctx["tenant"].id, viewer)
        assert out["shift"]["open_since"] == "2026-09-11T08:00:00Z"
        assert out["shift"]["user_name"] == "سالم" and out["shift"]["device_name"] == "كاشير 2"


def test_current_endpoint_uses_device_branch_and_isolation(ctx: dict[str, Any]) -> None:
    sid = str(uuid.uuid4())
    do_push(ctx, shift_open(ctx, sid))
    c = Client()
    h = {"HTTP_AUTHORIZATION": f"Bearer {ctx['access']}"}
    r = c.get("/api/shifts/current", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["current"]["id"] == sid
    assert r.json()["branch_id"] == str(ctx["branch"].id)
    r = c.get(f"/api/shifts/{sid}", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["user_name"] == "سالم"
    assert c.get("/api/shifts/current").status_code == 401
