"""الأطراف (§٧.٥؛ POS-04، PTY-01…): الطرف يُنشأ بالاسم فقط؛ الهاتف اختياري؛ التطبيع للبحث يحتفظ
بالاسم الأصلي ولا يثبت أن شخصين هما الشخص نفسه. قرار الهوية «طرف منفصل مع تمييز» يُسجَّل
(`distinct_from`) لا يُستنتج. الرصيد ليس حقلاً — يُشتق من الدفتر عبر مزوّدي PTY حين يُبنى.
"""

from __future__ import annotations

from typing import Any

from django.db import models

from core.models import TenantScoped
from core.search_normalize import normalize_search


def normalize_phone(phone: str) -> str:
    """أرقام لاتينية فقط للمطابقة («الرقم مسجَّل على طرف قائم»)؛ العرض بالأصل."""
    latin = phone.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    return "".join(ch for ch in latin if ch.isdigit())


class Party(TenantScoped):
    name = models.CharField(max_length=200)
    name_normalized = models.CharField(max_length=200, db_index=True)
    phone = models.CharField(max_length=32, blank=True, default="")
    phone_normalized = models.CharField(max_length=32, blank=True, default="", db_index=True)
    #: أسماء بديلة للبحث («أبو محمد · الطيب») — لا تثبت هوية (§٧.٥)
    aliases = models.JSONField(default=list, blank=True)
    aliases_normalized = models.TextField(blank=True, default="")
    #: حدّ الائتمان بالوحدة الصغرى؛ صفر = بلا حدّ مضبوط (PTY-03 يضبطه)
    credit_limit_minor = models.BigIntegerField(default=0)
    is_customer = models.BooleanField(default=True)
    is_supplier = models.BooleanField(default=False)
    #: «إنشاء منفصل مع تمييز»: قرار هوية صريح بأن هذا ليس ذاك (§٧.٥)
    distinct_from = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    created_by_user_id = models.UUIDField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="parties_party_tenant_id"),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.name_normalized = normalize_search(self.name)
        self.phone_normalized = normalize_phone(self.phone)
        self.aliases_normalized = " | ".join(
            normalize_search(str(a)) for a in (self.aliases or []) if str(a).strip()
        )
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.name
