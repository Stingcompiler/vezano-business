"""السوق (M1/M2) — حساب السوق للمنشأة وصفحتها المنشورة (§٥.٥، §٩.٥، §١٤.٥).

حساب واحد ودفتر واحد (G-06 المسار ب): دور البائع يُفتح بطلب تحقق منفصل يراجعه مشرف السوق
(PLT-06) — لا نشر قبل الاعتماد؛ التفعيل لا ينشر شيئاً تلقائياً (ACC-118، ACC-120). ما يُنشر قائمة
معلنة: الهوية والفئات والمناطق وطرق التنفيذ — العنوان التفصيلي والهاتف لا يُنشران ولو مُلئا.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.models import TenantScoped


class MarketAccount(TenantScoped):
    """دور المنشأة في السوق وحالة تحقق البائع."""

    class Role(models.TextChoices):
        BUYER = "buyer", "شراء"
        SELLER = "seller", "بيع"
        BOTH = "both", "شراء وبيع"

    class Verification(models.TextChoices):
        NONE = "none", "لم يُطلب"
        DRAFT = "draft", "مسوّدة الطلب"
        PENDING = "pending", "بانتظار المراجعة"
        NEEDS_MORE = "needs_more", "أدلة ناقصة"
        VERIFIED = "verified", "منشأة موثَّقة المستندات"
        REJECTED = "rejected", "مرفوض"

    role = models.CharField(max_length=8, choices=Role.choices, default=Role.BUYER)
    verification = models.CharField(
        max_length=12, choices=Verification.choices, default=Verification.NONE
    )
    # قائمة طلب التحقق (MP-08): هوية المسؤول من تحقق الشراء، عنوان النشاط ومنطقة الخدمة، الموافقة
    # على شروط البائع، ومستند السجل التجاري (لا يُنشر في الملف العام)
    business_address = models.CharField(max_length=300, blank=True, default="")
    service_area_note = models.CharField(max_length=300, blank=True, default="")
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    registry_doc_data_url = models.TextField(blank=True, default="")
    registry_doc_name = models.CharField(max_length=200, blank=True, default="")
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewer_name = models.CharField(max_length=200, blank=True, default="")
    # أسباب النقص حقلاً حقلاً: {"registry_doc": "…", "service_area": "…"}
    review_reasons = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_account_tenant_id"),
            models.UniqueConstraint(fields=["tenant"], name="market_account_once_per_tenant"),
        ]

    def __str__(self) -> str:
        return f"{self.role}:{self.verification}"


class MarketProfile(TenantScoped):
    """صفحة المنشأة العامة: مسوّدة تُحفظ، ومنشور لا يتغيّر حتى يكتمل (منطقة خدمة واحدة على الأقل)."""

    public_name = models.CharField(max_length=200, blank=True, default="")
    category_line = models.CharField(max_length=120, blank=True, default="")
    categories = models.JSONField(default=list, blank=True)
    service_areas = models.JSONField(default=list, blank=True)
    fulfilment = models.JSONField(default=list, blank=True)
    # المنشور الأخير (لقطة) — ما يراه أي مشترٍ؛ فارغ = لم يُنشر بعد
    published = models.JSONField(default=dict, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    updated_by_name = models.CharField(max_length=200, blank=True, default="")
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_profile_tenant_id"),
            models.UniqueConstraint(fields=["tenant"], name="market_profile_once_per_tenant"),
        ]

    def __str__(self) -> str:
        return self.public_name
