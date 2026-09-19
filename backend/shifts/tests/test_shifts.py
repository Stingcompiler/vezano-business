"""SHIFT-01/02 (T1.11): ShiftOpened حدث ثابت متزامن بنطاق الفرع فور إنشائه (§١٠.٣)؛ الإسقاط
الخادمي من PUSH متكرّر الأثر؛ الوردية الحالية للفرع مع كشف وردية ثانية؛ expected_cash من الحركات؛
الرئيسية تقول «وردية مفتوحة منذ». معيارا §١٨ ACC-34، 66.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core import home
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from shifts import services
from shifts.models import Shift, ShiftCashMovement
from sync.counter import ensure_state
from sync.push import PROTOCOL_VERSION, push

# تواريخ نسبية: «أمس» يوم الوردية و«اليوم» ما بعدها — كي تبقى داخل نافذة المراجعة (7 أيام) مهما
# مرّ التقويم
D = (datetime.now(tz=UTC) - timedelta(days=1)).date().isoformat()
D1 = datetime.now(tz=UTC).date().isoformat()

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _providers() -> Any:
    # المزوّدون المسجَّلون عند تحميل التطبيقات (POS…) يُعزلون هنا ثم يُعادون — لا يُمحون للجلسة كلها
    saved = list(services.CASH_EFFECT_PROVIDERS)
    services.CASH_EFFECT_PROVIDERS.clear()
    yield
    services.CASH_EFFECT_PROVIDERS[:] = saved


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
                    "business_date": D,
                    "occurred_at": f"{D}T08:00:00Z",
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
                    "reason": "توريد للخزنة الرئيسية" if kind == "withdrawal" else "عهدة إضافية",
                    "actor_user_id": "00000000-0000-0000-0000-000000000001",
                    "occurred_at": f"{D}T09:00:00Z",
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
    op2["members"][0]["payload"]["occurred_at"] = f"{D}T08:30:00Z"
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
        assert out["shift"]["open_since"] == f"{D}T08:00:00Z"
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


def shift_close(
    c: dict[str, Any], shift_id: str, dep: str, counted: str | None, expected: str
) -> dict[str, Any]:
    members: list[dict[str, Any]] = [
        {
            "entity": "shifts.ShiftClosed",
            "id": str(uuid.uuid4()),
            "schema_version": 1,
            "payload": {
                "shift_id": shift_id,
                "expected_cash_at_close_minor": expected,
                "count_status": "counted" if counted is not None else "not_counted",
                "expected_source": "device",
                "actor_user_id": str(c["owner"].id),
                "occurred_at": f"{D}T20:42:00Z",
            },
        }
    ]
    if counted is not None:
        cid = str(uuid.uuid4())
        members.append(
            {
                "entity": "shifts.CashCounted",
                "id": cid,
                "schema_version": 1,
                "payload": {
                    "count_id": cid,
                    "shift_id": shift_id,
                    "counted_cash_minor": counted,
                    "denominations": [{"face_minor": "50000", "count": 2}],
                    "actor_user_id": str(c["owner"].id),
                    "occurred_at": f"{D}T20:40:00Z",
                },
            }
        )
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "shift_close",
        "op_version": 1,
        "dependencies": [dep],
        "members": members,
    }


def test_close_with_count_snapshots_expected_and_late_movement_does_not_change_it(
    ctx: dict[str, Any],
) -> None:
    """SHIFT-04: الإقفال بالعدّ — expected_cash_at_close لقطة ثابتة، والفارق = المعدود − المتوقَّع؛
    حركة متأخرة لا تعدّل اللقطة (§١٠.٣)؛ الإعادة duplicate."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    do_push(ctx, op)
    close = shift_close(ctx, sid, op["operation_id"], counted="238500", expected="243000")
    assert list(do_push(ctx, close).values()) == ["accepted"]
    assert list(do_push(ctx, close).values()) == ["duplicate"]
    with tenant_context(ctx["tenant"].id):
        p = services.shift_payload(Shift.objects.select_related("branch").get(id=sid))
        assert p["state"] == "closed" and p["count_status"] == "counted"
        assert p["expected_cash_at_close_minor"] == "243000"
        assert p["counted_cash_minor"] == "238500" and p["variance_minor"] == "-4500"
        assert p["counted_by_name"] == "سالم" and p["denominations"][0]["count"] == 2
        assert services.current_for_branch(ctx["branch"].id)["current"] is None
        assert services.current_for_branch(ctx["branch"].id)["previous"]["id"] == sid
    # حركة متأخرة بعد الإقفال: تُقبل ولا تعدّل اللقطة
    do_push(ctx, cash_movement(sid, "deposit", "10000", op["operation_id"]))
    with tenant_context(ctx["tenant"].id):
        p = services.shift_payload(Shift.objects.select_related("branch").get(id=sid))
        assert p["expected_cash_at_close_minor"] == "243000" and p["variance_minor"] == "-4500"
        assert p["expected_cash_minor"] == "60000"  # المتوقَّع الحيّ يتحرّك؛ اللقطة لا


