"""طلب الجولة من الهبوط ومتابعته — جانب الزائر (0005 §١٤٧، بأمر المالك 2026-10-02).

**التقديم بخطوتين**:
1. `start_submission`: يتحقق من الحقول ومن التكرار، ثم يرسل رمز تحقق إلى البريد (غرض `demo`).
2. `complete_submission`: يؤكّد الرمز، ثم يعيد فحص التكرار، ثم يحفظ الطلب ببريد مؤكَّد.

لا يُحفظ شيء قبل تأكيد البريد. الحقول تُعاد مع الرمز، فلا حالة معلّقة على الخادم.

**كشف التكرار**: طلب سابق بالبريد نفسه، أو برقم الهاتف نفسه (آخر تسعة أرقام)، أو بالاسم نفسه بعد
التطبيع (الهمزات والتاء المربوطة والألف المقصورة والتشكيل والمسافات) يرفض الطلب الجديد برسالة واحدة
تدلّ على صفحة المتابعة. لا تقول أيّ الحقول طابق، ولا تكشف شيئاً عن الطلب الأول.

**المتابعة**: بحث بالبريد أو الهاتف أو الاسم يرسل الرمز إلى **بريد الطلب نفسه**، أياً كان مفتاح البحث
(غرض `track`). بعد التأكيد تُعاد حالة الطلب وتعليقات الفريق المكتوبة لصاحبه، مع رمز متابعة موقَّع
صالح 30 دقيقة للتحديث بلا رمز جديد.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.core import signing
from django.db.models import Q
from django.utils import timezone

from core.auth import verify
from core.models import VerificationCode
from core.tenancy import platform_context
from stingops.models import DemoRequest, DemoRequestComment

DEMO = VerificationCode.Purpose.DEMO
TRACK = VerificationCode.Purpose.TRACK
TRACK_TOKEN_SALT = "stingops.demo.track"  # noqa: S105 — ملح توقيع لا سرّ (السرّ SECRET_KEY)
TRACK_TOKEN_MAX_AGE = 30 * 60
RATE_LIMIT_PER_HOUR = 20
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DemoPublicRejected(Exception):
    def __init__(self, code: str, status: int = 400, **extra: Any) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.extra = extra


# ------------------------------------------------------------------ التطبيع


_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_LETTERS = str.maketrans(
    {"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي"}
)


def email_key(email: str) -> str:
    return email.strip().lower()


def phone_key(phone: str) -> str:
    """آخر تسعة أرقام: 0912345678 و+249912345678 و00249912345678 رقم واحد."""
    digits = re.sub(r"\D", "", phone.translate(_ARABIC_DIGITS))
    return digits[-9:] if len(digits) >= 9 else digits


def name_key(name: str) -> str:
    """الاسم بلا تشكيل ولا تطويل؛ الهمزات ألف، والتاء المربوطة هاء، والألف المقصورة ياء؛
    ومسافة واحدة بين الكلمات."""
    s = unicodedata.normalize("NFKC", name).translate(_LETTERS).casefold()
    s = "".join(ch for ch in s if not unicodedata.combining(ch) and ch != "ـ")
    return " ".join(s.split())


def mask_email(email: str) -> str:
    """ar•••@gmail.com — يكفي ليعرف صاحبه أين وصل الرمز، ولا يكشف البريد كاملاً لغيره."""
    local, _, domain = email.partition("@")
    head = local[:2] if len(local) > 2 else local[:1]
    return f"{head}•••@{domain}"


# ------------------------------------------------------------------ التقديم


@dataclass(frozen=True)
class Submission:
    name: str
    whatsapp: str
    email: str
    channel: str
    message: str


def clean(data: dict[str, Any]) -> Submission:
    name = str(data.get("name") or "").strip()[:200]
    whatsapp = "".join(
        ch
        for ch in str(data.get("whatsapp") or "").translate(_ARABIC_DIGITS)
        if ch.isdigit() or ch == "+"
    )
    email = email_key(str(data.get("email") or ""))
    channel = str(data.get("channel") or "")
    message = str(data.get("message") or "").strip()[:2000]
    if not name:
        raise DemoPublicRejected("name_required")
    if len(whatsapp.lstrip("+")) < 8:
        raise DemoPublicRejected("whatsapp_invalid")
    if not email:
        raise DemoPublicRejected("email_required")
    if not _EMAIL_RE.match(email):
        raise DemoPublicRejected("email_invalid")
    if channel not in DemoRequest.Channel.values:
        raise DemoPublicRejected("channel_invalid")
    return Submission(name, whatsapp, email, channel, message)


def find_duplicate(s: Submission) -> DemoRequest | None:
    q = Q(email=s.email) | Q(phone_key=phone_key(s.whatsapp)) | Q(name_key=name_key(s.name))
    with platform_context():
        return DemoRequest.objects.filter(q).order_by("-created_at").first()


def _rate_limited(ip: str) -> bool:
    since = timezone.now() - timedelta(hours=1)
    with platform_context():
        return (
            DemoRequest.objects.filter(source_path=ip, created_at__gte=since).count()
            >= RATE_LIMIT_PER_HOUR
        )


def _duplicate_error() -> DemoPublicRejected:
    return DemoPublicRejected("duplicate", 409, track_url="/demo/track")


def _send(identifier: str, purpose: str) -> dict[str, Any]:
    try:
        r = verify.request_code(identifier, purpose)
    except verify.ResendTooSoon as e:
        raise DemoPublicRejected(
            "resend_too_soon", 429, retry_after=e.retry_after_seconds
        ) from None
    except verify.ResendLimit:
        raise DemoPublicRejected("resend_limit", 429) from None
    except verify.SendUnavailable:
        raise DemoPublicRejected("send_failed", 503) from None
    return {
        "sent_to": mask_email(identifier),
        "code_length": verify.POLICY.code_length,
        "expires_at": r.expires_at.isoformat().replace("+00:00", "Z"),
        "resend_after_seconds": r.resend_after_seconds,
        "resends_left": r.resends_left,
    }


def _confirm(identifier: str, purpose: str, code: str) -> None:
    try:
        verify.confirm_code(identifier, purpose, code)
    except verify.CodeInvalid as e:
        raise DemoPublicRejected("code_invalid", 400, attempts_left=e.attempts_left) from None
    except verify.CodeExpired:
        raise DemoPublicRejected("code_expired", 400) from None


def start_submission(data: dict[str, Any], *, ip: str) -> dict[str, Any]:
    s = clean(data)
    if _rate_limited(ip):
        raise DemoPublicRejected("too_many", 429)
    if find_duplicate(s) is not None:
        raise _duplicate_error()
    return _send(s.email, DEMO)


def complete_submission(data: dict[str, Any], code: str, *, ip: str) -> dict[str, Any]:
    s = clean(data)
    if not code.strip():
        raise DemoPublicRejected("code_required")
    _confirm(s.email, DEMO, code)
    # بين الخطوتين قد يصل طلب آخر بالبيانات نفسها — الفحص الثاني بعد التأكيد هو الحاسم
    if find_duplicate(s) is not None:
        raise _duplicate_error()
    with platform_context():
        req = DemoRequest.objects.create(
            name=s.name,
            whatsapp=s.whatsapp,
            email=s.email,
            channel=s.channel,
            message=s.message,
            source_path=ip,
            email_verified_at=timezone.now(),
            phone_key=phone_key(s.whatsapp),
            name_key=name_key(s.name),
        )
    return {"id": str(req.id), "reference": reference(req), "track_url": "/demo/track"}


# ------------------------------------------------------------------ المتابعة


def reference(r: DemoRequest) -> str:
    return str(r.id)[-6:].upper()


def find_for_tracking(query: str) -> DemoRequest | None:
    """البحث بالبريد أو الهاتف أو الاسم — الأحدث إن تعدّد (الاسم قد يتكرّر بين أشخاص)."""
    q = query.strip()
    if not q:
        return None
    if "@" in q:
        cond = Q(email=email_key(q))
    elif len(re.sub(r"\D", "", q.translate(_ARABIC_DIGITS))) >= 8:
        cond = Q(phone_key=phone_key(q))
    else:
        cond = Q(name_key=name_key(q))
    with platform_context():
        return DemoRequest.objects.filter(cond).order_by("-created_at").first()


def track_start(query: str) -> dict[str, Any]:
    r = find_for_tracking(query)
    if r is None:
        raise DemoPublicRejected("not_found", 404)
    if not r.email:
        # طلبات قديمة قبل إلزام البريد — المتابعة عبر الدعم
        raise DemoPublicRejected("no_email", 409)
    return _send(r.email, TRACK)


def track_verify(query: str, code: str) -> dict[str, Any]:
    r = find_for_tracking(query)
    if r is None:
        raise DemoPublicRejected("not_found", 404)
    if not code.strip():
        raise DemoPublicRejected("code_required")
    _confirm(r.email, TRACK, code)
    token = signing.dumps(str(r.id), salt=TRACK_TOKEN_SALT)
    return {"token": token, "request": track_payload(r)}


def track_by_token(token: str) -> dict[str, Any]:
    try:
        rid = signing.loads(token, salt=TRACK_TOKEN_SALT, max_age=TRACK_TOKEN_MAX_AGE)
    except signing.SignatureExpired:
        raise DemoPublicRejected("token_expired", 401) from None
    except signing.BadSignature:
        raise DemoPublicRejected("token_invalid", 401) from None
    with platform_context():
        r = DemoRequest.objects.filter(id=uuid.UUID(str(rid))).first()
    if r is None:
        raise DemoPublicRejected("not_found", 404)
    return {"request": track_payload(r)}


#: ما تعنيه كل حالة لصاحب الطلب — بلا وعد بموعد (G-02)
STATUS_NOTE: dict[str, str] = {
    DemoRequest.Status.NEW: "وصل طلبك وينتظر أول تواصل من الفريق.",
    DemoRequest.Status.CONTACTED: "تواصل الفريق معك أو يرتّب موعد الجولة.",
    DemoRequest.Status.CONVERTED: "سُجّلت منشأتك — أهلاً بك في فيزانو بلص.",
    DemoRequest.Status.CLOSED: "أُغلق الطلب. إن احتجت جولة أخرى فاكتب للدعم.",
}


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def track_payload(r: DemoRequest) -> dict[str, Any]:
    with platform_context():
        comments = list(DemoRequestComment.objects.filter(request=r).order_by("created_at"))
    return {
        "reference": reference(r),
        "name": r.name,
        "channel": r.channel,
        "channel_label": DemoRequest.Channel(r.channel).label,
        "status": r.status,
        "status_label": DemoRequest.Status(r.status).label,
        "status_note": STATUS_NOTE[DemoRequest.Status(r.status)],
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.handled_at or r.created_at),
        "email": mask_email(r.email) if r.email else "",
        "comments": [
            {"body": c.body, "author": c.author_name or "فريق فيزانو بلص", "at": _iso(c.created_at)}
            for c in comments
        ],
    }
