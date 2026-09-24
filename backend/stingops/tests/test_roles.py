"""أدوار المشغّلين (0005 §١١٨): «الدعم» يقرأ ولا يغيّر إلا طلبات الجولة؛ المدير كل شيء؛ لا يخفّض
المدير نفسه ولا تبقى المنصة بلا مدير؛ المشغّل الجديد «دعم» افتراضاً؛ الدخول يعيد الدور."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.models import User
from core.tenancy import platform_context
from core.tests.test_org import _post, ctx  # noqa: F401
from stingops.models import OperatorProfile
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def _support_headers() -> dict[str, str]:
    h = _operator_headers("ops-sup", "طيب — دعم")
    with platform_context():
        OperatorProfile.objects.filter(user__username="ops-sup").update(role="support")
    return h


def test_support_reads_but_cannot_change(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    sup = _support_headers()
    admin = _operator_headers("ops-adm", "هدى — مديرة")
    # القراءة مسموحة
    assert c.get("/api/platform/plans", headers=sup).status_code == 200
    assert c.get("/api/platform/tenants", headers=sup).status_code == 200
    # التغيير ممنوع بسبب صريح
    r = _post(c, sup, "/api/platform/plans/single/update", {"name": "x", "reason": "اختبار"})
    assert r.status_code == 403 and r.json()["detail"] == "admin_required"
    r = _post(c, sup, "/api/platform/flags", {"key": "market_m3", "scope_kind": "env"})
    assert r.status_code == 403 and r.json()["detail"] == "admin_required"
    r = _post(c, sup, "/api/platform/operators", {"email": "n@x.co", "password": "x" * 12})
    assert r.status_code == 403
    # طلبات الجولة مسموحة للدعم (قد تُرفض لسبب آخر لكن ليس admin_required)
    r = _post(c, sup, "/api/platform/demo-requests/00000000-0000-0000-0000-000000000000")
    assert r.json().get("detail") != "admin_required"
    # المدير يمرّ
    assert c.get("/api/platform/operators", headers=admin).status_code == 200


def test_operator_roles_management(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    admin = _operator_headers("ops-adm2", "هدى — مديرة")
    r = _post(
        c,
        admin,
        "/api/platform/operators",
        {"email": "newop@vezano.example", "password": "pass-2026-long", "name": "ناصر"},
    )
    assert r.status_code == 201, r.content
    new = r.json()["operator"]
    assert new["role"] == "support" and new["role_label"] == "الدعم"
    r = _post(c, admin, f"/api/platform/operators/{new['id']}/set_role", {"role": "admin"})
    assert r.status_code == 200 and r.json()["operator"]["role"] == "admin"
    r = _post(c, admin, f"/api/platform/operators/{new['id']}/set_role", {"role": "boss"})
    assert r.json()["detail"] == "role_invalid"
    # لا يخفّض نفسه
    with platform_context():
        me = User.unscoped.get(username="ops-adm2")
    r = _post(c, admin, f"/api/platform/operators/{me.id}/set_role", {"role": "support"})
    assert r.status_code == 409 and r.json()["detail"] == "self_role"
    # «الدعم» لا يدير المشغّلين
    sup = _support_headers()
    r = _post(c, sup, f"/api/platform/operators/{new['id']}/set_role", {"role": "support"})
    assert r.status_code == 403 and r.json()["detail"] == "admin_required"


def test_login_returns_role(ctx: dict[str, Any]) -> None:  # noqa: F811
    from core.auth.accounts import create_account
    from stingops.services import ensure_operator

    with platform_context():
        acc = create_account("sup-login@vezano.example", "sup-login-2026", "دعم")
        u = User.unscoped.create(
            tenant=None, username="ops-sl", display_name="دعم", is_platform_staff=True, account=acc
        )
        ensure_operator(u)
        OperatorProfile.objects.filter(user=u).update(role="support")
    r = Client().post(
        "/api/platform/login",
        {"email": "sup-login@vezano.example", "password": "sup-login-2026"},
        content_type="application/json",
    )
    assert r.status_code == 200, r.content
    assert r.json()["role"] == "support"
