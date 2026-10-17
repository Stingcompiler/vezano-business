"""عقد ردود الـAPI من الرصد (خطة الجوال M0 — 0005 §١٦١).

أغلب العروض تعيد قواميس تبنيها الخدمات (`party_payload`…) بلا مُسلسِل، فكانت 292 عملية من 327 بلا
مخطط ردّ في OpenAPI، والويب يعرّف أشكالها محلياً (`as unknown as`). بدل كتابة مسلسِل لكل ردّ يدوياً:

1. **الرصد** (`STING_API_CONTRACT=capture`): وسيط أثناء pytest يكتب كل ردّ JSON (المسار بنمط OpenAPI،
   الطريقة، الحالة، الجسم) سطراً في ملفات `STING_API_CONTRACT_SAMPLES`.
2. **الاستنتاج** (`manage.py api_contract infer`): يدمج العيّنات إلى JSON Schema لكل (طريقة، مسار،
   حالة 2xx) في `core/api_contract.json`، ورموز الأخطاء المرصودة لكل مسار.
3. **الحقن**: خطّاف spectacular يضع المخطط في العمليات التي لا مخطط لها، فتتولّد أنواع TypeScript.
4. **الإنفاذ** (الافتراضي في pytest): الوسيط يتحقق من كل ردّ 2xx مقابل مخططه — حقل جديد أو نوع
   مختلف يُسقط الاختبار حتى يُعاد الرصد. فلا يتباعد العقد عن الكود بصمت.

حدّ معلن: «إلزامي» = ظهر في كل العيّنات المرصودة؛ فرع لم تغطّه الاختبارات قد يحذف حقلاً يُعلَن إلزامياً.
"""

from __future__ import annotations

import copy
import fnmatch
import functools
import json
import os
import re
import tempfile
import threading
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from django.http import HttpRequest, HttpResponse

CONTRACT_PATH = Path(__file__).with_name("api_contract.json")
OVERRIDES_PATH = Path(__file__).with_name("api_contract_overrides.json")
_ROUTE_PARAM = re.compile(r"<(?:\w+:)?(\w+)>")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_lock = threading.Lock()


def openapi_path(request: HttpRequest) -> str | None:
    """`api/parties/<uuid:party_id>` ← `/api/parties/{party_id}` كما يكتبه spectacular."""
    match = getattr(request, "resolver_match", None)
    if match is None or not match.route:
        return None
    return "/" + _ROUTE_PARAM.sub(r"{\1}", match.route)


# ---------------------------------------------------------------- الاستنتاج


