"""ORG-09/10 (T2.6): الحفظ بالإصدار (تعديل متزامن = conflict)، النص الأطول من عرض الورق يُرفض قبل
الحفظ، العملة لا تُمسّ، طريقة النقد لا تُعطَّل؛ سجل التدقيق ملحق فقط ونطاقه يتبع الدور، بلا أسرار،
وتصديره للمالك بترويسة النطاق."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core import audit
from core.models import AuditEvent, PaymentMethod, Tenant, User
from core.tenancy import tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)


def _put(c: Client, h: dict[str, str], body: dict[str, Any]) -> Any:
    return c.put("/api/org/settings", body, content_type="application/json", headers=h)


def test_settings_version_width_and_currency(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    with tenant_context(ctx["tenant"].id):
        PaymentMethod.objects.create(tenant=ctx["tenant"], code="cash", name="نقداً", is_cash=True)
        PaymentMethod.objects.create(tenant=ctx["tenant"], code="bank", name="تحويل بنكي")
    r = c.get("/api/org/settings", headers=h)
    assert r.status_code == 200, r.content
    p = r.json()
    assert p["version"] == 1 and p["currency"] == "SDG" and p["can_edit"] is True
    assert p["receipt"]["paper_width"] == "80" and p["locale"]["numerals"] == "latin"
    # نص أطول من عرض 58mm يُرفض قبل الحفظ ويعرض كيف سيُقطع
    long_name = "بقالة النيل الكبرى للمواد الغذائية والتموينية — الفرع الرئيسي"
    r = _put(c, h, {"version": 1, "name": long_name, "paper_width": "58"})
    assert r.status_code == 400 and r.json()["detail"] == "too_wide" and r.json()["field"] == "name"
    assert len(r.json()["extra"]["cut"]) == 32
    # حفظ صالح
    r = _put(
        c,
        h,
        {
            "version": 1,
            "name": "بقالة النيل — تجريبي",
            "header": "فرع بحري · 0912xxxxxx",
            "footer": "شكراً لزيارتكم",
            "paper_width": "58",
            "numerals": "latin",
        },
    )
    assert r.status_code == 200, r.content
    assert r.json()["version"] == 2 and r.json()["receipt"]["paper_width"] == "58"
    assert "عرض الورق" in r.json()["changed"] and "سطر الترويسة" in r.json()["changed"]
    with tenant_context(ctx["tenant"].id):
        assert Tenant.unscoped.get(id=ctx["tenant"].id).name == "بقالة النيل — تجريبي"
        assert AuditEvent.objects.filter(kind="settings.changed").count() == 1
    # تعديل متزامن: إصدار قديم → conflict بمن حفظ ومتى
    r = _put(c, h, {"version": 1, "footer": "x"})
    assert r.status_code == 409 and r.json()["detail"] == "conflict"
    assert (
        r.json()["extra"]["version"] == 2 and r.json()["extra"]["updated_by_name"] == "عثمان الطيب"
    )
    # طريقة النقد لا تُعطَّل؛ التحويل يُعطَّل
    with tenant_context(ctx["tenant"].id):
        cash = PaymentMethod.objects.get(code="cash")
        bank = PaymentMethod.objects.get(code="bank")
    r = _put(c, h, {"version": 2, "payment_methods": [{"id": str(cash.id), "is_active": False}]})
    assert r.status_code == 400 and r.json()["detail"] == "cash_method_required"
    r = _put(c, h, {"version": 2, "payment_methods": [{"id": str(bank.id), "is_active": False}]})
    assert r.status_code == 200 and r.json()["version"] == 3
    assert next(m for m in r.json()["payment_methods"] if m["code"] == "bank")["is_active"] is False
    # مدير الفرع يقرأ ولا يكتب؛ العملة ليست حقلاً
    m = c.get("/api/org/settings", headers=_h(ctx["tokens"]["manager"])).json()
    assert m["can_edit"] is False
    assert _put(c, _h(ctx["tokens"]["manager"]), {"version": 3, "footer": "x"}).status_code == 403


def test_audit_scope_filters_and_export(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    with tenant_context(ctx["tenant"].id):
        audit.record(
            kind="shift.variance_approved",
            title="اعتماد عجز وردية 150.00",
            actor=ctx["users"]["manager"],
            actor_role="مدير الفرع",
            branch=ctx["branch"],
            reason="فكّة ناقصة من تحويل أمس",
        )
        audit.record(
            kind="invitation.sent",
            title="دعوة kamal@… بدور كاشير",
            actor=ctx["users"]["owner"],
            branch=ctx["branch"],
        )
        audit.record(kind="party.distinct", title="رفض دمج طرفين", actor=ctx["users"]["cashier"])
        assert AuditEvent.objects.count() == 3
    # المالك يرى الكل؛ الحسّاسة فقط تصفّي
    o = c.get("/api/org/audit", headers=_h(ctx["tokens"]["owner"])).json()
    assert o["scope"] == "all" and o["count"] == 3 and o["can_export"] is True
    s = c.get("/api/org/audit?sensitive=1", headers=_h(ctx["tokens"]["owner"])).json()
    assert {r["kind"] for r in s["rows"]} == {"shift.variance_approved", "party.distinct"}
    # المدير فرعه؛ الكاشير أفعاله وحدها
    m = c.get("/api/org/audit", headers=_h(ctx["tokens"]["manager"])).json()
    assert m["scope"] == "branch" and m["count"] == 2 and m["can_export"] is False
    k = c.get("/api/org/audit", headers=_h(ctx["tokens"]["cashier"])).json()
    assert k["scope"] == "own" and k["count"] == 1 and k["rows"][0]["kind"] == "party.distinct"
    # مدى بلا أحداث: آخر حدث معلن
    e = c.get(
        "/api/org/audit?range=today&branch_id=00000000-0000-0000-0000-000000000000",
        headers=_h(ctx["tokens"]["owner"]),
    ).json()
    assert e["count"] == 0 and e["last_event_at"]
    # التصدير للمالك فقط ويحمل النطاق في ترويسته
    r = c.get("/api/org/audit?export=csv&range=7d", headers=_h(ctx["tokens"]["owner"]))
    assert r.status_code == 200 and r["Content-Type"].startswith("text/csv")
    text = r.content.decode()
    assert text.startswith("# سجل التدقيق · المدى: 7d") and "اعتماد عجز وردية" in text
    assert (
        c.get("/api/org/audit?export=csv", headers=_h(ctx["tokens"]["manager"])).status_code == 403
    )
    # لا تعديل ولا حذف: لا مسار لهما
    assert c.delete("/api/org/audit", headers=_h(ctx["tokens"]["owner"])).status_code == 405


def test_ownership_transfer_blocked_then_confirmed(ctx: dict[str, Any]) -> None:  # noqa: F811
    """ORG-09 conflict (20-D15): لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع؛ المالك الجديد بحساب
    مُثبَت؛ تأكيد الطرفين خلال 24 ساعة؛ الدفتر ينتقل كما هو والمالك السابق يبقى «مالك سابق»."""
    from datetime import timedelta

    from django.utils import timezone

    from core.models import Account, OwnershipTransfer, Session
    from shifts.models import Shift

    c, h, hm = Client(), _h(ctx["tokens"]["owner"]), _h(ctx["tokens"]["manager"])
    mgr = ctx["users"]["manager"]
    r = c.get("/api/org/ownership", headers=h)
    assert r.status_code == 200 and r.json()["current"] is None and r.json()["candidates"] == []
    # مدير بلا حساب مُثبَت → لا يصلح مالكاً جديداً
    r = c.post(
        "/api/org/ownership",
        {"to_user_id": str(mgr.id)},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 400 and r.json()["detail"] == "new_owner_unverified"
    with tenant_context(ctx["tenant"].id):
        acc = Account.unscoped.create(
            identifier="+249912000000",
            identifier_kind="phone",
            password="x",  # noqa: S106
            verified_at=timezone.now(),
        )
        mgr.account = acc
        mgr.save(update_fields=["account"])
        shift = Shift.objects.create(
            tenant=ctx["tenant"],
            branch=ctx["branch"],
            device_id=ctx["device_ids"]["cashier"],
            user_id=ctx["users"]["cashier"].id,
            user_name="أحمد ياسين",
            opening_float_minor=0,
            business_date=timezone.localdate(),
        )
        Session.objects.filter(device_id=ctx["device_ids"]["cashier"]).update(reported_pending=3)
    # الموانع تُعرض وتمنع الطلب
    r = c.get("/api/org/ownership", headers=h)
    assert [x["id"] for x in r.json()["candidates"]] == [str(mgr.id)]
    b = r.json()["blockers"]
    assert (
        b["open_shifts"][0]["user_name"] == "أحمد ياسين" and b["pending_devices"][0]["pending"] == 3
    )
    r = c.post(
        "/api/org/ownership",
        {"to_user_id": str(mgr.id)},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 409 and r.json()["detail"] == "conflict"
    # غير المالك لا يطلب
    assert (
        c.post(
            "/api/org/ownership",
            {"to_user_id": str(mgr.id)},
            content_type="application/json",
            headers=hm,
        ).status_code
        == 403
    )
    with tenant_context(ctx["tenant"].id):
        shift.state = "closed"
        shift.save(update_fields=["state"])
        Session.objects.filter(device_id=ctx["device_ids"]["cashier"]).update(reported_pending=0)
    r = c.post(
        "/api/org/ownership",
        {"to_user_id": str(mgr.id)},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 201, r.content
    tid = r.json()["transfer"]["id"]
    assert r.json()["transfer"]["state"] == "pending" and r.json()["ttl_hours"] == 24
    # المالك الحالي لا يؤكّد عن الآخر؛ المالك الجديد يؤكّد
    assert c.post(f"/api/org/ownership/{tid}/confirm", headers=h).status_code == 403
    r = c.post(f"/api/org/ownership/{tid}/confirm", headers=hm)
    assert r.status_code == 200 and r.json()["transfer"]["state"] == "confirmed"
    with tenant_context(ctx["tenant"].id):
        assert User.objects.get(id=mgr.id).is_owner is True
        old = User.objects.get(id=ctx["users"]["owner"].id)
        assert old.is_owner is False and old.former_owner_until is not None
        kinds = list(
            AuditEvent.objects.filter(kind__startswith="ownership.").values_list("kind", flat=True)
        )
        assert kinds == ["ownership.requested", "ownership.transferred"]
    # الانقضاء: طلب ثانٍ بلا تأكيد بعد 24 ساعة → منقضٍ ومسجَّل
    r = c.post(
        "/api/org/ownership",
        {"to_user_id": str(ctx["users"]["owner"].id)},
        content_type="application/json",
        headers=hm,
    )
    assert r.status_code == 400 and r.json()["detail"] == "new_owner_unverified"
    with tenant_context(ctx["tenant"].id):
        OwnershipTransfer.objects.create(
            tenant=ctx["tenant"],
            from_user_id=mgr.id,
            from_user_name="سميّة عبد الله",
            to_user_id=ctx["users"]["owner"].id,
            to_user_name="عثمان الطيب",
            expires_at=timezone.now() - timedelta(minutes=1),
        )
    r = c.get("/api/org/ownership", headers=hm)
    assert r.json()["current"] is None
    with tenant_context(ctx["tenant"].id):
        assert AuditEvent.objects.filter(kind="ownership.expired").count() == 1
