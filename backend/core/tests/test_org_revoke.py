"""ORG-05 (T2.3): التعطيل يمنع الدخول الجديد فوراً ولا يمسّ غيره على الجهاز المشترك ولا يمحو معلّقه
(ACC-63)؛ وردية مفتوحة باسمه مانع؛ سحب نطاق فرع يبقيه في فروعه الأخرى؛ المحو للمالك وبإقرار مكتوب
حين عليه معلّق (ACC-64)؛ المالك لا يُسحب."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import Device, Session, User, UserBranchAccess
from core.tenancy import tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)


def _post(c: Client, h: dict[str, str], uid: str, body: dict[str, Any]) -> Any:
    return c.post(
        f"/api/org/users/{uid}/revocation", body, content_type="application/json", headers=h
    )


def test_preview_open_shift_blocker_then_disable_keeps_others(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    cashier: User = ctx["users"]["cashier"]
    dev_id = ctx["device_ids"]["cashier"]
    with tenant_context(ctx["tenant"].id):
        from shifts.models import Shift

        # المدير يعمل على جهاز الكاشير نفسه (جهاز مشترك) وعليه معلّق مبلَّغ
        manager_session = Session.objects.filter(user=ctx["users"]["manager"]).first()
        assert manager_session is not None
        Session.objects.filter(id=manager_session.id).update(device_id=dev_id)
        Session.objects.filter(user=cashier, device_id=dev_id).update(
            reported_pending=2, reported_pending_at=timezone.now()
        )
        shift = Shift.objects.create(
            tenant=ctx["tenant"],
            branch=ctx["branch"],
            device_id=dev_id,
            device_name="جهاز cashier",
            user_id=cashier.id,
            user_name=cashier.display_name,
            opening_float_minor=0,
            business_date=timezone.localdate(),
            opened_at=timezone.now(),
            state="open",
        )
    r = c.get(f"/api/org/users/{cashier.id}/revocation", headers=h)
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["blockers"] == ["open_shift"] and p["pending_total"] == 2
    assert p["devices"][0]["shared_with"] == ["سميّة عبد الله"]
    assert p["can"] == {"disable_user": True, "revoke_branch": True, "wipe_device": True}
    # وردية مفتوحة باسمه → مانع
    r = _post(c, h, str(cashier.id), {"action": "disable", "mode": "now"})
    assert r.status_code == 400 and r.json()["detail"] == "open_shift"
    with tenant_context(ctx["tenant"].id):
        Shift.objects.filter(id=shift.id).update(state="closed", closed_at=timezone.now())
    # التعطيل بعد الرفع: جلسته ذات المعلّق تُنهى حين يفرغ طابورها؛ المدير على الجهاز نفسه يواصل
    r = _post(
        c, h, str(cashier.id), {"action": "disable", "mode": "after_upload", "reason": "ترك العمل"}
    )
    assert r.status_code == 200, r.content
    assert r.json()["action"] == "disable" and r.json()["sessions_deferred"] == 1
    assert r.json()["user"]["status"] == "disabled"
    with tenant_context(ctx["tenant"].id):
        cashier.refresh_from_db()
        assert cashier.is_active is False and cashier.deactivated_by_name == "عثمان الطيب"
        assert cashier.deactivation_reason == "ترك العمل"
        s = Session.objects.get(user=cashier, device_id=dev_id)
        assert s.revoke_after_upload is True and s.revoked_at is None
        assert Session.objects.get(id=manager_session.id).revoked_at is None
        assert Device.objects.get(id=dev_id).status == "active"
    # المعطَّل لا يجدّد ولا يدخل
    assert c.get("/api/org/users", headers=_h(ctx["tokens"]["cashier"])).status_code in (401, 403)


def test_branch_scope_manager_and_wipe_requires_owner_and_ack(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    cashier: User = ctx["users"]["cashier"]
    mh = _h(ctx["tokens"]["manager"])
    oh = _h(ctx["tokens"]["owner"])
    # المدير: يسحب نطاق فرعه فقط، ولا يعطّل ولا يمحو
    r = _post(c, mh, str(cashier.id), {"action": "disable", "mode": "now"})
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    r = _post(
        c,
        mh,
        str(cashier.id),
        {"action": "wipe_device", "device_id": str(ctx["device_ids"]["cashier"])},
    )
    assert r.status_code == 403
    p = c.get(f"/api/org/users/{cashier.id}/revocation", headers=mh).json()
    assert p["can"] == {"disable_user": False, "revoke_branch": True, "wipe_device": False}
    r = _post(
        c, mh, str(cashier.id), {"action": "revoke_branch", "branch_id": str(ctx["branch"].id)}
    )
    assert r.status_code == 200, r.content
    assert r.json()["remaining_branches"] == []
    with tenant_context(ctx["tenant"].id):
        assert not UserBranchAccess.objects.filter(user=cashier, revoked_at__isnull=True).exists()
        cashier.refresh_from_db()
        assert cashier.is_active is True  # سحب النطاق لا يعطّل الحساب
    assert (
        _post(
            c, mh, str(cashier.id), {"action": "revoke_branch", "branch_id": str(ctx["branch"].id)}
        ).json()["detail"]
        == "no_access_in_branch"
    )
    # المالك لا يُسحب
    r = _post(c, oh, str(ctx["users"]["owner"].id), {"action": "disable", "mode": "now"})
    assert r.status_code == 400 and r.json()["detail"] == "owner_not_revocable"
    # المحو: عليه معلّق → إقرار مكتوب إلزامي؛ ثم الجهاز ممحو والمستخدم معطَّل
    dev_id = ctx["device_ids"]["cashier"]
    with tenant_context(ctx["tenant"].id):
        Session.objects.filter(device_id=dev_id).update(
            reported_pending=5, reported_pending_at=timezone.now()
        )
    r = _post(c, oh, str(cashier.id), {"action": "wipe_device", "device_id": str(dev_id)})
    assert r.status_code == 400 and r.json()["detail"] == "acknowledgement_required"
    r = _post(
        c,
        oh,
        str(cashier.id),
        {
            "action": "wipe_device",
            "device_id": str(dev_id),
            "acknowledgement": "أقرّ بفقد المعلّق — الجهاز مسروق",
            "reason": "سرقة",
        },
    )
    assert r.status_code == 200, r.content
    with tenant_context(ctx["tenant"].id):
        d = Device.objects.get(id=dev_id)
        assert d.status == "wiped" and d.wiped_by_name == "عثمان الطيب"
        cashier.refresh_from_db()
        assert cashier.is_active is False
