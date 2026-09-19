"""REP-01/REP-02 (T2.7): تقرير المبيعات يطابق HOME-01 لنفس المدى ويُعلن ما لم يدخل بعد (الأجهزة
التي لم تُزامن والمعلّق المبلَّغ)؛ لا عمود تكلفة (G-03)؛ تقرير الذمم بلا أعمار (G-15): رصيد وآخر
سداد وأقدم حركة غير مغطّاة؛ الكاشير لا يرى التقريرين؛ التصدير يحمل سطر الاكتمال."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import home
from core.auth.devices import register_device
from core.models import Role, Session, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from parties import services as party_services
from sales.tests.test_sale import ctx, do_push, sale_op  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)


def _today_sale(c: dict[str, Any], **kw: Any) -> dict[str, Any]:
    op = sale_op(c, **kw)
    head = op["members"][0]["payload"]
    today = timezone.localdate().isoformat()
    head["business_date"] = today
    head["occurred_at"] = f"{today}T10:34:00Z"
    return op


def _h(c: dict[str, Any]) -> dict[str, str]:
    with tenant_context(c["tenant"].id):
        reg = register_device(user=c["owner"], branch=c["branch"], name="جهاز التقارير")
    return {"Authorization": f"Bearer {reg.access}"}


def test_sales_report_matches_home_and_declares_incompleteness(ctx: dict[str, Any]) -> None:  # noqa: F811
    with tenant_context(ctx["tenant"].id):
        party = party_services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=ctx["owner"], distinct_from=None
        )
    assert do_push(ctx, _today_sale(ctx, invoice="INV-1")) == ["accepted"]
    assert do_push(
        ctx,
        _today_sale(
            ctx,
            invoice="INV-2",
            party_id=str(party.id),
            payments=[("cash", "4000"), ("credit", "6000")],
        ),
    ) == ["accepted"]
    c, h = Client(), _h(ctx)
    r = c.get("/api/reports/sales?range=today", headers=h)
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["totals"]["revenue_minor"] == "20000" and p["totals"]["invoices"] == 2
    assert p["totals"]["cash_minor"] == "14000" and p["totals"]["credit_minor"] == "6000"
    assert p["totals"]["net_minor"] == "20000" and p["cost_columns"] == "phase_locked"
    assert p["by_day"][0]["invoices"] == 2 and p["scope"] == "all"
    # يطابق HOME-01 لنفس المدى
    with tenant_context(ctx["tenant"].id):
        viewer = home.viewer_for(ctx["owner"], ctx["device"])
        out = home.home_summary(ctx["tenant"].id, viewer)
        assert out["sales_today"]["total_minor"] == p["totals"]["revenue_minor"]
        assert out["sales_today"]["count"] == p["totals"]["invoices"]
    # جهاز البيع زامن للتوّ ولا معلّق: مكتمل
    assert p["completeness"]["complete"] is True
    # يبلّغ الجهاز عن 3 معلّقة → التقرير يقول «ناقص» ولا يخفيه
    with tenant_context(ctx["tenant"].id):
        Session.objects.filter(device_id=ctx["device"].id).update(reported_pending=3)
    p = c.get("/api/reports/sales?range=today", headers=h).json()
    assert p["completeness"]["complete"] is False and p["completeness"]["pending_ops"] == 3
    assert p["completeness"]["not_synced"][0]["device_name"] == "كاشير 2"
    row = next(b for b in p["by_branch"] if b["id"] == str(ctx["branch"].id))
    assert row["pending"] == 3 and row["complete"] is False and row["revenue_minor"] == "20000"
    # التصدير يحمل سطر الاكتمال في ترويسته
    r = c.get("/api/reports/sales?range=today&export=csv", headers=h)
    assert r.status_code == 200 and r.content.decode().startswith("# تقرير المبيعات · اليوم")
    assert "ناقص 3 عمليات معلّقة" in r.content.decode()
    # مدى بلا مبيعات: فارغ مع تاريخ آخر بيع لاقتراح المدى الأقرب
    p = c.get("/api/reports/sales?range=yesterday", headers=h).json()
    assert p["totals"]["invoices"] == 0 and p["last_sale_date"] == timezone.localdate().isoformat()
    # مرشّح الوسيلة
    p = c.get("/api/reports/sales?range=today&method=credit", headers=h).json()
    assert p["totals"]["invoices"] == 1 and p["totals"]["revenue_minor"] == "10000"


def test_receivables_report_no_ageing_and_cashier_denied(ctx: dict[str, Any]) -> None:  # noqa: F811
    from parties.tests.test_parties import _receipt_op

    with tenant_context(ctx["tenant"].id):
        ahmed = party_services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=ctx["owner"], distinct_from=None
        )
        fatima = party_services.create_party(
            party_id=None, name="فاطمة حسن", phone="", created_by=ctx["owner"], distinct_from=None
        )
    # أحمد: فاتورتان آجلتان (16 سبتمبر) ثم سداد جزئي (17 سبتمبر) ثم فاتورة آجلة اليوم
    for inv in ("INV-A1", "INV-A2"):
        assert do_push(
            ctx, sale_op(ctx, invoice=inv, party_id=str(ahmed.id), payments=[("credit", "10000")])
        ) == ["accepted"]
    rc = {**ctx, "user": ctx["owner"]}
    assert do_push(ctx, _receipt_op(rc, str(ahmed.id), amount="5000")) == ["accepted"]
    assert do_push(
        ctx,
        _today_sale(ctx, invoice="INV-A3", party_id=str(ahmed.id), payments=[("credit", "10000")]),
    ) == ["accepted"]
    # فاطمة: فاتورة واحدة بلا سداد
    assert do_push(
        ctx,
        _today_sale(
            ctx,
            invoice="INV-F1",
            price="3000",
            party_id=str(fatima.id),
            payments=[("credit", "3000")],
        ),
    ) == ["accepted"]
    c, h = Client(), _h(ctx)
    r = c.get("/api/reports/receivables", headers=h)
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["ageing"] == "disabled" and p["totals"]["balance_minor"] == "28000"
    a = next(x for x in p["rows"] if x["name"] == "أحمد الطيب")
    today = timezone.localdate().isoformat()
    assert a["balance_minor"] == "25000" and a["last_payment_date"] == "2026-09-17"
    assert a["oldest_unpaid_date"] == today and a["source"] == "فواتير آجلة"
    f = next(x for x in p["rows"] if x["name"] == "فاطمة حسن")
    assert f["last_payment_date"] == "" and f["oldest_unpaid_date"] == today
    assert f["source"] == "فاتورة واحدة"
    # يطابق HOME-01 «الذمم»
    with tenant_context(ctx["tenant"].id):
        viewer = home.viewer_for(ctx["owner"], ctx["device"])
        kpi = next(
            k
            for k in home.home_summary(ctx["tenant"].id, viewer)["kpis"]
            if k["key"] == "receivables"
        )
        assert kpi["value"]["amount_minor"] == p["totals"]["balance_minor"]
    r = c.get("/api/reports/receivables?export=csv", headers=h)
    assert r.status_code == 200 and "بلا جدول أعمار (G-15)" in r.content.decode()
    # الكاشير لا يرى التقريرين
    with platform_context():
        role = Role.unscoped.create(tenant=ctx["tenant"], code="cashier", name="كاشير")
        cashier = User.objects.create_user(
            tenant=ctx["tenant"], username="cash", display_name="أحمد ياسين"
        )
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=cashier, branch=ctx["branch"], role=role
        )
    with tenant_context(ctx["tenant"].id):
        reg = register_device(user=cashier, branch=ctx["branch"], name="جهاز الكاشير")
    ch = {"Authorization": f"Bearer {reg.access}"}
    assert c.get("/api/reports/receivables", headers=ch).status_code == 403
    r = c.get("/api/reports/sales", headers=ch)
    assert r.status_code == 403 and r.json()["detail"] == "permission_denied"
    assert uuid.UUID(p["rows"][0]["id"])
