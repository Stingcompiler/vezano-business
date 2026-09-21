"""PLT-00 (بأمر المالك 2026-09-21): لوحة النظرة العامة — عدّادات من السجل بروابط شاشاتها؛ الموقوف
وطلب الجولة الجديد يرفعان «يحتاج انتباهاً»؛ لا مبيعات ولا زبائن في الحمولة."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_overview_counts(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops4", "هدى — تشغيل")
    assert c.get("/api/platform/overview", headers=_h(ctx["tokens"]["owner"])).status_code == 403
    o = c.get("/api/platform/overview", headers=oh).json()
    assert o["tenants_total"] >= 1 and o["measured_at"]
    tiles = {t["key"]: t for t in o["subscriptions"] + o["queues"] + o["technical"]}
    assert tiles["trial"]["value"] >= 1 and tiles["suspended"]["value"] == 0
    assert tiles["demo"]["value"] == 0 and tiles["demo"]["href"] == "/platform/demo-requests"
    base = o["attention"]
    for forbidden in ("sales", "revenue", "customers", "receivable"):
        assert forbidden not in str(o)
    # طلب جولة جديد + إيقاف مستأجر → العدّادات والانتباه يرتفعان، والبطاقات تتلوّن
    c.post(
        "/api/public/contact",
        {"name": "أحمد", "whatsapp": "0912345678", "channel": "call"},
        content_type="application/json",
    )
    _post(
        c,
        oh,
        f"/api/platform/tenants/{ctx['tenant'].id}/subscription",
        {"action": "suspend", "reason": "تحقق"},
    )
    o = c.get("/api/platform/overview", headers=oh).json()
    tiles = {t["key"]: t for t in o["subscriptions"] + o["queues"] + o["technical"]}
    assert tiles["demo"]["value"] == 1 and tiles["demo"]["tone"] == "warn"
    assert tiles["suspended"]["value"] == 1 and tiles["suspended"]["tone"] == "danger"
    assert tiles["suspended"]["href"] == "/platform/tenants?filter=suspended"
    assert o["attention"] == base + 2
