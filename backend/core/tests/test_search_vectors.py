"""متجهات تطبيع البحث المشتركة (§٧.٥) على النظير Python."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from core.search_normalize import matches_prefix, normalize_search

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "packages/domain/vectors/search.json").read_text(
        encoding="utf-8"
    )
)


def _opts(v: dict[str, Any]) -> dict[str, bool]:
    o = v.get("options", {})
    return {"unify_ta_marbuta": bool(o.get("unifyTaMarbuta")), "strip_al": bool(o.get("stripAl"))}


@pytest.mark.parametrize("v", VECTORS["normalize"], ids=lambda v: v["in"])
def test_normalize(v: dict[str, Any]) -> None:
    assert normalize_search(v["in"], **_opts(v)) == v["out"]


@pytest.mark.parametrize("v", VECTORS["prefix"], ids=lambda v: f"{v['haystack']}<{v['query']}")
def test_prefix(v: dict[str, Any]) -> None:
    assert matches_prefix(v["haystack"], v["query"], **_opts(v)) is v["match"]
