"""REP-05/REP-06 (T2.9): الهامش `phase_locked` بلا سياسة تكلفة (عمود المبيعات دقيق وحده)، و`empty`
بأصناف مبيعة بلا تكلفة (نمتنع عن الرقم)، و`ready` حين تكتمل التكاليف؛ للمالك وحده. التصدير:
معاينة الصفحة الأولى، اسم الملف بمداه، حدّ 12 شهراً بالبدائل الثلاثة، الحصة، والتنزيل بالرابط."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.tenancy import tenant_context
from inventory.tests.test_inventory import _api, _cashier, _receipt_op, _sale, ctx  # noqa: F401
from sales.tests.test_sale import do_push

pytestmark = pytest.mark.django_db(transaction=True)


def _put_settings(c: Client, h: dict[str, str], body: dict[str, Any]) -> Any:
    v = c.get("/api/org/settings", **h).json()["version"]  # type: ignore[arg-type]
    return c.put("/api/org/settings", {"version": v, **body}, content_type="application/json", **h)  # type: ignore[arg-type]


def test_margin_phase_locked_then_empty_then_ready(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar, tea = str(ctx["sugar"].id), str(ctx["tea"].id)
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="40000", factor="12000", cost="90000")) == [
        "accepted"
    ]  # كرتونة بـ900.00 → الكيلو 75.00
    assert do_push(ctx, _sale(ctx, sugar, invoice="S-1", qty="2000", price="10000")) == ["accepted"]
    c, h = _api(ctx)
    r = c.get("/api/reports/margin?range=custom&start=2026-09-16&end=2026-09-16", **h)  # type: ignore[arg-type]
    assert r.status_code == 200, r.content
    p = r.json()
    # لا سياسة بعد: مرحلة غير مفعّلة — عمود المبيعات وحده
    assert p["state"] == "phase_locked" and p["policy"] == ""
    assert p["sales_by_branch"][0]["sales_minor"] == "20000" and p["rows"] == []
    # سياسة معتمدة (المالك عبر الإعدادات) — لكن الشاي بلا تكلفة → نمتنع عن الرقم
    assert _put_settings(c, h, {"cost_policy": "weighted_average"}).status_code == 200
    assert do_push(ctx, _sale(ctx, tea, invoice="S-2", qty="1000", price="5000")) == ["accepted"]
    p = c.get("/api/reports/margin?range=custom&start=2026-09-16&end=2026-09-16", **h).json()  # type: ignore[arg-type]
    assert p["state"] == "empty" and p["policy_label"] == "المتوسط المرجَّح من مستندات الشراء"
    assert p["missing"]["uncosted_items"] == 1 and p["missing"]["sold_items"] == 2
    assert p["missing"]["top_uncosted"][0]["name"] == "شاي أسود 250غ"
    # تكلفة للشاي (كيلو بـ30.00) → جاهز: الهامش بالفرع وبالمجموعة، لا رقم تقريبي
    op = _receipt_op(ctx, tea, qty="10000", factor="1000", cost="3000")
    op["members"][1]["payload"]["unit_code"] = "kg"
    assert do_push(ctx, op) == ["accepted"]
    p = c.get("/api/reports/margin?range=custom&start=2026-09-16&end=2026-09-16", **h).json()  # type: ignore[arg-type]
    assert p["state"] == "ready"
    (row,) = p["rows"]
    # المبيعات 200.00 + 50.00 = 250.00؛ التكلفة 2×75.00 + 1×30.00 = 180.00؛ الهامش 70.00 = 28.00%
    assert row["sales_minor"] == "25000" and row["cost_minor"] == "18000"
    assert row["margin_minor"] == "7000" and row["margin_bp"] == 2800
    assert p["groups"][0]["name"] == "بلا مجموعة"
    # سياسة آخر شراء
    assert _put_settings(c, h, {"cost_policy": "last_purchase"}).status_code == 200
    p = c.get("/api/reports/margin?range=custom&start=2026-09-16&end=2026-09-16", **h).json()  # type: ignore[arg-type]
    assert p["rows"][0]["cost_minor"] == "18000"
    assert _put_settings(c, h, {"cost_policy": "fifo"}).status_code == 400
    # الشاشة كلها محجوبة لغير المالك
    cc, ch = _cashier(ctx, ctx["branch"])
    assert cc.get("/api/reports/margin", **ch).status_code == 403  # type: ignore[arg-type]


def test_export_preview_generate_limit_and_download(ctx: dict[str, Any]) -> None:  # noqa: F811
    from core.models import ReportExport

    sugar = str(ctx["sugar"].id)
    assert do_push(ctx, _sale(ctx, sugar, invoice="S-1")) == ["accepted"]
    c, h = _api(ctx)
    r = c.get(
        "/api/reports/export/preview?report=sales&range=custom&start=2026-09-01&end=2026-09-30",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["file_name"] == "sales-2026-09-01_2026-09-30.html" and p["expected_pages"] == 1
    assert "صفحة 1 من 1" in p["first_page_html"] and "تقرير المبيعات" in p["first_page_html"]
    assert p["quota"] == {"used": 0, "limit": 6} or p["quota"]["limit"] > 0
    # 14 شهراً > حدّ 12: نقول الحدّ ونعرض البدائل الثلاثة
    r = c.get(
        "/api/reports/export/preview?report=sales&range=custom&start=2025-08-01&end=2026-09-30",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 400 and r.json()["detail"] == "range_too_wide"
    ex = r.json()["extra"]
    assert ex["months"] == 14 and ex["limit"] == 12
    assert [a["key"] for a in ex["alternatives"]] == ["split", "monthly_summary", "request_wider"]
    assert (
        ex["alternatives"][0]["first_end"] == "2026-07-01"
        and ex["alternatives"][0]["rest_months"] == 2
    )
    # التوليد: الملف باسم مداه، حجم وصفحات، ويُحصى
    r = c.post(
        "/api/reports/exports",
        {"report": "sales", "range": "custom", "start": "2026-09-01", "end": "2026-09-30"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201, r.content
    e = r.json()["export"]
    assert e["file_name"] == "sales-2026-09-01_2026-09-30.html" and e["byte_size"] > 500
    assert e["page_count"] == 1 and e["url"].startswith("/api/reports/exports/")
    lst = c.get("/api/reports/exports", **h).json()  # type: ignore[arg-type]
    assert lst["quota"]["used"] == 1 and lst["exports"][0]["id"] == e["id"]
    # التنزيل بالرابط المخوَّل بلا جلسة: المستند حرفياً
    r = Client().get(e["url"])
    assert r.status_code == 200 and "text/html" in r["Content-Type"]
    assert "2026-09-01 – 2026-09-30" in r.content.decode()
    with tenant_context(ctx["tenant"].id):
        assert ReportExport.objects.get(id=e["id"]).open_count == 1
    # CSV أخفّ
    r = c.post(
        "/api/reports/exports",
        {"report": "stock", "range": "30d", "format": "csv"},
        content_type="application/json",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 201 and r.json()["export"]["file_name"].endswith(".csv")
    r = Client().get(r.json()["export"]["url"])
    assert r.status_code == 200 and r["Content-Disposition"].startswith("attachment")
    assert Client().get("/api/reports/exports/nope").status_code == 404
    # الكاشير لا يصدّر
    cc, ch = _cashier(ctx, ctx["branch"])
    assert cc.get("/api/reports/exports", **ch).status_code == 403  # type: ignore[arg-type]