def test_close_without_count_declares_unknown_variance(ctx: dict[str, Any]) -> None:
    """«بلا عدّ» يُعلن والفرق غير معروف لا صفر (ACC-67)."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    do_push(ctx, op)
    do_push(ctx, shift_close(ctx, sid, op["operation_id"], counted=None, expected="50000"))
    with tenant_context(ctx["tenant"].id):
        p = services.shift_payload(Shift.objects.select_related("branch").get(id=sid))
        assert p["state"] == "closed" and p["count_status"] == "not_counted"
        assert p["counted_cash_minor"] == "" and p["variance_minor"] == ""


def test_cash_movement_kinds_reversal_and_requests(ctx: dict[str, Any]) -> None:
    """SHIFT-03: مصروف سالب بسبب إلزامي؛ العكس حركة مضادّة تشير إلى الأصل؛ «اطلب من المالك»."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    do_push(ctx, op)
    exp = cash_movement(sid, "expense", "-30000", op["operation_id"])
    exp["members"][0]["payload"]["reason"] = "شراء أكياس وأشرطة تغليف من محل الهدى"
    exp["members"][0]["payload"]["number"] = "119"
    exp["members"][0]["payload"]["actor_user_id"] = str(ctx["owner"].id)
    assert list(do_push(ctx, exp).values()) == ["accepted"]
    # بلا سبب → مرفوض؛ إشارة خاطئة → مرفوض
    bad = cash_movement(sid, "expense", "-100", op["operation_id"])
    bad["members"][0]["payload"]["reason"] = ""
    assert list(do_push(ctx, bad).values()) == ["rejected"]
    bad2 = cash_movement(sid, "deposit", "-100", op["operation_id"])
    assert list(do_push(ctx, bad2).values()) == ["rejected"]
    # العكس بالإشارة المضادّة يشير إلى الأصل
    rev = cash_movement(sid, "expense", "30000", exp["operation_id"])
    rev["members"][0]["payload"]["reverses_movement_id"] = exp["members"][0]["id"]
    rev["members"][0]["payload"]["reason"] = "تصحيح — الحركة تخصّ وردية أمس"
    assert list(do_push(ctx, rev).values()) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        p = services.shift_payload(Shift.objects.select_related("branch").get(id=sid))
        assert p["expected_cash_minor"] == "50000"
        by_reason = {m["reason"]: m for m in p["movements"]}
        assert by_reason["تصحيح — الحركة تخصّ وردية أمس"]["reverses_id"] == exp["members"][0]["id"]
        assert by_reason["شراء أكياس وأشرطة تغليف من محل الهدى"]["number"] == "119"
        assert by_reason["شراء أكياس وأشرطة تغليف من محل الهدى"]["actor_name"] == "سالم"
    # طلب سحب من المالك
    c = Client()
    h = {"HTTP_AUTHORIZATION": f"Bearer {ctx['access']}"}
    r = c.post(
        f"/api/shifts/{sid}/requests",
        {"kind": "withdrawal", "amount_minor": "100000", "reason": "توريد للخزنة"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["status"] == "pending"
    assert r.json()["owner_name"] == "سالم"
    cur = c.get("/api/shifts/current", **h).json()  # type: ignore[arg-type]
    assert cur["can_withdraw"] is True and cur["owner_name"] == "سالم"
    assert cur["current"]["pending_requests"][0]["amount_minor"] == "100000"
    r = c.post(
        f"/api/shifts/{sid}/requests",
        {"kind": "withdrawal", "amount_minor": "-5", "reason": "x"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 400


# ---------------------------------------------------------------- SHIFT-05 (T1.13)


def cash_adjustment(shift_id: str, amount: str, reason: str, dep: str) -> dict[str, Any]:
    aid = str(uuid.uuid4())
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "cash_adjustment",
        "op_version": 1,
        "dependencies": [dep],
        "members": [
            {
                "entity": "shifts.CashAdjustment",
                "id": aid,
                "schema_version": 1,
                "payload": {
                    "adjustment_id": aid,
                    "shift_id": shift_id,
                    "signed_amount_minor": amount,
                    "approved_by_user_id": "00000000-0000-0000-0000-000000000001",
                    "reason": reason,
                    "late_item_ids": [],
                    "occurred_at": f"{D1}T07:30:00Z",
                },
            }
        ],
    }


def test_late_movement_is_listed_outside_snapshot_and_review_records_adjustment(
    ctx: dict[str, Any],
) -> None:
    """ACC-68: حركة تصل بعد الإقفال تُعرض بنداً مستقلاً («وصلت بعد الإغلاق — خارج اللقطة») ولا تعدّل
    اللقطة ولا الفارق؛ «إقرار المراجعة» من المالك تسوية بقيمة الفارق باسمه وسببه تُقرّ المتأخر."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    do_push(ctx, op)
    do_push(ctx, shift_close(ctx, sid, op["operation_id"], counted="238500", expected="243000"))
    late = cash_movement(sid, "deposit", "15000", op["operation_id"])
    late["members"][0]["payload"]["occurred_at"] = f"{D}T20:30:00Z"  # قبل الإقفال بوقتها
    late["members"][0]["payload"]["number"] = "121"
    do_push(ctx, late)
    with tenant_context(ctx["tenant"].id):
        # الإقفال أمس والقبول الآن → متأخرة
        rows = services.review_rows(None, now=timezone.now())
        row = next(r for r in rows if r["id"] == sid)
        assert row["expected_cash_at_close_minor"] == "243000"
        assert row["variance_minor"] == "-4500" and row["review"] is None
        assert [i["number"] for i in row["late_items"]] == ["121"]
        assert row["late_items"][0]["reviewed"] is False
        assert row["late_items"][0]["signed_amount_minor"] == "15000"
        # المتوقَّع الحيّ يتحرّك؛ اللقطة لا
        assert row["expected_cash_minor"] == "65000"
    c = Client()
    h = {"HTTP_AUTHORIZATION": f"Bearer {ctx['access']}"}
    r = c.get("/api/shifts/review", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["scope"] == "all" and r.json()["can_settle"]
    assert [s["id"] for s in r.json()["shifts"]] == [sid]
    # بفارق وبلا سبب → رفض مضبوط
    r = c.post(f"/api/shifts/{sid}/review", {"reason": ""}, content_type="application/json", **h)  # type: ignore[arg-type]
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "reason"
    r = c.post(
        f"/api/shifts/{sid}/review",
        {"reason": "نقص تغيير الفكّة — يُخصم من عهدة الوردية"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201
    body = r.json()
    assert body["signed_amount_minor"] == "-4500" and body["approved_by_name"] == "سالم"
    assert body["row"]["review"]["reason"] == "نقص تغيير الفكّة — يُخصم من عهدة الوردية"
    assert body["row"]["late_items"][0]["reviewed"] is True
    with tenant_context(ctx["tenant"].id):
        s = Shift.objects.get(id=sid)
        # اللقطة والعدّ لا يُمسّان بالتسوية
        assert s.expected_cash_at_close_minor == 243000 and s.counted_cash_minor == 238500
        assert s.adjustments.count() == 1


def test_cash_adjustment_push_kind_is_idempotent_and_requires_reason_with_variance(
    ctx: dict[str, Any],
) -> None:
    """§١٠.٣ CashAdjustment حدث في عقد PUSH: مقبول ومتكرّر الأثر؛ فارق بلا سبب مرفوض؛ صفر بلا سبب
    يجوز (إقرار مراجعة بلا فارق)."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    do_push(ctx, op)
    do_push(ctx, shift_close(ctx, sid, op["operation_id"], counted="50000", expected="50000"))
    bad = cash_adjustment(sid, "-4500", "", op["operation_id"])
    assert list(do_push(ctx, bad).values()) == ["rejected"]
    ok = cash_adjustment(sid, "0", "", op["operation_id"])
    assert list(do_push(ctx, ok).values()) == ["accepted"]
    assert list(do_push(ctx, ok).values()) == ["duplicate"]
    good = cash_adjustment(sid, "-4500", "نقص فكّة", op["operation_id"])
    good["members"][0]["payload"]["approved_by_user_id"] = str(ctx["owner"].id)
    good["members"][0]["payload"]["occurred_at"] = f"{D1}T08:00:00Z"  # الأحدث هي المعروضة
    assert list(do_push(ctx, good).values()) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        s = Shift.objects.get(id=sid)
        assert s.adjustments.count() == 2
        row = services.review_row(Shift.objects.select_related("branch").get(id=sid))
        assert row["review"]["approved_by_name"] == "سالم"
        assert row["review"]["signed_amount_minor"] == "-4500"


def test_review_scope_manager_sees_own_branch_and_cannot_settle(ctx: dict[str, Any]) -> None:
    """38-D30 permission_denied: «مدير الفرع يرى فرعه» ولا يُسوّي — التسوية للمالك."""
    sid = str(uuid.uuid4())
    op = shift_open(ctx, sid)
    do_push(ctx, op)
    do_push(ctx, shift_close(ctx, sid, op["operation_id"], counted="50000", expected="50000"))
    with platform_context():
        manager = User.objects.create_user(
            tenant=ctx["tenant"], username="nada", display_name="ندى", is_owner=False
        )
        role = Role.unscoped.create(tenant=ctx["tenant"], code="manager", name="مدير فرع")
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=manager, branch=ctx["other_branch"], role=role
        )
    with tenant_context(ctx["tenant"].id):
        reg = register_device(user=manager, branch=ctx["other_branch"], name="مكتب بحري")
    c = Client()
    h = {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}
    r = c.get("/api/shifts/review", **h)  # type: ignore[arg-type]
    assert r.status_code == 200
    assert r.json()["scope"] == "branch" and r.json()["can_settle"] is False
    assert r.json()["branch_name"] == ctx["other_branch"].name
    assert r.json()["shifts"] == []  # وردية الفرع الرئيسي لا تظهر لمدير بحري
    r = c.post(f"/api/shifts/{sid}/review", {"reason": "x"}, content_type="application/json", **h)  # type: ignore[arg-type]
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    with tenant_context(ctx["tenant"].id):
        assert Shift.objects.get(id=sid).adjustments.count() == 0


def test_abandoned_open_shift_listed_first_and_ranking_by_value(ctx: dict[str, Any]) -> None:
    """15-D10: المفتوحة أياماً «مهجورة» تُسمّى ولا تُقفل بالمتوقَّع؛ 38-D30: الفوارق مرتّبة بالقيمة
    (400 قبل 5) والمطابِقة آخراً؛ «بلا عدّ» فارق غير معروف قبل الفوارق المعروفة."""
    now = timezone.now()
    ids = {k: str(uuid.uuid4()) for k in ("abandoned", "small", "big", "matched", "uncounted")}
    ops = {k: shift_open(ctx, v) for k, v in ids.items()}
    ops["abandoned"]["members"][0]["payload"]["occurred_at"] = "2026-09-09T14:10:00Z"
    do_push(ctx, *ops.values())
    close_at = (now - timedelta(hours=2)).isoformat().replace("+00:00", "Z")

    def close(k: str, counted: str | None, expected: str) -> dict[str, Any]:
        cl = shift_close(ctx, ids[k], ops[k]["operation_id"], counted=counted, expected=expected)
        cl["members"][0]["payload"]["occurred_at"] = close_at
        return cl

    do_push(
        ctx,
        close("small", "49500", "50000"),
        close("big", "10000", "50000"),
        close("matched", "50000", "50000"),
        close("uncounted", None, "50000"),
    )
    with tenant_context(ctx["tenant"].id):
        rows = services.review_rows(None, now=now)
        assert [r["id"] for r in rows] == [
            ids["abandoned"],
            ids["uncounted"],
            ids["big"],
            ids["small"],
            ids["matched"],
        ]
        assert rows[0]["abandoned"] is True and rows[0]["state"] == "open"
        assert rows[0]["counted_cash_minor"] == "" and rows[0]["variance_minor"] == ""
        assert rows[1]["count_status"] == "not_counted" and rows[1]["variance_minor"] == ""
        assert rows[2]["variance_minor"] == "-40000" and rows[3]["variance_minor"] == "-500"
        # مقفلة قبل أكثر من أسبوع لا تدخل المدى
        assert all(r["id"] != "x" for r in rows)
    # الإقفال الإداري غير مرسوم: الوردية المفتوحة تُرفض في «إقرار المراجعة»
    c = Client()
    h = {"HTTP_AUTHORIZATION": f"Bearer {ctx['access']}"}
    r = c.post(
        f"/api/shifts/{ids['abandoned']}/review",
        {"reason": "x"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["detail"] == "shift_open"
