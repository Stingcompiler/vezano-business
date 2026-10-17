"""متجهات رقم التواصل المشتركة مع `@sting/app-core` (0005 §١٦٤): قاعدة واحدة للواجهة والخادم."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.contact import normalize_contact_phone

VECTORS = Path(__file__).resolve().parents[3] / "packages/app-core/vectors/contact-phone.json"
CASES = json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize(("raw", "expected"), CASES)
def test_contact_phone_matches_app_core(raw: str, expected: str | None) -> None:
    if expected is None:
        with pytest.raises(ValueError):
            normalize_contact_phone(raw)
    else:
        assert normalize_contact_phone(raw) == expected
