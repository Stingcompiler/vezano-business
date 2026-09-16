"""بذرة السيناريو التجريبي (§١٥.٤) — بيانات مصطنعة معلنة، وحالة ابتدائية ثابتة:

    رصيد العميل 0 · مخزون الصنف 10 قطع · الصندوق 0 · جهازان مسجلان (A2 وB3)
    · مستأجران لاختبار العزل.

الأسماء من الحزمة: «بقالة النيل — تجريبي»، «مخزن البركة — تجريبي»، «أحمد الطيب — تجريبي».
لا أسرار حقيقية: كلمات السر ثابتة ومعلنة هنا لأن البيئة تجريبية،
ويرفض التشغيل على الإنتاج (guard.py).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from django.db import transaction

from core.auth.accounts import create_account
from core.auth.devices import register_device
from core.auth.invitations import create_invitation
from core.auth.pin import set_user_pin
from core.models import (
    Account,
    Branch,
    Device,
    Invitation,
    ManualVerificationRequest,
    PaymentMethod,
    Role,
    Tenant,
    TenantCreation,
    Unit,
    User,
    UserBranchAccess,
    VerificationCode,
)
from core.scenario.guard import assert_non_production
from core.tenancy import platform_context, tenant_context
from sync.counter import ensure_state

SCENARIO_TAG = "تجريبي"
DEMO_PASSWORD = "sting-demo-2026"  # noqa: S105 — بيئة تجريبية معلنة
DEMO_PIN = "123456"
#: معرّفات حسابات المنصة (ACC-02): المالك بهاتف وعضويتين (منشأتا السيناريو)، الكاشير ببريد وعضوية
DEMO_OWNER_IDENTIFIER = "+249912447001"
DEMO_CASHIER_IDENTIFIER = "cashier@sting.example"
#: رمز دعوة ثابت للسيناريو: «مخزن البركة» يدعو حساب الكاشير أمينَ مخزن على المخزن الرئيسي (ACC-06)
DEMO_INVITE_TOKEN = "demo-invite-baraka-storekeeper"  # noqa: S105 — سيناريو تجريبي

#: معرّفات ثابتة حتى تتكرر السيناريوهات بنفس الهويات (UUIDv7 مزيّف بوقت ثابت)
FIXED = {
    "tenant_a": uuid.UUID("01990000-0000-7000-8000-00000000000a"),
    "tenant_b": uuid.UUID("01990000-0000-7000-8000-00000000000b"),
    "tenant_c": uuid.UUID("01990000-0000-7000-8000-00000000000c"),
    "branch_a": uuid.UUID("01990000-0000-7000-8000-0000000000a1"),
    "branch_b": uuid.UUID("01990000-0000-7000-8000-0000000000b1"),
    "owner_a": uuid.UUID("01990000-0000-7000-8000-0000000000a2"),
    "cashier_a": uuid.UUID("01990000-0000-7000-8000-0000000000a3"),
    "owner_b": uuid.UUID("01990000-0000-7000-8000-0000000000b2"),
    "branch_c": uuid.UUID("01990000-0000-7000-8000-0000000000c1"),
    "suspended_c": uuid.UUID("01990000-0000-7000-8000-0000000000c2"),
}


@dataclass(frozen=True)
class SeededDevice:
    device_id: uuid.UUID
    prefix: str
    registration_secret: str
    access: str
    refresh: str


@dataclass
class SeedResult:
    tenant_a: Tenant
    tenant_b: Tenant
    branch_a: Branch
    branch_b: Branch
    owner_a: User
    cashier_a: User
    devices: list[SeededDevice] = field(default_factory=list)
    sync_epoch: str = ""

    def summary(self) -> dict[str, object]:
        return {
            "tenant_a": str(self.tenant_a.id),
            "tenant_b": str(self.tenant_b.id),
            "branch_a": str(self.branch_a.id),
            "owner_a": {
                "username": self.owner_a.username,
                "identifier": DEMO_OWNER_IDENTIFIER,
                "password": DEMO_PASSWORD,
                "pin": DEMO_PIN,
            },
            "cashier_a": {
                "username": self.cashier_a.username,
                "identifier": DEMO_CASHIER_IDENTIFIER,
                "password": DEMO_PASSWORD,
                "pin": DEMO_PIN,
            },
            "devices": [
                {
                    "device_id": str(d.device_id),
                    "prefix": d.prefix,
                    "registration_secret": d.registration_secret,
                }
                for d in self.devices
            ],
            "sync_epoch": self.sync_epoch,
            "initial_state": {
                "customer_balance": "0",
                "item_stock": "10",
                "cash_drawer": "0",
                "devices": 2,
            },
        }


def wipe_scenario() -> int:
    """يمحو مستأجري السيناريو وكل ما تحتهم (بترتيب المفاتيح) — محمي بـ guard.

    يعيد عدد المستأجرين الممحوين.
    """
    assert_non_production()
    from core.models import PinVerifier, Session
    from sync.models import Member, Operation, QuarantinedOperation, SyncState
    from sync.models_log import AccessManifest, Snapshot, SyncLog

    ids = [FIXED["tenant_a"], FIXED["tenant_b"], FIXED["tenant_c"]]
    with platform_context(), transaction.atomic():
        existing = list(Tenant.unscoped.filter(id__in=ids))
        if not existing:
            return 0
        for model in (
            SyncLog,
            Member,
            Operation,
            QuarantinedOperation,
            Snapshot,
            AccessManifest,
            SyncState,
        ):
            model.unscoped.filter(tenant_id__in=ids).delete()
        Session.unscoped.filter(tenant_id__in=ids).delete()
        from catalog.models import Item, ItemAlias, ItemGroup, ItemUnit

        for cat_model in (ItemAlias, ItemUnit, Item, ItemGroup):
            cat_model.unscoped.filter(tenant_id__in=ids).delete()
        Invitation.unscoped.filter(tenant_id__in=ids).delete()
        TenantCreation.unscoped.filter(tenant_id__in=ids).delete()
        Unit.unscoped.filter(tenant_id__in=ids).delete()
        PaymentMethod.unscoped.filter(tenant_id__in=ids).delete()
        PinVerifier.unscoped.filter(tenant_id__in=ids).delete()
        UserBranchAccess.unscoped.filter(tenant_id__in=ids).delete()
        Device.unscoped.filter(tenant_id__in=ids).delete()
        User.unscoped.filter(tenant_id__in=ids).delete()
        Role.unscoped.filter(tenant_id__in=ids).delete()
        Branch.unscoped.filter(tenant_id__in=ids).delete()
        # الإعدادات تُحذف بالتتالي مع المستأجر
        Tenant.unscoped.filter(id__in=ids).delete()
        demo_ids = [DEMO_OWNER_IDENTIFIER, DEMO_CASHIER_IDENTIFIER]
        VerificationCode.unscoped.filter(identifier__in=demo_ids).delete()
        ManualVerificationRequest.unscoped.filter(identifier__in=demo_ids).delete()
        Account.unscoped.filter(identifier__in=demo_ids).delete()
        return len(existing)


def seed_catalog(tenant: Tenant) -> None:
    """أصناف ومجموعات وأسماء بديلة كما في الإطار 05-D2 CAT-01 (يُستدعى داخل سياق المستأجر)."""
    from catalog import services as cat
    from core.models import Unit

    units = {u.code: u for u in Unit.objects.all()}
    piece = units.get("piece") or Unit.objects.create(
        tenant=tenant, code="piece", name="حبة", is_base=True
    )
    kg = units.get("kg") or Unit.objects.create(
        tenant=tenant, code="kg", name="كغ", is_base=True, decimal_places=3
    )
    if kg.decimal_places != 3:
        kg.decimal_places = 3
        kg.save(update_fields=["decimal_places"])
    carton = units.get("carton") or Unit.objects.create(tenant=tenant, code="carton", name="كرتونة")
    pack = Unit.objects.create(tenant=tenant, code="pack", name="عبوة", is_base=True)
    bag = Unit.objects.create(tenant=tenant, code="bag", name="كيس", is_base=True)
    grocery = cat.create_group(name="بقالة")
    drinks = cat.create_group(name="مشروبات")
    cleaning = cat.create_group(name="منظفات")
    rows: list[tuple[str, list[str], Any, Any, list[tuple[Any, int]], int, str, bool]] = [
        ("سكر", ["سكر أبيض"], grocery, kg, [(carton, 12_000)], 10_000, "6291000000142", True),
        ("شاي أسود 250غ", [], drinks, pack, [], 24_000, "6291000000338", True),
        (
            "زيت 1 لتر",
            ["زيت طعام"],
            grocery,
            pack,
            [(carton, 12_000)],
            78_000,
            "6291000000501",
            True,
        ),
        ("دقيق 5 كغ", [], grocery, bag, [], 145_000, "6291000000677", True),
        ("أرز 1 كغ", [], grocery, kg, [(carton, 25_000)], 32_000, "6291000000712", True),
        ("صابون قديم", ["صابون أزرق"], cleaning, piece, [], 8_000, "6291000000899", False),
        ("ماء 1.5 لتر", [], drinks, pack, [(carton, 6_000)], 7_500, "6291000000954", True),
    ]
    for name, aliases, group, base, extra, price, barcode, active in rows:
        item = cat.create_item(
            name=name,
            base_unit=base,
            group=group,
            barcode=barcode,
            sale_price_minor=price,
            units=extra,
            aliases=aliases,
        )
        if not active:
            cat.deactivate_item(item)


def seed_scenario() -> SeedResult:
    """يبني الحالة الابتدائية من الصفر (بعد wipe). كل شيء موسوم «تجريبي»."""
    assert_non_production()
    with platform_context(), transaction.atomic():
        a = Tenant.unscoped.create(
            id=FIXED["tenant_a"],
            name=f"بقالة النيل — {SCENARIO_TAG}",
            base_currency="SDG",
            base_currency_exponent=2,
        )
        b = Tenant.unscoped.create(
            id=FIXED["tenant_b"],
            name=f"مخزن البركة — {SCENARIO_TAG}",
            base_currency="SDG",
            base_currency_exponent=2,
        )
        branch_a = Branch.unscoped.create(
            id=FIXED["branch_a"], tenant=a, name="الرئيسي", code="KRT", is_default=True
        )
        branch_b = Branch.unscoped.create(
            id=FIXED["branch_b"], tenant=b, name="المخزن الرئيسي", code="KRT", is_default=True
        )
        # منشأة ثالثة يظهر فيها المالك بعضوية موقوفة (28-D21 ACC-03 permission_denied)
        c = Tenant.unscoped.create(
            id=FIXED["tenant_c"],
            name=f"متجر الخرطوم — {SCENARIO_TAG}",
            base_currency="SDG",
            base_currency_exponent=2,
        )
        Branch.unscoped.create(
            id=FIXED["branch_c"], tenant=c, name="الرئيسي", code="KRT", is_default=True
        )
        owner_role = Role.unscoped.create(tenant=a, code="owner", name="مالك")
        cashier_role = Role.unscoped.create(tenant=a, code="cashier", name="كاشير")
        Role.unscoped.create(tenant=b, code="owner", name="مالك")

        owner_a = User.objects.create_user(
            tenant=a,
            username="owner",
            display_name=f"المالك — {SCENARIO_TAG}",
            is_owner=True,
            id=FIXED["owner_a"],
        )
        cashier_a = User.objects.create_user(
            tenant=a,
            username="cashier",
            display_name=f"أحمد الطيب — {SCENARIO_TAG}",
            id=FIXED["cashier_a"],
        )
        owner_b = User.objects.create_user(
            tenant=b,
            username="owner",
            display_name=f"عثمان الطيب — {SCENARIO_TAG}",
            is_owner=True,
            id=FIXED["owner_b"],
        )
        suspended_c = User.objects.create_user(
            tenant=c,
            username="owner",
            display_name=f"المالك — {SCENARIO_TAG}",
            is_owner=True,
            is_active=False,
            id=FIXED["suspended_c"],
        )
        for u in (owner_a, cashier_a, owner_b):
            u.set_password(DEMO_PASSWORD)
            u.save(update_fields=["password"])
        # حسابا المنصة: المالك بعضويتين (يمرّ بـ ACC-03)، الكاشير بعضوية واحدة (يدخل مباشرة)
        owner_account = create_account(DEMO_OWNER_IDENTIFIER, DEMO_PASSWORD, owner_a.display_name)
        cashier_account = create_account(
            DEMO_CASHIER_IDENTIFIER, DEMO_PASSWORD, cashier_a.display_name
        )
        User.unscoped.filter(id__in=[owner_a.id, owner_b.id, suspended_c.id]).update(
            account=owner_account
        )
        User.unscoped.filter(id=cashier_a.id).update(account=cashier_account)
        storekeeper_b = Role.unscoped.create(tenant=b, code="storekeeper", name="أمين مخزن")
        create_invitation(
            inviter=owner_b,
            branch=branch_b,
            role=storekeeper_b,
            invitee_identifier=DEMO_CASHIER_IDENTIFIER,
            token=DEMO_INVITE_TOKEN,
        )

        UserBranchAccess.unscoped.create(tenant=a, user=owner_a, branch=branch_a, role=owner_role)
        UserBranchAccess.unscoped.create(
            tenant=a, user=cashier_a, branch=branch_a, role=cashier_role
        )

    result = SeedResult(a, b, branch_a, branch_b, owner_a, cashier_a)
    with tenant_context(a.id):
        ensure_state(a.id)
        seed_catalog(a)
        set_user_pin(owner_a, DEMO_PIN)
        set_user_pin(cashier_a, DEMO_PIN)
        for name, prefix in (("تابلت الكاشير", "A2"), ("هاتف المالك", "B3")):
            reg = register_device(user=owner_a, branch=branch_a, name=f"{name} — {SCENARIO_TAG}")
            # بادئة ثابتة للسيناريو حتى تتطابق أرقام الفواتير مع الوثيقة (INV-KRT-A2-…)
            Device.objects.filter(id=reg.device.id).update(prefix=prefix)
            result.devices.append(
                SeededDevice(
                    reg.device.id, prefix, reg.registration_secret, reg.access, reg.refresh
                )
            )
        result.sync_epoch = ensure_state(a.id).sync_epoch
    with platform_context():
        ensure_state(b.id)
    return result


def reset_scenario() -> SeedResult:
    """إعادة الضبط إلى الحالة الابتدائية: محو ثم بذر — الأمر الواحد الذي تطلبه §١٥.٤."""
    wipe_scenario()
    return seed_scenario()
