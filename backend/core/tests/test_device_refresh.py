"""تجديد الجلسة برمز لتطبيق الجوال (0005 §١٦٢؛ خطة الجوال §٢.١ والخطر ٦).

الإصدار يستهلك JWT جلسة الجهاز؛ التدوير مع كل استعمال (القديم باطل فوراً)؛ إعادة رمز مدوَّر تُبطل
السلسلة والجلسة؛ الربط بالجهاز؛ الإبطال مع سحب الجهاز (ORG-05/SYS-07) وإلغاء الجلسة (ACC-09)؛ أفق
الـCookie نفسه؛ الهاش وحده في القاعدة؛ RLS بدور التطبيق.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import asdict
from datetime import timedelta
from typing import Any

import pytest
from django.db import DatabaseError, connection, transaction
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.auth import device_refresh
from core.auth.devices import register_device
from core.auth.tokens import issue_session_tokens
from core.models import Device, DeviceRefreshToken, Session, User
from core.org_revoke import disable_user, wipe_device
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import ctx  # noqa: F401

pytestmark = pytest.mark.django_db

ISSUE = "/api/auth/device-refresh/issue"
ROTATE = "/api/auth/device-refresh"
THIRTY_DAYS = timedelta(days=30)


def _post(path: str, body: dict[str, Any]) -> Any:
    return Client().post(path, body, content_type="application/json")


def _device_jwt(c: dict[str, Any], who: str = "cashier") -> tuple[str, uuid.UUID]:
    """رمز التجديد JWT لجلسة جهاز جديدة — ما يملكه التطبيق بعد تسجيل الجهاز."""
    with platform_context():
        device = Device.unscoped.get(id=c["device_ids"][who])
        _, refresh = issue_session_tokens(c["users"][who], device=device)
    return str(refresh), device.id


def _issue(c: dict[str, Any], who: str = "cashier") -> dict[str, Any]:
    raw, _ = _device_jwt(c, who)
    r = _post(ISSUE, {"refresh": raw})
    assert r.status_code == 200, r.content
    body: dict[str, Any] = r.json()
    return body


def _rotate(body: dict[str, Any], device_id: str | None = None) -> Any:
    return _post(
        ROTATE,
        {"refresh_token": body["refresh_token"], "device_id": device_id or body["device_id"]},
    )


def _rows(**filters: Any) -> list[DeviceRefreshToken]:
    with platform_context():
        return list(DeviceRefreshToken.unscoped.filter(**filters).order_by("created_at"))


def _me(access: str) -> int:
    r = Client().get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    return int(r.status_code)


def _rejected(r: Any) -> bool:
    return bool(r.status_code == 401 and r.json() == {"detail": "token_invalid"})


# ------------------------------------------------------------------------------------ الإصدار


def test_issue_consumes_device_jwt_and_stores_only_hash(ctx: dict[str, Any]) -> None:  # noqa: F811
    raw_jwt, device_id = _device_jwt(ctx)
    before = timezone.now()
    r = _post(ISSUE, {"refresh": raw_jwt})
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["device_id"] == str(device_id)
    assert body["user_id"] == str(ctx["users"]["cashier"].id)
    assert body["tenant_id"] == str(ctx["tenant"].id)
    # الوصول يعمل ويحمل الجهاز
    me = Client().get("/api/auth/me", headers={"Authorization": f"Bearer {body['access']}"})
    assert me.status_code == 200 and me.json()["device_id"] == str(device_id)
    # الهاش وحده في القاعدة — الخام لا يُحفظ
    (row,) = _rows(session_id=body["session_id"])
    assert row.token_hash == hashlib.sha256(body["refresh_token"].encode()).hexdigest()
    assert body["refresh_token"] not in {row.token_hash, str(row.family), str(row.id)}
    # أفق الـCookie نفسه (30 يوماً)
    assert before + THIRTY_DAYS <= row.expires_at <= timezone.now() + THIRTY_DAYS
    # الـJWT استُهلك: لا إصدار ثانٍ به ولا تجديد ويب
    assert _rejected(_post(ISSUE, {"refresh": raw_jwt}))
    assert _post("/api/auth/refresh", {"refresh": raw_jwt}).status_code == 401


def test_issue_requires_live_device_session(ctx: dict[str, Any]) -> None:  # noqa: F811
    # جلسة بلا جهاز (دخول ويب) لا تُصدر رمز جوال — الربط بالجهاز شرط
    with platform_context():
        _, web_refresh = issue_session_tokens(ctx["users"]["owner"])
    assert _rejected(_post(ISSUE, {"refresh": str(web_refresh)}))
    assert _rejected(_post(ISSUE, {"refresh": "junk"}))
    # جهاز مسحوب
    raw_jwt, device_id = _device_jwt(ctx)
    with platform_context():
        Device.unscoped.filter(id=device_id).update(status=Device.Status.REVOKED)
    assert _rejected(_post(ISSUE, {"refresh": raw_jwt}))
    assert _rows() == []


def test_reissue_revokes_previous_family_of_session(ctx: dict[str, Any]) -> None:  # noqa: F811
    with platform_context():
        device = Device.unscoped.get(id=ctx["device_ids"]["cashier"])
        user = User.unscoped.get(id=ctx["users"]["cashier"].id)
        session, refresh = issue_session_tokens(user, device=device)
    first = device_refresh.issue(str(refresh))
    # سلسلة ثانية للجلسة نفسها (JWT حيّ آخر لها) — الأولى تسقط، فلا يبقى للجلسة إلا سلسلة واحدة
    second = device_refresh.issue(refresh_of(session, first))
    assert first.session_id == second.session_id
    assert _rejected(_rotate(asdict(first)))
    assert _rows(session_id=session.id)[0].revoke_reason == "reissued"
    assert _rotate(asdict(second)).status_code == 200


def refresh_of(session: Session, issued: device_refresh.Issued) -> str:
    """JWT تجديد حيّ لجلسة قائمة (كما يصل بعد تجديد الويب) — للاختبار فقط."""
    from rest_framework_simplejwt.tokens import RefreshToken

    from core.auth.tokens import CLAIM_DEVICE, CLAIM_SESSION, CLAIM_TENANT

    with platform_context():
        user = User.unscoped.get(id=session.user_id)
    t = RefreshToken.for_user(user)
    t[CLAIM_TENANT] = issued.tenant_id
    t[CLAIM_SESSION] = issued.session_id
    t[CLAIM_DEVICE] = issued.device_id
    return str(t)


# ------------------------------------------------------------------------------------ التدوير


def test_rotate_every_use_old_token_dead_immediately(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    r = _rotate(first)
    assert r.status_code == 200, r.content
    second = r.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert second["session_id"] == first["session_id"]
    assert _me(second["access"]) == 200
    rows = _rows(session_id=first["session_id"])
    assert len(rows) == 2 and rows[0].used_at is not None and rows[1].used_at is None
    assert rows[0].family == rows[1].family
    # الأفق ينزلق مع كل تدوير
    assert rows[1].expires_at > rows[0].expires_at
    third = _rotate(second).json()
    assert _rotate(third).status_code == 200


def test_reuse_of_rotated_token_revokes_whole_chain_and_session(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    second = _rotate(first).json()
    # المهاجم (أو التطبيق الشرعي، أيهما متأخر) يعيد الرمز المدوَّر
    assert _rejected(_rotate(first))
    rows = _rows(session_id=first["session_id"])
    assert all(r.revoked_at is not None for r in rows)
    assert {r.revoke_reason for r in rows} == {"reuse"}
    # الرمز الأحدث في السلسلة سقط أيضاً، والجلسة ملغاة فيسقط الوصول الحالي فوراً
    assert _rejected(_rotate(second))
    with platform_context():
        assert Session.unscoped.get(id=first["session_id"]).revoked_at is not None
    assert _me(second["access"]) == 401


def test_device_binding_mismatch_revokes_chain(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    other = str(ctx["device_ids"]["owner"])
    assert _rejected(_rotate(first, device_id=other))
    assert {r.revoke_reason for r in _rows(session_id=first["session_id"])} == {"device_mismatch"}
    assert _rejected(_rotate(first))


def test_unknown_token_rejected_without_side_effects(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    assert _rejected(_rotate({"refresh_token": "x" * 43, "device_id": first["device_id"]}))
    assert _post(ROTATE, {"refresh_token": "abc"}).status_code == 400  # device_id إلزامي
    assert _rotate(first).status_code == 200


# ------------------------------------------------------------------------------------ الإبطال


def test_device_wipe_org05_revokes_chain(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    with tenant_context(ctx["tenant"].id):
        device = Device.objects.get(id=ctx["device_ids"]["cashier"])
        wipe_device(device, actor=ctx["users"]["owner"], acknowledgement="", reason="فقد")
    assert {r.revoke_reason for r in _rows(device_id=device.id)} == {"device_revoked"}
    assert _rejected(_rotate(first))


def test_device_freeze_and_status_change_without_hook_still_rejected(ctx: dict[str, Any]) -> None:  # noqa: F811
    from sync.recovery import freeze

    first = _issue(ctx)
    with tenant_context(ctx["tenant"].id):
        freeze(Device.objects.get(id=ctx["device_ids"]["cashier"]), owner=ctx["users"]["owner"])
    assert _rejected(_rotate(first))
    # تغيير حالة مباشر لا يمرّ بأي خطّاف: الفحص عند الاستعمال يرفض ويُبطل السلسلة
    second = _issue(ctx, who="manager")
    with platform_context():
        Device.unscoped.filter(id=second["device_id"]).update(status=Device.Status.REVOKED)
    assert _rejected(_rotate(second))
    assert {r.revoke_reason for r in _rows(session_id=second["session_id"])} == {"device_revoked"}


def test_session_revoke_acc09_and_logout_revoke_chain(ctx: dict[str, Any]) -> None:  # noqa: F811
    from core.auth.tokens import revoke_session

    first = _issue(ctx)
    with platform_context():
        revoke_session(Session.unscoped.get(id=first["session_id"]))
    assert {r.revoke_reason for r in _rows(session_id=first["session_id"])} == {"session_revoked"}
    assert _rejected(_rotate(first))
    # الخروج من التطبيق (logout) يُبطلها كذلك
    second = _issue(ctx, who="manager")
    r = Client().post("/api/auth/logout", headers={"Authorization": f"Bearer {second['access']}"})
    assert r.status_code == 204
    assert _rejected(_rotate(second))


def test_user_disabled_org05_bulk_path_rejected_at_use(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    with tenant_context(ctx["tenant"].id):
        disable_user(
            User.objects.get(id=ctx["users"]["cashier"].id),
            actor=ctx["users"]["owner"],
            mode="now",
        )
    assert _rejected(_rotate(first))
    assert {r.revoke_reason for r in _rows(session_id=first["session_id"])} == {"session_revoked"}


# ------------------------------------------------------------------------------------ الانتهاء


def test_expired_token_rejected(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    with platform_context():
        DeviceRefreshToken.unscoped.filter(session_id=first["session_id"]).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
    assert _rejected(_rotate(first))
    # الانتهاء ليس سرقة: لا تُلغى الجلسة
    with platform_context():
        assert Session.unscoped.get(id=first["session_id"]).revoked_at is None


def test_rotation_prunes_rows_past_horizon(ctx: dict[str, Any]) -> None:  # noqa: F811
    first = _issue(ctx)
    second = _rotate(first).json()
    with platform_context():
        DeviceRefreshToken.unscoped.filter(
            session_id=first["session_id"], used_at__isnull=False
        ).update(expires_at=timezone.now() - THIRTY_DAYS - timedelta(days=1))
    assert _rotate(second).status_code == 200
    rows = _rows(session_id=first["session_id"])
    assert len(rows) == 2  # المدوَّر الذي انقضى أفقه حُذف؛ بقي المستعمل الأخير والجديد


# ------------------------------------------------------------------------------------ RLS


def test_rls_isolates_refresh_tokens_under_app_role(
    app_role: None,
    two_tenants: TwoTenants,
) -> None:
    a, b = two_tenants.a, two_tenants.b
    with platform_context():
        owner_a = User.objects.create_user(tenant=a, username="oa", display_name="أ", is_owner=True)
        from core.models import Role, UserBranchAccess

        role = Role.unscoped.create(tenant=a, code="owner", name="مالك")
        UserBranchAccess.unscoped.create(
            tenant=a, user=owner_a, branch=two_tenants.a_branches[0], role=role
        )
    with tenant_context(a.id):
        reg = register_device(user=owner_a, branch=two_tenants.a_branches[0], name="جوال")
    # الإصدار والتدوير يعملان بدور التطبيق (سياق المنصة لطلب غير مصادَق)
    issued = device_refresh.issue(reg.refresh)
    rotated = device_refresh.rotate(issued.refresh_token, reg.device.id)
    with tenant_context(a.id):
        assert DeviceRefreshToken.objects.count() == 2
    with tenant_context(b.id):
        assert DeviceRefreshToken.objects.count() == 0
        assert DeviceRefreshToken.unscoped.count() == 0  # RLS لا المدير
        with connection.cursor() as cur:
            cur.execute("SELECT count(*) FROM core_devicerefreshtoken")
            assert cur.fetchone() == (0,)
        # كتابة صفّ لمستأجر آخر من سياق B ترفضها WITH CHECK
        with pytest.raises(DatabaseError), transaction.atomic():
            DeviceRefreshToken.unscoped.create(
                tenant=a,
                session_id=rotated.session_id,
                device=reg.device,
                family=uuid.uuid4(),
                token_hash="0" * 64,
                expires_at=timezone.now(),
            )
