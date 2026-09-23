"""حدود الأجهزة والمستخدمين والفروع (بأمر المالك 2026-09-23؛ 0005 §١١٤): حدّ المستخدمين مفروض عند
الدعوة (الفعّالون + المعلّقة) وعند القبول؛ الزيادات يمنحها المشغّل بسبب فترفع الحدّ الفعلي في الدعوة
وORG-06 وتفاصيل المستأجر؛ التخفيض يُمنع إن تجاوز المستخدمون حدّ الباقة الأصغر."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.models import Role
from core.subscription import set_for_scenario
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_user_limit_and_operator_extras(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    oh = _operator_headers("ops9", "هدى — تشغيل")
    tid = ctx["tenant"].id
    with tenant_context(tid):
        set_for_scenario(state="active", plan_code="dual")  # 5 مستخدمين
        cashier = Role.objects.get(code="cashier")
    branch = str(ctx["branch"].id)

    def invite(who: str) -> Any:
        body = {"identifier": who, "role_id": str(cashier.id), "branch_id": branch}
        return _post(c, owner, "/api/org/invitations", body)

    # ثلاثة فعّالون + دعوتان معلّقتان = 5 → السادسة مرفوضة بنصّ الحدّ
    assert invite("a1@example.com").status_code == 201
    assert invite("a2@example.com").status_code == 201
    r = invite("a3@example.com")
    assert r.status_code in (400, 409) and r.json()["detail"] == "user_limit"
    ent = c.get("/api/org/subscription", headers=owner).json()
    assert ent["limits"]["users"] == {"used": 3, "max": 5, "extra": 0}
    # المشغّل يمنح مستخدمَين إضافيين بسبب → الحدّ 7 والدعوة تمرّ
    url = f"/api/platform/tenants/{tid}/subscription"
    bad = _post(c, oh, url, {"action": "limits", "extra_users": 2})
    assert bad.json()["detail"] == "reason_required"
    r = _post(c, oh, url, {"action": "limits", "extra_users": 2, "reason": "عقد خاص"})
    assert r.status_code == 200
    detail = r.json()["tenant"]
    assert detail["usage"]["users"] == {"used": 3, "max": 7, "plan": 5, "extra": 2}
    assert (
        detail["timeline"][0]["kind"] == "limits" and "عقد خاص" in detail["timeline"][0]["reason"]
    )
    assert invite("a3@example.com").status_code == 201
    # زيادة الأجهزة ترفع حدّ الأجهزة في ORG-06
    _post(c, oh, url, {"action": "limits", "extra_devices": 3, "reason": "جهازا مخزن"})
    ent = c.get("/api/org/subscription", headers=owner).json()
    assert ent["limits"]["devices"]["max"] == 6 + 3 and ent["limits"]["devices"]["extra"] == 3
    assert (
        _post(c, oh, url, {"action": "limits", "extra_devices": 3, "reason": "x"}).json()["detail"]
        == "nothing_to_change"
    )
    assert (
        _post(c, oh, url, {"action": "limits", "extra_users": 999, "reason": "x"}).json()["detail"]
        == "limits_invalid"
    )
    # بعد إلغاء الزيادة: التخفيض إلى «فرع واحد» (مستخدمان) ممنوع بثلاثة فعّالين
    _post(c, oh, url, {"action": "limits", "extra_users": 0, "reason": "انتهى العقد"})
    q = c.get("/api/org/subscription/change?plan_code=single", headers=owner).json()["quote"]
    assert any("المستخدمون الفعّالون" in b for b in q["blocked_reasons"])
