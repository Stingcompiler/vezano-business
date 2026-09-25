"""محتوى العرض الكامل (بأمر المالك 2026-09-25 «املأ الموقع بكل المحتوى المطلوب»).

منشأتان موسومتان «تجريبي» منفصلتان عن سيناريو §١٥.٤ (لا تمسّان حالته الثابتة ولا منشآت المالك):

- **سوبرماركت الواحة** — فرعان (الخرطوم ٢ وبحري)، خمسة مستخدمين بكل الأدوار، ستة أجهزة، نحو ستين
  صنفاً، عملاء وموردون، ثلاثون يوماً من الورديات والمبيعات (نقد/تحويل/آجل/مختلط، خصومات، مرتجعات،
  تحصيلات، مصروفات)، مشتريات واستلامات وتحويلات وجرد وهالك، حملات وتنبيهات، واشتراك بإثباتات.
- **شركة الجزيرة للتوزيع** — مورّد جملة موثَّق في السوق: ملف منشور وعروض وقائمة أسعار خاصة، وطلبات
  من الواحة بكل مراحلها (مُرسل، مسعَّر، مقبول، مشحون، مستلم، خلاف، مرفوض).

كل شيء يمرّ بطبقة الخدمات الحقيقية ونقل المزامنة، فالأرصدة والصندوق والتقارير متسقة. الأوامر:

    manage.py showcase reset   # محو ثم بذر
    manage.py showcase wipe    # محو فقط

مرفوض خارج بيئات التطوير (نفس حارس السيناريو). كلمة السر ورمز الـPIN معلنان هنا لأن البيئة تجريبية.
"""

from __future__ import annotations

import functools
import os
import random
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from django.db.models import F
from django.utils import timezone

from core.ids import uuid7
from core.money import line_total_minor
from core.tenancy import platform_context, tenant_context

TAG = "تجريبي"
PASSWORD = "vezano-demo-2026"  # noqa: S105 — بيئة تجريبية معلنة
PIN = "123456"
DAYS = 30

FIXED = {
    "shop": uuid.UUID("01990000-0000-7000-8000-0000000000e0"),
    "dist": uuid.UUID("01990000-0000-7000-8000-0000000000f0"),
}

#: الحسابات: (المعرّف، الاسم، المنشأة، الدور، الفروع)
ACCOUNTS: list[tuple[str, str, str, str, tuple[str, ...]]] = [
    ("+249912600100", "مصعب الأمين", "shop", "owner", ("KRT", "BHR")),
    ("sara@alwaha.example", "سارة عبد الله", "shop", "manager", ("KRT", "BHR")),
    ("+249912600101", "محمد إدريس", "shop", "cashier", ("KRT",)),
    ("+249912600102", "هبة صالح", "shop", "cashier", ("BHR",)),
    ("omar@alwaha.example", "عمر بشير", "shop", "storekeeper", ("KRT", "BHR")),
    ("+249912600200", "عثمان الجزيري", "dist", "owner", ("DST",)),
    ("yasir@aljazeera.example", "ياسر حامد", "dist", "manager", ("DST",)),
]
PENDING_INVITE = "+249912600109"


class ShowcaseError(RuntimeError):
    pass


def assert_dev() -> None:
    env = os.environ.get("STING_ENV", "development")
    if env not in {"development", "test", "ci"}:
        raise ShowcaseError(f"مرفوض في البيئة {env!r} — للتطوير فقط")


# ─────────────────────────────── محو ───────────────────────────────


def wipe_showcase() -> int:
    assert_dev()
    from core.models import Account, Tenant
    from core.scenario.seed import wipe_tenants

    ids = list(FIXED.values())
    with platform_context():
        n = Tenant.unscoped.filter(id__in=ids).count()
    if n:
        wipe_tenants(ids, reset_platform=False)
    with platform_context():
        Account.unscoped.filter(identifier__in=[a[0] for a in ACCOUNTS] + [PENDING_INVITE]).delete()
    return n


# ─────────────────────────────── البيانات ───────────────────────────────

#: (الاسم، المجموعة، الوحدة، السعر بالجنيه، التكلفة، الباركود، كرتونة×، الافتتاحي، أسماء بديلة)
ITEMS: list[tuple[str, str, str, int, int, str, int, int, tuple[str, ...]]] = [
    ("سكر أبيض 1 كغ", "بقالة", "piece", 2800, 2450, "6291100000011", 10, 320, ("سكر",)),
    ("سكر فاخر 10 كغ", "بقالة", "bag", 27000, 24200, "6291100000028", 0, 40, ()),
    ("دقيق زادنا 5 كغ", "بقالة", "bag", 14000, 12300, "6291100000035", 0, 90, ("دقيق", "فينو")),
    ("أرز بسمتي 1 كغ", "بقالة", "piece", 4200, 3600, "6291100000042", 10, 180, ("رز",)),
    ("عدس أحمر 1 كغ", "بقالة", "piece", 3000, 2550, "6291100000059", 10, 150, ()),
    ("فول مصري 1 كغ", "بقالة", "piece", 2600, 2200, "6291100000066", 10, 160, ("فول",)),
    ("مكرونة 400 غ", "بقالة", "piece", 1100, 880, "6291100000073", 20, 300, ("اسباغيتي",)),
    ("شعيرية 400 غ", "بقالة", "piece", 1000, 800, "6291100000080", 20, 200, ()),
    ("ملح طعام 1 كغ", "بقالة", "piece", 600, 420, "6291100000097", 20, 150, ()),
    ("زيت فول 1 لتر", "بقالة", "piece", 5500, 4800, "6291100000103", 12, 220, ("زيت",)),
    ("زيت سمسم 1 لتر", "بقالة", "piece", 7200, 6300, "6291100000110", 12, 80, ()),
    ("عجوة 1 كغ", "بقالة", "piece", 6500, 5400, "6291100000127", 0, 60, ("تمر",)),
    ("شاي الغزالين 250 غ", "مشروبات", "piece", 3500, 2950, "6291100000134", 24, 200, ("شاي",)),
    ("بن محوّج 250 غ", "مشروبات", "piece", 4800, 4000, "6291100000141", 24, 120, ("قهوة",)),
    ("كركدي 250 غ", "مشروبات", "piece", 2200, 1750, "6291100000158", 24, 90, ()),
    ("ماء صحة 1.5 لتر", "مشروبات", "piece", 700, 520, "6291100000165", 12, 600, ("موية",)),
    ("بيبسي 1 لتر", "مشروبات", "piece", 1800, 1450, "6291100000172", 12, 240, ()),
    ("عصير مانجو 1 لتر", "مشروبات", "piece", 2500, 2000, "6291100000189", 12, 150, ()),
    ("مشروب طاقة 250 مل", "مشروبات", "piece", 2000, 1550, "6291100000196", 24, 120, ()),
    (
        "حليب بودرة نيدو 400 غ",
        "ألبان",
        "piece",
        9500,
        8300,
        "6291100000202",
        12,
        14,
        ("لبن بودرة",),
    ),
    ("حليب طويل الأجل 1 لتر", "ألبان", "piece", 3200, 2700, "6291100000219", 12, 140, ()),
    ("جبنة بيضاء 500 غ", "ألبان", "piece", 4500, 3800, "6291100000226", 0, 70, ("جبنة",)),
    ("زبادي 500 غ", "ألبان", "piece", 1800, 1450, "6291100000233", 0, 90, ("روب",)),
    ("سمن 1 كغ", "ألبان", "piece", 8800, 7700, "6291100000240", 12, 60, ()),
    ("صلصة طماطم 400 غ", "معلبات", "piece", 1500, 1200, "6291100000257", 24, 200, ("صلصة",)),
    ("تونة 185 غ", "معلبات", "piece", 2700, 2250, "6291100000264", 48, 180, ()),
    ("سردين 125 غ", "معلبات", "piece", 1600, 1300, "6291100000271", 48, 140, ()),
    ("فول معلب 400 غ", "معلبات", "piece", 1300, 1050, "6291100000288", 24, 160, ()),
    ("بسكويت شاي", "حلويات", "piece", 500, 380, "6291100000295", 48, 400, ("بسكويت",)),
    ("شوكولاتة 50 غ", "حلويات", "piece", 900, 700, "6291100000301", 48, 260, ()),
    ("حلاوة طحينية 500 غ", "حلويات", "piece", 3800, 3150, "6291100000318", 12, 70, ("طحنية",)),
    ("شيبس 70 غ", "حلويات", "piece", 700, 520, "6291100000325", 48, 300, ()),
    ("مسحوق غسيل 1 كغ", "منظفات", "piece", 4200, 3500, "6291100000332", 12, 110, ("صابون بدرة",)),
    ("صابون غسيل قطعة", "منظفات", "piece", 600, 450, "6291100000349", 48, 260, ("صابون",)),
    ("سائل جلي 750 مل", "منظفات", "piece", 2300, 1850, "6291100000356", 12, 120, ()),
    ("كلوركس 1 لتر", "منظفات", "piece", 1900, 1500, "6291100000363", 12, 100, ("مبيض",)),
    ("مناديل ورقية", "منظفات", "piece", 1500, 1150, "6291100000370", 24, 150, ("كلينكس",)),
    ("معجون أسنان 100 مل", "عناية شخصية", "piece", 2400, 1900, "6291100000387", 24, 90, ()),
    ("صابون حمام", "عناية شخصية", "piece", 1200, 900, "6291100000394", 48, 160, ()),
    ("شامبو 400 مل", "عناية شخصية", "piece", 4600, 3800, "6291100000400", 12, 60, ()),
    ("فوط أطفال مقاس 4", "عناية شخصية", "piece", 16500, 14200, "6291100000417", 0, 40, ("بامبرز",)),
    ("طماطم", "خضار وفواكه", "kg", 1800, 1300, "", 0, 120, ()),
    ("بصل", "خضار وفواكه", "kg", 1400, 1000, "", 0, 200, ()),
    ("بطاطس", "خضار وفواكه", "kg", 2000, 1500, "", 0, 150, ()),
    ("موز", "خضار وفواكه", "kg", 2500, 1900, "", 0, 90, ()),
    ("ليمون", "خضار وفواكه", "kg", 3000, 2300, "", 0, 60, ()),
    ("خبز رغيف (10)", "مخبوزات", "piece", 1000, 800, "6291100000424", 0, 300, ("عيش",)),
    ("كيك 250 غ", "مخبوزات", "piece", 1500, 1150, "6291100000431", 24, 100, ()),
    ("بيض كرتونة 30", "مخبوزات", "piece", 9000, 8100, "6291100000448", 0, 50, ("بيض",)),
    ("فحم 5 كغ", "أدوات منزلية", "bag", 6000, 4800, "6291100000455", 0, 45, ()),
    ("غاز ولاعة", "أدوات منزلية", "piece", 500, 350, "6291100000462", 50, 180, ()),
    ("بطارية AA (2)", "أدوات منزلية", "piece", 1500, 1100, "6291100000479", 24, 80, ()),
    ("شمعة", "أدوات منزلية", "piece", 300, 200, "6291100000486", 50, 200, ()),
    ("كيس نفايات (20)", "أدوات منزلية", "piece", 1800, 1350, "6291100000493", 24, 70, ()),
]
#: صنف موقوف (يظهر في الفهرس بحالة غير نشط)
INACTIVE = ("صابون زيتون قديم", "منظفات", "piece", 800, 600, "6291100000509", 0, 0, ())

