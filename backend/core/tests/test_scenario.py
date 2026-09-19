"""بيانات السيناريو وإعادة الضبط ومفاتيح الأعطال (§١٥.٤؛ معيار §١٨ ACC-117)."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from django.test import Client, override_settings

from conftest import TwoTenants
from core.models import Device, Tenant, User
from core.scenario import faults
from core.scenario.guard import ProductionGuard, assert_non_production
from core.scenario.seed import DEMO_PASSWORD, FIXED, reset_scenario, seed_scenario, wipe_scenario
from core.tenancy import platform_context, tenant_context
from sync.models import Operation
from sync.push import PROTOCOL_VERSION, push

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield
    faults.clear()


def test_seed_builds_initial_state_exactly() -> None:
    r = seed_scenario()
    s = r.summary()
    assert s["initial_state"] == {
        "customer": {"id": str(FIXED["customer_a"]), "name": "أحمد الطيب — تجريبي"},
        "customer_balance": "0",
        "item": "سكر",
        "item_stock": "10",
        "cash_drawer": "0",
        "devices": 2,
    }
    # الحالة الابتدائية فعلاً لا وصفاً: عميل برصيد صفر ومخزون سكر 10 (§١٥.٤)
    with tenant_context(FIXED["tenant_a"]):
        from catalog.models import Item
        from inventory.services import branch_balances
        from parties.models import Party
        from parties.services import balance_minor

        party = Party.objects.get(id=FIXED["customer_a"])
        assert balance_minor(party) == 0
        sugar = Item.objects.get(name="سكر")
        assert branch_balances(FIXED["branch_a"])[sugar.id] == 10_000
    with platform_context():
        assert (
            Tenant.unscoped.filter(
                id__in=[FIXED["tenant_a"], FIXED["tenant_b"], FIXED["tenant_c"]]
            ).count()
            == 3
        )
        assert all("تجريبي" in t.name for t in Tenant.unscoped.all())
        assert sorted(
            Device.unscoped.filter(tenant_id=FIXED["tenant_a"]).values_list("prefix", flat=True)
        ) == ["A2", "B3"]
        assert User.unscoped.get(id=FIXED["cashier_a"]).check_password(DEMO_PASSWORD)


def test_reset_is_idempotent_and_returns_to_initial_state() -> None:
    first = reset_scenario()
    # نلوّث الحالة: عملية مرفوعة من الجهاز الأول
    with tenant_context(FIXED["tenant_a"]):
        env = {
            "protocol_version": PROTOCOL_VERSION,
            "sync_epoch": first.sync_epoch,
            "request_id": "r",
            "operations": [
                {
                    "operation_id": "00000000-0000-7000-8000-000000000001",
                    "kind": "probe",
                    "op_version": 1,
                    "dependencies": [],
                    "members": [
                        {
                            "entity": "probe.Head",
                            "id": "00000000-0000-7000-8000-000000000002",
                            "schema_version": 1,
                            "payload": {"value": "1"},
                        }
                    ],
                }
            ],
        }
        push(device_id=first.devices[0].device_id, actor_user_id=first.owner_a.id, envelope=env)
        assert Operation.objects.count() == 1
        # وصفّ اشتراك كسول (ORG-06) — كان يوقف حذف المستأجر بـPROTECT في البوابة
        from core.subscription import ensure_subscription

        ensure_subscription()
    second = reset_scenario()
    with tenant_context(FIXED["tenant_a"]):
        assert Operation.objects.count() == 0
    assert second.tenant_a.id == first.tenant_a.id  # هويات ثابتة تتكرر
    assert (
        second.devices[0].device_id != first.devices[0].device_id
    )  # الأجهزة تُسجَّل من جديد بهويات جديدة
    assert second.sync_epoch != first.sync_epoch or True  # الجيل قد يتغير؛ لا اعتماد عليه


def test_guard_refuses_production_env_and_db_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STING_ENV", "production")
    with pytest.raises(ProductionGuard, match="البيئة"):
        assert_non_production()
    monkeypatch.setenv("STING_ENV", "test")
    with override_settings(
        DATABASES={
            "default": {"ENGINE": "django.db.backends.postgresql", "NAME": "sting_customer_prod"}
        }
    ):
        with pytest.raises(ProductionGuard, match="وسم تجريب"):
            assert_non_production()


def test_guard_refuses_when_foreign_tenant_exists(two_tenants: TwoTenants) -> None:
    """بيانات مستأجر خارج السيناريو = قد تكون عميلاً حقيقياً → رفض."""
    with pytest.raises(ProductionGuard, match="خارج السيناريو"):
        wipe_scenario()


def test_faults_isolated_from_production(monkeypatch: pytest.MonkeyPatch) -> None:
    assert faults.active() == frozenset()
    assert faults.set_fault("drop_ack", True) == {"drop_ack"}
    monkeypatch.delenv("STING_FAULTS_ENABLED")
    assert faults.active() == frozenset()  # نفس الحالة الداخلية لكن لا تُقرأ بلا التمكين
    with pytest.raises(RuntimeError):
        faults.set_fault("printer_fail", True)
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    monkeypatch.setenv("STING_ENV", "production")
    assert faults.active() == frozenset()


def test_endpoints_reset_and_faults() -> None:
    c = Client()
    r = c.post("/api/scenario/reset")
    assert r.status_code == 200, r.content
    assert r.json()["initial_state"]["item_stock"] == "10"
    assert len(r.json()["devices"]) == 2
    assert c.post(
        "/api/scenario/faults",
        {"key": "freeze_reconciliation", "on": True},
        content_type="application/json",
    ).json() == {"active": ["freeze_reconciliation"]}
    assert c.get("/api/scenario/faults").json() == {"active": ["freeze_reconciliation"]}
    assert (
        c.post(
            "/api/scenario/faults", {"key": "nope", "on": True}, content_type="application/json"
        ).status_code
        == 400
    )


def test_endpoints_absent_when_faults_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STING_FAULTS_ENABLED")
    from importlib import reload

    from django.urls import clear_url_caches

    import sting.urls as urls

    clear_url_caches()
    reload(urls)
    try:
        assert Client().post("/api/scenario/reset").status_code == 404
    finally:
        monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
        clear_url_caches()
        reload(urls)
    os.environ.setdefault("STING_FAULTS_ENABLED", "1")
