"""رقم التواصل وروابط واتساب (0005 §١٥٠).

التسجيل بالبريد وحده (§١٤٩)، لكن رقم الهاتف إلزامي للتواصل: يفتح منه فريق فيزانو محادثة واتساب
بضغطة. الرقم غير مؤكَّد برمز، فهو وسيلة تواصل لا هوية دخول.
"""

from __future__ import annotations

import re

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_contact_phone(raw: str) -> str:
    """رقم سوداني محلي أو دولي إلى صيغة دولية `+249…`؛ يرفع ValueError إن لم يكن رقماً مقبولاً."""
    s = raw.strip().translate(_ARABIC_DIGITS)
    digits = re.sub(r"[^\d+]", "", s)
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    bare = digits.lstrip("+")
    if not bare.isdigit() or not 9 <= len(bare) <= 15:
        raise ValueError("phone")
    if digits.startswith("+"):
        return digits
    if bare.startswith("249"):
        return "+" + bare
    if bare.startswith("0") and len(bare) == 10:
        return "+249" + bare[1:]
    if len(bare) == 9:  # 912345678 بلا الصفر
        return "+249" + bare
    return "+" + bare


def whatsapp_url(phone: str) -> str:
    """رابط محادثة واتساب (`https://wa.me/249912345678`) أو فارغ إن لم يكن الرقم صالحاً."""
    try:
        e164 = normalize_contact_phone(phone)
    except ValueError:
        return ""
    return f"https://wa.me/{e164.lstrip('+')}"
