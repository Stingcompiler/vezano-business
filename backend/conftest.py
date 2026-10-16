"""تجهيزات pytest المشتركة.

- `app_role`: يبدّل دور الاتصال إلى `sting_app` داخل معاملة الاختبار حتى تسري RLS فعلاً
  (المستخدم المنشئ لقاعدة الاختبار متفوق ويتجاوز RLS، وهذا ما لا نريد اختباره).
- `two_tenants`: مستأجران بفرعين لكل منهما، يُنشآن في سياق المنصة.
- `pinned_clock`: ساعة الإنتاج (`timezone.now`) مثبَّتة على 2026-09-17T12:00Z وتواصل التكتكة. للوحدات
  التي بياناتها مؤرَّخة سبتمبر 2026 وتقرأ نوافذ نسبية (7/30/90 يوماً) — بدونه تسقط من النافذة مع
  تقدّم التقويم. اختبارات الساعة الحقيقية (`datetime.now()` / `date.today()`) لا تستعمله.
- `STING_TEST_CLOCK_SHIFT_DAYS=N`: يزيح `timezone.now` N يوماً للأمام في كل الاختبارات (كشف ما
  سيتقادم: شغّله بـ 10/40/100). الاختبار الذي يقرأ الساعة الحقيقية مباشرةً يفشل تحته بطبيعته.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from django.apps import apps
from django.db import connection
from django.utils import timezone

from core.db.rls import APP_ROLE
from core.models import Branch, Tenant
from core.tenancy import platform_context


@pytest.fixture(autouse=True)
def _phone_signup_in_tests(monkeypatch: pytest.MonkeyPatch) -> None:
    """الاختبارات القائمة تمرّ بمسارات الهاتف عامةً؛ الإنتاج بالبريد وحده (0005 §١٤٩) ويختبره
    `core/tests/test_email_only_signup.py` بإطفاء المتغيّر."""
    monkeypatch.setenv("STING_PHONE_SIGNUP", "1")


@pytest.fixture(autouse=True)
def _fresh_plan_catalog() -> Iterator[None]:
    """كاش `PLANS` لا يتجاوز الاختبار (قاعدة الاختبار تُفرَّغ بين الاختبارات وتُعاد بذر الكتالوج)."""
    from core.subscription import PLANS

    PLANS.refresh()
    yield
    PLANS.refresh()


@pytest.fixture
def app_role(db: None) -> Iterator[None]:
    with connection.cursor() as cursor:
        cursor.execute(f"SET LOCAL ROLE {APP_ROLE}")
    yield
    with connection.cursor() as cursor:
        cursor.execute("RESET ROLE")


@dataclass(frozen=True)
class TwoTenants:
    a: Tenant
    b: Tenant
    a_branches: tuple[Branch, Branch]
    b_branches: tuple[Branch, Branch]


@pytest.fixture
def two_tenants(db: None) -> TwoTenants:
    with platform_context():
        a = Tenant.unscoped.create(
            name="بقالة النيل — تجريبي", base_currency="SDG", base_currency_exponent=2
        )
        b = Tenant.unscoped.create(
            name="مخزن البركة — تجريبي", base_currency="SDG", base_currency_exponent=2
        )
        a1 = Branch.unscoped.create(tenant=a, name="الرئيسي", code="KRT", is_default=True)
        a2 = Branch.unscoped.create(tenant=a, name="بحري", code="BHR")
        b1 = Branch.unscoped.create(tenant=b, name="الرئيسي", code="KRT", is_default=True)
        b2 = Branch.unscoped.create(tenant=b, name="أم درمان", code="OMD")
    return TwoTenants(a=a, b=b, a_branches=(a1, a2), b_branches=(b1, b2))


PINNED_CLOCK_ANCHOR = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)
_REAL_NOW = timezone.now


def _ticking_clock(anchor: datetime) -> Callable[[], datetime]:
    """ساعة تبدأ من `anchor` وتتقدّم بالزمن الفعلي — تبقى الحركات متتابعة الختم لا متساوية."""
    started = datetime.now(UTC)
    return lambda: anchor + (datetime.now(UTC) - started)


def _install_clock(monkeypatch: pytest.MonkeyPatch, clock: Callable[[], datetime]) -> None:
    """يستبدل `timezone.now` وكل `default=timezone.now` في النماذج (الأخير مربوط بالدالة الأصلية عند
    تعريف الحقل فلا يلتقط الاستبدال — وبدونه يختلط ختم الإنتاج الحقيقي بختم الساعة المثبَّتة)."""
    monkeypatch.setattr(timezone, "now", clock)
    for model in apps.get_models():
        for field in model._meta.local_fields:
            if field.default is _REAL_NOW:
                monkeypatch.setitem(field.__dict__, "_get_default", clock)


@pytest.fixture
def pinned_clock(monkeypatch: pytest.MonkeyPatch) -> Callable[[], datetime]:
    clock = _ticking_clock(PINNED_CLOCK_ANCHOR)
    _install_clock(monkeypatch, clock)
    return clock


@pytest.fixture(autouse=True)
def _shifted_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    days = os.environ.get("STING_TEST_CLOCK_SHIFT_DAYS")
    if days:
        offset = timedelta(days=int(days))
        _install_clock(monkeypatch, lambda: datetime.now(UTC) + offset)
