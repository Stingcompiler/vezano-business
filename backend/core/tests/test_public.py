"""PUB-01…03 (T2.16): الصفحات العامة بلا جلسة — الباقات بأسعارها المعلنة (§٥٠)، البنية القانونية
بحالة كل بند (G-11)، وحالة الخدمة بوقت فحصها ومكوّناتها وإعلان الصيانة؛ ولا بيانات مستأجر."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.scenario import faults

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _clear_faults() -> Any:
    faults.clear()
    yield
    faults.clear()


def test_public_plans_legal_and_status() -> None:
    c = Client()
    p = c.get("/api/public/plans").json()
    assert [x["code"] for x in p["plans"]] == ["single", "dual", "trial"]
    assert p["plans"][0]["price_minor"] == "4500000" and p["plans"][2]["trial"] is True
    assert "التصدير الكامل" in p["on_expiry"]["never_hidden"]
    lg = c.get("/api/public/legal").json()
    assert lg["blocked_on"] == "G-11"
    assert {s["status"] for s in lg["sections"]} == {"decided", "pending"}
    st = c.get("/api/public/status").json()
    assert st["overall"] == "ok" and st["checked_at"] and st["maintenance"]["notice"] == ""
    by = {x["id"]: x for x in st["components"]}
    assert by["pos"]["state"] == "ok" and by["market"]["state"] == "not_launched"
    # تجميد المصالحة + صيانة: متأثر وإعلان، وحدث في السجل
    faults.set_fault("freeze_reconciliation", True)
    faults.set_fault("maintenance", True)
    st = c.get("/api/public/status").json()
    assert st["overall"] == "affected" and st["maintenance"]["notice"]
    assert {x["id"]: x["state"] for x in st["components"]}["sync"] == "affected"
    assert st["events"][0]["text"].startswith("تأكيد التعطل في المزامنة")
    # لا مستأجر في أي حمولة عامة
    for body in (p, lg, st):
        assert "tenant" not in str(body)


def test_public_contact_saves_demo_request() -> None:
    """قسم «تواصل» في PUB-01: طلب الجولة يُحفظ على مستوى المنصة برقم قصير؛ واتساب قصير أو بريد
    بلا @ يُرفضان بوضوح؛ لا وعد بموعد في الردّ."""
    from stingops.models import DemoRequest

    c = Client()
    r = c.post(
        "/api/public/contact",
        data={"name": "مصعب", "whatsapp": "0912 447 001", "channel": "whatsapp"},
        content_type="application/json",
    )
    assert r.status_code == 201, r.content
    body: dict[str, Any] = r.json()
    assert len(body["reference"]) == 6
    saved = DemoRequest.objects.get(id=body["id"])
    assert saved.whatsapp == "0912447001" and saved.channel == "whatsapp"
    r = c.post(
        "/api/public/contact",
        data={"name": "x", "whatsapp": "12", "channel": "call"},
        content_type="application/json",
    )
    assert (r.status_code, r.json()["detail"]) == (400, "whatsapp_invalid")
    r = c.post(
        "/api/public/contact",
        data={"name": "x", "whatsapp": "0912447001", "channel": "email", "email": "no-at"},
        content_type="application/json",
    )
    assert (r.status_code, r.json()["detail"]) == (400, "email_invalid")
