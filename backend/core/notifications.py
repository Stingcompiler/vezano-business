"""NOT-01/NOT-02 — صندوق الوارد وتفضيلات التنبيه (17-D12؛ 36-D28؛ §١١.٥، §١١.٦؛ ACC-110، ACC-113).

مصدر الحقيقة خادمي: الإشعارات التشغيلية تُشتقّ من الحالة الحيّة عند كل جلب (وردية مهجورة، معلّق لم
يُرفع، بنود محجوزة، اشتراك يقترب) بمفتاح إزالة تكرار، وتُوسم «زال سببها» لا تُمحى؛ الحسابية تُبثّ من
مواضعها (مراجعة الإثبات)؛ التسويقية قابلة للإيقاف ولا تُنبَّه بعرض منتهٍ (ACC-110). التشغيلي فوق
التسويقي دائماً. الرابط داخل الإشعار يحمل صلاحية: بعدها «انتهت صلاحية هذا الرابط» والوجهة بديلاً
(ACC-113). ما يخصّ المالك يظهر عنوانه للموظف ويُحجب محتواه.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core import home
from core.models import Notification, NotificationPreference, Session, User
from core.subscription import days_since_expiry, ensure_subscription, plan_of
from core.tenancy import require_tenant

#: صلاحية الرابط داخل الإشعار (ACC-113) — افتراض: 7 أيام
LINK_TTL = timedelta(days=7)
#: وردية مهجورة بعد 24 ساعة (0005 §١٦)
ABANDONED_AFTER = timedelta(hours=24)
#: حصة الرسائل النصية الشهرية بالباقة — افتراض حتى يُحسم العرض؛ لا مُرسِل SMS بعد
SMS_QUOTA = {"trial": 20, "single": 100, "dual": 300}

CATEGORY_LABELS = dict(Notification.CATEGORIES)
CATEGORY_ORDER = {"operational": 0, "account": 1, "marketing": 2}

DEFAULT_PREFS: dict[str, dict[str, bool]] = {
    "operational": {"in_app": True, "sms": True},
    "account": {"in_app": True, "email": False},
    "marketing": {"in_app": False, "email": False},
}


class PrefsRejected(Exception):
    def __init__(self, code: str, field: str = "", extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.field = field
        self.extra = extra or {}


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ------------------------------------------------------------------------------ البثّ والاشتقاق


def emit(
    *,
    kind: str,
    category: str,
    title: str,
    body: str = "",
    href: str = "",
    screen: str = "",
    needs_action: bool = False,
    owner_only: bool = False,
    branch_id: uuid.UUID | None = None,
    dedupe_key: str | None = None,
    expires_at: Any = None,
    occurred_at: Any = None,
) -> Notification:
    """يُنشئ إشعاراً مرة واحدة لمفتاحه؛ إن وُجد يعاد إحياؤه (يُلغى `resolved_at`) بلا تكرار."""
    key = dedupe_key or f"{kind}:{uuid.uuid4()}"
    n: Notification | None = Notification.objects.filter(dedupe_key=key).first()
    if n is not None:
        changed = False
        if n.resolved_at is not None:
            n.resolved_at = None
            changed = True
        if n.body != body or n.title != title:
            n.body, n.title = body, title
            changed = True
        if changed:
            n.save(update_fields=["resolved_at", "body", "title"])
        return n
    n = Notification.objects.create(
        tenant_id=require_tenant(),
        kind=kind,
        category=category,
        title=title,
        body=body,
        href=href,
        screen=screen,
        needs_action=needs_action,
        owner_only=owner_only,
        branch_id=branch_id,
        dedupe_key=key,
        occurred_at=occurred_at or timezone.now(),
        expires_at=expires_at,
        link_token=secrets.token_urlsafe(18),
        link_expires_at=(occurred_at or timezone.now()) + LINK_TTL,
    )
    return n


def _resolve_stale(kind: str, live_keys: set[str]) -> None:
    now = timezone.now()
    for n in Notification.objects.filter(kind=kind, resolved_at__isnull=True):
        if n.dedupe_key not in live_keys:
            n.resolved_at = now
            n.save(update_fields=["resolved_at"])


def _days_word(n: int) -> str:
    if n == 1:
        return "يوم"
    if n == 2:
        return "يومين"
    return "أيام" if n <= 10 else "يوماً"


def refresh() -> None:
    """اشتقاق التشغيلي والحسابي من الحالة الحيّة (متكرّر الأثر)."""
    from shifts.models import Shift
    from sync.models import QuarantinedOperation

    now = timezone.now()
    # ١) وردية مفتوحة مهجورة — SHIFT-05 الإقفال الإداري يحتاج حضور المالك
    live: set[str] = set()
    for s in Shift.objects.filter(
        state="open", opened_at__lte=now - ABANDONED_AFTER
    ).select_related("branch"):
        days = max(1, int((now - s.opened_at).total_seconds() // 86400))
        key = f"shift_abandoned:{s.id}"
        live.add(key)
        emit(
            kind="shift_abandoned",
            category="operational",
            title=f"وردية {s.user_name or s.device_name} مفتوحة منذ {days} {_days_word(days)}",
            body="صندوق بلا عدّ. الإقفال الإداري يحتاج حضورك.",
            href="/shifts/review",
            screen="SHIFT-05",
            needs_action=True,
            branch_id=s.branch_id,
            dedupe_key=key,
            occurred_at=s.opened_at + ABANDONED_AFTER,
        )
    _resolve_stale("shift_abandoned", live)
    # ٢) معلّق لم يُرفع من جهاز — SYS-01
    live = set()
    for sess in (
        Session.objects.filter(
            device__isnull=False, revoked_at__isnull=True, reported_pending__gt=0
        )
        .select_related("device")
        .order_by("-reported_pending")
    ):
        assert sess.device is not None
        key = f"pending_upload:{sess.device_id}"
        if key in live:
            continue
        live.add(key)
        emit(
            kind="pending_upload",
            category="operational",
            title=f"{sess.reported_pending} عمليات لم تُرفع من {sess.device.name}",
            body="فصل الجهاز الآن يفقدها.",
            href="/sync",
            screen="SYS-01",
            needs_action=True,
            branch_id=sess.device.branch_id,
            dedupe_key=key,
            occurred_at=sess.reported_pending_at or now,
        )
    _resolve_stale("pending_upload", live)
    # ٣) بنود محجوزة تنتظر قرار المالك — SYS-03
    q = QuarantinedOperation.objects.filter(reviewed_at__isnull=True).count()
    if q:
        emit(
            kind="quarantine_pending",
            category="operational",
            title=f"{q} بنود محجوزة تنتظر قرارك",
            body="تعارضات المزامنة لا تُحسم تلقائياً — القرار للمالك.",
            href="/sync/review",
            screen="SYS-03",
            needs_action=True,
            owner_only=True,
            dedupe_key="quarantine_pending",
        )
        _resolve_stale("quarantine_pending", {"quarantine_pending"})
    else:
        _resolve_stale("quarantine_pending", set())
    # ٤) الاشتراك يقترب من التجديد (10 أيام) أو انتهى — ORG-06
    sub = ensure_subscription()
    d = days_since_expiry(sub, now)
    if d >= 0:
        emit(
            kind="subscription_expired",
            category="account",
            title=f"انتهى اشتراكك قبل {d} {_days_word(d)}" if d else "انتهى اشتراكك اليوم",
            body="البيع مستمر؛ التقارير المتقدمة تتوقف بعد مهلة السماح.",
            href="/org/subscription/expiry",
            screen="ORG-08",
            needs_action=True,
            owner_only=True,
            dedupe_key=f"subscription_expired:{sub.expires_at.date().isoformat()}",
        )
    elif -d <= 10:
        left = -d
        emit(
            kind="subscription_renewal",
            category="account",
            title=f"اشتراكك يُجدَّد بعد {left} {_days_word(left)}",
            body="لا انقطاع متوقع. الدفع يدوي ويحتاج اعتماد المشغّل.",
            href="/org/subscription",
            screen="ORG-06",
            owner_only=True,
            dedupe_key=f"subscription_renewal:{sub.expires_at.date().isoformat()}",
        )
    # ٥) تسويقي: باقة الفروع المتعددة — قابل للإيقاف، لا يُنبَّه به بعد انتهاء العرض (ACC-110)
    if plan_of(sub).code in {"single", "trial"}:
        emit(
            kind="plan_upgrade",
            category="marketing",
            title="باقة الفروع المتعددة متاحة",
            body="تشمل مقارنة الفروع وتقرير الهامش. يمكن إيقاف هذا النوع من الإشعارات.",
            href="/org/subscription",
            screen="ORG-06",
            owner_only=True,
            dedupe_key="plan_upgrade:dual",
        )


# ------------------------------------------------------------------------------ التفضيلات


def prefs_for(user: User) -> NotificationPreference:
    p: NotificationPreference
    p, _ = NotificationPreference.objects.get_or_create(
        tenant_id=require_tenant(), user=user, defaults={"prefs": DEFAULT_PREFS}
    )
    return p


def effective_prefs(p: NotificationPreference) -> dict[str, dict[str, bool]]:
    out = {k: dict(v) for k, v in DEFAULT_PREFS.items()}
    for cat, chans in (p.prefs or {}).items():
        if cat in out and isinstance(chans, dict):
            for ch, on in chans.items():
                if ch in out[cat]:
                    out[cat][ch] = bool(on)
    out["operational"]["in_app"] = True  # دائم — لا يُطفأ
    return out


def sms_balance() -> dict[str, int]:
    quota = SMS_QUOTA.get(plan_of(ensure_subscription()).code, 100)
    return {"remaining": quota, "quota": quota}  # لا مُرسِل SMS بعد — المستهلك 0


def prefs_payload(user: User) -> dict[str, Any]:
    p = prefs_for(user)
    eff = effective_prefs(p)
    counts = {
        "in_app": sum(1 for c in eff.values() if c.get("in_app")),
        "sms": sum(1 for c in eff.values() if c.get("sms")),
        "email": sum(1 for c in eff.values() if c.get("email")),
    }
    return {
        "prefs": eff,
        "destination_email": p.destination_email,
        "phone": "",
        "sms_balance": sms_balance(),
        "counts": counts,
        "updated_at": _iso(p.updated_at),
        "is_owner": user.is_owner,
    }


def save_prefs(user: User, *, prefs: dict[str, Any], email: str | None) -> dict[str, Any]:
    p = prefs_for(user)
    merged = effective_prefs(p)
    for cat, chans in (prefs or {}).items():
        if cat not in merged or not isinstance(chans, dict):
            continue
        for ch, on in chans.items():
            if ch in merged[cat]:
                merged[cat][ch] = bool(on)
    merged["operational"]["in_app"] = True
    dest = (email if email is not None else p.destination_email).strip()
    wants_email = any(c.get("email") for c in merged.values())
    if wants_email and not dest:
        # قناة بلا وجهة: لا نحفظ تفضيلاً معطّلاً — نطلب البريد هنا في مكانه
        raise PrefsRejected("channel_without_destination", "email", {"channel": "email"})
    if dest and "@" not in dest:
        raise PrefsRejected("email_invalid", "email")
    p.prefs = merged
    p.destination_email = dest
    p.save()
    return prefs_payload(user)


# ------------------------------------------------------------------------------ الوارد


def _visible(n: Notification, viewer: home.Viewer) -> bool:
    if viewer.is_owner:
        return True
    if n.branch_id is not None and viewer.branch is not None and n.branch_id != viewer.branch.id:
        return False
    return True


def item_payload(n: Notification, viewer: home.Viewer, *, now: Any = None) -> dict[str, Any]:
    now = now or timezone.now()
    locked = n.owner_only and not viewer.is_owner
    expired = n.expires_at is not None and n.expires_at <= now
    return {
        "id": str(n.id),
        "kind": n.kind,
        "category": n.category,
        "category_label": CATEGORY_LABELS.get(n.category, n.category),
        "title": n.title,
        # العنوان بلا التفصيل لمن لا يملك فتحه — «يخصّ المالك»
        "body": "" if locked else n.body,
        "href": "" if locked else n.href,
        "screen": n.screen,
        "needs_action": n.needs_action and not expired and n.resolved_at is None,
        "locked": locked,
        "expired": expired,
        "resolved": n.resolved_at is not None,
        "read": str(viewer.user.id) in [str(x) for x in (n.read_user_ids or [])],
        "occurred_at": _iso(n.occurred_at),
        "expires_at": _iso(n.expires_at),
        "link_token": "" if locked else n.link_token,
        "link_expires_at": _iso(n.link_expires_at),
    }


def inbox(viewer: home.Viewer, *, category: str = "") -> dict[str, Any]:
    refresh()
    prefs = effective_prefs(prefs_for(viewer.user))
    now = timezone.now()
    rows = [
        n
        for n in Notification.objects.order_by("-occurred_at")[:200]
        if _visible(n, viewer)
        # التسويقي الموقوف لا يظهر؛ والمنتهي منه لا يُنبَّه به (ACC-110) لكن يبقى مقروءاً
        and (n.category != "marketing" or prefs["marketing"]["in_app"] or n.expires_at is not None)
    ]
    if category:
        rows = [n for n in rows if n.category == category]
    # التشغيلي فوق التسويقي دائماً؛ داخل الفئة الأحدث أولاً وما يحتاج إجراءً قبل غيره
    rows.sort(
        key=lambda n: (
            CATEGORY_ORDER.get(n.category, 9),
            0 if (n.needs_action and n.resolved_at is None) else 1,
            -n.occurred_at.timestamp(),
        )
    )
    items = [item_payload(n, viewer, now=now) for n in rows]
    return {
        "items": items,
        "needs_action": sum(1 for i in items if i["needs_action"] and not i["locked"]),
        "unread": sum(1 for i in items if not i["read"]),
        "category": category,
        "as_of": _iso(now),
    }


def mark_read(n: Notification, user: User) -> Notification:
    ids = [str(x) for x in (n.read_user_ids or [])]
    if str(user.id) not in ids:
        ids.append(str(user.id))
        n.read_user_ids = ids
        n.save(update_fields=["read_user_ids"])
    return n


def open_link(n: Notification, viewer: home.Viewer, *, token: str) -> dict[str, Any]:
    """الرابط العميق (ACC-113): يُعاد فحص التخويل على الخادم عند الفتح؛ بعد انتهاء الصلاحية نقول
    «انتهت صلاحية هذا الرابط» ونعرض الوجهة بديلاً — لا صفحة خطأ عامة."""
    now = timezone.now()
    if n.owner_only and not viewer.is_owner:
        return {"status": "permission_denied", "title": n.title, "href": ""}
    if token != n.link_token or n.link_expires_at <= now:
        return {"status": "link_expired", "title": n.title, "href": n.href, "screen": n.screen}
    if n.expires_at is not None and n.expires_at <= now:
        return {"status": "expired", "title": n.title, "href": n.href, "screen": n.screen}
    mark_read(n, viewer.user)
    return {"status": "ok", "title": n.title, "href": n.href, "screen": n.screen}
