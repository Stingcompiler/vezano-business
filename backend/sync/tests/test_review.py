"""SYS-03 (T1.35): تعارض وحجر ومراجعة مالك — النسختان معروضتان، قبول مخوَّل بسبب دون كتابة فوق
الأصل (تصحيح يشير إليه)، رفض بسبب يبقي المؤكد، القرار نهائي؛ الكاشير يرى ولا يحسم؛ الترتيب بالأثر
المالي."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from core.tenancy import tenant_context
from parties import services
from parties.tests.test_parties import _owner_client, _receipt_op, api, ctx  # noqa: F401
from sales.tests.test_sale import do_push, sale_op
from sync.models import QuarantinedOperation

pytestmark = pytest.mark.django_db(transaction=True)


def _hdr(h: dict[str, str]) -> dict[str, str]:
    return {"Authorization": h["HTTP_AUTHORIZATION"]}


def _shift_op(c: dict[str, Any]) -> tuple[dict[str, Any], str]:
    sid = str(uuid.uuid4())
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "shift_open",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {
                "entity": "shifts.ShiftOpened",
                "id": sid,
                "schema_version": 1,
                "payload": {
                    "shift_id": sid,
                    "branch_id": str(c["branch"].id),
                    "device_id": str(c["device"].id),
                    "user_id": str(c["user"].id),
                    "opening_float_minor": "50000",
                    "business_date": "2026-09-17",
                    "occurred_at": "2026-09-17T08:00:00Z",
                },
            }
        ],
    }, sid


def test_conflict_review_both_versions_owner_decides_with_reason(ctx: dict[str, Any]) -> None:  # noqa: F811
    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=None, distinct_from=None
        )
    oc = dict(ctx, owner=ctx["user"])
    shift, sid = _shift_op(ctx)
    do_push(oc, shift)
    assert do_push(
        oc, sale_op(oc, invoice="INV-1", party_id=str(ahmed.id), payments=[("credit", "10000")])
    ) == ["accepted"]
    # السداد نفسه (المعرّف نفسه) بمبلغين: 140 مؤكد ثم 180 من جهاز آخر → conflicted ومحجوز
    op = _receipt_op(ctx, str(ahmed.id), amount="4000", shift_id=sid, number="PAY-0244")
    assert do_push(oc, op) == ["accepted"]
    op2 = {
        **op,
        "members": [
            dict(op["members"][0], payload={**op["members"][0]["payload"], "amount_minor": "8000"})
        ],
    }
    assert do_push(oc, op2) == ["conflicted"]
    with tenant_context(ctx["tenant"].id):
        assert services.party_payload(ahmed)["balance_minor"] == "6000"
        q = QuarantinedOperation.objects.get(operation_id=op["operation_id"])

    # الكاشير يرى محجور جهازه ولا يحسم — permission_denied
    c, h = api(ctx)
    r = c.get("/api/sync/quarantine", headers=_hdr(h))
    assert r.status_code == 200 and r.json()["is_owner"] is False
    assert [i["id"] for i in r.json()["items"]] == [str(q.id)]
    d = c.get(f"/api/sync/quarantine/{q.id}", headers=_hdr(h)).json()
    assert d["confirmed"]["members"][0]["payload"]["amount_minor"] == "4000"
    assert d["item"]["members"][0]["payload"]["amount_minor"] == "8000"
    assert d["effect"] == {
        "party_id": str(ahmed.id),
        "party_name": "أحمد الطيب",
        "balance_now_minor": "6000",
        "balance_if_accept_minor": "2000",
        "balance_if_reject_minor": "6000",
        "device_amount_minor": "8000",
        "confirmed_amount_minor": "4000",
    }
    assert d["acceptable"] is True
    r = c.post(
        f"/api/sync/quarantine/{q.id}/decide",
        {"decision": "accept", "reason": "الإيصال الورقي 80"},
        content_type="application/json",
        headers=_hdr(h),
    )
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"

    # المالك: السبب إلزامي؛ القبول = تصحيح مبلغ يشير إلى الأصل؛ الأصل لا يتغير؛ القرار نهائي
    oc_client, oh = _owner_client(ctx)
    r = oc_client.post(
        f"/api/sync/quarantine/{q.id}/decide",
        {"decision": "accept", "reason": "  "},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 400
    r = oc_client.post(
        f"/api/sync/quarantine/{q.id}/decide",
        {"decision": "accept", "reason": "الإيصال الورقي 80"},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["applied"]["balance_after_minor"] == "2000"
    assert body["item"]["decision"] == "accept" and body["item"]["decided_by_name"] == "سالم"
    with tenant_context(ctx["tenant"].id):
        from parties.models import PaymentReceipt

        rec = PaymentReceipt.objects.get(receipt_number="PAY-0244")
        assert rec.amount_minor == 4000  # الأصل كما هو
        assert rec.corrections.count() == 1 and rec.corrections.first().new_amount_minor == 8000
        assert services.party_payload(ahmed)["balance_minor"] == "2000"
    r = oc_client.post(
        f"/api/sync/quarantine/{q.id}/decide",
        {"decision": "reject", "reason": "تراجع"},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 400 and r.json()["detail"] == "already_decided"
    assert oc_client.get("/api/sync/quarantine", headers=_hdr(oh)).json()["items"] == []


def test_reject_keeps_confirmed_and_ordering_by_effect(ctx: dict[str, Any]) -> None:  # noqa: F811
    with tenant_context(ctx["tenant"].id):
        ahmed = services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=None, distinct_from=None
        )
    oc = dict(ctx, owner=ctx["user"])
    shift, sid = _shift_op(ctx)
    do_push(oc, shift)
    small = _receipt_op(ctx, str(ahmed.id), amount="1000", shift_id=sid, number="PAY-1")
    big = _receipt_op(ctx, str(ahmed.id), amount="40000", shift_id=sid, number="PAY-2")
    assert do_push(oc, small, big) == ["accepted", "accepted"]
    small2 = {
        **small,
        "members": [
            dict(
                small["members"][0],
                payload={**small["members"][0]["payload"], "amount_minor": "1500"},
            )
        ],
    }
    big2 = {
        **big,
        "members": [
            dict(
                big["members"][0], payload={**big["members"][0]["payload"], "amount_minor": "50000"}
            )
        ],
    }
    assert do_push(oc, small2, big2) == ["conflicted", "conflicted"]
    oc_client, oh = _owner_client(ctx)
    items = oc_client.get("/api/sync/quarantine", headers=_hdr(oh)).json()["items"]
    # بالأثر المالي لا بالتاريخ: 500.00 قبل 15.00
    assert [i["effect_minor"] for i in items] == ["50000", "1500"]
    r = oc_client.post(
        f"/api/sync/quarantine/{items[0]['id']}/decide",
        {"decision": "reject", "reason": "الإيصال الورقي 400"},
        content_type="application/json",
        headers=_hdr(oh),
    )
    assert r.status_code == 200 and r.json()["applied"] == {}
    with tenant_context(ctx["tenant"].id):
        assert services.party_payload(ahmed)["balance_minor"] == "-41000"
        q = QuarantinedOperation.objects.get(id=items[0]["id"])
        assert q.decision == "reject" and q.decision_reason == "الإيصال الورقي 400"
        assert q.original["members"][0]["payload"]["amount_minor"] == "50000"  # المرفوض يبقى مقروءاً
