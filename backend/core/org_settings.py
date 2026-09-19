"""ORG-09 — إعدادات المنشأة واللغة والقوالب: لا محاسبة عامة ولا محرّر برمجي (§١١.٣). القالب حقول
مسمّاة بمعاينة فورية؛ النص الأطول من عرض الورق يُمنع قبل الحفظ؛ التعديل المتزامن يُكشف بالإصدار
(`conflict`)؛ العملة غير قابلة للتبديل (§٦.٣؛ ACC-27)؛ نمط الأرقام مبدّل واحد للنظام كله (G-01)."""

from __future__ import annotations

from typing import Any

from django.db import transaction

from core import audit
from core.models import PaymentMethod, Tenant, TenantSettings, User
from core.tenancy import require_tenant

#: أحرف لكل سطر تقريباً عند 203dpi بخط الإيصال — تقدير معلن يُقاس على الطراز (WEB-03)
PAPER_CHARS: dict[str, int] = {"58": 32, "80": 48}
NUMERALS: tuple[str, ...] = ("latin", "arabic")


class SettingsRejected(Exception):
    def __init__(self, code: str, field: str = "", extra: Any = None) -> None:
        super().__init__(code)
        self.code = code
        self.field = field
        self.extra = extra


def _settings() -> TenantSettings:
    obj, _ = TenantSettings.objects.get_or_create(tenant_id=require_tenant())
    assert isinstance(obj, TenantSettings)
    return obj


def payload(*, can_edit: bool) -> dict[str, Any]:
    st = _settings()
    tenant = Tenant.unscoped.get(id=require_tenant())
    branding = dict(st.branding or {})
    locale = dict(st.locale or {})
    width = str(branding.get("paper_width", "80"))
    return {
        "version": st.version,
        "updated_at": st.updated_at.isoformat().replace("+00:00", "Z"),
        "updated_by_name": st.updated_by_name,
        "name": tenant.name,
        "currency": tenant.base_currency,
        "currency_exponent": tenant.base_currency_exponent,
        "receipt": {
            "header": str(branding.get("receipt_header", "")),
            "footer": str(branding.get("receipt_footer", "شكراً لزيارتكم")),
            "paper_width": width,
            "max_chars": PAPER_CHARS.get(width, 48),
        },
        "locale": {
            "language": str(locale.get("language", "ar")),
            "numerals": str(locale.get("numerals", "latin")),
        },
        "payment_methods": [
            {
                "id": str(m.id),
                "code": m.code,
                "name": m.name,
                "is_cash": m.is_cash,
                "is_active": m.is_active,
            }
            for m in PaymentMethod.objects.order_by("created_at")
        ],
        "can_edit": can_edit,
    }


def _too_wide(text: str, width: str) -> bool:
    return len(text.strip()) > PAPER_CHARS.get(width, 48)


