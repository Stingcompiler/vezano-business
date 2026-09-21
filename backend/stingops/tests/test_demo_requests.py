"""PLT-14 (بأمر المالك 2026-09-21): طلبات الجولة — القائمة بحالتها وعدّاداتها، والانتقالات
المسموحة فقط، وملاحظة إلزامية عند الإغلاق/التحوّل، وكل تغيير باسم المشغّل ووقته."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import DemoRequest, OperatorAccessLog
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_demo_requests_flow(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    # طلب من الهبوط (PUB-01) — بلا جلسة
    r = c.post(
        "/api/public/contact",
        {
            "name": "أحمد",
            "whatsapp": "0912345678",
            "channel": "whatsapp",
            "message": "متجر مواد غذائية",
        },
        content_type="application/json",
    )
    assert r.status_code == 201
    oh = _operator_headers("ops3", "هدى — تشغيل")
    assert (
        c.get("/api/platform/demo-requests", headers=_h(ctx["tokens"]["owner"])).status_code == 403
    )
    p = c.get("/api/platform/demo-requests", headers=oh).json()
    assert p["counts"]["new"] == 1 and p["counts"]["open"] == 1 and p["filter"] == "open"
    row = p["requests"][0]
    assert row["status"] == "new" and row["channel_label"] == "واتساب"
    assert set(row["next"]) == {"closed", "contacted"}
    url = f"/api/platform/demo-requests/{row['id']}"
    # انتقال غير مسموح: جديد → تحوّل
    assert _post(c, oh, url, {"status": "converted", "note": "x"}).status_code == 409
    # بلا تغيير ولا ملاحظة
    assert _post(c, oh, url, {}).json()["detail"] == "nothing_to_change"
    # تواصلنا
    r = _post(c, oh, url, {"status": "contacted"})
    assert r.status_code == 200 and r.json()["request"]["handled_by_name"] == "هدى — تشغيل"
    # التحوّل يحتاج ملاحظة
    assert _post(c, oh, url, {"status": "converted"}).json()["detail"] == "note_required"
    r = _post(c, oh, url, {"status": "converted", "note": "سجّل منشأة «بقالة أحمد»"})
    assert r.status_code == 200 and r.json()["request"]["next"] == []
    p = c.get("/api/platform/demo-requests?status=converted", headers=oh).json()
    assert p["counts"]["open"] == 0 and len(p["requests"]) == 1
    assert c.get("/api/platform/demo-requests", headers=oh).json()["requests"] == []
    with_all = c.get("/api/platform/demo-requests?status=all", headers=oh).json()
    assert len(with_all["requests"]) == 1
    assert OperatorAccessLog.objects.filter(action="demo.update").count() == 2
    assert DemoRequest.objects.get().note.startswith("سجّل منشأة")
