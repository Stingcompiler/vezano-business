"""إيصال الاشتراك (بأمر المالك 2026-09-22؛ 0005 §١١١): اعتماد الإثبات يُصدر إيصالاً مرقَّماً
`SR-YYYY-NNNNNN` بالمبلغ والباقة والدورة والفترة ورقم التحويل ومن اعتمده؛ يراه المالك وحده."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.models import SubscriptionReceipt
from core.subscription import PLANS
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_receipt_issued_on_approval(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    oh = _operator_headers("ops7", "هدى — تشغيل")
    r = _post(
        c,
        owner,
        "/api/org/subscription/proofs",
        {"reference": "TRX-501", "plan_code": "dual", "cycle": "quarterly"},
    )
    assert r.status_code == 201 and r.json()["proof"]["receipt"] is None
    pid = r.json()["proof"]["id"]
    assert c.get("/api/org/subscription/receipts", headers=owner).json()["receipts"] == []
    approve = f"/api/platform/proofs/{ctx['tenant'].id}/{pid}/approve"
    assert _post(c, oh, approve, {}).status_code == 200
    lst = c.get("/api/org/subscription/receipts", headers=owner).json()["receipts"]
    assert len(lst) == 1
    rc = lst[0]
    assert rc["number"].startswith("SR-") and rc["number"].endswith("-000001")
    assert rc["plan_name"] == "فرعان" and rc["cycle_label"] == "ربعي"
    # المبلغ سعر الكتالوج الربعي لـ«فرعان» (0005 §١١٧) — لا رقم مثبَّت يتقادم بتغيير السعر
    quarterly = str(PLANS["dual"].price_quarterly_minor)
    assert rc["amount_minor"] == quarterly and rc["reference"] == "TRX-501"
    assert rc["issued_by_name"] == "هدى — تشغيل" and rc["period_to"] > rc["period_from"]
    # الإثبات يحمل مرجع الإيصال، والتفاصيل تُقرأ بمعرّفه؛ المدير لا يراه
    proofs = c.get("/api/org/subscription/proofs", headers=owner).json()["proofs"]
    assert proofs[0]["receipt"]["number"] == rc["number"]
    one = c.get(f"/api/org/subscription/receipts/{rc['id']}", headers=owner).json()["receipt"]
    assert one["tenant_name"] == ctx["tenant"].name and one["issuer"]["name"] == "فيزانو بلص"
    mgr = _h(ctx["tokens"]["manager"])
    assert c.get("/api/org/subscription/receipts", headers=mgr).status_code == 403
    # إيصال ثانٍ يتسلسل
    r = _post(
        c, owner, "/api/org/subscription/proofs", {"reference": "TRX-502", "plan_code": "dual"}
    )
    assert (
        _post(
            c, oh, f"/api/platform/proofs/{ctx['tenant'].id}/{r.json()['proof']['id']}/approve", {}
        ).status_code
        == 200
    )
    with tenant_context(ctx["tenant"].id):
        numbers = sorted(SubscriptionReceipt.objects.values_list("number", flat=True))
    assert numbers[1].endswith("-000002")
