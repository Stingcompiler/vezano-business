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
    # PLT-07: تعليق نشر بقرار المشغّل — إجراء نشر لا محاسبي (ACC-135 · ACC-139): يُخفى من نتائج
    # السوق فقط، والبائع يرى السبب فوراً وله اعتراض يراجعه غيرُ من علّق
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspended_reason_code = models.CharField(max_length=14, blank=True, default="")
    suspended_reason = models.CharField(max_length=400, blank=True, default="")
    suspended_by_name = models.CharField(max_length=200, blank=True, default="")
    appeal_status = models.CharField(max_length=10, blank=True, default="")
    appeal_note = models.CharField(max_length=600, blank=True, default="")
    appeal_doc_name = models.CharField(max_length=200, blank=True, default="")
    appeal_doc_data_url = models.TextField(blank=True, default="")
    appeal_opened_at = models.DateTimeField(null=True, blank=True)
    appeal_decided_at = models.DateTimeField(null=True, blank=True)
    appeal_reviewer_name = models.CharField(max_length=200, blank=True, default="")
    appeal_decision_note = models.CharField(max_length=400, blank=True, default="")
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


class MarketOrder(TenantScoped):
    """ORD-01/02: طلب أو طلب سعر من منشأة مشترية إلى مورد واحد (ACC-126) — بإصدار ورقم عملية.

    الإرسال فعل واحد بمعرّف واحد (`op_id`): إعادة المحاولة تُرسل الطلب نفسه لا طلباً جديداً
    (ACC-124). «أُرسل» ليست «قُبل»: لا التزام مالي ولا حجز مخزون ولا دين عند الطلب — الذمّة
    بالاستلام والمستند المحلي (§٧.٩). السطور نسخة من العرض وقت الإرسال بسعرها المؤكَّد خادمياً؛ لا
    تحويل عملة ضمنياً (ACC-140). كل تعديل لاحق إصدار جديد بموافقة الطرفين (ORD-05).
    """

    class Kind(models.TextChoices):
        ORDER = "order", "طلب"
        QUOTE = "quote", "طلب سعر"

    class Status(models.TextChoices):
        SENT = "sent", "بانتظار رد المورد"
        QUOTED = "quoted", "عرض سعر من المورد"
        ACCEPTED = "accepted", "مقبول"
        REJECTED = "rejected", "مرفوض"
        PREPARING = "preparing", "قيد التجهيز"
        DELIVERED = "delivered", "سُلِّم"
        RECEIVED = "received", "استُلم"
        CANCELLED = "cancelled", "أُلغي"
        DISPUTED = "disputed", "خلاف مفتوح"

    number = models.PositiveIntegerField(default=0)
    op_id = models.UUIDField()
    kind = models.CharField(max_length=6, choices=Kind.choices, default=Kind.ORDER)
    supplier_tenant_id = models.UUIDField()
    supplier_name = models.CharField(max_length=200)
    buyer_name = models.CharField(max_length=200, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.SENT)
    version = models.PositiveIntegerField(default=1)
    agreed_version = models.PositiveIntegerField(null=True, blank=True)
    remaining_cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=400, blank=True, default="")
    paid_minor = models.BigIntegerField(default=0)
    restore_point = models.DateTimeField(null=True, blank=True)
    reconciling = models.BooleanField(default=False)
    currency = models.CharField(max_length=3, default="SDG")
    lines = models.JSONField(default=list, blank=True)
    delivery_to = models.CharField(max_length=200, blank=True, default="")
    fees_label = models.CharField(max_length=200, blank=True, default="")
    note = models.CharField(max_length=600, blank=True, default="")
    response_hours = models.PositiveIntegerField(default=72)
    sent_at = models.DateTimeField(default=timezone.now)
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_order_tenant_id"),
            models.UniqueConstraint(fields=["tenant", "op_id"], name="market_order_op_once"),
        ]

    def __str__(self) -> str:
        return f"PO-{self.number}:{self.status}"