def _kind(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array"
    return "object"


def _is_map(objs: list[dict[str, Any]]) -> bool:
    """قاموس مفاتيحه معرّفات (UUID أو أرقام) = خريطة لا كائن بحقول ثابتة."""
    keys = {k for o in objs for k in o}
    return bool(keys) and all(_UUID.match(k) or k.isdigit() for k in keys)


def infer(values: list[Any]) -> dict[str, Any]:
    """JSON Schema يقبل كل القيم المرصودة ويمنع غيرها (حقول إضافية مرفوضة)."""
    kinds = {_kind(v) for v in values}
    if kinds == {"integer", "number"} or kinds == {"integer", "number", "null"}:
        kinds = (kinds - {"integer"}) | {"number"}
    schemas: list[dict[str, Any]] = []
    for kind in sorted(kinds - {"null"}):
        group = [
            v for v in values if _kind(v) == kind or (kind == "number" and _kind(v) == "integer")
        ]
        if kind == "object":
            schemas.append(_infer_object(group))
        elif kind == "array":
            items = [i for arr in group for i in arr]
            schemas.append({"type": "array", "items": infer(items) if items else {}})
        else:
            schemas.append({"type": kind})
    if "null" in kinds:
        schemas.append({"type": "null"})
    if not schemas:
        return {}
    return schemas[0] if len(schemas) == 1 else {"anyOf": schemas}


def _infer_object(objs: list[dict[str, Any]]) -> dict[str, Any]:
    if _is_map(objs):
        vals = [v for o in objs for v in o.values()]
        return {"type": "object", "additionalProperties": infer(vals) if vals else {}}
    keys: list[str] = []
    for o in objs:
        for k in o:
            if k not in keys:
                keys.append(k)
    props = {k: infer([o[k] for o in objs if k in o]) for k in keys}
    required = [k for k in keys if all(k in o for o in objs)]
    out: dict[str, Any] = {"type": "object", "properties": props, "additionalProperties": False}
    if required:
        out["required"] = required
    return out


def _targets(schema: dict[str, Any], steps: list[str]) -> list[dict[str, Any]]:
    """العُقد التي يشير إليها المسار (يمرّ عبر anyOf)؛ يُعيد الحاويات مع مفتاح الاستبدال."""
    nodes = [schema]
    for step in steps:
        nxt: list[dict[str, Any]] = []
        for node in nodes:
            alts = node.get("anyOf", [node])
            for alt in alts:
                if step == "[]" and alt.get("type") == "array":
                    nxt.append(alt.setdefault("items", {}))
                elif step != "[]" and step in alt.get("properties", {}):
                    nxt.append(alt["properties"][step])
        nodes = nxt
    return nodes


def apply_overrides(responses: dict[str, Any]) -> dict[str, Any]:
    if not OVERRIDES_PATH.exists():
        return responses
    entries = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))["overrides"]
    for entry in entries:
        steps = [p for p in re.split(r"\.|(\[\])", entry.get("at", "")) if p]
        for key, by_status in responses.items():
            if not any(fnmatch.fnmatchcase(key, pat) for pat in entry["ops"]):
                continue
            for schema in by_status.values():
                for node in _targets(schema, steps):
                    if "add_properties" in entry:
                        # حقول اختيارية لفرع لم تغطّه الاختبارات (تُضاف ولا تُلزَم)
                        for alt in node.get("anyOf", [node]):
                            if alt.get("type") == "object" and "properties" in alt:
                                alt["properties"].update(entry["add_properties"])
                        continue
                    replacement = copy.deepcopy(entry["schema"])
                    has_null = any(a.get("type") == "null" for a in replacement.get("anyOf", []))
                    nullable = any(a.get("type") == "null" for a in node.get("anyOf", []))
                    node.clear()
                    if nullable and not has_null:
                        node["anyOf"] = [replacement, {"type": "null"}]
                    else:
                        node.update(replacement)
    return responses


def build_contract(samples: Iterable[dict[str, Any]]) -> dict[str, Any]:
    bodies: dict[str, dict[str, list[Any]]] = {}
    errors: dict[str, set[str]] = {}
    for s in samples:
        key = f"{s['method']} {s['path']}"
        status = int(s["status"])
        body = s["body"]
        if 200 <= status < 300:
            bodies.setdefault(key, {}).setdefault(str(status), []).append(body)
        elif isinstance(body, dict) and isinstance(body.get("detail"), str):
            errors.setdefault(key, set()).add(f"{status}:{body['detail']}")
    responses = {
        key: {status: infer(vals) for status, vals in sorted(by_status.items())}
        for key, by_status in sorted(bodies.items())
    }
    return {
        "responses": apply_overrides(responses),
        "errors": {key: sorted(codes) for key, codes in sorted(errors.items())},
    }


def load_contract() -> dict[str, Any]:
    if not CONTRACT_PATH.exists():
        return {"responses": {}, "errors": {}}
    data: dict[str, Any] = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    return data


@functools.cache
def _cached_responses() -> dict[str, Any]:
    responses: dict[str, Any] = load_contract()["responses"]
    return responses


# ---------------------------------------------------------------- spectacular


