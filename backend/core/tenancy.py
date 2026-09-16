"""سياق المستأجر — الطبقة الثانية من العزل (§٥.٤ بند ٢).

- `tenant_context(tenant_id)` يضبط `sting.tenant_id` داخل المعاملة (transaction-local) فلا يتسرب
  إلى الطلب التالي على اتصال معاد استخدامه (معيار §١٨ ACC-61)، ويُعيده عند الخروج صراحة.
- `platform_context()` لعمليات مشغّل المنصة ومسارات التهيئة التي تسبق وجود مستأجر؛ يُسجَّل استعماله.
- المديرون (`TenantManager`) **يفشلون عند غياب السياق** بدل أن يعيدوا صفراً بصمت — RLS في القاعدة
  هي الطبقة الأولى، وهذا الفشل الصريح طبقة تطبيق فوقها.
"""

from __future__ import annotations

import contextvars
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from django.db import connection, models, transaction


class TenantContextMissing(RuntimeError):
    """استعلام على بيانات مستأجر بلا سياق — خطأ برمجي لا حالة عادية."""


@dataclass(frozen=True)
class TenantContext:
    tenant_id: uuid.UUID | None
    platform: bool = False


_current: contextvars.ContextVar[TenantContext | None] = contextvars.ContextVar(
    "sting_tenant_context", default=None
)

_TENANT_GUC = "sting.tenant_id"
_PLATFORM_GUC = "sting.platform"


def _set_local(name: str, value: str) -> None:
    with connection.cursor() as cursor:
        # set_config(..., is_local=true): ينتهي بانتهاء المعاملة الجارية
        cursor.execute("SELECT set_config(%s, %s, true)", [name, value])


def current_context() -> TenantContext | None:
    return _current.get()


def require_tenant() -> uuid.UUID:
    ctx = _current.get()
    if ctx is None or ctx.tenant_id is None:
        raise TenantContextMissing("لا سياق مستأجر — الاستعلام مرفوض")
    return ctx.tenant_id


@contextmanager
def tenant_context(tenant_id: uuid.UUID) -> Iterator[TenantContext]:
    """يفتح معاملة ويضبط سياق المستأجر فيها؛ لا يُشتق المستأجر من حقول يختارها العميل."""
    ctx = TenantContext(tenant_id=tenant_id)
    with transaction.atomic():
        _set_local(_TENANT_GUC, str(tenant_id))
        _set_local(_PLATFORM_GUC, "")
        token = _current.set(ctx)
        try:
            yield ctx
        finally:
            _current.reset(token)
            _set_local(_TENANT_GUC, "")


@contextmanager
def platform_context() -> Iterator[TenantContext]:
    """سياق مشغّل المنصة: يرى كل المستأجرين. للتهيئة والدعم المدقَّق فقط (§٣.١، §١٣.٥)."""
    ctx = TenantContext(tenant_id=None, platform=True)
    with transaction.atomic():
        _set_local(_PLATFORM_GUC, "on")
        _set_local(_TENANT_GUC, "")
        token = _current.set(ctx)
        try:
            yield ctx
        finally:
            _current.reset(token)
            _set_local(_PLATFORM_GUC, "")


class TenantQuerySet(models.QuerySet):  # type: ignore[type-arg]
    pass


class TenantManager(models.Manager):  # type: ignore[type-arg]
    """يفرض السياق تطبيقياً: بلا سياق يرفع TenantContextMissing؛ بسياق مستأجر يقيّد بمعرفه."""

    def get_queryset(self) -> TenantQuerySet:
        qs = TenantQuerySet(self.model, using=self._db)
        ctx = _current.get()
        if ctx is None:
            raise TenantContextMissing(f"{self.model.__name__}: لا سياق مستأجر")
        if ctx.platform:
            return qs
        # جدول المستأجر نفسه يُقيَّد بـ id؛ بقية الجداول بـ tenant_id
        column = "id" if self.model._meta.db_table == "core_tenant" else "tenant_id"
        return qs.filter(**{column: ctx.tenant_id})