#: (الاسم، الهاتف، حدّ الائتمان بالجنيه، رصيد افتتاحي بالجنيه، موافقة تسويق)
CUSTOMERS: list[tuple[str, str, int, int, bool]] = [
    ("مطعم الواحة", "0912700101", 500_000, 120_000, True),
    ("كافتيريا النيلين", "0912700102", 300_000, 0, True),
    ("أحمد الطيب", "0912700103", 100_000, 35_000, True),
    ("فاطمة الزين", "0912700104", 60_000, 0, True),
    ("مدرسة الرياض الخاصة", "0912700105", 800_000, 0, False),
    ("عبد الرحيم موسى", "0912700106", 80_000, 22_500, True),
    ("بقالة الحي الصغيرة", "0912700107", 250_000, 0, True),
    ("نادي الهلال الأهلي", "0912700108", 400_000, 0, False),
    ("خالد عثمان", "0912700109", 50_000, 0, True),
    ("مستشفى الأمل", "0912700110", 1_000_000, 0, True),
    ("سعاد بابكر", "0912700111", 40_000, 0, True),
    ("ورشة الصافي", "0912700112", 150_000, 0, False),
    ("محمد علي — زبون نقدي", "0912700113", 0, 0, True),
    ("هيثم الحسن", "0912700114", 70_000, 0, True),
]
#: (الاسم، الهاتف، رصيد افتتاحي مستحق له بالجنيه)
SUPPLIERS: list[tuple[str, str, int]] = [
    ("شركة الجزيرة للتوزيع", "0912800201", 450_000),
    ("مصنع سكر كنانة — وكيل", "0912800202", 0),
    ("مطاحن سيقا — وكيل", "0912800203", 280_000),
    ("شركة النيل للمشروبات", "0912800204", 0),
    ("سوق الخضار المركزي", "0912800205", 0),
    ("شركة الصافي للمنظفات", "0912800206", 95_000),
]

#: عروض الموزّع في السوق: (الاسم، الوحدة، التعبئة، السعر بالجنيه، أقل طلب)
OFFERS: list[tuple[str, str, str, int, int]] = [
    ("سكر أبيض", "carton", "10×1 كغ", 24_000, 5),
    ("زيت فول", "carton", "12×1 لتر", 56_500, 3),
    ("أرز بسمتي", "carton", "10×1 كغ", 35_500, 3),
    ("شاي الغزالين", "carton", "24×250 غ", 69_000, 2),
    ("مكرونة", "carton", "20×400 غ", 17_200, 5),
    ("تونة", "carton", "48×185 غ", 106_000, 1),
    ("صلصة طماطم", "carton", "24×400 غ", 28_000, 3),
    ("ماء صحة", "carton", "12×1.5 لتر", 6_000, 10),
    ("بيبسي", "carton", "12×1 لتر", 17_000, 5),
    ("مسحوق غسيل", "carton", "12×1 كغ", 41_000, 2),
    ("حليب بودرة نيدو", "carton", "12×400 غ", 97_000, 1),
    ("بسكويت شاي", "carton", "48 قطعة", 17_500, 5),
]


# ─────────────────────────────── أدوات ───────────────────────────────


def _m(pounds: int) -> int:
    """جنيه → وحدة صغرى (أسّ ٢)."""
    return pounds * 100


def _iso(d: date, h: int, m: int = 0) -> str:
    return datetime(d.year, d.month, d.day, h, m, tzinfo=UTC).isoformat().replace("+00:00", "Z")


def _member(entity: str, payload: dict[str, Any], mid: str | None = None) -> dict[str, Any]:
    return {"entity": entity, "id": mid or str(uuid7()), "schema_version": 1, "payload": payload}


def _op(kind: str, members: list[dict[str, Any]], deps: list[str] | None = None) -> dict[str, Any]:
    return {
        "operation_id": str(uuid7()),
        "kind": kind,
        "op_version": 1,
        "dependencies": deps or [],
        "members": members,
    }


@dataclass
class Ctx:
    shop: Any = None
    dist: Any = None
    branches: dict[str, Any] = field(default_factory=dict)
    users: dict[str, Any] = field(default_factory=dict)  # "shop:owner", "shop:cashier:KRT" …
    devices: dict[str, Any] = field(default_factory=dict)  # "KRT" → Device
    items: list[Any] = field(default_factory=list)
    item_meta: dict[str, dict[str, Any]] = field(default_factory=dict)  # item_id → meta
    customers: list[Any] = field(default_factory=list)
    suppliers: dict[str, Any] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)
    sales: list[dict[str, Any]] = field(default_factory=list)  # للمرتجعات
    scarce: set[str] = field(default_factory=set)
    #: ذمّة كل عميل كما تتراكم في البذرة — الآجل لا يتجاوز الحدّ، والتحصيل من أكبر المدينين
    debt: dict[str, int] = field(default_factory=dict)  # أصناف قليلة الرصيد عمداً (تنبيه «ينفد»)
    stats: dict[str, int] = field(default_factory=dict)

    def bump(self, key: str, n: int = 1) -> None:
        self.stats[key] = self.stats.get(key, 0) + n

    def number(self, kind: str, branch: str) -> str:
        dev = self.devices[branch]
        key = f"{kind}:{branch}"
        self.counters[key] = self.counters.get(key, 0) + 1
        yy = timezone.localdate().strftime("%y")
        return f"{kind}-{branch}-{dev.prefix}-{yy}-{self.counters[key]:06d}"


def _push(ctx: Ctx, branch: str, user: Any, ops: list[dict[str, Any]]) -> None:
    from sync.counter import ensure_state
    from sync.push import PROTOCOL_VERSION, push

    if not ops:
        return
    dev = ctx.devices[branch]
    tid = ctx.shop.id
    for i in range(0, len(ops), 40):
        chunk = ops[i : i + 40]
        with tenant_context(tid):
            resp = push(
                device_id=dev.id,
                actor_user_id=user.id,
                envelope={
                    "protocol_version": PROTOCOL_VERSION,
                    "sync_epoch": ensure_state(tid).sync_epoch,
                    "request_id": str(uuid7()),
                    "operations": chunk,
                },
                branch_id=str(dev.branch_id),
            ).as_dict()
        bad = [r for r in resp["results"] if r["status"] not in ("accepted", "duplicate")]
        if bad:
            raise ShowcaseError(f"نقل مرفوض: {bad[:2]}")


# ─────────────────────────────── المنشآت والمستخدمون ───────────────────────────────


def _create_tenant(tid: uuid.UUID, name: str, branches: list[tuple[str, str]]) -> Any:
    from core.models import Branch, PaymentMethod, Role, Tenant, Unit
    from core.recipes import RECIPES
    from sync.counter import ensure_state

    recipe = RECIPES["grocery"]
    t = Tenant.unscoped.create(id=tid, name=name, base_currency="SDG", base_currency_exponent=2)
    for i, (bname, code) in enumerate(branches):
        Branch.unscoped.create(tenant=t, name=bname, code=code, is_default=i == 0)
    for r in recipe.roles:
        Role.unscoped.create(tenant=t, code=r.code, name=r.name)
    for u in recipe.units:
        Unit.unscoped.create(
            tenant=t, code=u.code, name=u.name, is_base=u.is_base, decimal_places=u.decimal_places
        )
    Unit.unscoped.create(tenant=t, code="bag", name="كيس", is_base=True)
    for p in recipe.payment_methods:
        PaymentMethod.unscoped.create(tenant=t, code=p.code, name=p.name, is_cash=p.is_cash)
    ensure_state(t.id)
    return t


def seed_org(ctx: Ctx) -> None:
    from core.auth.accounts import create_account
    from core.models import Branch, Role, User, UserBranchAccess

    with platform_context():
        ctx.shop = _create_tenant(
            FIXED["shop"],
            f"سوبرماركت الواحة — {TAG}",
            [("الخرطوم ٢ — الرئيسي", "KRT"), ("بحري — المزاد", "BHR")],
        )
        ctx.dist = _create_tenant(
            FIXED["dist"], f"شركة الجزيرة للتوزيع — {TAG}", [("مخزن المنطقة الصناعية", "DST")]
        )
        for b in Branch.unscoped.filter(tenant_id__in=list(FIXED.values())):
            ctx.branches[b.code] = b
        for ident, name, tkey, role_code, codes in ACCOUNTS:
            t = ctx.shop if tkey == "shop" else ctx.dist
            acc = create_account(ident, PASSWORD, f"{name} — {TAG}")
            role = Role.unscoped.get(tenant=t, code=role_code)
            u = User.objects.create_user(
                tenant=t,
                username=role_code if role_code != "cashier" else f"cashier-{codes[0].lower()}",
                display_name=f"{name} — {TAG}",
                is_owner=role_code == "owner",
                account=acc,
            )
            for c in codes:
                UserBranchAccess.unscoped.create(
                    tenant=t, user=u, branch=ctx.branches[c], role=role
                )
            key = f"{tkey}:{role_code}" + (f":{codes[0]}" if role_code == "cashier" else "")
            ctx.users[key] = u
    ctx.bump("accounts", len(ACCOUNTS))


