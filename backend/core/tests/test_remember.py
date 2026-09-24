"""بقاء الجلسة بعد إعادة التحميل (0005 §١٢١): رمز التجديد في Cookie `HttpOnly` مقصور على
`/api/auth/` و`SameSite=Strict`؛ الاستئناف تجديد مدوّر (القديم يُحظر) بCookie جديد؛ الجلسة الملغاة
أو الرمز المعاد يمسح الـCookie؛ الخروج يمسحه؛ لا يُحفظ رمز غير صالح."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.auth.tokens import issue_session_tokens, revoke_session
from core.models import Session
from core.tenancy import platform_context
from core.tests.test_org import ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)


def _tokens(c: dict[str, Any]) -> tuple[Session, str]:
    with platform_context():
        session, refresh = issue_session_tokens(c["users"]["owner"])
    return session, str(refresh)


def test_remember_resume_rotates_and_logout_forgets(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    session, raw = _tokens(ctx)
    r = c.post("/api/auth/remember", {"refresh": raw}, content_type="application/json")
    assert r.status_code == 204
    cookie = r.cookies["sting_rt"]
    assert cookie.value == raw and cookie["httponly"] and cookie["path"] == "/api/auth/"
    assert cookie["samesite"] == "Strict" and int(cookie["max-age"]) == 30 * 24 * 3600
    # الاستئناف: رموز جديدة وCookie جديد، والقديم محظور
    r = c.post("/api/auth/resume")
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["session_id"] == str(session.id)
    assert body["user_id"] == str(ctx["users"]["owner"].id)
    assert body["tenant_id"] == str(ctx["tenant"].id)
    new_cookie = r.cookies["sting_rt"].value
    assert new_cookie == body["refresh"] and new_cookie != raw
    # الرمز القديم لم يعد يُستأنف (المسروق بعد الاستئناف بلا قيمة)
    stale = Client()
    stale.cookies["sting_rt"] = raw
    r = stale.post("/api/auth/resume")
    assert r.status_code == 401 and r.cookies["sting_rt"].value == ""
    # الوصول الجديد يعمل
    me = c.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access']}"})
    assert me.status_code == 200
    # الخروج يمسح الـCookie ويلغي الجلسة
    r = c.post("/api/auth/logout", headers={"Authorization": f"Bearer {body['access']}"})
    assert r.status_code == 204 and r.cookies["sting_rt"].value == ""
    assert c.post("/api/auth/resume").status_code == 401


def test_revoked_session_cannot_resume_and_bad_token_not_remembered(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    c = Client()
    session, raw = _tokens(ctx)
    assert (
        c.post(
            "/api/auth/remember", {"refresh": "junk"}, content_type="application/json"
        ).status_code
        == 401
    )
    assert (
        c.post("/api/auth/remember", {"refresh": raw}, content_type="application/json").status_code
        == 204
    )
    with platform_context():
        revoke_session(session)
    r = c.post("/api/auth/resume")
    assert r.status_code == 401 and r.json()["detail"] == "token_invalid"
    assert r.cookies["sting_rt"].value == ""
    # رمز جلسة ملغاة لا يُحفظ أصلاً
    r = c.post("/api/auth/remember", {"refresh": raw}, content_type="application/json")
    assert r.status_code == 401
    # بلا Cookie
    assert Client().post("/api/auth/resume").json()["detail"] == "not_remembered"
    # «انسَ» يمسح دائماً
    r = Client().post("/api/auth/forget")
    assert r.status_code == 204 and r.cookies["sting_rt"].value == ""
