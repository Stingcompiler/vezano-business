"""بيئة التطوير: محتوى تجريبي لمساحة المشغّل (بأمر المالك 2026-09-22) — يُثري المستأجرين الموسومين
«تجريبي» فقط (لا يمسّ منشأة المالك الحقيقية): اشتراكات بحالات مختلفة، إثباتات معلّقة، أحداث اشتراك،
طلبات جولة بحالاتها، إعلانات، سعر مقبل مجدول، ومشغّل ثانٍ. قابل لإعادة التشغيل (idempotent).

    manage.py seed_platform_demo
"""

from __future__ import annotations

import os
from datetime import timedelta
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models import PlanCatalog, SubscriptionProof, Tenant, TenantSubscription, User
from core.scenario.seed import SCENARIO_TAG
from core.subscription import PLANS, ensure_subscription
from core.tenancy import platform_context, tenant_context
from stingops import subscriptions as sub_ops
from stingops.models import DemoRequest, OperatorProfile, PlatformAnnouncement


class Command(BaseCommand):
    help = "محتوى تجريبي لمساحة المشغّل (تطوير فقط)"

    def handle(self, *args: Any, **opts: Any) -> None:
        if os.environ.get("STING_ENV", "development") not in {"development", "test", "ci"}:
            raise CommandError("للتطوير فقط — STING_ENV غير تطويري")
        now = timezone.now()
        with platform_context():
            demo = list(Tenant.unscoped.filter(name__contains=SCENARIO_TAG).order_by("name"))
            ops = User.unscoped.filter(is_platform_staff=True).order_by("username").first()
        if ops is None:
            raise CommandError("لا مشغّل — شغّل seed_operator أولاً")
        by = ops.display_name
        if len(demo) < 3:
            raise CommandError("شغّل `manage.py scenario reset` أولاً (3 منشآت تجريبية)")
        a, b, c = demo[0], demo[1], demo[2]

        # 1) اشتراكات بحالات مختلفة
        def set_sub(t: Tenant, code: str, days: int, state: str) -> None:
            with tenant_context(t.id):
                s = ensure_subscription()
                s.plan_code = code
                s.state = state
                s.expires_at = now + timedelta(days=days)
                s.renewal_amount_minor = PLANS[code].price_minor if code in PLANS else 0
                s.suspended_at = None
                s.suspended_reason = ""
                s.save()

        set_sub(a, "dual", 22, TenantSubscription.State.ACTIVE)  # نشط
        set_sub(b, "single", 9, TenantSubscription.State.ACTIVE)  # ينتهي خلال 14 يوماً
        set_sub(c, "single", -10, TenantSubscription.State.EXPIRED)  # متأخر السداد

        # 2) إثباتات معلّقة (b: مبلغ صحيح، c: مبلغ ناقص للمراجعة)
        for t, ref, amount, cycle in (
            (b, "TRX-88102", PLANS["single"].price_minor, "monthly"),
            (c, "TRX-88117", PLANS["single"].price_minor - 500_000, "monthly"),
        ):
            with tenant_context(t.id):
                if not SubscriptionProof.objects.filter(reference=ref).exists():
                    SubscriptionProof.objects.create(
                        tenant_id=t.id,
                        reference=ref,
                        plan_code="single",
                        amount_minor=amount,
                        period_label="أكتوبر",
                        cycle=cycle,
                        note="تحويل من تطبيق بنكك",
                        submitted_by_name="مالك المتجر",
                    )

        # 3) أحداث اشتراك (خط زمني) على a: تمديد وملاحظة
        with platform_context():
            from stingops.models import SubscriptionEvent

            if not SubscriptionEvent.objects.filter(tenant=a).exists():
                sub_ops.extend(a, days=7, reason="تعويض انقطاع المزامنة في سبتمبر", by_name=by)
                sub_ops.note(a, text="المالك سأل عن باقة السلاسل — يُتابَع في أكتوبر", by_name=by)

        # 4) طلبات جولة بحالاتها
        seeds = [
            ("أحمد الطيب", "0912345678", "whatsapp", "متجر مواد غذائية بفرعين في أم درمان", "new"),
            ("سلمى عثمان", "0998765432", "call", "صيدلية — نحتاج المخزون والانتهاء", "contacted"),
            ("مجدي حسن", "0123456789", "email", "سلسلة 4 فروع في بورتسودان", "converted"),
            ("نادية خالد", "0911223344", "whatsapp", "", "closed"),
        ]
        with platform_context():
            for name, wa, ch, msg, st in seeds:
                if DemoRequest.objects.filter(name=name, whatsapp=wa).exists():
                    continue
                DemoRequest.objects.create(
                    name=name,
                    whatsapp=wa,
                    email="majdi@example.com" if ch == "email" else "",
                    channel=ch,
                    message=msg,
                    source_path="127.0.0.1",
                    status=st,
                    note=(
                        {
                            "contacted": "اتصلنا — موعد الجولة الخميس",
                            "converted": "سجّل منشأة «سلسلة النور» على باقة فرعين",
                            "closed": "رقم غير صحيح بعد محاولتين",
                        }.get(st, "")
                    ),
                    handled_at=now if st != "new" else None,
                    handled_by_name=by if st != "new" else "",
                )
            # 5) إعلانات: صيانة مجدولة + إعلان
            if not PlatformAnnouncement.objects.exists():
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
                    audience_count=4,
                    created_by_name=by,
                )
                PlatformAnnouncement.objects.create(
                    kind=PlatformAnnouncement.Kind.NOTICE,
                    title="الدورة السنوية متاحة الآن",
                    body=(
                        "اشترك سنوياً بسعر 10 أشهر — من شاشة الاشتراك ← رفع إثبات التحويل ← "
                        "اختر «سنوي»."
                    ),
                    audience=PlatformAnnouncement.Audience.ALL,
                    starts_at=now,
                    ends_at=now + timedelta(days=30),
                    status=PlatformAnnouncement.Status.DRAFT,
                    created_by_name=by,
                )
            # 6) سعر مقبل مجدول على «فرع واحد» بعد 45 يوماً
            single = PlanCatalog.objects.get(code="single")
            if single.next_price_effective_at is None:
                single.next_price_monthly_minor = 5_000_000
                single.next_price_effective_at = now + timedelta(days=45)
                single.save(update_fields=["next_price_monthly_minor", "next_price_effective_at"])
                PLANS.refresh()
            # 7) مشغّل ثانٍ للدعم
            if not User.unscoped.filter(username="ops-support", is_platform_staff=True).exists():
                from core.auth.accounts import create_account

                acc = create_account("support@vezano.local", "support-dev-2026", "طيب — دعم")
                u = User.unscoped.create(
                    tenant=None,
                    username="ops-support",
                    display_name="طيب — دعم",
                    is_platform_staff=True,
                    account=acc,
                )
                from core.auth import totp

                OperatorProfile.objects.create(user=u, totp_secret=totp.new_secret())
        self.stdout.write(
            "بُذر: 3 اشتراكات (نشط/ينتهي خلال 9 أيام/متأخر)، إثباتان معلّقان، خط زمني على "
            f"{a.name}، 4 طلبات جولة، إعلانان، سعر مقبل على «فرع واحد»، مشغّل support@vezano.local"
        )
