"""طلب الجولة ومتابعته من جانب الزائر (0005 §١٤٧): البريد يُؤكَّد برمز قبل الحفظ، والتكرار بالبريد أو
الهاتف أو الاسم يُرفض برسالة تدلّ على المتابعة، والمتابعة ترسل الرمز إلى بريد الطلب أياً كان البحث."""

from __future__ import annotations

from typing import Any

import pytest
from django.core.cache import cache
from django.test import Client

from core.auth import verify
from core.tests.test_org import _post, ctx  # noqa: F401
from stingops.models import DemoRequest
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

BASE: dict[str, Any] = {
    "name": "أحمد الطيب",
    "whatsapp": "0912345678",
    "email": "Ahmed@Example.com",
    "channel": "whatsapp",
    "message": "بقالة بفرعين",
}


@pytest.fixture(autouse=True)
def _faults(monkeypatch: pytest.MonkeyPatch) -> None:
    # الرموز تُقرأ من مرسِل التطوير (لا مزوّد إرسال في الاختبار)
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    cache.clear()


def _json(c: Client, url: str, data: dict[str, Any]) -> Any:
    return c.post(url, data, content_type="application/json")


def submit_demo(c: Client, data: dict[str, Any]) -> Any:
    """الخطوتان: رمز إلى البريد ثم الحفظ به — مساعد للاختبارات الأخرى أيضاً."""
    r = _json(c, "/api/public/contact/start", data)
    assert r.status_code == 200, r.content
    code = verify.dev_code_for(str(data["email"]))
    return _json(c, "/api/public/contact", {**data, "code": code})


def test_submission_needs_verified_email() -> None:
    c = Client()
    assert _json(c, "/api/public/contact/start", {**BASE, "email": ""}).json()["detail"] == (
        "email_required"
    )
    assert _json(c, "/api/public/contact/start", {**BASE, "email": "x"}).json()["detail"] == (
        "email_invalid"
    )
    bad_phone = _json(c, "/api/public/contact/start", {**BASE, "whatsapp": "12"})
    assert bad_phone.json()["detail"] == "whatsapp_invalid"
    r = _json(c, "/api/public/contact/start", BASE)
    assert r.status_code == 200 and r.json()["sent_to"] == "ah•••@example.com"
    assert DemoRequest.objects.count() == 0  # لا شيء قبل تأكيد البريد
    no_code = _json(c, "/api/public/contact", BASE)
    assert no_code.json()["detail"] == "code_required"
    wrong = _json(c, "/api/public/contact", {**BASE, "code": "000000"})
    assert wrong.status_code == 400 and wrong.json()["detail"] == "code_invalid"
    assert wrong.json()["attempts_left"] >= 1
    code = verify.dev_code_for(BASE["email"])
    ok = _json(c, "/api/public/contact", {**BASE, "code": code})
    assert ok.status_code == 201 and len(ok.json()["reference"]) == 6
    saved = DemoRequest.objects.get()
    assert saved.email == "ahmed@example.com" and saved.email_verified_at is not None
    assert saved.phone_key == "912345678" and saved.name_key == "احمد الطيب"


@pytest.mark.parametrize(
    "change",
    [
        {"email": "AHMED@example.com", "whatsapp": "0999000111", "name": "شخص آخر"},
        {"email": "other@example.com", "whatsapp": "+249 912 345 678", "name": "شخص آخر"},
        {"email": "other@example.com", "whatsapp": "0999000111", "name": "  أحمـد   الطّيب "},
    ],
    ids=["same-email", "same-phone-intl", "same-name-normalized"],
)
def test_duplicate_points_to_tracking(change: dict[str, str]) -> None:
    c = Client()
    assert submit_demo(c, BASE).status_code == 201
    r = _json(c, "/api/public/contact/start", {**BASE, **change})
    assert r.status_code == 409
    # رسالة واحدة تدلّ على المتابعة — لا تقول أيّ الحقول طابق ولا تكشف الطلب الأول
    assert r.json() == {"detail": "duplicate", "track_url": "/demo/track"}
    assert DemoRequest.objects.count() == 1


def test_duplicate_arriving_between_the_two_steps_is_rejected() -> None:
    c = Client()
    first = {**BASE, "email": "first@example.com", "name": "الأول"}
    assert _json(c, "/api/public/contact/start", first).status_code == 200
    code = verify.dev_code_for(first["email"])
    # طلب آخر بالرقم نفسه يكتمل قبل أن يُدخل الأول رمزه
    assert submit_demo(c, {**BASE, "email": "second@example.com"}).status_code == 201
    late = _json(c, "/api/public/contact", {**first, "code": code})
    assert late.status_code == 409 and late.json()["detail"] == "duplicate"


def test_tracking_sends_code_to_request_email_whatever_the_search(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    c = Client()
    assert submit_demo(c, BASE).status_code == 201
    assert _json(c, "/api/public/demo-track/start", {"query": "0900000000"}).status_code == 404
    # بالهاتف بصيغة أخرى — الرمز إلى بريد الطلب
    start = _json(c, "/api/public/demo-track/start", {"query": "+249912345678"})
    assert start.status_code == 200 and start.json()["sent_to"] == "ah•••@example.com"
    wrong = _json(c, "/api/public/demo-track/verify", {"query": "0912345678", "code": "1"})
    assert wrong.json()["detail"] == "code_invalid"
    code = verify.dev_code_for("ahmed@example.com")
    ok = _json(c, "/api/public/demo-track/verify", {"query": "0912345678", "code": code})
    assert ok.status_code == 200
    req = ok.json()["request"]
    assert req["status"] == "new" and req["comments"] == []
    assert req["status_note"].startswith("وصل طلبك")
    # الفريق يكتب لصاحب الطلب — يظهر في المتابعة برمز المتابعة بلا رمز جديد
    oh = _operator_headers("ops7", "هدى — تشغيل")
    rid = DemoRequest.objects.get().id
    r = _post(
        c,
        oh,
        f"/api/platform/demo-requests/{rid}",
        {"status": "contacted", "comment": "سنتصل بك الأحد صباحاً"},
    )
    assert r.status_code == 200 and r.json()["request"]["comments"][0]["body"].startswith("سنتصل")
    token = ok.json()["token"]
    again = c.get("/api/public/demo-track", {"token": token}).json()["request"]
    assert again["status"] == "contacted"
    assert [x["body"] for x in again["comments"]] == ["سنتصل بك الأحد صباحاً"]
    assert c.get("/api/public/demo-track", {"token": "x"}).status_code == 401
    # بالاسم بصيغة أخرى أيضاً
    by_name = _json(c, "/api/public/demo-track/start", {"query": "احمد الطيب"})
    assert by_name.status_code in (200, 429)  # 429 إن لم تنقضِ مهلة إعادة الإرسال للبريد نفسه


def test_tracking_legacy_request_without_email() -> None:
    DemoRequest.objects.create(
        name="قديم", whatsapp="0911111111", channel="call", phone_key="911111111", name_key="قديم"
    )
    r = _json(Client(), "/api/public/demo-track/start", {"query": "0911111111"})
    assert r.status_code == 409 and r.json()["detail"] == "no_email"
