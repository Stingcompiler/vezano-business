"""REP-03/REP-04 (T2.8): تقرير المخزون بوحدة البيع — أول المدة/وارد/صادر/الرصيد يطابق INV-01 والسالب
لا يُصفَّر ومعه مستنده؛ تقرير الصندوق من الورديات المغلقة وحدها، والوردية المقفلة على جهازين تُحجر
نسختها الثانية (`shift_closed_twice`) وتُستثنى من المجموع ويُقال ذلك؛ الكاشير لا يراهما."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from core.tenancy import tenant_context
from inventory.tests.test_inventory import _api, _receipt_op, _sale, ctx  # noqa: F401
from sales.tests.test_sale import do_push
from shifts.tests.test_shifts import D, shift_close, shift_open

pytestmark = pytest.mark.django_db(transaction=True)


def test_stock_report_matches_balances_and_explains_negative(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar, tea = str(ctx["sugar"].id), str(ctx["tea"].id)
    # استلام 40 كرتونة (480 كغ) في 16 سبتمبر ثم بيع كرتونة وكيلو؛ الشاي يُباع بلا استلام → سالب
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="40000", factor="12000")) == ["accepted"]
    assert do_push(ctx, _sale(ctx, sugar, invoice="S-1", factor="12000", price="120000")) == [
        "accepted"
    ]
    assert do_push(ctx, _sale(ctx, sugar, invoice="S-2")) == ["accepted"]
    assert do_push(ctx, _sale(ctx, tea, invoice="S-3", qty="2000", price="5000")) == ["accepted"]
    c, h = _api(ctx)
    r = c.get(
        "/api/reports/stock?range=custom&start=2026-09-16&end=2026-09-16",
        **h,  # type: ignore[arg-type]
    )
    assert r.status_code == 200, r.content
    p = r.json()
    rows = {x["name"]: x for x in p["rows"]}
    assert rows["سكر"]["opening_milli"] == "0" and rows["سكر"]["in_milli"] == "480000"
    assert rows["سكر"]["out_milli"] == "13000" and rows["سكر"]["closing_milli"] == "467000"
    assert rows["سكر"]["unit"]["name"] == "كغ" and rows["سكر"]["tag"] == "ok"
    assert rows["شاي أسود 250غ"]["closing_milli"] == "-2000"
    assert rows["شاي أسود 250غ"]["tag"] == "negative" and p["negatives"] == 1
    assert rows["شاي أسود 250غ"]["explain"] == "لا يوجد إدخال شراء مقابل"
    assert rows["شاي أسود 250غ"]["doc"].startswith("بيع نقطة بيع")
    assert rows["سكر"]["last_movement_at"]  # الوقت مع كل رصيد
    # يطابق INV-01
    bal = {x["name"]: x["qty_milli"] for x in c.get("/api/inventory/balances", **h).json()["rows"]}  # type: ignore[arg-type]
    assert bal["سكر"] == rows["سكر"]["closing_milli"]
    assert bal["شاي أسود 250غ"] == rows["شاي أسود 250غ"]["closing_milli"]
    # مدى لاحق: أول المدة = الرصيد السابق ولا حركة داخله
    p = c.get("/api/reports/stock?range=custom&start=2026-09-17&end=2026-09-17", **h).json()  # type: ignore[arg-type]
    rows = {x["name"]: x for x in p["rows"]}
    assert rows["سكر"]["opening_milli"] == "467000" and rows["سكر"]["moved_in_range"] == 0
    assert p["moved_rows"] == 0 and p["last_movement_date"] == "2026-09-16"
    r = c.get("/api/reports/stock?range=custom&start=2026-09-16&end=2026-09-16&export=csv", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.content.decode().startswith("# تقرير المخزون والحركات")


def test_cash_report_double_close_is_quarantined_and_excluded(ctx: dict[str, Any]) -> None:  # noqa: F811
    from sync.models import QuarantinedOperation

    s1, s2 = str(uuid.uuid4()), str(uuid.uuid4())
    o1, o2 = shift_open(ctx, s1), shift_open(ctx, s2)
    o2["members"][0]["payload"]["occurred_at"] = f"{D}T09:00:00Z"
    assert list(do_push(ctx, o1, o2)) == ["accepted", "accepted"]
    # الأولى تُقفل بفارق −45.00؛ الثانية تُقفل مرتين بمبلغين (جهازان)
    assert do_push(
        ctx, shift_close(ctx, s1, o1["operation_id"], counted="238500", expected="243000")
    ) == ["accepted"]
    assert do_push(
        ctx, shift_close(ctx, s2, o2["operation_id"], counted="50000", expected="50000")
    ) == ["accepted"]
    second = shift_close(ctx, s2, o2["operation_id"], counted="48000", expected="50000")
    assert do_push(ctx, second) == ["conflicted"]
    with tenant_context(ctx["tenant"].id):
        q = QuarantinedOperation.objects.get(code="shift_closed_twice")
        assert q.reason == "conflicted" and "50000" in q.detail
    c, h = _api(ctx)
    r = c.get("/api/reports/cash?range=7d", **h)  # type: ignore[arg-type]
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["totals"]["shifts"] == 2 and p["totals"]["excluded_conflicts"] == 1
    # الفارق من الورديات المحسومة وحدها — المتعارضة خارج المجموع
    assert p["totals"]["variance_minor"] == "-4500" and p["totals"]["unreviewed_variances"] == 1
    rows = {x["id"]: x for x in p["rows"]}
    assert rows[s1]["variance_minor"] == "-4500" and rows[s1]["conflict"] is None
    cf = rows[s2]["conflict"]
    assert cf["counted_cash_minor"] == "48000" and cf["counted_by_name"] == "سالم"
    assert rows[s2]["counted_cash_minor"] == "50000"
    assert p["open_shifts"] == []
    r = c.get("/api/reports/cash?range=7d&export=csv", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and "خارج المجموع 1" in r.content.decode()
    # وردية مفتوحة لا تدخل — تُذكر في المخرج
    s3 = str(uuid.uuid4())
    assert do_push(ctx, shift_open(ctx, s3)) == ["accepted"]
    p = c.get("/api/reports/cash?range=7d", **h).json()  # type: ignore[arg-type]
    assert p["totals"]["shifts"] == 2 and [o["id"] for o in p["open_shifts"]] == [s3]
    # فُتحت أمس صباحاً ولم تُقفل: مهجورة (≥ 24 ساعة) — المخرج يشير إليها
    assert p["open_shifts"][0]["abandoned"] is True and p["open_shifts"][0]["open_hours"] >= 24
    # الكاشير لا يرى
    from inventory.tests.test_inventory import _cashier

    cc, ch = _cashier(ctx, ctx["branch"])
    assert cc.get("/api/reports/cash", **ch).status_code == 403  # type: ignore[arg-type]
    assert cc.get("/api/reports/stock", **ch).status_code == 403  # type: ignore[arg-type]
