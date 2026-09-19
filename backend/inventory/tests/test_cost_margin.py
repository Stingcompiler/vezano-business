"""PUR-05 (T2.15): الشاشة كلها محجوبة عن غير المالك والمحاسب (`cost_margin_view`)؛ بلا تفعيل
`phase_locked` بلقطة «مثال» ومفتاح في يد المالك؛ بلا مستند شراء «لا تكلفة بعد» بأعمدة فارغة وتكلفة
يدوية تُوسم «يدوية» وتُستبدل بأول مستند حقيقي؛ التكلفة بالمتوسط المرجّح للوحدة الأساسية، الهامش
السالب يُعرض، ومستند واحد يُقال عنه ذلك، وارتفاع التكلفة بمستند يُسمّى برقمه وبالهامش السابق."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.tenancy import tenant_context
from inventory.tests.test_inventory import _api, _cashier, _receipt_op, ctx  # noqa: F401
from sales.tests.test_sale import do_push

pytestmark = pytest.mark.django_db(transaction=True)


def _post(c: Client, h: dict[str, str], body: dict[str, Any]) -> Any:
    path = "/api/inventory/purchasing/cost-margin"
    return c.post(path, body, content_type="application/json", **h)  # type: ignore[arg-type]


def test_cost_margin_lock_empty_manual_and_ready(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar = str(ctx["sugar"].id)
    c, h = _api(ctx)
    # الكاشير: الشاشة كلها محجوبة
    cc, ch = _cashier(ctx, ctx["branch"])
    r = cc.get("/api/inventory/purchasing/cost-margin", **ch)  # type: ignore[arg-type]
    assert r.status_code == 403 and r.json()["detail"] == "permission_denied"
    # بلا تفعيل: مقفلة بلقطة «مثال»
    r = c.get("/api/inventory/purchasing/cost-margin", **h)  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["state"] == "phase_locked"
    assert r.json()["can_enable"] is True and r.json()["rows"][0]["note"] == "example"
    # «فعّل الشراء الداخلي» — بلا مستند: لا تكلفة بعد، والجدول بأعمدته فارغة
    r = _post(c, h, {"action": "enable"})
    assert r.status_code == 200 and r.json()["state"] == "empty"
    rows = {x["item_name"]: x for x in r.json()["rows"]}
    assert rows["سكر"]["cost_minor"] == "" and rows["سكر"]["margin_bps"] is None
    # تكلفة يدوية للكيلو 80.00 مقابل بيع 100.00 → 20% موسومة «يدوية»
    r = _post(c, h, {"action": "manual_cost", "item_id": sugar, "unit_cost_minor": "8000"})
    assert r.status_code == 200 and r.json()["state"] == "ready"
    row = next(x for x in r.json()["rows"] if x["item_name"] == "سكر")
    assert row["method_label"] == "يدوية" and row["margin_bps"] == 2000 and row["note"] == "manual"
    # أول مستند حقيقي يستبدلها: 10 كراتين × 1,080.00 → للكيلو 90.00 → 10% · مستند واحد
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="10000", factor="12000", cost="108000")) == [
        "accepted"
    ]
    row = next(
        x
        for x in c.get("/api/inventory/purchasing/cost-margin", **h).json()["rows"]  # type: ignore[arg-type]
        if x["item_name"] == "سكر"
    )
    assert row["cost_minor"] == "9000" and row["margin_bps"] == 1000
    assert row["method_label"] == "مستند واحد" and row["note"] == "single_doc"
    # مستند ثانٍ أغلى: 10 كراتين × 1,320.00 (110.00 للكيلو) → متوسط 100.00 → 0% وارتفعت
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="10000", factor="12000", cost="132000")) == [
        "accepted"
    ]
    row = next(
        x
        for x in c.get("/api/inventory/purchasing/cost-margin", **h).json()["rows"]  # type: ignore[arg-type]
        if x["item_name"] == "سكر"
    )
    assert row["cost_minor"] == "10000" and row["margin_bps"] == 0
    assert row["method_label"] == "متوسط مرجّح · 2 مستندات" and row["note"] == "cost_rose"
    assert row["note_extra"]["previous_margin_bps"] == 1000
    # مستند ثالث أغلى بعد: 10 × 1,560.00 (130.00) → متوسط 110.00 → هامش سالب يُعرض ولا يُحكم
    assert do_push(ctx, _receipt_op(ctx, sugar, qty="10000", factor="12000", cost="156000")) == [
        "accepted"
    ]
    row = next(
        x
        for x in c.get("/api/inventory/purchasing/cost-margin", **h).json()["rows"]  # type: ignore[arg-type]
        if x["item_name"] == "سكر"
    )
    assert row["cost_minor"] == "11000" and row["margin_bps"] == -1000 and row["note"] == "negative"
    with tenant_context(ctx["tenant"].id):
        from core.org_settings import _settings

        assert _settings().inventory["purchasing_enabled"] is True