def save(
    *,
    actor: User,
    version: int,
    name: str | None,
    header: str | None,
    footer: str | None,
    paper_width: str | None,
    numerals: str | None,
    language: str | None,
    payment_methods: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """يحفظ بشرط تطابق الإصدار (وإلا `conflict` بمن حفظ ومتى)؛ النص الأطول من عرض الورق يُرفض قبل
    الحفظ (`too_wide` بالحقل وكيف سيُقطع)؛ العملة لا تُمسّ."""
    with transaction.atomic():
        st = TenantSettings.objects.select_for_update().get(tenant_id=require_tenant())
        if st.version != int(version):
            raise SettingsRejected(
                "conflict",
                extra={
                    "version": st.version,
                    "updated_at": st.updated_at.isoformat().replace("+00:00", "Z"),
                    "updated_by_name": st.updated_by_name,
                },
            )
        branding = dict(st.branding or {})
        locale = dict(st.locale or {})
        width = str(paper_width or branding.get("paper_width", "80"))
        if width not in PAPER_CHARS:
            raise SettingsRejected("paper_width_invalid", "paper_width")
        tenant = Tenant.unscoped.get(id=require_tenant())
        new_name = tenant.name if name is None else name.strip()
        if not new_name:
            raise SettingsRejected("name_required", "name")
        new_header = branding.get("receipt_header", "") if header is None else header.strip()
        new_footer = (
            branding.get("receipt_footer", "شكراً لزيارتكم") if footer is None else footer.strip()
        )
        limit = PAPER_CHARS[width]
        for field, text in (("name", new_name), ("header", new_header), ("footer", new_footer)):
            if _too_wide(str(text), width):
                raise SettingsRejected(
                    "too_wide", field, extra={"max_chars": limit, "cut": str(text).strip()[:limit]}
                )
        if numerals is not None and numerals not in NUMERALS:
            raise SettingsRejected("numerals_invalid", "numerals")
        changed: list[str] = []
        if new_name != tenant.name:
            tenant.name = new_name
            tenant.save(update_fields=["name"])
            changed.append("اسم المنشأة")
        for key, val, label in (
            ("receipt_header", new_header, "سطر الترويسة"),
            ("receipt_footer", new_footer, "سطر الختام"),
            ("paper_width", width, "عرض الورق"),
        ):
            if branding.get(key) != val:
                branding[key] = val
                changed.append(label)
        if numerals is not None and locale.get("numerals", "latin") != numerals:
            locale["numerals"] = numerals
            changed.append("نمط الأرقام")
        if language is not None and locale.get("language", "ar") != language:
            locale["language"] = language
            changed.append("اللغة")
        if payment_methods:
            for pm in payment_methods:
                m = PaymentMethod.objects.filter(id=pm.get("id")).first()
                if m is None:
                    continue
                active = bool(pm.get("is_active", True))
                if m.is_cash and not active:
                    raise SettingsRejected("cash_method_required", "payment_methods")
                if m.is_active != active:
                    m.is_active = active
                    m.save(update_fields=["is_active"])
                    changed.append(f"طريقة الدفع {m.name}")
        st.branding = branding
        st.locale = locale
        st.version += 1
        st.updated_by_name = actor.display_name
        st.save()
        if changed:
            audit.record(
                kind="settings.changed",
                title="تعديل إعدادات المنشأة",
                actor=actor,
                detail="، ".join(changed)[:400],
                ref_entity="core.TenantSettings",
            )
    return {"changed": changed, **payload(can_edit=True)}


# ---------------------------------------------------------------- نقل الملكية (ORG-09 · conflict)
from datetime import timedelta  # noqa: E402

from django.utils import timezone  # noqa: E402

from core.models import OwnershipTransfer, Session  # noqa: E402

TRANSFER_TTL = timedelta(hours=24)


def _transfer_blockers() -> dict[str, Any]:
    """لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع."""
    from shifts.models import Shift

    open_shifts = list(
        Shift.objects.filter(state="open")
        .select_related("branch")
        .values_list("user_name", "branch__name")
    )
    pending = (
        Session.objects.filter(
            device__isnull=False, revoked_at__isnull=True, reported_pending__gt=0
        )
        .select_related("device")
        .values_list("device__name", "reported_pending")
    )
    pend: dict[str, int] = {}
    for name, n in pending:
        pend[str(name)] = max(int(n or 0), pend.get(str(name), 0))
    return {
        "open_shifts": [{"user_name": u, "branch_name": b} for u, b in open_shifts],
        "pending_devices": [{"device_name": k, "pending": v} for k, v in pend.items()],
    }


def _expire_stale() -> None:
    now = timezone.now()
    for t in OwnershipTransfer.objects.filter(
        state=OwnershipTransfer.State.PENDING, expires_at__lte=now
    ):
        t.state = OwnershipTransfer.State.EXPIRED
        t.resolved_at = now
        t.save(update_fields=["state", "resolved_at"])
        audit.record(
            kind="ownership.expired",
            title="انقضاء طلب نقل الملكية بلا تأكيد",
            actor=None,
            detail=f"من {t.from_user_name} إلى {t.to_user_name} — أُلغي تلقائياً وسُجّل.",
            ref_entity="core.OwnershipTransfer",
            ref_id=t.id,
        )


def transfer_payload(t: OwnershipTransfer) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "from_user_name": t.from_user_name,
        "to_user_id": str(t.to_user_id),
        "to_user_name": t.to_user_name,
        "state": t.state,
        "requested_at": t.requested_at.isoformat().replace("+00:00", "Z"),
        "expires_at": t.expires_at.isoformat().replace("+00:00", "Z"),
    }


