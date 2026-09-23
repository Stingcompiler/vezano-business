"""قيم الكتالوج الافتراضية (قيم الإطار التي كانت في الشيفرة — 0005 §٥٠). تُبذر بالهجرة 0026، ويُعاد
بذرها إن وُجد الجدول فارغاً (قاعدة جديدة أو مُفرَّغة في الاختبارات)."""

from __future__ import annotations

from typing import Any

DEFAULT_PLANS: list[dict[str, Any]] = [
    {
        "code": "single",
        "name": "فرع واحد",
        "order": 1,
        "trial": False,
        "max_branches": 1,
        "max_devices": 3,
        "max_users": 2,
        "campaign_quota": 0,
        "features": ["pos_core", "advanced_reports", "bulk_pricing"],
        "blurb": "3 أجهزة · مستخدمان بدور كامل · تقارير كاملة · بلا نشر في السوق",
        "price_monthly_minor": 4_500_000,
        # الربعي والسنوي (بأمر المالك 2026-09-22 — 0005 §١١٠): ربعي ≈ خصم 7٪، سنوي = 10 أشهر
        "price_quarterly_minor": 12_500_000,
        "price_yearly_minor": 45_000_000,
        "addon_device_minor": 1_000_000,
        "addon_user_minor": 500_000,
        "addon_branch_minor": 3_000_000,
    },
    {
        "code": "dual",
        "name": "فرعان",
        "order": 2,
        "trial": False,
        "max_branches": 2,
        "max_devices": 6,
        "max_users": 5,
        "campaign_quota": 1_200,
        "features": [
            "pos_core",
            "multi_branch",
            "advanced_reports",
            "branch_compare",
            "market_publish",
            "market_private_prices",
            "campaigns",
            "bulk_pricing",
        ],
        "blurb": "6 أجهزة · 5 مستخدمين · مقارنة الفروع · نشر في السوق واستقبال الطلبات",
        "price_monthly_minor": 8_500_000,
        "price_quarterly_minor": 23_500_000,
        "price_yearly_minor": 85_000_000,
        "addon_device_minor": 1_000_000,
        "addon_user_minor": 500_000,
        "addon_branch_minor": 3_500_000,
    },
    {
        "code": "trial",
        "name": "تجريبية",
        "order": 3,
        "trial": True,
        "trial_days": 30,
        "max_branches": 1,
        "max_devices": 3,
        "max_users": 2,
        "campaign_quota": 0,
        "features": ["pos_core", "advanced_reports", "bulk_pricing"],
        "blurb": (
            "كل ميزات باقة الفرع الواحد. عند الانتهاء تبقى بياناتك وتتحوّل للقراءة والبيع النقدي."
        ),
        "price_monthly_minor": 0,
    },
]