def _component_name(method: str, path: str, status: str, statuses: Iterable[str]) -> str:
    """اسم ثابت من الطريقة والمسار لا من operationId (spectacular يضيف لاحقة التمييز بعد الخطّافات):
    `GET /api/campaigns/{campaign_id}` ← `GetCampaignsByCampaignIdResponse`."""
    parts = [method.capitalize()]
    for seg in path.strip("/").split("/")[1:]:
        if seg.startswith("{"):
            parts.append("By" + "".join(w.capitalize() for w in seg.strip("{}").split("_")))
        else:
            parts.append("".join(w.capitalize() for w in re.split(r"[-_]", seg) if w))
    base = "".join(parts)
    ok = [x for x in statuses if x in {"200", "201"}]
    suffix = "" if status in {"200", "201"} and len(ok) == 1 else status
    return f"{base}Response{suffix}"


def postprocess_schema(result: dict[str, Any], generator: Any, **_kwargs: Any) -> dict[str, Any]:
    """يحقن المخطط المرصود في العمليات التي لا مخطط ردّ لها (لا يمسّ ما وصفه مسلسِل)."""
    contract = load_contract()["responses"]
    components = result.setdefault("components", {}).setdefault("schemas", {})
    for path, item in result.get("paths", {}).items():
        for method, op in item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            observed = contract.get(f"{method.upper()} {path}")
            if not observed:
                continue
            responses = op.setdefault("responses", {})
            for status, schema in observed.items():
                current = responses.get(status, {})
                if current.get("content"):
                    continue
                name = _component_name(method, path, status, observed)
                components[name] = schema
                responses[status] = {
                    "description": current.get("description", ""),
                    "content": {
                        "application/json": {"schema": {"$ref": f"#/components/schemas/{name}"}}
                    },
                }
    return result


# ---------------------------------------------------------------- الوسيط


def _mode() -> str:
    return os.environ.get("STING_API_CONTRACT", "off")


class ApiContractMiddleware:
    """يُضاف في pytest وحده (`backend/conftest.py`)؛ لا أثر له في الإنتاج."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response
        self.mode = _mode()
        self.contract = _cached_responses() if self.mode == "enforce" else {}

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        if self.mode not in {"capture", "enforce"}:
            return response
        path = openapi_path(request)
        if not path or not path.startswith("/api/") or "/api/scenario/" in path:
            return response
        if "application/json" not in response.get("Content-Type", ""):
            return response
        try:
            body = json.loads(response.content or b"null")
        except (ValueError, AttributeError):
            return response
        method = (request.method or "GET").upper()
        if self.mode == "capture":
            _write_sample(
                {"method": method, "path": path, "status": response.status_code, "body": body}
            )
        elif 200 <= response.status_code < 300:
            check(method, path, response.status_code, body, self.contract)
        return response


def _write_sample(sample: dict[str, Any]) -> None:
    default = Path(tempfile.gettempdir()) / "sting-api-samples"
    folder = Path(os.environ.get("STING_API_CONTRACT_SAMPLES", str(default)))
    folder.mkdir(parents=True, exist_ok=True)
    line = json.dumps(sample, ensure_ascii=False)
    with _lock, open(folder / f"samples-{os.getpid()}.jsonl", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


class ContractViolation(AssertionError):
    pass


def check(method: str, path: str, status: int, body: Any, contract: dict[str, Any]) -> None:
    from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

    schema = contract.get(f"{method} {path}", {}).get(str(status))
    if schema is None:
        return
    errors = sorted(Draft202012Validator(schema).iter_errors(body), key=lambda e: list(e.path))
    if errors:
        first = errors[0]
        where = "/".join(str(p) for p in first.path) or "(الجذر)"
        raise ContractViolation(
            f"ردّ {method} {path} ({status}) خالف العقد عند {where}: {first.message}\n"
            "إن كان التغيير مقصوداً فأعد الرصد: انظر backend/README.md «عقد الردود»."
        )
