"""تنبيهات الاشتراك (بأمر المالك 2026-09-23؛ 0005 §١١٥): تذكير متدرّج (10/7/3/1) يحلّ محل سابقه،
التجريبية بصياغتها، الانتهاء بعدّ مهلة السماح، الإيقاف، السعر المقبل قبل 30 يوماً، والحدود
القريبة/الممتلئة — كلها مشتقّة من الحالة الحيّة للمالك."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import PlanCatalog, TenantSubscription
from core.subscription import PLANS, ensure_subscription
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)

INBOX = "/api/notifications"


def _live(c: Client, h: dict[str, str]) -> list[dict[str, Any]]:
    """الإشعارات القائمة — المحلولة تبقى في الصندوق تاريخاً بعلامة `resolved`."""
    return [i for i in c.get(INBOX, headers=h).json()["items"] if not i["resolved"]]


def _open(c: Client, h: dict[str, str]) -> dict[str, dict[str, Any]]:
    return {i["kind"]: i for i in _live(c, h)}


def _set(tid: Any, **kw: Any) -> None:
    with tenant_context(tid):
        s = ensure_subscription()
        for k, v in kw.items():
            setattr(s, k, v)
        s.save()


def test_subscription_alerts(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    tid = ctx["tenant"].id
    now = timezone.now()
    # تجريبية تنتهي بعد 5 أيام وساعات (اليوم الجزئي يُعدّ — 6) → مرحلة 7 بصياغة التجربة
    _set(tid, plan_code="trial", state="trial", expires_at=now + timedelta(days=5, hours=2))
    got = _open(c, owner)
    assert got["subscription_renewal"]["title"] == "تجربتك المجانية تنتهي بعد 6 أيام"
    # سارية بعد يوم وساعات (يومان) → مرحلة 3، والمرحلة السابقة حُلّت (إشعار تجديد واحد فقط)
    _set(tid, plan_code="dual", state="active", expires_at=now + timedelta(days=1, hours=2))
    renewals = [i for i in _live(c, owner) if i["kind"] == "subscription_renewal"]
    assert len(renewals) == 1 and renewals[0]["title"] == "اشتراكك يُجدَّد بعد يومين"
    assert "«فرعان»" in renewals[0]["body"]
    # منتهٍ قبل 3 أيام → عدّ مهلة السماح (14 − 3 = 11)، والتذكير اختفى
    _set(tid, expires_at=now - timedelta(days=3, hours=1))
    got = _open(c, owner)
    assert "subscription_renewal" not in got
    assert got["subscription_expired"]["title"] == "انتهى اشتراكك قبل 3 أيام"
    assert "بعد 11 يوماً" in got["subscription_expired"]["body"]
    # إيقاف من المشغّل
    _set(tid, expires_at=now + timedelta(days=40), suspended_at=now, suspended_reason="تحقق")
    got = _open(c, owner)
    assert got["subscription_suspended"]["title"] == "اشتراكك موقوف من مشغّل المنصة"
    _set(tid, suspended_at=None, suspended_reason="")
    assert "subscription_suspended" not in _open(c, owner)
    # سعر مقبل على «فرعان» بعد 20 يوماً → إشعار بالسعرين
    with platform_context():
        row = PlanCatalog.objects.get(code="dual")
        row.next_price_monthly_minor = 9_500_000
        row.next_price_effective_at = now + timedelta(days=20)
        row.save()
    PLANS.refresh()
    got = _open(c, owner)
    assert "95,000.00" in got["price_change"]["body"] and "85,000.00" in got["price_change"]["body"]
    # الحدود: الفرعان (فرع 2) — مستأجر الاختبار له فرعان نشطان → ممتلئ
    lim = [i for i in _live(c, owner) if i["kind"] == "limit"]
    assert any(i["title"].startswith("بلغت حدّ الفروع") for i in lim)
    # زيادة فرع تُحلّ تنبيه «ممتلئ» (2/3 = 67٪ دون القرب)
    with tenant_context(tid):
        TenantSubscription.objects.update(extra_branches=1)
    lim = [i for i in _live(c, owner) if i["kind"] == "limit"]
    assert not any("الفروع" in i["title"] for i in lim)
    # المدير لا يرى تنبيهات الحساب
    mgr = c.get(INBOX, headers=_h(ctx["tokens"]["manager"])).json()["items"]
    assert all(
        i["kind"] not in {"price_change", "subscription_renewal"} or i["locked"] for i in mgr
    )