def ownership_payload(*, viewer: User) -> dict[str, Any]:
    _expire_stale()
    current = (
        OwnershipTransfer.objects.filter(state=OwnershipTransfer.State.PENDING)
        .order_by("-requested_at")
        .first()
    )
    candidates = [
        {"id": str(u.id), "display_name": u.display_name}
        for u in User.objects.filter(
            is_active=True, is_owner=False, account__isnull=False
        ).order_by("display_name")
    ]
    return {
        "current": transfer_payload(current) if current else None,
        "blockers": _transfer_blockers(),
        "candidates": candidates,
        "can_request": viewer.is_owner,
        "can_confirm": bool(current and str(current.to_user_id) == str(viewer.id)),
        "ttl_hours": int(TRANSFER_TTL.total_seconds() // 3600),
    }


def request_transfer(*, actor: User, to_user_id: Any) -> OwnershipTransfer:
    if not actor.is_owner:
        raise SettingsRejected("owner_required")
    _expire_stale()
    if OwnershipTransfer.objects.filter(state=OwnershipTransfer.State.PENDING).exists():
        raise SettingsRejected("transfer_pending")
    blockers = _transfer_blockers()
    if blockers["open_shifts"] or blockers["pending_devices"]:
        raise SettingsRejected("conflict", extra=blockers)
    to_user = User.objects.filter(id=to_user_id, is_active=True).first()
    if to_user is None or to_user.is_owner:
        raise SettingsRejected("new_owner_invalid", "to_user_id")
    if to_user.account_id is None or to_user.account.verified_at is None:
        # حساب قائم ومُثبَت برقمه — لا نقل إلى بريد أو رقم غير مؤكَّد
        raise SettingsRejected("new_owner_unverified", "to_user_id")
    t: OwnershipTransfer = OwnershipTransfer.objects.create(
        tenant_id=require_tenant(),
        from_user_id=actor.id,
        from_user_name=actor.display_name,
        to_user_id=to_user.id,
        to_user_name=to_user.display_name,
        expires_at=timezone.now() + TRANSFER_TTL,
    )
    audit.record(
        kind="ownership.requested",
        title=f"طلب نقل ملكية المنشأة إلى {to_user.display_name}",
        actor=actor,
        detail="تأكيد من الطرفين خلال 24 ساعة؛ انقضاؤها يلغي الطلب تلقائياً.",
        ref_entity="core.OwnershipTransfer",
        ref_id=t.id,
    )
    return t


def confirm_transfer(t: OwnershipTransfer, *, actor: User) -> OwnershipTransfer:
    """يؤكّد المالك الجديد: ينتقل الدفتر كله كما هو — لا إعادة ترقيم ولا إعادة حساب رصيد."""
    _expire_stale()
    t.refresh_from_db()
    if t.state != OwnershipTransfer.State.PENDING:
        raise SettingsRejected("transfer_not_pending")
    if str(t.to_user_id) != str(actor.id):
        raise SettingsRejected("not_the_new_owner")
    blockers = _transfer_blockers()
    if blockers["open_shifts"] or blockers["pending_devices"]:
        raise SettingsRejected("conflict", extra=blockers)
    now = timezone.now()
    with transaction.atomic():
        old = User.objects.filter(id=t.from_user_id).first()
        if old is not None:
            old.is_owner = False
            old.former_owner_until = now
            old.save(update_fields=["is_owner", "former_owner_until"])
        actor.is_owner = True
        actor.save(update_fields=["is_owner"])
        t.state = OwnershipTransfer.State.CONFIRMED
        t.resolved_at = now
        t.save(update_fields=["state", "resolved_at"])
        audit.record(
            kind="ownership.transferred",
            title=f"نقل ملكية المنشأة من {t.from_user_name} إلى {t.to_user_name}",
            actor=actor,
            detail=(
                "الاشتراك والأجهزة والذمم انتقلت كما هي؛ "
                "المالك السابق يبقى في السجل بصفة «مالك سابق»."
            ),
            ref_entity="core.OwnershipTransfer",
            ref_id=t.id,
        )
    return t


def cancel_transfer(t: OwnershipTransfer, *, actor: User) -> OwnershipTransfer:
    if t.state != OwnershipTransfer.State.PENDING:
        raise SettingsRejected("transfer_not_pending")
    if str(actor.id) not in {str(t.from_user_id), str(t.to_user_id)}:
        raise SettingsRejected("owner_required")
    t.state = OwnershipTransfer.State.CANCELLED
    t.resolved_at = timezone.now()
    t.save(update_fields=["state", "resolved_at"])
    audit.record(
        kind="ownership.cancelled",
        title="إلغاء طلب نقل الملكية",
        actor=actor,
        ref_entity="core.OwnershipTransfer",
        ref_id=t.id,
    )
    return t
