"""SYS-10 (T1.39): استيراد بمعاينة — المطابقة تُقترح لا تُفترض، الوحدة إلزامية، المكرر بسعرين يحتاج
قراراً، لا رفض للملف كلّه، الدفعة بهوية (البصمة) فلا تُضاعف، الاستئناف بعد انقطاع، التراجع دفعةً."""

from __future__ import annotations

from typing import Any

import pytest

from catalog.tests.test_prices import Api, _env  # noqa: F401
from core.tenancy import platform_context

pytestmark = pytest.mark.django_db(transaction=True)

ITEMS_CSV = (
    "الصنف,الوحدة,السعر,باركود\n"
    "سكر — كيس 50,kg,120.00,\n"  # موجود بالاسم؟ لا — جديد
    "سكر,,11.00,\n"  # موجود (سكر) → تحديث سعره فقط، الوحدة غير مطلوبة للموجود
    "دقيق فاخر,,35.00,\n"  # جديد بلا وحدة → مرفوض
    "شاي أحمر,pack,-9.00,\n"  # سعر سالب → مرفوض
    "زيت قلي 5 لتر,carton,80.00,111\n"
    "زيت قلي 5 لتر,carton,85.00,\n"  # مكرر بسعر مختلف → يحتاج قرارك (الصفّان)
    "معلبات فول,piece,7.50,222\n"
    "حليب,piece,4.00,222\n"  # باركود مكرر داخل الملف → مرفوض
)


def test_items_import_preview_decide_apply_resume_revert() -> None:
    api = Api(owner=True)
    r = api.post(
        "/api/imports/preview",
        {"kind": "items", "file_name": "أصناف-سبتمبر.csv", "content": ITEMS_CSV},
    )
    assert r.status_code == 200, r.json()
    b = r.json()
    assert b["suggested_mapping"] == {"name": 0, "unit": 1, "price": 2, "barcode": 3}
    assert b["headers"] == ["الصنف", "الوحدة", "السعر", "باركود"]
    by_line: dict[int, dict[str, Any]] = {row["line"]: row for row in b["rows"]}
    assert by_line[2]["result"] == "create"
    assert by_line[3]["result"] == "update" and by_line[3]["old_price_minor"] == "10000"
    assert by_line[4]["reason"] == "unit_required"
    assert by_line[5]["reason"] == "negative"
    assert by_line[6]["result"] == "needs_decision" and by_line[6]["duplicate_of_line"] == 7
    assert by_line[7]["result"] == "needs_decision" and by_line[7]["duplicate_of_line"] == 6
    assert by_line[8]["result"] == "create"
    assert (
        by_line[9]["reason"] == "barcode_duplicate_in_file" and by_line[9]["duplicate_of_line"] == 8
    )
    assert (b["create_count"], b["update_count"], b["rejected_count"], b["decision_count"]) == (
        2,
        1,
        3,
        2,
    )
    # لم يُكتب شيء
    assert api.item("سكر")["sale_price_minor"] == "10000"
    # الملف نفسه → الدفعة نفسها
    assert (
        api.post(
            "/api/imports/preview", {"kind": "items", "file_name": "x.csv", "content": ITEMS_CSV}
        ).json()["id"]
        == b["id"]
    )
    # الاعتماد قبل حسم المكرر يُرفض
    assert api.post(f"/api/imports/{b['id']}/apply", {}).status_code == 400
    r = api.post(f"/api/imports/{b['id']}/decide", {"decisions": {"7": "keep"}})
    d = r.json()
    by_line = {row["line"]: row for row in d["rows"]}
    assert by_line[7]["result"] == "create" and by_line[6]["result"] == "rejected"
    assert d["decision_count"] == 0 and d["create_count"] == 3
    # المرفوضات بسببها ورقم سطرها
    csv_out = api.get(f"/api/imports/{b['id']}/rejected.csv")
    text = csv_out.content.decode("utf-8")
    assert "4,دقيق فاخر" in text and "الوحدة فارغة" in text
    assert "5,شاي أحمر" in text and "سعر سالب" in text
    assert "9,حليب" in text and "(الصف 8)" in text
    # انقطاع بعد صفين ثم استئناف بلا تكرار
    r = api.post(f"/api/imports/{b['id']}/apply", {"stop_after": 2})
    assert r.json()["status"] == "applying" and r.json()["applied_count"] == 2
    r = api.post(f"/api/imports/{b['id']}/apply", {})
    assert r.json()["status"] == "applied" and r.json()["applied_count"] == 4
    assert api.item("سكر")["sale_price_minor"] == "1100"
    assert api.item("زيت قلي 5 لتر")["sale_price_minor"] == "8500"
    assert api.item("معلبات فول")["barcode"] == "222"
    rows = api.get("/api/catalog/items", {"include_inactive": "1"}).json()["items"]
    assert sum(1 for i in rows if i["name"] == "زيت قلي 5 لتر") == 1  # لا مضاعفة
    # إعادة الاعتماد لا تكرّر
    assert api.post(f"/api/imports/{b['id']}/apply", {}).json()["applied_count"] == 4
    # التراجع دفعةً: المنشأ يُعطَّل والسعر يعود
    r = api.post(f"/api/imports/{b['id']}/revert", {})
    assert r.status_code == 200 and r.json()["status"] == "reverted"
    assert api.item("سكر")["sale_price_minor"] == "10000"
    assert api.item("معلبات فول")["is_active"] is False
    assert api.post(f"/api/imports/{b['id']}/revert", {}).status_code == 409


def test_parties_import_and_role_guard() -> None:
    api = Api(owner=True)
    content = (
        "الطرف,هاتف,الرصيد الافتتاحي,الصفة\n"
        "أحمد الطيب,0912000000,150.00,عميل\n"
        "مطعم الواحة,,80.00,مورد\n"
        ",0999,10,عميل\n"
    )
    r = api.post(
        "/api/imports/preview", {"kind": "parties", "file_name": "أطراف.csv", "content": content}
    )
    assert r.status_code == 200, r.json()
    b = r.json()
    assert b["suggested_mapping"] == {"name": 0, "phone": 1, "opening": 2, "side": 3}
    assert (b["create_count"], b["rejected_count"]) == (2, 1)
    r = api.post(f"/api/imports/{b['id']}/apply", {})
    assert r.json()["status"] == "applied" and r.json()["applied_count"] == 2, r.json()["rows"]
    assert [row.get("opening_error") for row in r.json()["rows"]] == [None, None, None]
    parties = api.get("/api/parties", {"q": "الواحة"}).json()["parties"]
    assert parties and parties[0]["name"] == "مطعم الواحة"
    with platform_context():
        from parties.models import OpeningBalance

        assert (
            OpeningBalance.unscoped.filter(reference__startswith=f"import:{b['id']}").count() == 2
        )
    assert api.post(f"/api/imports/{b['id']}/revert", {}).status_code == 409
    # الكاشير لا يستورد
    cashier = Api(owner=False)
    r = cashier.post(
        "/api/imports/preview", {"kind": "items", "file_name": "x.csv", "content": ITEMS_CSV}
    )
    assert r.status_code == 403 and r.json()["detail"] == "import_owner_or_manager"
