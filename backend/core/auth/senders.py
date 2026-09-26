"""قنوات إرسال رمز التحقق (G-02 — 0005 §١١٧، قرار نيابة عن المالك 2026-09-23).

الترتيب للهاتف: واتساب (قالب «مصادقة» عبر WhatsApp Cloud API — نحو 0.02$ للرسالة في منطقة «بقية
أفريقيا») ثم رسالة نصية عبر مجمِّع بمسارات مباشرة لمشغّلي السودان (زين، MTN، سوداني) — النصية تصل
أثناء قطع بيانات الجوال ولذا هي الاحتياط لا الأصل لغلائها (0.36–0.47$ عبر المسارات الدولية).
للبريد: SMTP (أي مزوّد: Resend، Amazon SES…). بعد فشل كل القنوات يبقى التحقق اليدوي (§٢).

لا شيء يُفعَّل بلا إعداد: بلا متغيرات البيئة يبقى `StoredSender` (التطوير والاختبار) كما كان.

المتغيرات:
- `STING_VERIFY_PHONE_CHANNELS` — ترتيب قنوات الهاتف، افتراضاً `whatsapp,sms`.
- `STING_WHATSAPP_TOKEN`، `STING_WHATSAPP_PHONE_ID`، `STING_WHATSAPP_TEMPLATE` (افتراضاً
  `verify_code`)، `STING_WHATSAPP_LANG` (افتراضاً `ar`).
- `STING_SMS_URL`، `STING_SMS_TOKEN`، `STING_SMS_SENDER` (افتراضاً `VEZANO` — يُسجَّل لدى المشغّلين
  وهيئة تنظيم الاتصالات والبريد قبل الإطلاق). واجهة JSON على نمط Infobip:
  `{"messages": [{"from", "destinations": [{"to"}], "text"}]}` بترويسة `Authorization: App <token>`.
- `STING_EMAIL_FROM` مع إعدادات Django البريدية (`EMAIL_HOST`…) لقناة البريد.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any

from django.core.mail import send_mail

from core.auth.verify import SendFailed, StoredSender, VerificationSender

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10
GRAPH_VERSION = "v21.0"

#: نصّ الرسالة النصية والبريد — الرمز بأرقام لاتينية، بلا رابط (رسائل الرموز بروابط تُحجب وتُصاد)
CODE_TEXT = "رمز التحقق في فيزانو بلص: {code}\nصالح 10 دقائق. لا تشاركه مع أحد."

Poster = Callable[[str, dict[str, Any], dict[str, str]], None]


def _post_json(url: str, body: dict[str, Any], headers: dict[str, str]) -> None:
    req = urllib.request.Request(  # noqa: S310 — العنوان من إعداد المشغّل لا من المستخدم
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310
            if resp.status >= 300:
                raise SendFailed
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise SendFailed from e


def to_e164_sd(phone: str) -> str:
    """رقم سوداني محلي (`0912345678`) أو دولي بلا + إلى E.164 (`+249912345678`)."""
    if phone.startswith("+"):
        return phone
    if phone.startswith("249"):
        return "+" + phone
    if phone.startswith("0") and len(phone) == 10:
        return "+249" + phone[1:]
    return "+" + phone


class WhatsAppSender:
    """قالب «مصادقة» معتمد لدى Meta: متن فيه الرمز وزرّ نسخه."""

    def __init__(self, *, token: str, phone_id: str, template: str, lang: str, post: Poster):
        self.token, self.phone_id, self.template, self.lang = token, phone_id, template, lang
        self.post = post

    def send(self, identifier: str, code: str) -> None:
        self.post(
            f"https://graph.facebook.com/{GRAPH_VERSION}/{self.phone_id}/messages",
            {
                "messaging_product": "whatsapp",
                "to": to_e164_sd(identifier).lstrip("+"),
                "type": "template",
                "template": {
                    "name": self.template,
                    "language": {"code": self.lang},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": code}]},
                        {
                            "type": "button",
                            "sub_type": "url",
                            "index": "0",
                            "parameters": [{"type": "text", "text": code}],
                        },
                    ],
                },
            },
            {"Authorization": f"Bearer {self.token}"},
        )


class SmsSender:
    def __init__(self, *, url: str, token: str, sender: str, post: Poster):
        self.url, self.token, self.sender, self.post = url, token, sender, post

    def send(self, identifier: str, code: str) -> None:
        self.post(
            self.url,
            {
                "messages": [
                    {
                        "from": self.sender,
                        "destinations": [{"to": to_e164_sd(identifier).lstrip("+")}],
                        "text": CODE_TEXT.format(code=code),
                    }
                ]
            },
            {"Authorization": f"App {self.token}"},
        )


class EmailSender:
    def __init__(self, *, from_email: str):
        self.from_email = from_email

    def send(self, identifier: str, code: str) -> None:
        try:
            send_mail(
                "رمز التحقق في فيزانو بلص",
                CODE_TEXT.format(code=code),
                self.from_email,
                [identifier],
                fail_silently=False,
            )
        except Exception as e:  # noqa: BLE001 — أي فشل SMTP = فشل إرسال يُحصى
            raise SendFailed from e


class RoutedSender:
    """يوجّه بحسب نوع المعرّف ويجرّب قنوات الهاتف بالترتيب؛ يفشل فقط إن فشلت كلها."""

    def __init__(self, *, phone: list[VerificationSender], email: VerificationSender | None):
        self.phone, self.email = phone, email

    def send(self, identifier: str, code: str) -> None:
        chain = ([self.email] if self.email else []) if "@" in identifier else self.phone
        if not chain:
            raise SendFailed
        for sender in chain:
            try:
                sender.send(identifier, code)
                return
            except SendFailed:
                log.warning("verify channel failed: %s", type(sender).__name__)
        raise SendFailed


def build_sender(
    env: Mapping[str, str] | None = None, post: Poster = _post_json
) -> VerificationSender:
    """المرسِل من البيئة؛ بلا أي قناة مضبوطة يعود `StoredSender` (سلوك التطوير)."""
    env = os.environ if env is None else env
    channels: dict[str, VerificationSender] = {}
    if env.get("STING_WHATSAPP_TOKEN") and env.get("STING_WHATSAPP_PHONE_ID"):
        channels["whatsapp"] = WhatsAppSender(
            token=env["STING_WHATSAPP_TOKEN"],
            phone_id=env["STING_WHATSAPP_PHONE_ID"],
            template=env.get("STING_WHATSAPP_TEMPLATE", "verify_code"),
            lang=env.get("STING_WHATSAPP_LANG", "ar"),
            post=post,
        )
    if env.get("STING_SMS_URL") and env.get("STING_SMS_TOKEN"):
        channels["sms"] = SmsSender(
            url=env["STING_SMS_URL"],
            token=env["STING_SMS_TOKEN"],
            sender=env.get("STING_SMS_SENDER", "VEZANO"),
            post=post,
        )
    email = EmailSender(from_email=env["STING_EMAIL_FROM"]) if env.get("STING_EMAIL_FROM") else None
    if not channels and email is None:
        return StoredSender()
    order = env.get("STING_VERIFY_PHONE_CHANNELS", "whatsapp,sms").split(",")
    phone = [channels[c.strip()] for c in order if c.strip() in channels]
    return RoutedSender(phone=phone, email=email)
