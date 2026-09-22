"""PLT-15 (بأمر المالك 2026-09-22): حسابات المشغّلين — قائمة، إنشاء، تعطيل يُسقط الجلسات ويمنع
الدخول، تفعيل، إعادة تعيين كلمة المرور؛ لا تعطيل للذات ولا إنشاء على بريد متجر. بلا تحقّق ثنائي."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.auth.accounts import create_account
from core.models import User
from core.tenancy import platform_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorAccessLog
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_operators_management(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops5", "هدى — تشغيل")
    assert c.get("/api/platform/operators", headers=_h(ctx["tokens"]["owner"])).status_code == 403
    lst = c.get("/api/platform/operators", headers=oh).json()
    assert lst["active_count"] == 1 and lst["operators"][0]["is_me"] is True
    me_id = lst["operators"][0]["id"]
    # رفضات الإنشاء
    url = "/api/platform/operators"
    assert _post(c, oh, url, {"email": "x", "password": "p" * 12, "name": "س"}).json()[
        "detail"
    ] == ("invalid_email")
    r = _post(c, oh, url, {"email": "a@b.co", "password": "short", "name": "س"})
    assert r.json()["detail"] == "password_too_short"
    # بريد حساب متجر لا يصير مشغّلاً
    owner_acc = create_account("owner@shop.example", "owner-pass-12", "مالك")
    with platform_context():
        owner = User.unscoped.get(id=ctx["users"]["owner"].id)
        owner.account = owner_acc
        owner.save(update_fields=["account"])
    r = _post(c, oh, url, {"email": "owner@shop.example", "password": "p" * 12, "name": "س"})
    assert r.status_code == 409 and r.json()["detail"] == "tenant_account_email"
    # إنشاء: السرّ يُعرض مرة واحدة والقائمة لا تعيده
    r = _post(
        c, oh, url, {"email": "Tayeb@Vezano.local", "password": "very-secret-12", "name": "طيب"}
    )
    assert r.status_code == 201
    op = r.json()["operator"]
    assert op["email"] == "tayeb@vezano.local" and "totp_secret" not in op
    lst = c.get("/api/platform/operators", headers=oh).json()
    assert lst["active_count"] == 2
    # الجديد يدخل ببريده وكلمة مروره — بلا تحقّق ثنائي
    login = "/api/platform/login"
    creds = {"email": "tayeb@vezano.local", "password": "very-secret-12"}
    r = _post(c, {}, login, creds)
    assert r.status_code == 200
    th = {"Authorization": f"Bearer {r.json()['access']}"}
    assert c.get("/api/platform/operators", headers=th).status_code == 200
    # التعطيل: يُسقط الجلسة ويمنع الدخول؛ الذات لا تُعطَّل
    assert _post(c, oh, f"{url}/{me_id}/disable", {}).json()["detail"] == "cannot_disable_self"
    r = _post(c, oh, f"{url}/{op['id']}/disable", {})
    assert r.status_code == 200 and r.json()["operator"]["active"] is False
    assert c.get("/api/platform/operators", headers=th).status_code in (401, 403)
    r = _post(c, {}, login, creds)
    assert r.status_code == 400 and r.json()["detail"] == "invalid_credentials"
    assert _post(c, oh, f"{url}/{op['id']}/disable", {}).status_code == 409
    # التفعيل وإعادة تعيين كلمة المرور: القديمة لا تدخل والجديدة تدخل
    assert _post(c, oh, f"{url}/{op['id']}/enable", {}).json()["operator"]["active"] is True
    short = _post(c, oh, f"{url}/{op['id']}/reset_password", {"password": "short"})
    assert short.json()["detail"] == "password_too_short"
    r = _post(c, oh, f"{url}/{op['id']}/reset_password", {"password": "new-secret-2026"})
    assert r.status_code == 200
    assert _post(c, {}, login, creds).status_code == 400
    assert _post(c, {}, login, {**creds, "password": "new-secret-2026"}).status_code == 200
    assert _post(c, oh, f"{url}/{op['id']}/bogus", {}).status_code == 400
    with platform_context():
        actions = list(
            OperatorAccessLog.objects.filter(action__startswith="operator.").values_list(
                "action", flat=True
            )
        )
    assert sorted(actions) == sorted(
        ["operator.create", "operator.disable", "operator.enable", "operator.reset_password"]
    )