class MarketOrderVersion(TenantScoped):
    """ORD-05/06: إصدار مرقَّم من الطلب — طلب المشتري، عرض المورد، تعديل لاحق (ACC-125).

    الاتفاق هو الإصدار المشار إليه في القبول لا الأحدث؛ إصدار أحدث بعد القبول اقتراحٌ يحتاج قبولاً
    جديداً ويُعرض مع الفرق لا يُخفى. مسودة المورد (`sent_at` فارغ) تبقى عنده ولا تصل المشتري.
    الصف في نطاق منشأة المشتري (صاحب الطلب) ويقرؤه المورد عبر `platform_context`.
    """

    class Kind(models.TextChoices):
        REQUEST = "request", "طلب المشتري"
        QUOTE = "quote", "عرض المورد"
        REVISION = "revision", "تعديل لاحق من المورد"

    order = models.ForeignKey("MarketOrder", on_delete=models.PROTECT, related_name="versions")
    number = models.PositiveIntegerField(default=1)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.REQUEST)
    author_side = models.CharField(max_length=8, default="buyer")
    lines = models.JSONField(default=list, blank=True)
    delivery_fee_minor = models.BigIntegerField(null=True, blank=True)
    delivery_days = models.PositiveIntegerField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=600, blank=True, default="")
    summary = models.CharField(max_length=300, blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_orderversion_tenant_id"),
            models.UniqueConstraint(
                fields=["order", "number"], name="market_orderversion_number_once"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.order_id}:v{self.number}"


class MarketOrderEvent(TenantScoped):
    """ORD-05: الخط الزمني للطلب من أحداث الطرفين مرتَّبةً — لا محو لما حدث."""

    order = models.ForeignKey("MarketOrder", on_delete=models.PROTECT, related_name="events")
    kind = models.CharField(max_length=30)
    side = models.CharField(max_length=8, default="buyer")
    title = models.CharField(max_length=200)
    detail = models.CharField(max_length=400, blank=True, default="")
    ref_label = models.CharField(max_length=80, blank=True, default="")
    at = models.DateTimeField(default=timezone.now)
    needs_decision = models.BooleanField(default=False)
    decision = models.CharField(max_length=8, blank=True, default="")
    decision_reason = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_orderevent_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"{self.order_id}:{self.kind}"


class MarketShipment(TenantScoped):
    """ORD-08: شحنة على طلب — مرجع مستقل (SH-NN) يُطابق عند الاستلام؛ مجموع المشحون ≤ المؤكَّد لكل
    صنف؛ بيان المورد كما هو، والمخزون يُكتب بعدّ المشتري في ORD-09 لا بوصول الشحنة."""

    order = models.ForeignKey("MarketOrder", on_delete=models.PROTECT, related_name="shipments")
    number = models.PositiveIntegerField(default=1)
    lines = models.JSONField(default=list, blank=True)
    carrier_ref = models.CharField(max_length=120, blank=True, default="")
    eta_note = models.CharField(max_length=120, blank=True, default="")
    note = models.CharField(max_length=400, blank=True, default="")
    shipped_at = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(null=True, blank=True)
    received_lines = models.JSONField(default=list, blank=True)
    received_by_name = models.CharField(max_length=200, blank=True, default="")
    dispute_opened = models.BooleanField(default=False)
    created_by_name = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_shipment_tenant_id"),
            models.UniqueConstraint(fields=["order", "number"], name="market_shipment_number_once"),
        ]

    def __str__(self) -> str:
        return f"{self.order_id}:SH-{self.number:02d}"


class MarketReturn(TenantScoped):
    """ORD-11: مرتجع تجاري — طلب، ثم موافقة مورد (قد تكون جزئية)، ثم تنفيذ مادّي بمستند عكسي.

    لا خصم من الذمّة قبل التنفيذ ولا تجاوز للمستلَم غير المُعاد (ACC-141)؛ الفحص على الخادم.
    التنفيذ (المستند العكسي) يخصّ LINK/M3 ولا يُبنى هنا.
    """

    class Status(models.TextChoices):
        REQUESTED = "requested", "بانتظار موافقة"
        APPROVED = "approved", "موافَق عليه"
        PARTIAL = "partial", "موافقة جزئية"
        REJECTED = "rejected", "مرفوض"
        EXECUTED = "executed", "نُفِّذ"

    order = models.ForeignKey("MarketOrder", on_delete=models.PROTECT, related_name="returns")
    number = models.PositiveIntegerField(default=1)
    lines = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.REQUESTED)
    decision_note = models.CharField(max_length=400, blank=True, default="")
    requested_by_name = models.CharField(max_length=200, blank=True, default="")
    requested_at = models.DateTimeField(default=timezone.now)
    decided_at = models.DateTimeField(null=True, blank=True)
    executed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_return_tenant_id"),
            models.UniqueConstraint(fields=["order", "number"], name="market_return_number_once"),
        ]

    def __str__(self) -> str:
        return f"{self.order_id}:RT-{self.number:02d}"


