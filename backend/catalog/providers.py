"""مساهمات الكتالوج في سجلّات المزامنة والرئيسية والبحث — تُسجَّل عند تحميل التطبيق."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from catalog.models import Item, ItemGroup
from catalog.services import ItemQuery, group_payload, item_payload, search_items
from core import home
from sync.reference import register_lister, register_resolver


def _resolve_items(
    _tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    return {
        i.id: item_payload(i)
        for i in Item.objects.filter(id__in=list(ids))
        .select_related("group", "base_unit")
        .prefetch_related("aliases", "units__unit")
    }


def _resolve_groups(
    _tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    return {
        g.id: group_payload(g)
        for g in ItemGroup.objects.filter(id__in=list(ids)).select_related("parent")
    }


def _list_catalog(_tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [
        {"entity": "catalog.ItemGroup", "id": str(g.id), "payload": group_payload(g)}
        for g in ItemGroup.objects.select_related("parent").order_by("sort_order")
    ]
    out += [
        {"entity": "catalog.Item", "id": str(i.id), "payload": item_payload(i)}
        for i in Item.objects.select_related("group", "base_unit")
        .prefetch_related("aliases", "units__unit")
        .order_by("name_normalized")
    ]
    return out


register_resolver("catalog.Item", _resolve_items)
register_resolver("catalog.ItemGroup", _resolve_groups)
register_lister("catalog", _list_catalog)


def _search_items(viewer: home.Viewer, q: str, out: dict[str, Any]) -> None:
    """HOME-03: الأصناف بالبادئة — الأصناف تظهر للكاشير أيضاً (الكشف والتكلفة لا)."""
    items, _ = search_items(ItemQuery(q=q), limit=20)
    group = next(g for g in out["groups"] if g["kind"] == "items")
    for i in items:
        group["results"].append(
            {
                "id": str(i.id),
                "title": i.name,
                "meta": f"{i.base_unit.name}",
                "tag": "نشط" if i.is_active else "معطَّل",
                "tag_kind": "ok" if i.is_active else "muted",
                "href": f"/catalog/{i.id}",
            }
        )


home.SEARCH_PROVIDERS.append(_search_items)
