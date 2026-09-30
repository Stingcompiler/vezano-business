"""مقاييس التجربة الميدانية (`docs/field-trial.md`؛ 0005 §١٣٩) — من السجلّ مباشرة لا من الذاكرة.

أسبوعاً أسبوعاً لمنشآت بعينها:
- **بيع ضاع أو تكرّر بعد انقطاع**: عمليات بيع في الحجر + فواتير عُكست لأنها مكرّرة. الهدف صفر.
- **أطول انقطاع عمل خلاله المتجر**: أكبر فارق بين وقت البيع على الجهاز ووصوله إلى الخادم.
- **فروق الوردية بلا تسوية**: ورديات مغلقة بفارق لم يُعتمد له سبب (SHIFT-05).
- **سطور تسوية الجرد**: كل فرق جرد مسجَّل بسببه (INV-06) — للمقارنة أسبوعاً بأسبوع.
- **بلاغات الدعم**: عددها؛ تصنيفها (خطأ/فهم/ميزة ناقصة) يدوي من المشغّل.
- **رمز التحقق من أول محاولة**: رموز استُعملت بإرسال واحد بلا فشل ÷ كل الرموز (على مستوى المنصة).

زمن إصدار الفاتورة عند الكاشير لا يُقاس من السجلّ — يُلاحَظ مباشرة (الجدول يقول ذلك).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

from django.utils import timezone

from core.models import Tenant, VerificationCode
from core.tenancy import platform_context
from inventory.models import StockAdjustmentLine
from sales.models import Sale, SaleReversal
from shifts.models import Shift
from shifts.services import _variance
from sync.models import QuarantinedOperation, SupportReport

SALE_KINDS = {"sale"}


@dataclass(frozen=True)
class Week:
    start: date  # يوم البداية (شامل)
    end: date  # يوم النهاية (شامل)

    @property
    def bounds(self) -> tuple[datetime, datetime]:
        tz = timezone.get_current_timezone()
        return (
            datetime.combine(self.start, time.min, tzinfo=tz),
            datetime.combine(self.end + timedelta(days=1), time.min, tzinfo=tz),
        )


def weeks_ending(end: date, count: int) -> list[Week]:
    """`count` أسبوعاً متتالياً آخرها ينتهي في `end` — الأقدم أولاً."""
    out = []
    for i in range(count):
        last = end - timedelta(days=7 * i)
        out.append(Week(start=last - timedelta(days=6), end=last))
    return list(reversed(out))


def _hours(seconds: float) -> str:
    if seconds < 60:
        return "أقل من دقيقة"
    minutes = round(seconds / 60)
    if minutes < 60:
        return f"{minutes} دقيقة"
    return f"{seconds / 3600:.1f} ساعة"


def week_metrics(tenant_ids: list[uuid.UUID], week: Week) -> dict[str, Any]:
    lo, hi = week.bounds
    with platform_context():
        quarantined_sales = sum(
            1
            for q in QuarantinedOperation.unscoped.filter(
                tenant_id__in=tenant_ids, received_at__gte=lo, received_at__lt=hi
            ).only("original")
            if str((q.original or {}).get("kind", "")) in SALE_KINDS
        )
        duplicates = SaleReversal.unscoped.filter(
            tenant_id__in=tenant_ids, kind="duplicate", occurred_at__gte=lo, occurred_at__lt=hi
        ).count()
        sales = list(
            Sale.unscoped.filter(
                tenant_id__in=tenant_ids, occurred_at__gte=lo, occurred_at__lt=hi
            ).values_list("occurred_at", "received_at")
        )
        longest = max(((r - o).total_seconds() for o, r in sales if o and r and r > o), default=0.0)
        closed = list(
            Shift.unscoped.filter(
                tenant_id__in=tenant_ids, state="closed", closed_at__gte=lo, closed_at__lt=hi
            ).prefetch_related("adjustments")
        )
        unexplained = [
            s for s in closed if (_variance(s) or 0) != 0 and not list(s.adjustments.all())
        ]
        stock_lines = StockAdjustmentLine.unscoped.filter(
            tenant_id__in=tenant_ids,
            adjustment__occurred_at__gte=lo,
            adjustment__occurred_at__lt=hi,
        ).count()
        support = SupportReport.unscoped.filter(
            tenant_id__in=tenant_ids, created_at__gte=lo, created_at__lt=hi
        ).count()
        codes = list(
            VerificationCode.unscoped.filter(created_at__gte=lo, created_at__lt=hi).values_list(
                "sends", "send_failures", "consumed_at"
            )
        )
    first_try = sum(1 for sends, fails, used in codes if sends == 1 and fails == 0 and used)
    return {
        "week": week,
        "sales": len(sales),
        "lost_or_duplicated": quarantined_sales + duplicates,
        "quarantined_sales": quarantined_sales,
        "duplicates": duplicates,
        "longest_offline_seconds": longest,
        "shifts_closed": len(closed),
        "unexplained_shift_variances": len(unexplained),
        "unexplained_shift_variance_minor": sum(_variance(s) or 0 for s in unexplained),
        "stock_adjustment_lines": stock_lines,
        "support_reports": support,
        "codes": len(codes),
        "codes_first_try": first_try,
    }


def report_markdown(tenant_ids: list[uuid.UUID], *, end: date, weeks: int = 4) -> str:
    with platform_context():
        names = list(
            Tenant.unscoped.filter(id__in=tenant_ids)
            .order_by("name")
            .values_list("name", flat=True)
        )
    rows = [week_metrics(tenant_ids, w) for w in weeks_ending(end, weeks)]
    lines = [
        "| الأسبوع | فواتير | ضاع/تكرّر (الهدف 0) | أطول انقطاع | ورديات بفارق بلا تسوية "
        "| سطور تسوية جرد | بلاغات دعم | رمز التحقق من أول محاولة (الهدف ≥ 95٪) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        w: Week = r["week"]
        codes = r["codes"]
        otp = f"{round(100 * r['codes_first_try'] / codes)}٪ من {codes}" if codes else "لا رموز"
        lines.append(
            f"| {w.start:%Y-%m-%d} → {w.end:%Y-%m-%d} | {r['sales']} | "
            f"{r['lost_or_duplicated']} (حجر {r['quarantined_sales']} · مكرّر {r['duplicates']}) | "
            f"{_hours(r['longest_offline_seconds'])} | "
            f"{r['unexplained_shift_variances']} من {r['shifts_closed']} | "
            f"{r['stock_adjustment_lines']} | {r['support_reports']} | {otp} |"
        )
    head = [
        f"المنشآت: {'، '.join(names) or '—'}",
        "",
        "زمن إصدار الفاتورة عند الكاشير لا يُقاس من السجلّ — يُلاحَظ مباشرة في اليوم الأول والأخير.",
        "تصنيف بلاغات الدعم (خطأ/فهم/ميزة ناقصة) يدوي من المشغّل.",
        "",
    ]
    return "\n".join(head + lines) + "\n"
