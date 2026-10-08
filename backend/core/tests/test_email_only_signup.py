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


@pytest.mark.parametrize(
    ("raw", "e164"),
    [
        ("0912345678", "+249912345678"),
        ("912345678", "+249912345678"),
        ("+249 912 345 678", "+249912345678"),
        ("00249912345678", "+249912345678"),
        ("٠٩١٢٣٤٥٦٧٨", "+249912345678"),
        ("+971501234567", "+971501234567"),
    ],
)
def test_contact_phone_normalized(raw: str, e164: str) -> None:
    from core.contact import normalize_contact_phone, whatsapp_url

    assert normalize_contact_phone(raw) == e164
    assert whatsapp_url(raw) == f"https://wa.me/{e164[1:]}"


def test_email_signup_requires_contact_phone() -> None:
    """التسجيل بالبريد يحمل رقم واتساب إلزامياً للتواصل (0005 §١٥٠) — يُخزَّن بصيغة دولية."""
    from core.models import Account
    from core.tenancy import platform_context

    c = Client()
    email = "owner@example.com"
    assert (
        _json(
            c, "/api/auth/verify/request", {"identifier": email, "purpose": "register"}
        ).status_code
        == 202
    )
    code = verify.dev_code_for(email)
    ticket = _json(
        c, "/api/auth/verify/confirm", {"identifier": email, "purpose": "register", "code": code}
    ).json()["verified_ticket"]
    body = {"verified_ticket": ticket, "password": "long-enough-1", "display_name": "مالك"}
    for bad in ("", "12", "abc"):
        r = _json(c, "/api/auth/account/register", {**body, "phone": bad})
        assert r.status_code == 400 and r.json()["detail"] == "phone_invalid"
    r = _json(c, "/api/auth/account/register", {**body, "phone": "0912 345 678"})
    assert r.status_code == 201, r.content
    with platform_context():
        assert Account.unscoped.get(identifier=email).contact_phone == "+249912345678"


def test_operator_sees_owner_whatsapp(ctx: dict[str, Any]) -> None:  # noqa: F811
    from core.tenancy import platform_context
    from stingops.tests.test_operator import _operator_headers

    owner = ctx["users"]["owner"]
    acc = create_account("shop-owner@example.com", "long-enough-1", "عثمان")
    with platform_context():
        acc.contact_phone = "+249912345678"
        acc.save(update_fields=["contact_phone"])
        owner.account = acc
        owner.save(update_fields=["account"])
    oh = _operator_headers("ops9", "هدى — تشغيل")
    d = Client().get(f"/api/platform/tenants/{ctx['tenant'].id}", headers=oh).json()["tenant"]
    assert d["owner_contact"] == {
        "name": owner.display_name,
        "email": "shop-owner@example.com",
        "phone": "+249912345678",
        "whatsapp_url": "https://wa.me/249912345678",
    }
