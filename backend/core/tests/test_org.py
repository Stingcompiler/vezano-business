"""ORG-01/02 (T2.1): القائمة من الخادم بحالات الدعوة الأربع؛ لا دعوة ثانية لرقم مدعوّ؛ الدعوة
المنتهية لا تُحيا بل تُصدر جديدة ويبقى أثر الأولى؛ المصفوفة للمالك وحده تعديلاً، عمود المالك مقفل،
التغيير يُحصي المتأثرين ويصل إلى سقوف الخصم (G-09)، ولا يمسّ عمليات سابقة."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core import org
from core.auth.devices import register_device
from core.models import Invitation, Role, RolePermission, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from sales.services import caps_for

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    a, branch = two_tenants.a, two_tenants.a_branches[0]
    with platform_context():
        roles = {
            code: Role.unscoped.create(tenant=a, code=code, name=name)
            for code, name in (
                ("owner", "مالك"),
                ("manager", "مدير فرع"),
                ("cashier", "كاشير"),
                ("storekeeper", "أمين مخزن"),
            )
        }
        owner = User.objects.create_user(
            tenant=a, username="owner", display_name="عثمان الطيب", is_owner=True
        )
        manager = User.objects.create_user(tenant=a, username="mgr", display_name="سميّة عبد الله")
        cashier = User.objects.create_user(tenant=a, username="cash", display_name="أحمد ياسين")
        for u, code in ((owner, "owner"), (manager, "manager"), (cashier, "cashier")):
            UserBranchAccess.unscoped.create(tenant=a, user=u, branch=branch, role=roles[code])
    with tenant_context(a.id):
        tokens = {
            code: register_device(user=u, branch=branch, name=f"جهاز {code}").access
            for u, code in ((owner, "owner"), (manager, "manager"), (cashier, "cashier"))
        }
    return {"tenant": a, "branch": branch, "roles": roles, "tokens": tokens}


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _post(c: Client, h: dict[str, str], path: str, body: dict[str, Any] | None = None) -> Any:
    return c.post(path, body or {}, content_type="application/json", headers=h)


def test_users_invitations_lifecycle(ctx: dict[str, Any]) -> None:
    c, h = Client(), _h(ctx["tokens"]["owner"])
    roles = ctx["roles"]
    branch_id = str(ctx["branch"].id)
    r = c.get("/api/org/users", headers=h)
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["counts"]["open_invitations"] == 0 and body["can_invite"] is True
    assert any(u["is_owner"] for u in body["users"])
    assert all(r["code"] != "owner" for r in body["roles"])
    # دعوة كاشير — تعيد الرابط وما سيملكه المدعوّ
    r = _post(
        c,
        h,
        "/api/org/invitations",
        {
            "identifier": "kamal@example.com",
            "role_id": str(roles["cashier"].id),
            "branch_id": branch_id,
        },
    )
    assert r.status_code == 201, r.content
    first = r.json()
    assert first["link"].startswith("/invite/") and "البيع وإصدار الفاتورة" in first["grants"]
    assert first["invitation"]["identifier_masked"] == "kamal@…"
    assert first["invitation"]["status"] == "sent"
    # لا دعوة ثانية لرقم مدعوّ أصلاً — الدعوة القائمة تعود مع الرفض
    r = _post(
        c,
        h,
        "/api/org/invitations",
        {
            "identifier": "Kamal@Example.com",
            "role_id": str(roles["cashier"].id),
            "branch_id": branch_id,
        },
    )
    assert r.status_code == 409 and r.json()["detail"] == "already_invited"
    assert r.json()["existing"]["id"] == first["invitation"]["id"]
    # المالك لا يُدعى؛ معرّف غير صالح يُرفض
    r = _post(
        c,
        h,
        "/api/org/invitations",
        {"identifier": "x", "role_id": str(roles["cashier"].id), "branch_id": branch_id},
    )
    assert r.status_code == 400 and r.json()["detail"] == "identifier_invalid"
    # انتهاء الدعوة ثم إعادة الإرسال: جديدة برابط جديد، والأولى تبقى بحالتها «منتهية»
    with tenant_context(ctx["tenant"].id):
        Invitation.objects.filter(id=first["invitation"]["id"]).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )
    r = c.get("/api/org/users", headers=h)
    assert [i["status"] for i in r.json()["invitations"]] == ["expired"]
    r = _post(c, h, f"/api/org/invitations/{first['invitation']['id']}/resend")
    assert r.status_code == 201, r.content
    second = r.json()
    assert second["invitation"]["id"] != first["invitation"]["id"]
    assert second["link"] != first["link"]
    r = c.get("/api/org/users", headers=h)
    statuses = sorted(i["status"] for i in r.json()["invitations"])
    assert statuses == ["expired", "sent"]
    assert r.json()["counts"]["open_invitations"] == 1
    # إلغاء الدعوة الجديدة → ملغاة، وتبقى في القائمة
    r = _post(c, h, f"/api/org/invitations/{second['invitation']['id']}/revoke")
    assert r.status_code == 200 and r.json()["invitation"]["status"] == "revoked"
    # الرمز الخام لا يُخزَّن ولا يُعاد في القائمة
    text = c.get("/api/org/users", headers=h).content.decode()
    assert second["link"].split("/")[-1] not in text


def test_matrix_defaults_owner_locked_and_caps(ctx: dict[str, Any]) -> None:
    c, h = Client(), _h(ctx["tokens"]["owner"])
    r = c.get("/api/org/roles", headers=h)
    assert r.status_code == 200, r.content
    m = r.json()
    assert m["can_edit"] is True
    codes = [x["code"] for x in m["roles"]]
    assert codes[0] == "owner" and "cashier" in codes
    keys = [row["key"] for row in m["rows"]]
    assert keys == [p.key for p in org.PERMISSIONS]
    discount = next(row for row in m["rows"] if row["key"] == "discount")
    by_role = {x["id"]: x["code"] for x in m["roles"]}
    labels = {by_role[cell["role_id"]]: cell["label"] for cell in discount["cells"]}
    assert labels["owner"] == "بلا حد" and labels["cashier"] == "10 للعملية"
    assert labels["manager"] == "200 للعملية" and labels["storekeeper"] == "لا"
    refund = next(row for row in m["rows"] if row["key"] == "refund")
    assert {by_role[x["role_id"]]: x["label"] for x in refund["cells"]}["cashier"] == "حتى 500"
    # سقف الخصم يُقرأ من المصفوفة (G-09 لم يعد ثابتاً)
    with tenant_context(ctx["tenant"].id):
        assert caps_for("cashier", False).per_op_minor == 1_000
        assert caps_for("owner", True).per_op_minor == 0
        cashier_role = Role.objects.get(code="cashier")
        owner_role = Role.objects.get(code="owner")
        cashier_users = (
            UserBranchAccess.objects.filter(role=cashier_role, revoked_at__isnull=True)
            .values("user_id")
            .distinct()
            .count()
        )
    # عمود المالك مقفل
    r = c.put(
        "/api/org/roles",
        {"changes": [{"role_id": str(owner_role.id), "key": "sell", "value": "no"}]},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 400 and r.json()["detail"] == "owner_locked"
    # حدّ بلا قيمة يُرفض
    r = c.put(
        "/api/org/roles",
        {"changes": [{"role_id": str(cashier_role.id), "key": "discount", "value": "limit"}]},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 400 and r.json()["detail"] == "limit_required"
    # رفع سقف الكاشير إلى 25 للعملية — يُحصي المتأثرين ويصل إلى السقف فوراً
    r = c.put(
        "/api/org/roles",
        {
            "changes": [
                {
                    "role_id": str(cashier_role.id),
                    "key": "discount",
                    "value": "limit",
                    "limit_minor": "2500",
                    "period": "per_op",
                }
            ]
        },
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 200, r.content
    assert r.json()["changed_cells"] == 1 and r.json()["affected_users"] == cashier_users
    with tenant_context(ctx["tenant"].id):
        assert caps_for("cashier", False).per_op_minor == 2_500
        assert RolePermission.objects.get(role=cashier_role, key="discount").limit_minor == 2_500
    # التغيير نفسه مرة ثانية لا يغيّر شيئاً
    r = c.put(
        "/api/org/roles",
        {
            "changes": [
                {
                    "role_id": str(cashier_role.id),
                    "key": "discount",
                    "value": "limit",
                    "limit_minor": "2500",
                    "period": "per_op",
                }
            ]
        },
        content_type="application/json",
        headers=h,
    )
    assert r.json()["changed_cells"] == 0


def test_manager_reads_matrix_but_cannot_edit_and_cashier_forbidden(ctx: dict[str, Any]) -> None:
    c = Client()
    mh = _h(ctx["tokens"]["manager"])
    r = c.get("/api/org/roles", headers=mh)
    assert r.status_code == 200 and r.json()["can_edit"] is False
    r = c.put("/api/org/roles", {"changes": []}, content_type="application/json", headers=mh)
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    # مدير الفرع يرى فريق فرعه؛ الكاشير لا يرى القائمة
    r = c.get("/api/org/users", headers=mh)
    assert r.status_code == 200
    names = {u["display_name"] for u in r.json()["users"]}
    assert {"سميّة عبد الله", "أحمد ياسين"} <= names
    assert c.get("/api/org/users", headers=_h(ctx["tokens"]["cashier"])).status_code == 403
    # الأثر: المستخدم المعطَّل يبقى في القائمة باسمه وحالته «معطَّل» — التعطيل ليس حذفاً
    with tenant_context(ctx["tenant"].id):
        User.objects.filter(username="cash").update(is_active=False)
    r = c.get("/api/org/users", headers=_h(ctx["tokens"]["owner"]))
    row = next(u for u in r.json()["users"] if u["display_name"] == "أحمد ياسين")
    assert row["status"] == "disabled"
