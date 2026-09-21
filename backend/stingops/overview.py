"""PLT-00 — لوحة النظرة العامة للمشغّل (بأمر المالك 2026-09-21؛ 0005 §١٠٢).

عدّادات ما ينتظر فعلاً، بروابط شاشاتها: الاستحقاق (نشط/ينتهي خلال 14/متأخر/موقوف/تجريبي)، والطوابير
(إثباتات دفع، تحققات، بلاغات، خلافات، طلبات جولة)، وصحة المزامنة. أرقام من السجل لا من تخمين، وكل
رقم بختم وقته. لا مبيعات ولا أسماء زبائن (ACC-60).
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone

from core.models import SubscriptionProof, Tenant
from core.tenancy import platform_context
from stingops import health as health_svc
from stingops import moderation, ops
from stingops.models import DemoRequest
from stingops.services import DUE_SOON_DAYS, tenant_row


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def overview_payload() -> dict[str, Any]:
    now = timezone.now()
    with platform_context():
        rows = [tenant_row(t, now) for t in Tenant.unscoped.all()]
        proofs_pending = SubscriptionProof.unscoped.filter(
            status=SubscriptionProof.Status.PENDING
        ).count()
        demo_open = DemoRequest.objects.filter(
            status__in=[DemoRequest.Status.NEW, DemoRequest.Status.CONTACTED]
        ).count()
        demo_new = DemoRequest.objects.filter(status=DemoRequest.Status.NEW).count()
    by = {
        k: sum(1 for r in rows if r["status"] == k)
        for k in ("active", "trial", "expired", "suspended")
    }
    due14 = sum(
        1 for r in rows if r["days_left"] is not None and 0 <= r["days_left"] <= DUE_SOON_DAYS
    )
    sync_stuck = sum(1 for r in rows if r["sync_stuck"])
    verifications = ops.verifications_payload()
    ver_pending = sum(
        1 for r in verifications["requests"] if r["status"] in {"pending", "needs_more"}
    )
    reports = moderation.reports_payload()
    disputes = moderation.disputes_payload()
    health = health_svc.health_payload()
    health_issues = sum(1 for r in health["rows"] if r["status"] != "ok")

    def tile(key: str, label: str, value: int, note: str, href: str, tone: str) -> dict[str, Any]:
        return {
            "key": key,
            "label": label,
            "value": value,
            "note": note,
            "href": href,
            "tone": tone,
        }

    subscriptions = [
        tile("active", "نشط", by["active"], "اشتراك سارٍ", "/platform/tenants", "ok"),
        tile("trial", "تجريبي", by["trial"], "30 يوماً من الإنشاء", "/platform/tenants", "info"),
        tile(
            "due14",
            "ينتهي خلال 14 يوماً",
            due14,
            "يحتاج تذكيراً أو إثبات دفع",
            "/platform/tenants?filter=due14",
            "warn" if due14 else "ok",
        ),
        tile(
            "late",
            "متأخرو السداد",
            by["expired"],
            "الدفتر لا يُحجب — الميزات المدفوعة تتوقف بعد المهلة",
            "/platform/tenants?filter=late",
            "warn" if by["expired"] else "ok",
        ),
        tile(
            "suspended",
            "موقوفون",
            by["suspended"],
            "إيقاف من المشغّل بسبب مسجَّل",
            "/platform/tenants?filter=suspended",
            "danger" if by["suspended"] else "ok",
        ),
    ]
    queues = [
        tile(
            "proofs",
            "إثباتات دفع معلّقة",
            proofs_pending,
            "الاعتماد يمدّد شهراً",
            "/platform/proofs",
            "warn" if proofs_pending else "ok",
        ),
        tile(
            "verifications",
            "طلبات تحقّق",
            ver_pending,
            "شارة هوية لا تزكية",
            "/platform/verifications",
            "warn" if ver_pending else "ok",
        ),
        tile(
            "reports",
            "بلاغات قيد المراجعة",
            int(reports["open_count"]),
            "تعليق النشر بمسار مسجَّل",
            "/platform/reports",
            "warn" if reports["open_count"] else "ok",
        ),
        tile(
            "disputes",
            "خلافات مفتوحة",
            int(disputes["open_count"]),
            f"{disputes['near_limit_count']} قرب حدّ التدخّل",
            "/platform/disputes",
            "danger"
            if disputes["near_limit_count"]
            else ("warn" if disputes["open_count"] else "ok"),
        ),
        tile(
            "demo",
            "طلبات جولة تنتظر",
            demo_open,
            f"{demo_new} لم يُتواصل معه بعد",
            "/platform/demo-requests",
            "warn" if demo_new else "ok",
        ),
    ]
    technical = [
        tile(
            "sync_stuck",
            "مزامنة متعثّرة",
            sync_stuck,
            "جهاز لم يزامن 3 أيام",
            "/platform/tenants?filter=sync_stuck",
            "warn" if sync_stuck else "ok",
        ),
        tile(
            "health",
            "مؤشرات صحة غير سليمة",
            health_issues,
            "المزامنة والخادم — يغذّي صفحة الحالة",
            "/platform/health",
            "danger" if health["state"] == "server_error" else ("warn" if health_issues else "ok"),
        ),
    ]
    attention = sum(t["value"] for t in queues) + by["suspended"] + sync_stuck + health_issues
    return {
        "measured_at": _iso(now),
        "tenants_total": len(rows),
        "attention": attention,
        "subscriptions": subscriptions,
        "queues": queues,
        "technical": technical,
        "rule": "أرقام من السجل لا من تخمين — كل بطاقة تفتح شاشتها. لا مبيعات ولا أسماء زبائن هنا.",
    }
