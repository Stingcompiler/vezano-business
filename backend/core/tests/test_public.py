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
    # صفحة المقارنة: كل خاصية بقيمتها لكل باقة، والحدود رقماً
    cmp_ = p["comparison"]
    by_code = {f["code"]: f["values"] for f in cmp_["features"]}
    assert by_code["multi_branch"] == {"single": False, "dual": True, "trial": False}
    assert cmp_["limits"][0]["values"]["dual"] == "2" and cmp_["stops"]
    lg = c.get("/api/public/legal").json()
    assert lg["blocked_on"] == "G-11"
    assert {s["status"] for s in lg["sections"]} == {"decided", "pending"}
    # مسودة السودان: نصّ لكل بند وتمهيد، والاعتماد موقوف على G-11
    assert all(s["body"] for s in lg["sections"]) and len(lg["preamble"]) >= 6
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


def test_public_contact_saves_demo_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """قسم «تواصل» في PUB-01: طلب الجولة يُحفظ برقم قصير بعد تأكيد البريد برمز (0005 §١٤٧)؛
    واتساب قصير أو بريد بلا @ يُرفضان بوضوح؛ لا وعد بموعد في الردّ."""
    from stingops.models import DemoRequest
    from stingops.tests.test_demo_public import submit_demo

    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    c = Client()
    data = {
        "name": "مصعب",
        "whatsapp": "0912 447 001",
        "email": "musab@example.com",
        "channel": "whatsapp",
    }
    r = submit_demo(c, data)
    assert r.status_code == 201, r.content
    body: dict[str, Any] = r.json()
    assert len(body["reference"]) == 6
    saved = DemoRequest.objects.get(id=body["id"])
    assert saved.whatsapp == "0912447001" and saved.channel == "whatsapp"
    r = c.post(
        "/api/public/contact/start",
        data={**data, "whatsapp": "12"},
        content_type="application/json",
    )
    assert (r.status_code, r.json()["detail"]) == (400, "whatsapp_invalid")
    r = c.post(
        "/api/public/contact/start",
        data={**data, "email": "no-at"},
        content_type="application/json",
    )
    assert (r.status_code, r.json()["detail"]) == (400, "email_invalid")


def test_legal_preamble_registry_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """رقم السجل التجاري من بيئة النشر، وبلا المتغيّر يبقى موضعه ظاهراً (0005 §١٣٩)."""
    from core.legal_text import REGISTRY_PLACEHOLDER, legal_preamble

    monkeypatch.delenv("STING_COMMERCIAL_REGISTRY", raising=False)
    assert REGISTRY_PLACEHOLDER in legal_preamble()[0]
    monkeypatch.setenv("STING_COMMERCIAL_REGISTRY", "12345")
    first = legal_preamble()[0]
    assert "بسجل رقم 12345" in first and REGISTRY_PLACEHOLDER not in first


def test_client_ip_behind_proxies(monkeypatch: pytest.MonkeyPatch) -> None:
    """خلف Caddy ثم Next: الزائر ثاني عنوان من اليمين، وما يزوّره يبقى يساراً (0005 §١٤٠)."""
    from django.test import RequestFactory

    from core.public_views import client_ip

    rf = RequestFactory()
    spoofed = rf.post("/", HTTP_X_FORWARDED_FOR="6.6.6.6, 41.1.2.3, 172.18.0.5")
    spoofed.META["REMOTE_ADDR"] = "172.18.0.4"
    monkeypatch.delenv("STING_PROXY_HOPS", raising=False)
    assert client_ip(spoofed) == "172.18.0.4"  # type: ignore[arg-type]
    monkeypatch.setenv("STING_PROXY_HOPS", "2")
    assert client_ip(spoofed) == "41.1.2.3"  # type: ignore[arg-type]
    single = rf.post("/", HTTP_X_FORWARDED_FOR="41.1.2.3")
    assert client_ip(single) == "41.1.2.3"  # type: ignore[arg-type]
