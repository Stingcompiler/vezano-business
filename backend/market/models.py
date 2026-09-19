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
    # MP-03: الشارة تسقط ويبقى الملف («التحقق منتهٍ منذ …»)، والمعلَّقة يُمنع جديدها (ACC-135)
    verified_until = models.DateField(null=True, blank=True)
    publish_suspended_at = models.DateTimeField(null=True, blank=True)
    publish_suspended_reason = models.CharField(max_length=300, blank=True, default="")
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


class MarketOffer(TenantScoped):
    """عرض منشور صنفاً صنفاً (MP-10/11): أربع حالات لا حالتان — منشور، مسودة، منتهٍ، مخفي؛ «المخفي»
    ليس محذوفاً و«المنتهي» ليس مخفياً. الرصيد الداخلي والتكلفة لا يُنشران أبداً (ACC-120)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "مسودة"
        PUBLISHED = "published", "منشور"
        EXPIRED = "expired", "منتهٍ"
        HIDDEN = "hidden", "مخفي"

    class Audience(models.TextChoices):
        PUBLIC = "public", "كل المشترين"
        PRIVATE = "private", "قائمة خاصة"
        FOLLOWERS = "followers", "متابعو منشأتك"

    number = models.PositiveIntegerField(default=0)
    item_id = models.UUIDField(null=True, blank=True)
    public_name = models.CharField(max_length=200, blank=True, default="")
    description = models.CharField(max_length=600, blank=True, default="")
    unit_code = models.CharField(max_length=20, blank=True, default="")
    unit_name = models.CharField(max_length=60, blank=True, default="")
    pack_label = models.CharField(max_length=80, blank=True, default="")
    price_minor = models.BigIntegerField(null=True, blank=True)
    min_order_qty = models.PositiveIntegerField(null=True, blank=True)
    max_order_qty = models.PositiveIntegerField(null=True, blank=True)
    availability = models.CharField(max_length=12, default="available")
    fulfilment_note = models.CharField(max_length=200, blank=True, default="")
    # MP-04: الرسوم قابلة للحساب أو غير محسومة — لا «الأرخص» بلا رسوم محسومة (ACC-122)
    pickup_only = models.BooleanField(default=False)
    delivery_fee_minor = models.BigIntegerField(null=True, blank=True)
    delivery_free_over_minor = models.BigIntegerField(null=True, blank=True)
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.PUBLIC)
    private_party_ids = models.JSONField(default=list, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    # MP-13: ختم التأكيد الخادمي — التجديد فعل صريح؛ تغيير السعر/الوحدة/الحدّ يلغيه
    confirmed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    version = models.PositiveIntegerField(default=1)
    published_at = models.DateTimeField(null=True, blank=True)
    hidden_at = models.DateTimeField(null=True, blank=True)
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    published_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_offer_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.public_name}:{self.status}"


class MarketPriceList(TenantScoped):
    """MP-12: قائمة أسعار خاصة — الشريحة بوحدتها والمشترون بأسمائهم (ACC-121، ACC-138). السعر
    الخاص امتيازُ علاقة لا إعلان: لا سعر خاص لمنشأة بلا علاقة قائمة."""

    name = models.CharField(max_length=120)
    offer = models.ForeignKey(MarketOffer, on_delete=models.CASCADE, related_name="price_lists")
    # الشرائح: [{"min": 5, "max": 19, "price_minor": 118000} …]؛ max فارغ = «أكثر من»،
    # price فارغ = «بالتفاوض»
    tiers = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_pricelist_tenant_id"),
        ]

    def __str__(self) -> str:
        return self.name


class MarketPriceListMember(TenantScoped):
    """عضو قائمة خاصة: منشأة مشترية مسمّاة بعلاقة مخوَّلة — دعوة تنتهي، نشطة، أو موقوفة بطلب البائع."""

    class Status(models.TextChoices):
        INVITED = "invited", "دعوة معلّقة"
        ACTIVE = "active", "نشطة"
        SUSPENDED = "suspended", "موقوف"

    price_list = models.ForeignKey(
        MarketPriceList, on_delete=models.CASCADE, related_name="members"
    )
    buyer_tenant_id = models.UUIDField()
    buyer_name = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.INVITED)
    invited_at = models.DateTimeField(default=timezone.now)
    invite_expires_at = models.DateTimeField(null=True, blank=True)
    authorized_at = models.DateTimeField(null=True, blank=True)
    suspended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "id"], name="market_pricelistmember_tenant_id"
            ),
            models.UniqueConstraint(
                fields=["tenant", "price_list", "buyer_tenant_id"],
                name="market_pricelistmember_once",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.buyer_name}:{self.status}"


class MarketFollow(TenantScoped):
    """MP-06: متابعة مورد — اشتراك تسويقي B2B باسم المنشأة المتابِعة، يُلغى وحده (ACC-134): يوقف
    رسائل المورد التسويقية ولا يمسّ أحداث الطلبات. المورد يرى عدد متابعيه لا أسماءهم."""

    class Status(models.TextChoices):
        ACTIVE = "active", "متابَع"
        CANCELLED = "cancelled", "أُلغيت"

    supplier_tenant_id = models.UUIDField()
    supplier_name = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    followed_at = models.DateTimeField(default=timezone.now)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_follow_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "supplier_tenant_id"], name="market_follow_once"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.supplier_name}:{self.status}"


class MarketInvite(TenantScoped):
    """MP-07: مشاركة رابط ودعوة منشأة باسم منشأتك (ACC-06 · ACC-118 · ACC-150).

    الرابط له عمر ولا يُحيا — المنتهي يُستبدل برابط جديد؛ ما يخرج به عامّ دوماً (المعاينة العامة
    لا سعر خاص فيها) ولا يعرف من يفتحه. القبول لا ينشر ملف المدعوّ ولا كتالوجه — يفتح باباً فقط.
    القياس بأقل بيانات: عدّادات زيارة/تسجيل/نشر/أول طلب مفصولة، بلا هوية.
    طلب التخويل (`kind=authorization`) يصل المورد بمعلومة واحدة: من أنت؛ ورفضه بلا سبب (ACC-121).
    """

    class Kind(models.TextChoices):
        SHARE = "share", "مشاركة رابط"
        INVITE = "invite", "دعوة منشأة"
        AUTHORIZATION = "authorization", "طلب تخويل"

    class Status(models.TextChoices):
        SENT = "sent", "مرسَل"
        ACCEPTED = "accepted", "قُبل"
        DECLINED = "declined", "رُفض"
        REVOKED = "revoked", "أُلغي"
        EXPIRED = "expired", "منتهٍ"

    kind = models.CharField(max_length=14, choices=Kind.choices, default=Kind.SHARE)
    target_offer_id = models.UUIDField(null=True, blank=True)
    target_tenant_id = models.UUIDField(null=True, blank=True)
    target_name = models.CharField(max_length=200, blank=True, default="")
    message = models.CharField(max_length=300, blank=True, default="")
    token_hash = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.SENT)
    expires_at = models.DateTimeField(null=True, blank=True)
    accepted_tenant_id = models.UUIDField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    visits = models.PositiveIntegerField(default=0)
    signups = models.PositiveIntegerField(default=0)
    publishes = models.PositiveIntegerField(default=0)
    first_orders = models.PositiveIntegerField(default=0)
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_invite_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.status}"


class MarketReport(TenantScoped):
    """MP-15: بلاغ عن عرض أو انتحال — سبب من قائمة، ودليل، ورقم متابعة يرى المبلِّغ حالته.

    البلاغ لا يُعلِّق شيئاً بنفسه (التعليق قرار مراجِع بشري في PLT-07)؛ هوية المبلِّغ محفوظة —
    المبلَّغ عنه لا يرى من بلّغ، وغير المقدِّم لا يرى البلاغ أصلاً. لا مساس بدفاتر الطرف الآخر
    (ACC-139).
    """

    class Reason(models.TextChoices):
        IMPERSONATION = "impersonation", "انتحال اسم منشأة أو شارتها"
        MISLEADING = "misleading", "وصف مضلّل للمنتج أو وحدته"
        HARMFUL = "harmful", "محتوى غير لائق أو ضارّ"
        PROHIBITED = "prohibited", "عرض لسلعة ممنوعة"

    class Status(models.TextChoices):
        UNDER_REVIEW = "under_review", "قيد المراجعة"
        ACTIONED = "actioned", "أُجري إجراء"
        CLOSED = "closed", "أُغلق بلا إجراء"

    number = models.PositiveIntegerField(default=0)
    target_offer_id = models.UUIDField(null=True, blank=True)
    target_tenant_id = models.UUIDField(null=True, blank=True)
    target_label = models.CharField(max_length=300, blank=True, default="")
    reason = models.CharField(max_length=14, choices=Reason.choices)
    note = models.CharField(max_length=600, blank=True, default="")
    evidence_data_url = models.TextField(blank=True, default="")
    evidence_name = models.CharField(max_length=200, blank=True, default="")
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.UNDER_REVIEW)
    outcome = models.CharField(max_length=300, blank=True, default="")
    decided_at = models.DateTimeField(null=True, blank=True)
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_report_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"RP-{self.number}:{self.reason}"