class MarketDispute(TenantScoped):
    """ORD-12: خلاف على فارق — دفتران مستقلان وموظف مسؤول من كل طرف (ACC-132 · ACC-148).

    نعرض رقم المورد كما هو ولا نضعه في دفتر المشتري؛ الإغلاق لا يحرّك دفتراً — ما يُسوّى يُسوّى
    بمستند مستقل بصلاحيته. من عليه الدور معلَن ومهلته ظاهرة؛ الوسيط PLT-08.
    """

    class Status(models.TextChoices):
        OPEN = "open", "مفتوح"
        CLOSED = "closed", "مُغلق"

    class Outcome(models.TextChoices):
        NONE = "", "—"
        RETURN = "return", "مرتجع"
        CREDIT = "credit", "خصم/إشعار دائن"
        ACCEPT = "accept", "قبول بالحالة"

    order = models.ForeignKey("MarketOrder", on_delete=models.PROTECT, related_name="disputes")
    shipment = models.ForeignKey(
        "MarketShipment", on_delete=models.PROTECT, null=True, blank=True, related_name="disputes"
    )
    number = models.PositiveIntegerField(default=0)
    title = models.CharField(max_length=200)
    lines = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN)
    turn = models.CharField(max_length=8, default="supplier")
    turn_deadline = models.DateTimeField(null=True, blank=True)
    evidence = models.JSONField(default=list, blank=True)
    outcome = models.CharField(
        max_length=8, choices=Outcome.choices, default=Outcome.NONE, blank=True
    )
    outcome_ref = models.CharField(max_length=120, blank=True, default="")
    mediator_requested_at = models.DateTimeField(null=True, blank=True)
    # PLT-08: حدّ التدخّل — المنصة تُيسّر وتقيس ولا تحكم؛ التجاوز يُحال لمسار خارجي معلَن
    mediator_note = models.CharField(max_length=400, blank=True, default="")
    referred_external_at = models.DateTimeField(null=True, blank=True)
    referred_by_name = models.CharField(max_length=200, blank=True, default="")
    opened_by_name = models.CharField(max_length=200, blank=True, default="")
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_dispute_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"DSP-{self.number}:{self.status}"


class MarketPayment(TenantScoped):
    """ORD-13: إثبات دفع — الإيصال ليس تحصيلاً (ACC-133): يُسجَّل «مسجَّل — غير مطابق» ولا تنقص
    الذمّة إلا بمطابقة المورد؛ مرجع التحويل يُطابَق مرة واحدة (ACC-15)؛ الدفعة على طلبين بتوزيع
    صريح لا تلقائي (G-15). لسنا طرفاً في الدفع."""

    class Status(models.TextChoices):
        RECORDED = "recorded", "مسجَّل — غير مطابق"
        MATCHED = "matched", "مطابَق"
        REJECTED = "rejected", "مرفوض"

    order = models.ForeignKey("MarketOrder", on_delete=models.PROTECT, related_name="payments")
    supplier_tenant_id = models.UUIDField()
    number = models.PositiveIntegerField(default=0)
    amount_minor = models.BigIntegerField()
    transfer_ref = models.CharField(max_length=120)
    transferred_on = models.DateField()
    allocations = models.JSONField(default=list, blank=True)
    evidence_name = models.CharField(max_length=200, blank=True, default="")
    evidence_data_url = models.TextField(blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RECORDED)
    matched_at = models.DateTimeField(null=True, blank=True)
    matched_by_name = models.CharField(max_length=200, blank=True, default="")
    decision_note = models.CharField(max_length=300, blank=True, default="")
    reminded_at = models.DateTimeField(null=True, blank=True)
    uploaded_by_name = models.CharField(max_length=200, blank=True, default="")
    uploaded_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_payment_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "supplier_tenant_id", "transfer_ref"],
                name="market_payment_ref_once",
            ),
        ]

    def __str__(self) -> str:
        return f"PAY-{self.number}:{self.status}"


