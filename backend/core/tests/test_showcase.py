"""محتوى العرض (`manage.py showcase reset`): يُبذر كاملاً عبر الخدمات ونقل المزامنة، وأرقامه متسقة،
ويُمحى دون أن يمسّ غيره، ولا يُعدّ «بيانات عميل» عند حارس السيناريو."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from core.auth.accounts import create_account
from core.models import Account, Tenant, User
from core.scenario.guard import assert_non_production
from core.scenario.showcase import ACCOUNTS, FIXED, seed_showcase, wipe_showcase
from core.tenancy import platform_context, tenant_context
from stingops.services import ensure_operator

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    yield


def _operator() -> None:
    acc = create_account("ops.showcase@sting.internal", "very-secret-ops", "طيب")
    with platform_context():
        op = User.unscoped.create(
            tenant=None,
            username="ops",
            display_name="طيب — تشغيل",
            is_platform_staff=True,
            account=acc,
        )
        ensure_operator(op)


def test_showcase_seeds_consistent_content_and_wipes_cleanly() -> None:
    from inventory.services import branch_balances
    from market.models import MarketOffer, MarketOrder
    from parties.models import Party
    from parties.services import balance_minor
    from sales.models import Sale
    from shifts.models import Shift

    _operator()
    stats = seed_showcase(log=lambda _msg: None)
    assert stats["shifts"] >= 60 and stats["sales_cash"] > 500
    assert stats["market_orders"] == 6 and stats["campaigns"] == 4

    with tenant_context(FIXED["shop"]):
        # وردية اليوم مفتوحة في كل فرع، وكل ما قبلها مقفل
        assert Shift.objects.filter(state="open").count() == 2
        assert Sale.objects.count() == sum(v for k, v in stats.items() if k.startswith("sales_"))
        # كل مرتجع يجد أصله (التبعية على البيع صريحة — ترتيب الدفعة لا يُسقطه صامتاً)
        from sales.models import SaleReturn

        assert SaleReturn.objects.count() == stats["returns"]
        # لا رصيد مخزون سالب في أي فرع
        from core.models import Branch

        for b in Branch.objects.all():
            assert min(branch_balances(b.id).values()) >= 0
        # ذمم العملاء الآجلة قائمة
        balances = [balance_minor(p) for p in Party.objects.filter(is_customer=True)]
        assert any(b > 0 for b in balances)
    with tenant_context(FIXED["dist"]):
        assert MarketOffer.objects.filter(status="published").count() >= 11
    with tenant_context(FIXED["shop"]):
        assert set(MarketOrder.objects.values_list("status", flat=True)) >= {
            "received",
            "disputed",
            "rejected",
            "quoted",
            "delivered",
            "sent",
        }

    # منشآت العرض ليست «بيانات عميل حقيقي»
    assert_non_production()

    assert wipe_showcase() == 2
    with platform_context():
        assert not Tenant.unscoped.filter(id__in=list(FIXED.values())).exists()
        assert not Account.unscoped.filter(identifier__in=[a[0] for a in ACCOUNTS]).exists()