def seed_subscriptions(ctx: Ctx) -> None:
    """الواحة على «فرعان» ربعياً بإضافة مستخدمَين؛ الجزيرة على «فرعان» شهرياً."""
    from core.subscription import set_for_scenario

    for t in (ctx.shop, ctx.dist):
        with tenant_context(t.id):
            set_for_scenario(state="active", plan_code="dual")
    from core.models import TenantSubscription

    with tenant_context(ctx.shop.id):
        s = TenantSubscription.objects.get()
        s.extra_users = 3
        s.extra_devices = 2
        s.save(update_fields=["extra_users", "extra_devices"])


def seed_devices_and_pins(ctx: Ctx) -> None:
    from core.auth.devices import register_device
    from core.auth.pin import set_user_pin
    from core.models import Device

    plan = [
        ("KRT", "shop:cashier:KRT", "كاشير ١ — الرئيسي"),
        ("BHR", "shop:cashier:BHR", "كاشير بحري"),
    ]
    with tenant_context(ctx.shop.id):
        for code, ukey, name in plan:
            reg = register_device(user=ctx.users[ukey], branch=ctx.branches[code], name=name)
            ctx.devices[code] = reg.device
        register_device(
            user=ctx.users["shop:owner"], branch=ctx.branches["KRT"], name="هاتف المالك"
        )
        register_device(
            user=ctx.users["shop:storekeeper"], branch=ctx.branches["KRT"], name="تابلت المخزن"
        )
        for k, u in ctx.users.items():
            if k.startswith("shop:"):
                set_user_pin(u, PIN)
        ctx.bump("devices", Device.objects.count())
    with tenant_context(ctx.dist.id):
        register_device(
            user=ctx.users["dist:owner"], branch=ctx.branches["DST"], name="حاسوب المكتب"
        )
        for k, u in ctx.users.items():
            if k.startswith("dist:"):
                set_user_pin(u, PIN)
    ctx.bump("devices", 1)


def seed_invitation_and_matrix(ctx: Ctx) -> None:
    from core import org
    from core.models import Role

    with tenant_context(ctx.shop.id):
        roles = {r.code: r for r in Role.objects.all()}
        org.invite(
            inviter=ctx.users["shop:owner"],
            identifier=PENDING_INVITE,
            role=roles["cashier"],
            branch=ctx.branches["BHR"],
        )
        org.ensure_matrix()
        org.save_matrix(
            [
                {
                    "role_id": str(roles["manager"].id),
                    "key": "discount",
                    "value": "limit",
                    "limit_minor": _m(500),
                    "period": "per_op",
                },
                {
                    "role_id": str(roles["cashier"].id),
                    "key": "discount",
                    "value": "limit",
                    "limit_minor": _m(50),
                    "period": "per_op",
                },
            ],
            actor=ctx.users["shop:owner"],
        )


# ─────────────────────────────── الفهرس والأطراف والمخزون الافتتاحي ───────────────────────────────


def seed_catalog(ctx: Ctx) -> None:
    from catalog import services as cat
    from catalog.prices import set_price
    from core.models import Unit

    with tenant_context(ctx.shop.id):
        units = {u.code: u for u in Unit.objects.all()}
        groups: dict[str, Any] = {}
        for row in [*ITEMS, INACTIVE]:
            name, gname, ucode, price, cost, barcode, per_carton, opening, aliases = row
            g = groups.get(gname) or cat.create_group(name=gname)
            groups[gname] = g
            extra = [(units["carton"], per_carton * 1000)] if per_carton else []
            item = cat.create_item(
                name=name,
                base_unit=units[ucode],
                group=g,
                barcode=barcode,
                sale_price_minor=_m(price),
                units=extra,
                aliases=list(aliases),
            )
            if row is INACTIVE:
                cat.deactivate_item(item)
                continue
            ctx.items.append(item)
            ctx.item_meta[str(item.id)] = {
                "name": name,
                "unit": ucode,
                "unit_id": str(units[ucode].id),
                "price": _m(price),
                "cost": _m(cost),
                "per_carton": per_carton,
                "carton_id": str(units["carton"].id),
                "opening": opening,
                "kg": ucode == "kg",
            }
        # تاريخ أسعار: أربعة أصناف رُفع سعرها هذا الشهر
        owner = ctx.users["shop:owner"]
        for item in ctx.items[:40:10]:
            meta = ctx.item_meta[str(item.id)]
            new = meta["price"] + _m(200)
            set_price(item, new, changed_by=owner, can_see_cost=True)
            meta["price"] = new
        ctx.bump("groups", len(groups))
        ctx.bump("items", len(ctx.items) + 1)
    # كتالوج الموزّع (أصناف جملة بالكرتونة)
    with tenant_context(ctx.dist.id):
        units = {u.code: u for u in Unit.objects.all()}
        g = cat.create_group(name="جملة")
        for name, _unit, _pack, price, _min in OFFERS:
            cat.create_item(
                name=f"{name} — كرتونة",
                base_unit=units["carton"],
                group=g,
                barcode="",
                sale_price_minor=_m(price),
                units=[],
                aliases=[],
            )


def seed_parties(ctx: Ctx, start: date) -> None:
    from parties import services as ps
    from parties.models import Party

    owner = ctx.users["shop:owner"]
    now = timezone.now()
    with tenant_context(ctx.shop.id):
        for name, phone, limit, opening, consent in CUSTOMERS:
            p = ps.create_party(
                party_id=None, name=name, phone=phone, created_by=owner, distinct_from=None
            )
            Party.objects.filter(id=p.id).update(
                credit_limit_minor=_m(limit), marketing_consent_at=now if consent else None
            )
            p.refresh_from_db()
            if opening:
                ctx.debt[str(p.id)] = _m(opening)
                ps.record_opening_balance(
                    p,
                    side="customer_due",
                    amount_minor=_m(opening),
                    reason="رصيد مرحّل من الدفتر الورقي",
                    reference="",
                    business_date=start,
                    actor=owner,
                )
            ctx.customers.append(p)
        for name, phone, owed in SUPPLIERS:
            s = ps.create_party(
                party_id=None, name=name, phone=phone, created_by=owner, distinct_from=None
            )
            ps.update_party(
                s,
                name=name,
                phone=phone,
                aliases=[],
                credit_limit_minor=0,
                is_customer=False,
                is_supplier=True,
                note="مورّد معتمد",
            )
            s.refresh_from_db()
            if owed:
                ps.record_opening_balance(
                    s,
                    side="supplier_owed",
                    amount_minor=_m(owed),
                    reason="فواتير سابقة غير مسدَّدة",
                    reference="",
                    business_date=start,
                    actor=owner,
                )
            ctx.suppliers[name] = s
    ctx.bump("customers", len(CUSTOMERS))
    ctx.bump("suppliers", len(SUPPLIERS))


def seed_opening_stock(ctx: Ctx, start: date) -> None:
    from inventory.models import StockMovement
    from inventory.services import create_opening

    owner = ctx.users["shop:owner"]
    with tenant_context(ctx.shop.id):
        for code, share in (("KRT", 3.0), ("BHR", 2.0)):
            lines: list[Mapping[str, Any]] = []
            for item in ctx.items:
                meta = ctx.item_meta[str(item.id)]
                scarce = meta["opening"] < 20
                if scarce:
                    ctx.scarce.add(str(item.id))
                qty = meta["opening"] if scarce else max(1, int(meta["opening"] * share))
                lines.append(
                    {
                        "item_id": str(item.id),
                        "qty_milli": str(qty * 1000),
                        "factor_milli": "1000",
                        "unit_cost_minor": str(meta["cost"]),
                    }
                )
            create_opening(branch=ctx.branches[code], lines=lines, actor=owner, approve=True)
        StockMovement.objects.filter(reason="opening").update(occurred_at=_dt(start, 7))


def _dt(d: date, h: int, m: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, h, m, tzinfo=UTC)


# ─────────────────────────────── العمليات اليومية ───────────────────────────────


def _sale_lines(ctx: Ctx, rnd: random.Random, sale_id: str) -> tuple[list[dict[str, Any]], int]:
    members: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    subtotal = 0
    k = rnd.choice([1, 1, 2, 2, 3, 3, 4, 5])
    weights = [0.08 if str(i.id) in ctx.scarce else 1.0 for i in ctx.items]
    picks: list[Any] = []
    while len(picks) < k:
        it = rnd.choices(ctx.items, weights=weights)[0]
        if it not in picks:
            picks.append(it)
    for item in picks:
        meta = ctx.item_meta[str(item.id)]
        carton = meta["per_carton"] and rnd.random() < 0.05
        if meta["kg"]:
            qty = rnd.choice([500, 1000, 1500, 2000, 3000])
            factor, unit_id, unit_code, price = 1000, meta["unit_id"], "kg", meta["price"]
        elif carton:
            qty = 1000
            factor = meta["per_carton"] * 1000
            unit_id, unit_code = meta["carton_id"], "carton"
            price = int(meta["price"] * meta["per_carton"] * 0.95) // 100 * 100
        else:
            qty = rnd.choice([1000, 1000, 1000, 2000, 2000, 3000, 5000])
            factor, unit_id, unit_code, price = 1000, meta["unit_id"], meta["unit"], meta["price"]
        lt = line_total_minor(qty, price)
        subtotal += lt
        line_id = str(uuid7())
        members.append(
            _member(
                "sales.SaleLine",
                {
                    "line_id": line_id,
                    "sale_id": sale_id,
                    "item_id": str(item.id),
                    "item_name": meta["name"],
                    "unit_id": unit_id,
                    "unit_code": unit_code,
                    "factor_milli": str(factor),
                    "qty_milli": str(qty),
                    "unit_price_minor": str(price),
                    "line_total_minor": str(lt),
                },
                line_id,
            )
        )
        lines.append(
            {
                "line_id": line_id,
                "item_id": str(item.id),
                "qty": qty,
                "factor": factor,
                "price": price,
                "lt": lt,
            }
        )
    return members + [{"_lines": lines}], subtotal


