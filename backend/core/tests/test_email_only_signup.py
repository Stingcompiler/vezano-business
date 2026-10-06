"""التسجيل بالبريد وحده (بأمر المالك 2026-10-06؛ 0005 §١٤٩) — حتى تُربط قناة واتساب أو نصية:

- رمز التسجيل لهاتف يُرفض قبل أي إرسال (`email_only`)، وللبريد يُرسل.
- تذكرة تسجيل لهاتف صدرت قبل الإطفاء لا تنشئ حساباً.
- دعوة موظف بهاتف بلا حساب تُرفض؛ بهاتف له حساب قائم تُقبل (يقبل بدخوله).
- الاستعادة والدخول بالهاتف لحسابات قائمة باقيان.
- `STING_PHONE_SIGNUP=1` يعيد التسجيل بالهاتف بلا تعديل كود.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.auth import verify
from core.auth.accounts import create_account
from core.tests.test_org import _post, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)

PHONE = "+249912000777"


@pytest.fixture(autouse=True)
def _email_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STING_PHONE_SIGNUP", "0")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")


def _json(c: Client, url: str, body: dict[str, Any]) -> Any:
    return c.post(url, body, content_type="application/json")


def test_register_code_refused_for_phone_sent_for_email() -> None:
    c = Client()
    r = _json(c, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "register"})
    assert r.status_code == 400 and r.json()["detail"] == "email_only"
    assert verify.dev_code_for(PHONE) is None  # لا إرسال
    r = _json(
        c, "/api/auth/verify/request", {"identifier": "new@example.com", "purpose": "register"}
    )
    assert r.status_code == 202
    # غرضا طلب الجولة ليسا من رموز الحسابات
    r = _json(c, "/api/auth/verify/request", {"identifier": "new@example.com", "purpose": "track"})
    assert r.status_code == 400


def test_old_phone_ticket_cannot_create_account(monkeypatch: pytest.MonkeyPatch) -> None:
    c = Client()
    monkeypatch.setenv("STING_PHONE_SIGNUP", "1")
    assert (
        _json(
            c, "/api/auth/verify/request", {"identifier": PHONE, "purpose": "register"}
        ).status_code
        == 202
    )
    code = verify.dev_code_for(PHONE)
    ok = _json(
        c, "/api/auth/verify/confirm", {"identifier": PHONE, "purpose": "register", "code": code}
    )
    ticket = ok.json()["verified_ticket"]
    monkeypatch.setenv("STING_PHONE_SIGNUP", "0")
    r = _json(
        c,
        "/api/auth/account/register",
        {"verified_ticket": ticket, "password": "long-enough-1", "display_name": "x"},
    )
    assert r.status_code == 400 and r.json()["detail"] == "email_only"


def test_recover_by_phone_still_works_for_existing_account() -> None:
    create_account(PHONE, "long-enough-1", "قائم")
    r = _json(Client(), "/api/auth/verify/request", {"identifier": PHONE, "purpose": "recover"})
    assert r.status_code == 202


def test_staff_invite_by_phone_needs_existing_account(ctx: dict[str, Any]) -> None:  # noqa: F811
    from core.subscription import set_for_scenario
    from core.tenancy import tenant_context

    with tenant_context(ctx["tenant"].id):
        set_for_scenario(state="active", plan_code="dual")
    headers = {"Authorization": f"Bearer {ctx['tokens']['owner']}"}
    body = {"role_id": str(ctx["roles"]["cashier"].id), "branch_id": str(ctx["branch"].id)}
    c = Client()
    r = _post(c, headers, "/api/org/invitations", {**body, "identifier": PHONE})
    assert r.status_code in (400, 409) and r.json()["detail"] == "email_only"
    # بريد يُدعى عادياً
    r = _post(c, headers, "/api/org/invitations", {**body, "identifier": "staff@example.com"})
    assert r.status_code == 201, r.content
    # هاتف له حساب قائم: يقبل بدخوله فلا يُمنع
    create_account(PHONE, "long-enough-1", "قائم")
    r = _post(c, headers, "/api/org/invitations", {**body, "identifier": PHONE})
    assert r.status_code == 201, r.content
