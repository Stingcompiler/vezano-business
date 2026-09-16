"""تجهيزات pytest المشتركة.

- `app_role`: يبدّل دور الاتصال إلى `sting_app` داخل معاملة الاختبار حتى تسري RLS فعلاً
  (المستخدم المنشئ لقاعدة الاختبار متفوق ويتجاوز RLS، وهذا ما لا نريد اختباره).
- `two_tenants`: مستأجران بفرعين لكل منهما، يُنشآن في سياق المنصة.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from django.db import connection

from core.db.rls import APP_ROLE
from core.models import Branch, Tenant
from core.tenancy import platform_context


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
