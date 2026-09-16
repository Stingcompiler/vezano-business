"""تطبيع البحث (§٧.٥) — مرآة `packages/domain/src/search.ts` بمتجهات مشتركة (search.json)."""

from __future__ import annotations

import re

_TASHKEEL = re.compile(r"[ً-ٰٟـ]")
_ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_search(text: str, *, unify_ta_marbuta: bool = False, strip_al: bool = False) -> str:
    s = _TASHKEEL.sub("", text)
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = s.replace("ى", "ي").replace("ئ", "ي").replace("ؤ", "و")
    s = s.translate(_ARABIC_INDIC).lower()
    s = re.sub(r"\s+", " ", s).strip()
    if unify_ta_marbuta:
        s = s.replace("ة", "ه")
    if strip_al:
        s = re.sub(r"(^| )ال(?=\S)", r"\1", s)
    return s


def matches_prefix(
    haystack: str, query: str, *, unify_ta_marbuta: bool = False, strip_al: bool = False
) -> bool:
    q = normalize_search(query, unify_ta_marbuta=unify_ta_marbuta, strip_al=strip_al)
    if not q:
        return True
    h = normalize_search(haystack, unify_ta_marbuta=unify_ta_marbuta, strip_al=strip_al)
    return h.startswith(q) or f" {q}" in h