class MarketPartyLink(TenantScoped):
    """LINK-01 (M3): ربط طرف محلي في دفتري بمنشأة في السوق — موافقة وهوية لا دمج بالاسم (ACC-131).
    الطلب يراه الطرف الآخر ويقبله؛ الدفتر كما هو والرصيد لا يتغيّر بالربط؛ ما يُضاف قناة مستندات
    (LINK-03)."""

    class Status(models.TextChoices):
        REQUESTED = "requested", "بانتظار موافقة المنشأة"
        ACCEPTED = "accepted", "مربوط"
        REJECTED = "rejected", "رُفض"
        CANCELLED = "cancelled", "أُلغي"

    party_id = models.UUIDField()
    party_name = models.CharField(max_length=200)
    counterparty_tenant_id = models.UUIDField()
    counterparty_name = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.REQUESTED)
    requested_by_name = models.CharField(max_length=200, blank=True, default="")
    requested_at = models.DateTimeField(default=timezone.now)
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by_name = models.CharField(max_length=200, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_partylink_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"link:{self.party_id}->{self.counterparty_tenant_id}:{self.status}"


class MarketItemMapping(TenantScoped):
    """LINK-02 (M3): مطابقة صنفي ووحدتي بصنف المورد ووحدته بمعامل تحويل صريح — لا نخمّن أن
    «كرتونة» عنده = «كرتونة» عندي. الملكية داخلية: تغيير المورد لتعريفه يوقف المطابقة للمراجعة."""

    class Status(models.TextChoices):
        MATCHED = "matched", "مطابَق"
        NEEDS_DEFINITION = "needs_definition", "ناقص تعريف"
        NEEDS_REVIEW = "needs_review", "يحتاج مراجعة"

    counterparty_tenant_id = models.UUIDField()
    item_id = models.UUIDField()
    item_name = models.CharField(max_length=200)
    unit_code = models.CharField(max_length=20)
    unit_name = models.CharField(max_length=60, blank=True, default="")
    offer_id = models.UUIDField()
    offer_name = models.CharField(max_length=200)
    offer_unit_name = models.CharField(max_length=60, blank=True, default="")
    offer_pack_label = models.CharField(max_length=120, blank=True, default="")
    offer_version = models.PositiveIntegerField(default=1)
    # وحدة المورد الواحدة = كم من وحدتي (بالألف)
    factor_milli = models.BigIntegerField(default=0)
    status = models.CharField(max_length=18, choices=Status.choices, default=Status.MATCHED)
    confirmed_by_name = models.CharField(max_length=200, blank=True, default="")
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_itemmapping_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "counterparty_tenant_id", "offer_id"],
                name="market_itemmapping_offer_once",
            ),
        ]

    def __str__(self) -> str:
        return f"map:{self.item_id}~{self.offer_id}:{self.status}"


class MarketDocumentLink(TenantScoped):
    """LINK-03/04/05 (M3): الجسر بين مستند السوق (شحنة/مرتجع) ومستند دفتري (مستند شراء/مستند
    عكسي) — مصدر واحد معلَن لا تكرار (ACC-130): شحنة واحدة = رابط واحد، ولو أُعيد التحويل.
    التسوية لا تُحرّك رقماً هنا؛ تُسجَّل مساراً باسم من قرّره (LINK-04)."""

    class Kind(models.TextChoices):
        RECEIPT = "receipt", "استلام مقابل شحنة"
        RETURN = "return", "مرتجع إلى مستند عكسي"

    class Mode(models.TextChoices):
        CREATED = "created", "أُنشئ من الشحنة"
        ATTACHED = "attached", "رُبط بمستند يدوي قائم"

    kind = models.CharField(max_length=8, choices=Kind.choices)
    order = models.ForeignKey("MarketOrder", on_delete=models.PROTECT, related_name="doc_links")
    shipment = models.ForeignKey(
        "MarketShipment", on_delete=models.PROTECT, null=True, blank=True, related_name="doc_links"
    )
    market_return = models.ForeignKey(
        "MarketReturn", on_delete=models.PROTECT, null=True, blank=True, related_name="doc_links"
    )
    mode = models.CharField(max_length=8, choices=Mode.choices, default=Mode.CREATED)
    local_entity = models.CharField(max_length=40)
    local_id = models.UUIDField()
    local_number = models.CharField(max_length=40, blank=True, default="")
    # ما دخل دفتري (بوحدة الأساس) مقابل ما يقوله المورد — للفرق في LINK-04
    my_value_minor = models.BigIntegerField(default=0)
    their_value_minor = models.BigIntegerField(default=0)
    settled_at = models.DateTimeField(null=True, blank=True)
    settled_by_name = models.CharField(max_length=200, blank=True, default="")
    settlement_path = models.CharField(max_length=20, blank=True, default="")
    settlement_note = models.CharField(max_length=400, blank=True, default="")
    created_by_name = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_doclink_tenant_id"),
            models.UniqueConstraint(
                fields=["tenant", "shipment"],
                condition=models.Q(shipment__isnull=False),
                name="market_doclink_shipment_once",
            ),
            models.UniqueConstraint(
                fields=["tenant", "market_return"],
                condition=models.Q(market_return__isnull=False),
                name="market_doclink_return_once",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.local_entity}:{self.local_number}"


class MarketShipmentDistinct(TenantScoped):
    """LINK-03 `conflict`: تأكيد صريح أن شحنة السوق ومستند الاستلام اليدوي شحنتان مختلفتان —
    لا نُضيف ولا نحذف تلقائياً."""

    shipment = models.ForeignKey(
        "MarketShipment", on_delete=models.PROTECT, related_name="distinct_confirmations"
    )
    receipt_id = models.UUIDField()
    confirmed_by_name = models.CharField(max_length=200, blank=True, default="")
    confirmed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="market_shipdistinct_tenant_id"),
        ]

    def __str__(self) -> str:
        return f"distinct:{self.shipment_id}:{self.receipt_id}"
