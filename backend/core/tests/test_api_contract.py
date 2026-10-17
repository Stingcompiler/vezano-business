"""عقد الردود من الرصد (0005 §١٦١): الاستنتاج والتصحيحات والإنفاذ والتسمية، وحارس يمنع عودة عملية
بلا مخطط ردّ إلى OpenAPI."""

from __future__ import annotations

from typing import Any

import pytest
from drf_spectacular.generators import SchemaGenerator

from core import api_contract
from core.api_contract import ContractViolation, build_contract, check, infer

#: عمليات بلا جسم JSON بطبيعتها (لا محتوى، أو ملف CSV) أو لم تغطّها الاختبارات بعد. عملية جديدة بلا
#: مخطط ردّ تُسقط `test_no_new_untyped_operations` حتى تُرصد (أو تُضاف هنا بسبب مكتوب).
UNTYPED_ALLOWED = {
    # بلا جسم
    "POST /api/auth/forget",
    "POST /api/auth/logout",
    "POST /api/auth/remember",
    # ملفات لا JSON
    "GET /api/catalog/prices/import/{batch_id}/rejected.csv",
    "GET /api/imports/{batch_id}/rejected.csv",
    "GET /api/reports/exports/{token}",
    # لم تغطّها الاختبارات بعد — تُرصد عند تغطيتها
    "PUT /api/campaigns/{campaign_id}",
    "DELETE /api/catalog/items/{item_id}/aliases",
    "GET /api/catalog/prices/import/{batch_id}",
    "GET /api/imports/{batch_id}",
    "GET /api/inventory/purchasing/returns/{return_id}",
    "PUT /api/market/lists/{list_id}",
    "POST /api/market/orders/{order_id}/requote",
    "GET /api/market/reports",
    "POST /api/parties/merges/{merge_id}/undo",
    "GET /api/platform/announcements",
    "POST /api/reports/exports/limit-request",
}


def test_infer_required_optional_nullable_and_maps() -> None:
    s = infer(
        [
            {"id": "a", "n": 1, "note": None, "by": {"0b8f0c5e-1111-4111-8111-111111111111": True}},
            {"id": "b", "n": 2.5, "note": "x", "extra": [1]},
        ]
    )
    assert s["required"] == ["id", "n", "note"]
    assert s["properties"]["n"] == {"type": "number"}
    assert s["properties"]["note"] == {"anyOf": [{"type": "string"}, {"type": "null"}]}
    assert s["properties"]["by"] == {"type": "object", "additionalProperties": {"type": "boolean"}}
    assert s["additionalProperties"] is False


def test_overrides_replace_enum_and_add_optional(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    f = tmp_path / "o.json"
    f.write_text(
        '{"overrides": ['
        '{"ops": ["GET /api/x"], "at": "rows[].state",'
        ' "schema": {"type": "string", "enum": ["a", "b"]}},'
        '{"ops": ["GET /api/x"], "at": "", "add_properties": {"link": {"type": "string"}}}'
        "]}",
        encoding="utf-8",
    )
    monkeypatch.setattr(api_contract, "OVERRIDES_PATH", f)
    c = build_contract(
        [{"method": "GET", "path": "/api/x", "status": 200, "body": {"rows": [{"state": "a"}]}}]
    )
    schema = c["responses"]["GET /api/x"]["200"]
    assert schema["properties"]["rows"]["items"]["properties"]["state"]["enum"] == ["a", "b"]
    assert "link" in schema["properties"] and "link" not in schema["required"]


def test_errors_collected_from_detail_codes() -> None:
    c = build_contract(
        [{"method": "POST", "path": "/api/x", "status": 403, "body": {"detail": "owner_required"}}]
    )
    assert c["errors"] == {"POST /api/x": ["403:owner_required"]}


def test_check_rejects_undeclared_field() -> None:
    contract = {"GET /api/x": {"200": infer([{"a": 1}])}}
    check("GET", "/api/x", 200, {"a": 2}, contract)
    with pytest.raises(ContractViolation, match="GET /api/x"):
        check("GET", "/api/x", 200, {"a": 2, "b": 3}, contract)


def test_component_names_unique_per_path_and_status() -> None:
    a = api_contract._component_name("get", "/api/campaigns", "200", ["200"])
    b = api_contract._component_name("get", "/api/campaigns/{campaign_id}", "200", ["200"])
    assert a == "GetCampaignsResponse" and b == "GetCampaignsByCampaignIdResponse"
    both = ["200", "201"]
    assert api_contract._component_name("post", "/api/x", "201", both) == "PostXResponse201"


def test_no_new_untyped_operations() -> None:
    """كل عملية في OpenAPI لها مخطط ردّ (مسلسِل أو مرصود) ما لم تكن في القائمة المسموحة بسببها."""
    gen = SchemaGenerator()  # type: ignore[no-untyped-call]
    schema = gen.get_schema(request=None, public=True)  # type: ignore[no-untyped-call]
    untyped = set()
    for path, item in schema["paths"].items():
        for method, op in item.items():
            if method not in {"get", "post", "put", "patch", "delete"} or "/scenario/" in path:
                continue
            ok = [r for c, r in op.get("responses", {}).items() if c.startswith("2")]
            if not any(r.get("content") for r in ok):
                untyped.add(f"{method.upper()} {path}")
    assert untyped - UNTYPED_ALLOWED == set(), "عمليات بلا مخطط ردّ — أعد الرصد (backend/README.md)"
