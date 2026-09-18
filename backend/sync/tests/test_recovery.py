"""SYS-07/SYS-08 (T1.38): جهاز مسحوب يسلّم عمله إلى الحجر باعتماد مقيّد (رمز التجديد، لا هوية من
الحمولة)؛ المالك يسترده منسوباً إلى مُنشئه والجهاز يبقى مسحوباً؛ التجميد والمحو بإقرار؛ المصالحة
بعد تغيّر الجيل تقارن الهويات الأصلية."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from core.auth.devices import revoke_device
from core.models import Device
from core.tenancy import tenant_context
from parties import services
from parties.tests.test_parties import _owner_client, _receipt_op, api, ctx  # noqa: F401
from sales.tests.test_sale import do_push, sale_op
from sync.counter import ensure_state
from sync.models import Operation, QuarantinedOperation
from sync.tests.test_review import _hdr, _shift_op

pytestmark = pytest.mark.django_db(transaction=True)


def test_revoked_device_hands_over_to_quarantine_and_owner_restores(ctx: dict[str, Any]) -> None:  # noqa: F811
    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=None, distinct_from=None
        )
    oc = dict(ctx, owner=ctx["user"])
    shift, sid = _shift_op(ctx)
    do_push(oc, shift)
    unsent = sale_op(oc, invoice="INV-9001", party_id=str(ahmed.id), payments=[("cash", "10000")])
    # سحب الجهاز: PUSH المعتاد يُرفض
    with tenant_context(ctx["tenant"].id):
        device = Device.objects.get(id=ctx["device"].id)
        revoke_device(device)
    c, h = api(ctx)
    r = c.post(
        "/api/sync/push",
        {
            "protocol_version": 1,
            "sync_epoch": ctx["epoch"],
            "request_id": "x",
            "operations": [unsent],
        },
        content_type="application/json",
        headers=_hdr(h),
    )
    assert r.status_code == 401 and r.json()["detail"] in ("device_revoked", "session_revoked")
    # التسليم المقيّد برمز التجديد: يُحجز ولا يُطبَّق
    rh = {"Authorization": f"Bearer {ctx['refresh']}"}
    r = c.post(
        "/api/sync/recovery/handover",
        {"operations": [unsent]},
        content_type="application/json",
        headers=rh,
    )
    assert r.status_code == 200, r.content
    assert r.json()["results"] == [{"operation_id": unsent["operation_id"], "status": "held"}]
    r = c.post(
        "/api/sync/recovery/handover",
        {"operations": [unsent]},
        content_type="application/json",
        headers=rh,
    )
    assert r.json()["results"][0]["status"] == "duplicate"
    with tenant_context(ctx["tenant"].id):
        assert not Operation.objects.filter(operation_id=unsent["operation_id"]).exists()
        q = QuarantinedOperation.objects.get(operation_id=unsent["operation_id"])
        assert q.reason == "recovered" and q.actor_user == ctx["user"].id
        assert services.party_payload(ahmed)["balance_minor"] == "0"

    # الكاشير يرى العدد والقيمة بلا تفصيل؛ المالك يرى التفصيل ويسترد
    oc_client, oh = _owner_client(ctx)
    lst = oc_client.get("/api/sync/recovery", headers=_hdr(oh)).json()
    dev = lst["devices"][0]
    assert dev["status"] == "revoked" and dev["held_count"] == 1
    assert dev["held_value_minor"] == "10000" and dev["items"][0]["kind"] == "sale"
    assert dev["actor_names"] == ["سميرة ع."]
    # (الكاشير نفسه مسحوب جهازه — نستعمل جلسة المالك لفحص وضع غير المالك عبر منطق detailed)
    r = oc_client.post(
        f"/api/sync/recovery/{dev['id']}/restore",
        {},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 200, r.content
    assert r.json()["restored"] == 1 and r.json()["status"] == "revoked"
    with tenant_context(ctx["tenant"].id):
        op = Operation.objects.get(operation_id=unsent["operation_id"])
        assert op.actor_user == ctx["user"].id  # منسوبة إلى من أنشأها لا إلى من استردّها
        assert op.device == ctx["device"].id
        assert Device.objects.get(id=ctx["device"].id).status == "revoked"
        q.refresh_from_db()
        assert q.decision == "restored" and q.decided_by_name == "سالم"
    assert (
        oc_client.get("/api/sync/recovery", headers=_hdr(oh)).json()["devices"][0]["held_count"]
        == 0
    )

    # المحو بعد إقرار؛ بلا إقرار مع معلّق مسجَّل يُرفض؛ الممحو لا يسلّم
    with tenant_context(ctx["tenant"].id):
        from core.auth.sessions import report_pending
        from core.models import Session

        s = Session.unscoped.filter(device_id=ctx["device"].id).first()
        assert s is not None
        report_pending(s, 3)
    r = oc_client.post(
        f"/api/sync/recovery/{dev['id']}/wipe",
        {},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 400 and r.json()["detail"] == "acknowledgement_required"
    r = oc_client.post(
        f"/api/sync/recovery/{dev['id']}/wipe",
        {"acknowledgement": "أقرّ بفقد العمليات الثلاث — سالم"},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 200 and r.json()["status"] == "wiped"
    r = c.post(
        "/api/sync/recovery/handover",
        {"operations": [unsent]},
        content_type="application/json",
        headers=rh,
    )
    assert r.status_code == 401 and "device_wiped" in r.content.decode()
    with tenant_context(ctx["tenant"].id):
        d = Device.objects.get(id=ctx["device"].id)
        assert d.wipe_acknowledgement.startswith("أقرّ") and d.wiped_by_name == "سالم"


def test_freeze_blocks_access_but_allows_handover(ctx: dict[str, Any]) -> None:  # noqa: F811
    oc_client, oh = _owner_client(ctx)
    c, h = api(ctx)
    r = oc_client.post(
        f"/api/sync/recovery/{ctx['device'].id}/freeze",
        {},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 200 and r.json()["status"] == "frozen"
    assert c.get("/api/sync/status", headers=_hdr(h)).status_code == 401
    oc = dict(ctx, owner=ctx["user"])
    shift, _sid = _shift_op(ctx)
    r = c.post(
        "/api/sync/recovery/handover",
        {"operations": [shift]},
        content_type="application/json",
        headers={"Authorization": f"Bearer {ctx['refresh']}"},
    )
    assert r.status_code == 200 and r.json()["results"][0]["status"] == "held"
    # جهاز فعّال لا يسلّم — مساره PUSH المعتاد
    with tenant_context(ctx["tenant"].id):
        d = Device.objects.get(id=ctx["device"].id)
        d.status = Device.Status.ACTIVE
        d.save(update_fields=["status"])
    r = c.post(
        "/api/sync/recovery/handover",
        {"operations": [shift]},
        content_type="application/json",
        headers={"Authorization": f"Bearer {ctx['refresh']}"},
    )
    assert r.status_code == 409 and r.json()["detail"] == "device_active"
    del oc


def test_reconcile_reports_present_and_missing_by_original_ids(ctx: dict[str, Any]) -> None:  # noqa: F811
    oc = dict(ctx, owner=ctx["user"])
    shift, _sid = _shift_op(ctx)
    assert do_push(oc, shift) == ["accepted"]
    lost = str(uuid.uuid4())
    c, h = api(ctx)
    r = c.post(
        "/api/sync/reconcile",
        {"operation_ids": [shift["operation_id"], lost, "not-a-uuid"]},
        content_type="application/json",
        headers=_hdr(h),
    )
    assert r.status_code == 200
    body = r.json()
    with tenant_context(ctx["tenant"].id):
        assert body["sync_epoch"] == ensure_state(ctx["tenant"].id).sync_epoch
    assert body["present"] == [shift["operation_id"]] and body["missing"] == [lost]