def _sale_op(
    ctx: Ctx,
    rnd: random.Random,
    *,
    branch: str,
    user: Any,
    shift_id: str,
    d: date,
    hh: int,
    mm: int,
) -> tuple[dict[str, Any], int, str]:
    """يعيد العملية، ونقد الصندوق منها، ونوع الدفع."""
    sale_id = str(uuid7())
    members, subtotal = _sale_lines(ctx, rnd, sale_id)
    lines = members.pop()["_lines"]
    occurred = _iso(d, hh, mm)
    head: dict[str, Any] = {
        "sale_id": sale_id,
        "invoice_number": ctx.number("INV", branch),
        "branch_id": str(ctx.branches[branch].id),
        "device_id": str(ctx.devices[branch].id),
        "user_id": str(user.id),
        "shift_id": shift_id,
        "subtotal_minor": str(subtotal),
        "total_minor": str(subtotal),
        "business_date": d.isoformat(),
        "occurred_at": occurred,
    }
    total = subtotal
    if subtotal > _m(8000) and rnd.random() < 0.18:
        disc = min(_m(rnd.choice([100, 200, 300, 500])), subtotal)
        head.update(
            discount_mode="amount",
            discount_value=str(disc),
            discount_minor=str(disc),
            discount_reason=rnd.choice(["عميل دائم", "كمية كبيرة", "تقريب المبلغ"]),
        )
        total = subtotal - disc
        head["total_minor"] = str(total)
        ctx.bump("discounts")
    r = rnd.random()
    bank_ref = ""
    credit_customers = [c for c in ctx.customers if c.credit_limit_minor > 0]
    if r < 0.66:
        kind, pays = "cash", [("cash", total)]
    elif r < 0.84:
        kind, pays = "bank", [("bank", total)]
        bank_ref = f"BNK{rnd.randint(10_000_000, 99_999_999)}"
    else:
        mixed = r >= 0.95
        cash = total // 2 // 100 * 100 if mixed else 0
        owed = total - cash
        room = [
            c for c in credit_customers if c.credit_limit_minor - ctx.debt.get(str(c.id), 0) >= owed
        ]
        if room:
            party = rnd.choices(room, weights=[c.credit_limit_minor for c in room])[0]
            head["party_id"] = str(party.id)
            ctx.debt[str(party.id)] = ctx.debt.get(str(party.id), 0) + owed
            if mixed:
                kind, pays = "mixed", [("cash", cash), ("credit", owed)]
            else:
                kind, pays = "credit", [("credit", total)]
        else:  # لا عميل بحدٍّ يسع المبلغ — يُدفع نقداً
            kind, pays = "cash", [("cash", total)]
    ms = [_member("sales.Sale", head, sale_id), *members]
    for method, amount in pays:
        pay = {"payment_id": str(uuid7()), "sale_id": sale_id, "method": method}
        pay["amount_minor"] = str(amount)
        if method == "bank":
            pay["reference"] = bank_ref
        if method == "cash" and kind == "cash":
            received = -(-amount // _m(1000)) * _m(1000)
            pay.update(received_minor=str(received), change_minor=str(received - amount))
        ms.append(_member("sales.Payment", pay))
    for ln in lines:
        ms.append(
            _member(
                "inventory.StockMovement",
                {
                    "movement_id": str(uuid7()),
                    "branch_id": head["branch_id"],
                    "item_id": ln["item_id"],
                    "delta_base_qty_milli": str(-(ln["qty"] * ln["factor"] // 1000)),
                    "reason": "sale",
                    "source_entity": "sales.Sale",
                    "source_id": sale_id,
                    "occurred_at": occurred,
                },
            )
        )
    ctx.sales.append(
        {"sale_id": sale_id, "branch": branch, "lines": lines, "head": head, "kind": kind}
    )
    ctx.bump(f"sales_{kind}")
    cash_in = sum(a for m, a in pays if m == "cash")
    return _op("sale", ms, [shift_id]), cash_in, kind


def _return_op(
    ctx: Ctx, rnd: random.Random, *, branch: str, user: Any, shift_id: str, d: date
) -> dict[str, Any] | None:
    pool = [s for s in ctx.sales[-80:] if s["branch"] == branch and s["kind"] in ("cash", "credit")]
    if not pool:
        return None
    sale = rnd.choice(pool)
    ln = sale["lines"][0]
    qty = ln["qty"] if ln["qty"] <= 1000 else 1000
    lt = line_total_minor(qty, ln["price"])
    damaged = rnd.random() < 0.3
    rid = str(uuid7())
    occurred = _iso(d, 17, rnd.randint(0, 59))
    head = {
        "return_id": rid,
        "return_number": ctx.number("RET", branch),
        "sale_id": sale["sale_id"],
        "branch_id": str(ctx.branches[branch].id),
        "device_id": str(ctx.devices[branch].id),
        "user_id": str(user.id),
        "shift_id": shift_id,
        "condition": "damaged" if damaged else "good",
        "destination": "credit" if sale["kind"] == "credit" else "cash",
        "total_minor": str(lt),
        "business_date": d.isoformat(),
        "occurred_at": occurred,
    }
    if sale["kind"] == "credit":
        head["party_id"] = sale["head"]["party_id"]
        pid = head["party_id"]
        ctx.debt[pid] = ctx.debt.get(pid, 0) - lt
    base = qty * ln["factor"] // 1000
    ms = [
        _member("sales.SaleReturn", head, rid),
        _member(
            "sales.SaleReturnLine",
            {
                "line_id": str(uuid7()),
                "return_id": rid,
                "sale_line_id": ln["line_id"],
                "item_id": ln["item_id"],
                "factor_milli": str(ln["factor"]),
                "qty_milli": str(qty),
                "unit_price_minor": str(ln["price"]),
                "line_total_minor": str(lt),
            },
        ),
    ]
    if damaged:
        ms.append(
            _member(
                "inventory.QuarantineMovement",
                {
                    "movement_id": str(uuid7()),
                    "branch_id": head["branch_id"],
                    "item_id": ln["item_id"],
                    "base_qty_milli": str(base),
                    "reason": "return_damaged",
                    "source_entity": "sales.SaleReturn",
                    "source_id": rid,
                    "occurred_at": occurred,
                },
            )
        )
    else:
        ms.append(
            _member(
                "inventory.StockMovement",
                {
                    "movement_id": str(uuid7()),
                    "branch_id": head["branch_id"],
                    "item_id": ln["item_id"],
                    "delta_base_qty_milli": str(base),
                    "reason": "return",
                    "source_entity": "sales.SaleReturn",
                    "source_id": rid,
                    "occurred_at": occurred,
                },
            )
        )
    ctx.bump("returns")
    return _op("sale_return", ms, [sale["sale_id"], shift_id])


def _receipt_op(
    ctx: Ctx, rnd: random.Random, *, branch: str, user: Any, shift_id: str, d: date
) -> dict[str, Any] | None:
    debtors = sorted(ctx.customers, key=lambda c: -ctx.debt.get(str(c.id), 0))[:3]
    p = rnd.choice(debtors)
    owed = ctx.debt.get(str(p.id), 0)
    if owed < _m(1000):
        return None
    amount = max(_m(1000), int(owed * rnd.uniform(0.4, 0.8)) // _m(1000) * _m(1000))
    ctx.debt[str(p.id)] = owed - amount
    rid = str(uuid7())
    ctx.bump("collections")
    return _op(
        "payment_receipt",
        [
            _member(
                "parties.PaymentReceipt",
                {
                    "receipt_id": rid,
                    "receipt_number": ctx.number("REC", branch),
                    "party_id": str(p.id),
                    "branch_id": str(ctx.branches[branch].id),
                    "device_id": str(ctx.devices[branch].id),
                    "user_id": str(user.id),
                    "shift_id": shift_id,
                    "kind": "receipt",
                    "method": "cash",
                    "amount_minor": str(amount),
                    "reference": "",
                    "reason": "",
                    "business_date": d.isoformat(),
                    "occurred_at": _iso(d, 12, rnd.randint(0, 59)),
                },
                rid,
            )
        ],
        [shift_id],
    )


EXPENSES = [
    ("expense", "أكياس بلاستيك للزبائن", 1500),
    ("expense", "مواصلات توصيل طلب", 2000),
    ("expense", "وجبة العمال", 3000),
    ("expense", "رصيد كهرباء للمولّد", 5000),
    ("withdrawal", "إيداع في البنك", 60_000),
]


def seed_days(ctx: Ctx, start: date, today: date) -> None:
    from core.shift import expected_cash_minor
    from shifts.models import Shift
    from shifts.services import cash_totals

    rnd = random.Random(2026)  # noqa: S311 — بذرة ثابتة لبيانات عرض لا للتشفير
    d = start
    while d <= today:
        for code, cashier_key, base_n in (
            ("KRT", "shop:cashier:KRT", 22),
            ("BHR", "shop:cashier:BHR", 12),
        ):
            user = ctx.users[cashier_key]
            is_today = d == today
            sid = str(uuid7())
            ops = [
                _op(
                    "shift_open",
                    [
                        _member(
                            "shifts.ShiftOpened",
                            {
                                "shift_id": sid,
                                "branch_id": str(ctx.branches[code].id),
                                "device_id": str(ctx.devices[code].id),
                                "user_id": str(user.id),
                                "opening_float_minor": str(_m(20_000)),
                                "business_date": d.isoformat(),
                                "occurred_at": _iso(d, 7, 30),
                            },
                            sid,
                        )
                    ],
                )
            ]
            weekend = d.weekday() in (4,)  # الجمعة أهدأ
            n = base_n + rnd.randint(-4, 8) - (6 if weekend else 0)
            if is_today:
                n = max(3, n // 3)
            minute = 8 * 60
            for _ in range(n):
                minute += rnd.randint(8, 30)
                hh, mm = divmod(min(minute, 21 * 60), 60)
                op, _cash, _k = _sale_op(
                    ctx, rnd, branch=code, user=user, shift_id=sid, d=d, hh=hh, mm=mm
                )
                ops.append(op)
            if rnd.random() < 0.35:
                r = _return_op(ctx, rnd, branch=code, user=user, shift_id=sid, d=d)
                if r:
                    ops.append(r)
            if rnd.random() < 0.8:
                rec = _receipt_op(ctx, rnd, branch=code, user=user, shift_id=sid, d=d)
                if rec:
                    ops.append(rec)
            for kind, reason, amount in rnd.sample(EXPENSES[:4], k=rnd.randint(0, 2)) + (
                [EXPENSES[4]] if code == "KRT" and d.weekday() == 2 else []
            ):
                mid = str(uuid7())
                ops.append(
                    _op(
                        "cash_movement",
                        [
                            _member(
                                "shifts.CashMovement",
                                {
                                    "movement_id": mid,
                                    "shift_id": sid,
                                    "kind": kind,
                                    "signed_amount_minor": str(-_m(amount)),
                                    "reason": reason,
                                    "actor_user_id": str(user.id),
                                    "occurred_at": _iso(d, 14, rnd.randint(0, 59)),
                                },
                                mid,
                            )
                        ],
                        [sid],
                    )
                )
                ctx.bump("cash_movements")
            _push(ctx, code, user, ops)
            ctx.bump("shifts")
            if is_today:
                continue  # وردية اليوم مفتوحة
            with tenant_context(ctx.shop.id):
                exp = expected_cash_minor(cash_totals(Shift.objects.get(id=sid)))
            variance = rnd.choice([0] * 8 + [-_m(500), -_m(200), _m(300)])
            cid = str(uuid7())
            _push(
                ctx,
                code,
                user,
                [
                    _op(
                        "shift_close",
                        [
                            _member(
                                "shifts.ShiftClosed",
                                {
                                    "shift_id": sid,
                                    "expected_cash_at_close_minor": str(exp),
                                    "count_status": "counted",
                                    "expected_source": "server",
                                    "actor_user_id": str(user.id),
                                    "occurred_at": _iso(d, 21, 40),
                                },
                            ),
                            _member(
                                "shifts.CashCounted",
                                {
                                    "count_id": cid,
                                    "shift_id": sid,
                                    "counted_cash_minor": str(exp + variance),
                                    "denominations": [],
                                    "actor_user_id": str(user.id),
                                    "occurred_at": _iso(d, 21, 35),
                                },
                                cid,
                            ),
                        ],
                        [sid],
                    )
                ],
            )
            if variance:
                ctx.bump("shift_variances")
        d += timedelta(days=1)


def fix_received_at(ctx: Ctx) -> None:
    """الاستلام الخادمي = وقت الوقوع (البذرة تُرفع دفعة واحدة؛ لا «متأخرات» مصطنعة)."""
    from parties.models import PaymentReceipt
    from sales.models import Sale, SaleReturn
    from shifts.models import ShiftCashMovement

    with tenant_context(ctx.shop.id):
        for model in (Sale, SaleReturn, PaymentReceipt, ShiftCashMovement):
            model.objects.filter(received_at__gt=F("occurred_at")).update(
                received_at=F("occurred_at")
            )


# ─────────────────────────────── التشغيل ───────────────────────────────


def seed_showcase(log: Any = print) -> dict[str, int]:
    assert_dev()
    wipe_showcase()
    ctx = Ctx()
    today = timezone.localdate()
    start = today - timedelta(days=DAYS)
    steps: list[tuple[str, Callable[[], None]]] = [
        ("المنشآت والحسابات", lambda: seed_org(ctx)),
        ("الاشتراكات", lambda: seed_subscriptions(ctx)),
        ("الأجهزة ورموز PIN", lambda: seed_devices_and_pins(ctx)),
        ("الدعوة ومصفوفة الصلاحيات", lambda: seed_invitation_and_matrix(ctx)),
        ("الفهرس", lambda: seed_catalog(ctx)),
        ("العملاء والموردون", lambda: seed_parties(ctx, start)),
        ("المخزون الافتتاحي", lambda: seed_opening_stock(ctx, start)),
        ("ثلاثون يوماً من الورديات والمبيعات", lambda: seed_days(ctx, start, today)),
        ("تصحيح أوقات الاستلام", lambda: fix_received_at(ctx)),
    ]
    steps += [(n, functools.partial(f, ctx, start, today)) for n, f in EXTRA_STEPS]
    for name, fn in steps:
        log(f"… {name}")
        fn()
    return ctx.stats


#: خطوات تُسجَّل أدناه (المخزون والمشتريات، الحملات، السوق، المنصة)
EXTRA_STEPS: list[tuple[str, Callable[[Ctx, date, date], None]]] = []


# ─────────────────────────────── المخزون والمشتريات ───────────────────────────────


def _item(ctx: Ctx, name: str) -> Any:
    return next(i for i in ctx.items if ctx.item_meta[str(i.id)]["name"] == name)


def _move(
    branch_id: str, item_id: str, delta: int, reason: str, src: str, sid: str, at: str
) -> dict[str, Any]:
    return _member(
        "inventory.StockMovement",
        {
            "movement_id": str(uuid7()),
            "branch_id": branch_id,
            "item_id": item_id,
            "delta_base_qty_milli": str(delta),
            "reason": reason,
            "source_entity": src,
            "source_id": sid,
            "occurred_at": at,
        },
    )


def seed_produce_receipts(ctx: Ctx, start: date, today: date) -> None:
    """استلام مباشر أسبوعي للخضار من السوق المركزي (بتكلفة) — الفرع الرئيسي."""
    keeper = ctx.users["shop:storekeeper"]
    supplier = ctx.suppliers["سوق الخضار المركزي"]
    produce = [i for i in ctx.items if ctx.item_meta[str(i.id)]["kg"]]
    d = start + timedelta(days=3)
    ops = []
    while d < today:
        rid = str(uuid7())
        at = _iso(d, 6, 30)
        bid = str(ctx.branches["KRT"].id)
        ms = [
            _member(
                "inventory.GoodsReceipt",
                {
                    "receipt_id": rid,
                    "receipt_number": ctx.number("RCV", "KRT"),
                    "branch_id": bid,
                    "device_id": str(ctx.devices["KRT"].id),
                    "user_id": str(keeper.id),
                    "supplier_name": supplier.name,
                    "party_id": str(supplier.id),
                    "reference": f"سوق-{d.strftime('%m%d')}",
                    "business_date": d.isoformat(),
                    "occurred_at": at,
                    "note": "استلام الخضار الأسبوعي",
                },
                rid,
            )
        ]
        for it in produce:
            meta = ctx.item_meta[str(it.id)]
            qty = 40_000
            ms.append(
                _member(
                    "inventory.GoodsReceiptLine",
                    {
                        "line_id": str(uuid7()),
                        "receipt_id": rid,
                        "item_id": str(it.id),
                        "item_name": meta["name"],
                        "unit_code": "kg",
                        "factor_milli": "1000",
                        "qty_milli": str(qty),
                        "base_qty_milli": str(qty),
                        "unit_cost_minor": str(meta["cost"]),
                    },
                )
            )
            ms.append(_move(bid, str(it.id), qty, "receive", "inventory.GoodsReceipt", rid, at))
        ops.append(_op("stock_receipt", ms))
        ctx.bump("goods_receipts")
        d += timedelta(days=7)
    _push(ctx, "KRT", keeper, ops)


def seed_transfers(ctx: Ctx, start: date, today: date) -> None:
    """ثلاثة تحويلات من الرئيسي إلى بحري: اثنان مستلَمان (أحدهما بفارق)، وواحد في الطريق."""
    keeper = ctx.users["shop:storekeeper"]
    krt, bhr = ctx.branches["KRT"], ctx.branches["BHR"]
    plans = [
        (today - timedelta(days=21), ["سكر أبيض 1 كغ", "زيت فول 1 لتر", "ماء صحة 1.5 لتر"], 0),
        (today - timedelta(days=9), ["دقيق زادنا 5 كغ", "شاي الغزالين 250 غ", "تونة 185 غ"], 2000),
        (today - timedelta(days=1), ["مكرونة 400 غ", "بسكويت شاي", "صلصة طماطم 400 غ"], None),
    ]
    for d, names, short in plans:
        tid = str(uuid7())
        at = _iso(d, 9, 15)
        lines = []
        ms = [
            _member(
                "inventory.StockTransfer",
                {
                    "transfer_id": tid,
                    "transfer_number": ctx.number("TRF", "KRT"),
                    "branch_from_id": str(krt.id),
                    "branch_to_id": str(bhr.id),
                    "device_id": str(ctx.devices["KRT"].id),
                    "user_id": str(keeper.id),
                    "sent_at": at,
                    "note": "تغذية فرع بحري",
                },
                tid,
            )
        ]
        for name in names:
            it = _item(ctx, name)
            qty = 20_000
            lid = str(uuid7())
            lines.append((lid, it, qty))
            ms.append(
                _member(
                    "inventory.StockTransferLine",
                    {
                        "line_id": lid,
                        "transfer_id": tid,
                        "item_id": str(it.id),
                        "item_name": name,
                        "factor_milli": "1000",
                        "qty_milli": str(qty),
                        "base_qty_milli": str(qty),
                    },
                    lid,
                )
            )
            ms.append(
                _move(
                    str(krt.id),
                    str(it.id),
                    -qty,
                    "transfer_out",
                    "inventory.StockTransfer",
                    tid,
                    at,
                )
            )
        _push(ctx, "KRT", keeper, [_op("stock_transfer", ms)])
        ctx.bump("transfers")
        if short is None:
            continue  # في الطريق
        rid = str(uuid7())
        at2 = _iso(d, 13, 0)
        ms2 = [
            _member(
                "inventory.TransferReceipt",
                {
                    "receipt_id": rid,
                    "receipt_number": ctx.number("TRR", "BHR"),
                    "transfer_id": tid,
                    "branch_id": str(bhr.id),
                    "device_id": str(ctx.devices["BHR"].id),
                    "user_id": str(ctx.users["shop:cashier:BHR"].id),
                    "received_at": at2,
                    **({"reason": "كرتونة تالفة في النقل"} if short else {}),
                },
                rid,
            )
        ]
        for i, (lid, it, qty) in enumerate(lines):
            got = qty - (short if i == 0 else 0)
            ms2.append(
                _member(
                    "inventory.TransferReceiptLine",
                    {
                        "line_id": str(uuid7()),
                        "receipt_id": rid,
                        "transfer_line_id": lid,
                        "item_id": str(it.id),
                        "sent_base_milli": str(qty),
                        "received_base_milli": str(got),
                    },
                )
            )
            ms2.append(
                _move(
                    str(bhr.id),
                    str(it.id),
                    got,
                    "transfer_in",
                    "inventory.TransferReceipt",
                    rid,
                    at2,
                )
            )
        _push(ctx, "BHR", ctx.users["shop:cashier:BHR"], [_op("transfer_receipt", ms2)])


def seed_count_and_damage(ctx: Ctx, start: date, today: date) -> None:
    """جرد جزئي في بحري بفرقين مسوّيين، وهالك وحجر في الرئيسي."""
    from inventory.models import CountSession, DamageRecord, StockAdjustment
    from inventory.services import branch_balances

    bhr = ctx.branches["BHR"]
    keeper = ctx.users["shop:storekeeper"]
    names = ["سكر أبيض 1 كغ", "أرز بسمتي 1 كغ", "زيت فول 1 لتر", "شاي الغزالين 250 غ", "تونة 185 غ"]
    with tenant_context(ctx.shop.id):
        bal = branch_balances(bhr.id)
        system = {n: bal.get(_item(ctx, n).id, 0) for n in names}
    sid = str(uuid7())
    d = today - timedelta(days=4)
    ms = [
        _member(
            "inventory.CountSession",
            {
                "session_id": sid,
                "session_number": ctx.number("CNT", "BHR"),
                "branch_id": str(bhr.id),
                "device_id": str(ctx.devices["BHR"].id),
                "user_id": str(keeper.id),
                "started_at": _iso(d, 6, 0),
                "closed_at": _iso(d, 7, 10),
                "total_items": str(len(names)),
            },
            sid,
        )
    ]
    diffs = {"أرز بسمتي 1 كغ": -2000, "تونة 185 غ": 1000}
    for n in names:
        it = _item(ctx, n)
        ms.append(
            _member(
                "inventory.CountLine",
                {
                    "line_id": str(uuid7()),
                    "session_id": sid,
                    "item_id": str(it.id),
                    "item_name": n,
                    "counted_qty_milli": str(max(0, system[n] + diffs.get(n, 0))),
                    "counted_at": _iso(d, 6, 30),
                    "system_qty_milli": str(system[n]),
                },
            )
        )
    _push(ctx, "BHR", keeper, [_op("count_session", ms)])
    ctx.bump("count_sessions")
    from inventory.services import adjust_session, record_damage

    owner = ctx.users["shop:owner"]
    with tenant_context(ctx.shop.id):
        adjust_session(
            CountSession.objects.get(id=sid),
            reasons={
                str(_item(ctx, "أرز بسمتي 1 كغ").id): "كيسان ممزّقان لم يُسجَّلا هالكاً",
                str(_item(ctx, "تونة 185 غ").id): "علبة من التحويل لم تُحتسب عند الاستلام",
            },
            actor=owner,
        )
        StockAdjustment.objects.update(occurred_at=_dt(d, 7, 30))
        for name, qty, dest, reason in (
            ("زبادي 500 غ", 4000, "write_off", "منتهي الصلاحية"),
            ("بيض كرتونة 30", 1000, "write_off", "كسر أثناء التفريغ"),
            ("عصير مانجو 1 لتر", 3000, "quarantine", "انتفاخ العبوات — يُرتجع للمورد"),
        ):
            record_damage(
                branch=ctx.branches["KRT"],
                item=_item(ctx, name),
                unit_code="",
                unit_name="",
                factor_milli=1000,
                qty_milli=qty,
                destination=dest,
                reason=reason,
                actor=owner,
                is_owner=True,
            )
            ctx.bump("damage_records")
        DamageRecord.objects.update(occurred_at=_dt(today - timedelta(days=2), 10))


def seed_purchasing(ctx: Ctx, start: date, today: date) -> None:
    """أربعة أوامر شراء: اثنان معتمدان بمستنداتهما (ومرتجع مقبول)، واحد مُرسل ينتظر، ومسوّدة."""
    from core.home import viewer_for
    from inventory import purchase_docs as pd
    from inventory import purchasing as po
    from inventory.models import GoodsReceipt, PurchaseDocument, PurchaseOrder, StockMovement

    owner = ctx.users["shop:owner"]
    plans = [
        (
            "شركة الجزيرة للتوزيع",
            "KRT",
            [("سكر أبيض 1 كغ", 20), ("زيت فول 1 لتر", 10), ("أرز بسمتي 1 كغ", 8)],
            "approve",
            22,
            "F-8841",
        ),
        ("مطاحن سيقا — وكيل", "KRT", [("دقيق زادنا 5 كغ", 40)], "approve", 11, "SG-2291"),
        (
            "شركة النيل للمشروبات",
            "KRT",
            [("ماء صحة 1.5 لتر", 30), ("بيبسي 1 لتر", 15)],
            "send",
            2,
            "",
        ),
        (
            "شركة الصافي للمنظفات",
            "BHR",
            [("مسحوق غسيل 1 كغ", 6), ("سائل جلي 750 مل", 5)],
            "draft",
            0,
            "",
        ),
    ]
    first_doc = None
    with tenant_context(ctx.shop.id):
        v = viewer_for(owner, None)
        for sname, code, rows, action, ago, inv in plans:
            raw = []
            for n, qty in rows:
                it = _item(ctx, n)
                carton = ctx.item_meta[str(it.id)]["per_carton"]
                raw.append(
                    {
                        "item_id": str(it.id),
                        "unit_code": "carton" if carton else ctx.item_meta[str(it.id)]["unit"],
                        "qty_milli": str(qty * 1000),
                    }
                )
            o = po.create(
                actor=owner,
                viewer=v,
                branch=ctx.branches[code],
                supplier_id=str(ctx.suppliers[sname].id),
                raw_lines=raw,
                note="",
                confirmed=True,
            )
            ctx.bump("purchase_orders")
            when = _dt(today - timedelta(days=ago), 10)
            if action == "draft":
                continue
            po.send(actor=owner, viewer=v, order=o)
            PurchaseOrder.objects.filter(id=o.id).update(
                created_at=when - timedelta(days=2), sent_at=when - timedelta(days=2)
            )
            if action == "send":
                continue
            doc = pd.draft_from_order(actor=owner, viewer=v, order=o)
            lines = []
            for ln in doc.lines.all():
                meta = ctx.item_meta[str(ln.item_id)]
                per = meta["per_carton"] or 1
                lines.append(
                    {
                        "id": str(ln.id),
                        "received_qty_milli": str(ln.ordered_qty_milli),
                        "unit_price_minor": str(meta["cost"] * per),
                        "excess_reason": "",
                    }
                )
            pd.save_draft(
                actor=owner,
                viewer=v,
                document=doc,
                supplier_invoice_number=inv,
                lines=lines,
                note=None,
            )
            doc = pd.approve(
                actor=owner, viewer=v, document=PurchaseDocument.objects.get(id=doc.id)
            )
            ctx.bump("purchase_documents")
            PurchaseDocument.objects.filter(id=doc.id).update(approved_at=when, created_at=when)
            if doc.receipt_id:
                GoodsReceipt.objects.filter(id=doc.receipt_id).update(
                    business_date=when.date(), occurred_at=when, received_at=when
                )
                StockMovement.objects.filter(source_id=doc.receipt_id).update(occurred_at=when)
            first_doc = first_doc or doc
        if first_doc is not None:
            oil_line = next(
                ln
                for ln in first_doc.lines.all()
                if ctx.item_meta[str(ln.item_id)]["name"] == "زيت فول 1 لتر"
            )
            r = pd.record_return(
                actor=owner,
                viewer=v,
                document=first_doc,
                lines=[
                    {"document_line_id": str(oil_line.id), "qty_milli": "1000", "reason": "تالف"}
                ],
            )
            pd.respond(
                actor=owner,
                viewer=v,
                purchase_return=r,
                note="قبل المندوب الكرتونة واستبدلها في الطلب التالي",
                lines=[{"id": str(x.id), "accepted_qty_milli": "1000"} for x in r.lines.all()],
            )
            ctx.bump("purchase_returns")


EXTRA_STEPS += [
    ("استلام الخضار الأسبوعي", seed_produce_receipts),
    ("التحويلات بين الفرعين", seed_transfers),
    ("الجرد والهالك", seed_count_and_damage),
    ("المشتريات", seed_purchasing),
]


# ─────────────────────────────── الاشتراك والتنبيهات والحملات ───────────────────────────────


def _operator() -> Any:
    from core.models import User

    with platform_context():
        return (
            User.unscoped.filter(is_platform_staff=True, is_active=True)
            .order_by("username")
            .first()
        )


def seed_subscription_proofs(ctx: Ctx, start: date, today: date) -> None:
    """تجديد ربعي معتمد، إضافة مستخدمَين معتمدة، إثبات مرفوض بسبب، وإضافة جهاز معلّقة للمراجعة."""
    from core.subscription import submit_proof
    from stingops import review as rv

    owner = ctx.users["shop:owner"]
    ops = _operator()
    with tenant_context(ctx.shop.id):
        renew = submit_proof(
            actor=owner,
            reference="BNK-7710251",
            plan_code="dual",
            cycle="quarterly",
            kind="renewal",
            note="تحويل من بنكك — الربع الأخير",
        )
        wrong = submit_proof(
            actor=owner, reference="BNK-7710199", plan_code="dual", kind="renewal", note="تحويل أول"
        )
    ctx.bump("subscription_proofs", 2)
    if ops is None:
        return
    rv.review(
        viewer=ops,
        tenant_id=ctx.shop.id,
        proof_id=wrong.id,
        approve=False,
        reason="المبلغ المحوَّل أقل من سعر الباقة — أعد الرفع بالتحويل الكامل",
    )
    rv.review(viewer=ops, tenant_id=ctx.shop.id, proof_id=renew.id, approve=True, reason="")
    with tenant_context(ctx.shop.id):
        addon = submit_proof(
            actor=owner,
            reference="BNK-7710342",
            plan_code="dual",
            kind="addon",
            addon_kind="users",
            addon_qty=2,
        )
    rv.review(viewer=ops, tenant_id=ctx.shop.id, proof_id=addon.id, approve=True, reason="")
    with tenant_context(ctx.shop.id):
        submit_proof(
            actor=owner,
            reference="BNK-7710388",
            plan_code="dual",
            kind="addon",
            addon_kind="devices",
            addon_qty=1,
            note="جهاز ثالث لفرع بحري",
        )
    ctx.bump("subscription_proofs", 2)


def seed_campaigns(ctx: Ctx, start: date, today: date) -> None:
    """مشتركو القناة، وأربع حملات: مُرسلة بنتائجها، مجدولة، بانتظار الاعتماد، ومسوّدة."""
    from core import campaigns, notifications, portal
    from core.home import viewer_for
    from core.models import Campaign

    owner = ctx.users["shop:owner"]
    with tenant_context(ctx.shop.id):
        portal.ensure_channel()
        for c in ctx.customers[:9]:
            portal.subscribe(phone=c.phone)
            ctx.bump("portal_subscribers")
        v = viewer_for(owner, None)
        shop = campaigns.shop_name()
        sent = campaigns.save(
            actor=owner,
            viewer=v,
            campaign=None,
            name="عروض أول الشهر",
            message=f"{shop}: خصم على السكر والزيت والأرز حتى نهاية الأسبوع. نسعد بزيارتكم.",
            rules={"segments": ["subscribed"]},
        )
        campaigns.approve(
            actor=owner,
            viewer=v,
            campaign=sent,
            scheduled_at=None,
            night_confirmed=False,
            send_now=True,
        )
        later = campaigns.save(
            actor=owner,
            viewer=v,
            campaign=None,
            name="وصول الخضار الطازجة",
            message=f"{shop}: وصلت الخضار الطازجة صباح الخميس — طماطم وبصل وبطاطس بأسعار السوق.",
            rules={"segments": ["subscribed", "bought_90d"]},
        )
        when = timezone.make_aware(
            datetime.combine(today + timedelta(days=2), datetime.min.time())
        ) + timedelta(hours=10)
        campaigns.approve(
            actor=owner,
            viewer=v,
            campaign=later,
            scheduled_at=when,
            night_confirmed=False,
            send_now=False,
        )
        pending = campaigns.save(
            actor=owner,
            viewer=v,
            campaign=None,
            name="تذكير بالحساب الآجل",
            message=f"{shop}: نذكّركم بتسديد الحساب قبل نهاية الشهر. شكراً لثقتكم.",
            rules={"segments": ["with_debt"]},
        )
        Campaign.objects.filter(id=pending.id).update(status=Campaign.Status.PENDING_APPROVAL)
        campaigns.save(
            actor=owner,
            viewer=v,
            campaign=None,
            name="رمضان كريم",
            message=f"{shop}: سلة رمضان جاهزة — اطلبها مبكراً.",
            rules={"segments": ["bought_90d"]},
        )
        ctx.bump("campaigns", 4)
        notifications.refresh()
        notifications.emit(
            kind="showcase_welcome",
            category="account",
            title="تم تجديد اشتراكك ربعياً",
            body="باقة «فرعان» سارية لثلاثة أشهر — الإيصال في شاشة الاشتراك.",
            href="/org/subscription",
            owner_only=True,
            dedupe_key="showcase:renewed",
        )
        notifications.emit(
            kind="showcase_stock",
            category="operational",
            title="حليب بودرة نيدو يوشك أن ينفد",
            body="الرصيد 6 في كل فرع — أمر شراء من شركة الجزيرة للتوزيع؟",
            href="/inventory",
            needs_action=True,
            dedupe_key="showcase:nido-low",
        )


EXTRA_STEPS += [
    ("إثباتات الاشتراك", seed_subscription_proofs),
    ("الحملات والتنبيهات", seed_campaigns),
]


# ─────────────────────────────── السوق ───────────────────────────────

#: صورة 1×1 شفافة — مستند السجل التجاري التجريبي
_DOC = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8"
    "AAAAASUVORK5CYII="
)


def _enable_market_flags() -> None:
    """أعلام الإطلاق كما في `apply_launch_flags`: الربط (M3) مفتوح، والنموّ (M4) مفتوح للعرض."""
    from stingops.models import OpsFlag

    with platform_context():
        for key in ("market_m3", "market_m4"):
            OpsFlag.objects.update_or_create(
                key=key,
                scope_kind="env",
                scope=os.environ.get("STING_ENV", ""),
                defaults={"enabled": True, "changed_by_name": "محتوى العرض"},
            )


def seed_market(ctx: Ctx, start: date, today: date) -> None:
    from core.home import viewer_for
    from market import follows, offers, order_flow, orders, price_lists, services, settlement
    from market.models import MarketOffer
    from stingops import ops as ops_mod

    _enable_market_flags()
    d_owner, s_owner = ctx.users["dist:owner"], ctx.users["shop:owner"]
    op = _operator()
    # ١) الموزّع: قائمة التحقق ثم الطلب ثم قرار المشرف، والملف المنشور
    with tenant_context(ctx.dist.id):
        v = viewer_for(d_owner, None)
        services.save_verification(
            actor=d_owner,
            viewer=v,
            business_address="المنطقة الصناعية — بحري، مربع 7",
            service_area_note="الخرطوم وبحري وأم درمان — توصيل خلال 24 ساعة",
            accept_terms=True,
            registry_doc={"data_url": _DOC, "name": "سجل-تجاري.png"},
        )
        services.submit_verification(actor=d_owner, viewer=v)
    if op is not None:
        ops_mod.decide_verification(
            viewer=op, tenant_id=ctx.dist.id, decision="verified", reasons=None
        )
    offer_ids: list[Any] = []
    with tenant_context(ctx.dist.id):
        v = viewer_for(d_owner, None)
        services.save_profile(
            actor=d_owner,
            viewer=v,
            publish=True,
            data={
                "public_name": "شركة الجزيرة للتوزيع",
                "category_line": "جملة المواد الغذائية والمنظفات",
                "categories": ["بقالة", "مشروبات", "معلبات", "منظفات", "ألبان"],
                "service_areas": ["الخرطوم", "بحري", "أم درمان"],
                "fulfilment": ["توصيل للمحل", "استلام من المخزن"],
            },
        )
        for i, (name, unit, pack, price, min_qty) in enumerate(OFFERS):
            o = offers.save(
                actor=d_owner,
                viewer=v,
                offer=None,
                data={
                    "public_name": name,
                    "unit_code": unit,
                    "unit_name": "كرتونة",
                    "pack_label": pack,
                    "price_minor": str(_m(price)),
                    "min_order_qty": str(min_qty),
                    "delivery_fee_minor": "0" if i % 3 else str(_m(1500)),
                    "audience": "public",
                    "valid_until": (today + timedelta(days=7 + i % 5)).isoformat(),
                },
            )
            offers.publish(actor=d_owner, viewer=v, offer=o)
            offer_ids.append(o.id)
            ctx.bump("market_offers")
        # عرض منتهي (يحتاج تجديد تأكيد) وقائمة أسعار خاصة للواحة
        MarketOffer.objects.filter(id=offer_ids[-1]).update(valid_until=today - timedelta(days=2))
        pl = price_lists.save_list(
            actor=d_owner,
            viewer=v,
            price_list=None,
            offer_id=str(offer_ids[1]),
            name="عملاء الجملة المميّزون",
            tiers=[
                {"min": "3", "max": "9", "price_minor": str(_m(55_000))},
                {"min": "10", "max": "", "price_minor": str(_m(53_500))},
            ],
        )
        price_lists.invite_member(
            actor=d_owner, viewer=v, price_list=pl, buyer_tenant_id=str(ctx.shop.id)
        )
    price_lists.accept_invite(buyer_tenant_id=ctx.shop.id, list_id=pl.id)
    # ٢) الواحة: حساب مشترٍ، متابعة، وطلبات بكل المراحل
    with tenant_context(ctx.shop.id):
        services.ensure_account()
        vs = viewer_for(s_owner, None)
        follows.follow(actor=s_owner, viewer=vs, supplier_tenant_id=ctx.dist.id)
    with tenant_context(ctx.dist.id):
        prices = {o.id: o.price_minor for o in MarketOffer.objects.filter(id__in=offer_ids)}

    def order(lines: list[tuple[int, int]]) -> Any:
        with tenant_context(ctx.shop.id):
            vs = viewer_for(s_owner, None)
            o, _ = orders.submit(
                actor=s_owner,
                viewer=vs,
                body={
                    "op_id": str(uuid7()),
                    "supplier_tenant_id": str(ctx.dist.id),
                    "kind": "order",
                    "lines": [
                        {
                            "offer_id": str(offer_ids[i]),
                            "qty": q,
                            "price_minor": str(prices[offer_ids[i]]),
                        }
                        for i, q in lines
                    ],
                },
            )
        ctx.bump("market_orders")
        return o

    def quote(o: Any, lines: list[tuple[int, int]]) -> Any:
        with tenant_context(ctx.dist.id):
            return order_flow.save_quote(
                actor=d_owner,
                viewer=viewer_for(d_owner, None),
                order_id=o.id,
                send=True,
                body={
                    "lines": [
                        {
                            "offer_id": str(offer_ids[i]),
                            "qty_confirmed": q,
                            "price_minor": str(prices[offer_ids[i]]),
                        }
                        for i, q in lines
                    ],
                    "valid_until": (today + timedelta(days=3)).isoformat(),
                },
            )

    def accept(o: Any, ver: Any) -> None:
        with tenant_context(ctx.shop.id):
            order_flow.accept_version(actor=s_owner, order_id=o.id, number=ver.number)

    def ship(o: Any, lines: list[tuple[int, int]]) -> Any:
        with tenant_context(ctx.dist.id):
            return order_flow.ship(
                actor=d_owner,
                viewer=viewer_for(d_owner, None),
                order_id=o.id,
                body={"lines": [{"offer_id": str(offer_ids[i]), "qty": q} for i, q in lines]},
            )

    def receive(o: Any, sh: Any, lines: list[tuple[int, int]], dispute: bool) -> None:
        with tenant_context(ctx.shop.id):
            order_flow.receive(
                actor=s_owner,
                viewer=viewer_for(s_owner, None),
                order_id=o.id,
                body={
                    "shipment_id": str(sh.id),
                    "lines": [{"offer_id": str(offer_ids[i]), "qty_received": q} for i, q in lines],
                    "open_dispute": dispute,
                },
            )

    # أ) مكتمل: مستلم كاملاً ومدفوع
    full = [(0, 10), (4, 6), (6, 5)]
    o1 = order(full)
    accept(o1, quote(o1, full))
    sh = ship(o1, full)
    receive(o1, sh, full, False)
    with tenant_context(ctx.shop.id):
        total = sum(prices[offer_ids[i]] * q for i, q in full)
        settlement.record_payment(
            actor=s_owner,
            order_id=o1.id,
            body={"amount_minor": str(total), "transfer_ref": "BNK-8820114"},
        )
    # ب) مستلم بفارق → خلاف مفتوح
    part = [(2, 5), (9, 3)]
    o2 = order(part)
    accept(o2, quote(o2, part))
    sh = ship(o2, part)
    receive(o2, sh, [(2, 4), (9, 3)], True)
    ctx.bump("market_disputes")
    # ج) مقبول ومشحون ينتظر الاستلام
    o3 = order([(3, 2), (7, 20)])
    accept(o3, quote(o3, [(3, 2), (7, 20)]))
    ship(o3, [(3, 2), (7, 20)])
    # د) مسعَّر بكمية أقل ينتظر قبول الواحة
    o4 = order([(5, 2), (10, 1)])
    quote(o4, [(5, 1), (10, 1)])
    # هـ) مُرسل ينتظر تسعير المورد
    order([(8, 10), (0, 6)])
    # و) مرفوض من المورد بسبب
    o6 = order([(1, 3)])
    with tenant_context(ctx.dist.id):
        order_flow.decline(
            actor=d_owner,
            viewer=viewer_for(d_owner, None),
            order_id=o6.id,
            reason="نفد المخزون حتى الأسبوع القادم",
        )


EXTRA_STEPS += [("السوق: الموزّع والعروض والطلبات", seed_market)]


# ─────────────────────────────── الربط (M3) والنموّ (M4) والمنصة ───────────────────────────────


def seed_links_and_platform(ctx: Ctx, start: date, today: date) -> None:
    from core.home import viewer_for
    from market import link, link_docs, links, promotion
    from market.models import MarketOffer, MarketOrder, MarketShipment
    from stingops import demo
    from stingops.models import DemoRequest, PlatformAnnouncement

    s_owner, d_owner = ctx.users["shop:owner"], ctx.users["dist:owner"]
    supplier_party = ctx.suppliers["شركة الجزيرة للتوزيع"]
    # ١) ربط المورد في دفتر الواحة بمنشأته في السوق، ثم قبوله
    with tenant_context(ctx.shop.id):
        lk = link.request_link(
            actor=s_owner,
            viewer=viewer_for(s_owner, None),
            party_id=supplier_party.id,
            body={"counterparty_tenant_id": str(ctx.dist.id)},
        )
    with tenant_context(ctx.dist.id):
        link.decide_incoming(
            actor=d_owner, viewer=viewer_for(d_owner, None), link_id=lk.id, accept=True
        )
        offers = {o.public_name: o for o in MarketOffer.objects.all()}
    ctx.bump("market_links")
    # ٢) مطابقة أصناف المورد بأصناف الواحة (كرتونة المورد = N من وحدتي)
    with tenant_context(ctx.shop.id):
        v = viewer_for(s_owner, None)
        for offer_name, my_name in (
            ("سكر أبيض", "سكر أبيض 1 كغ"),
            ("مكرونة", "مكرونة 400 غ"),
            ("ماء صحة", "ماء صحة 1.5 لتر"),
            ("أرز بسمتي", "أرز بسمتي 1 كغ"),
            ("صلصة طماطم", "صلصة طماطم 400 غ"),
        ):
            it = _item(ctx, my_name)
            per = ctx.item_meta[str(it.id)]["per_carton"]
            link.save_mapping(
                actor=s_owner,
                viewer=v,
                body={
                    "counterparty_tenant_id": str(ctx.dist.id),
                    "item_id": str(it.id),
                    "offer_id": str(offers[offer_name].id),
                    "unit_code": "piece",
                    "factor_milli": str(per * 1000),
                },
            )
            ctx.bump("item_mappings")
        # ٣) تحويل الطلب المستلَم كاملاً إلى مستند شراء معتمد
        done = MarketOrder.objects.filter(status="received").order_by("created_at").first()
        if done is not None:
            sh = MarketShipment.objects.filter(order=done).first()
            if sh is not None:
                link_docs.convert(actor=s_owner, viewer=v, shipment_id=sh.id, body={})
                ctx.bump("market_documents")
    # ٤) النموّ (M4): طلب عرض ممول من الموزّع، وبلاغ من الواحة للمشرف
    with tenant_context(ctx.dist.id):
        promotion.save_request(
            actor=d_owner,
            viewer=viewer_for(d_owner, None),
            body={
                "offer_id": str(offers["زيت فول"].id),
                "audience": "all",
                "duration_days": "7",
                "action": "request",
            },
        )
        ctx.bump("promotion_requests")
    with tenant_context(ctx.shop.id):
        links.report(
            actor=s_owner,
            offer_id=offers["بيبسي"].id,
            reason="misleading",
            note="الصورة لعبوة 1.5 لتر والوصف 1 لتر — نرجو التوضيح",
        )
        ctx.bump("market_reports")
    # ٥) المنصة: طلبات جولة بحالاتها وإعلانان (إن لم تكن موجودة)
    op = _operator()
    by = op.display_name if op is not None else "المشغّل"
    with platform_context():
        seeds = [
            ("سامي الطيب", "0912900301", "whatsapp", "بقالة بفرع واحد في الصحافة — نريد تجربة"),
            ("منى إبراهيم", "0912900302", "call", "صيدلية وسوبرماركت — نحتاج الجرد والانتهاء"),
            ("شركة النور التجارية", "0912900303", "email", "أربعة فروع في بورتسودان وكسلا"),
            ("عادل حمد", "0912900304", "whatsapp", ""),
        ]
        created = []
        for name, wa, ch, msg in seeds:
            if DemoRequest.objects.filter(name=name).exists():
                continue
            created.append(
                DemoRequest.objects.create(
                    name=name,
                    whatsapp=wa,
                    email="info@alnoor.example" if ch == "email" else "",
                    channel=ch,
                    message=msg,
                    source_path="/about",
                )
            )
    for r, (status, note) in zip(
        created[1:],
        [
            ("contacted", "اتصلنا — الجولة يوم الأحد"),
            ("contacted", ""),
            ("closed", "رقم غير صحيح بعد محاولتين"),
        ],
        strict=False,
    ):
        demo.update(r.id, status=status, note=note, by_name=by)
    if len(created) > 2:
        demo.update(
            created[2].id, status="converted", note="سجّلوا منشأة على باقة «فرعان»", by_name=by
        )
    ctx.bump("demo_requests", len(created))
    with platform_context():
        if not PlatformAnnouncement.objects.filter(title="صيانة مجدولة للمزامنة").exists():
            now = timezone.now()
            PlatformAnnouncement.objects.create(
                kind=PlatformAnnouncement.Kind.MAINTENANCE,
                title="صيانة مجدولة للمزامنة",
                body=(
                    "نوقف رفع العمليات 30 دقيقة لترقية قاعدة البيانات؛ البيع المحلي مستمر "
                    "والمعلّق يُرفع بعدها."
                ),
                audience=PlatformAnnouncement.Audience.ALL,
                starts_at=now + timedelta(days=3, hours=2),
                ends_at=now + timedelta(days=3, hours=2, minutes=30),
                status=PlatformAnnouncement.Status.SCHEDULED,
                scheduled_at=now,
                created_by_name=by,
            )
            ctx.bump("announcements")


EXTRA_STEPS += [("الربط والنموّ والمنصة", seed_links_and_platform)]
