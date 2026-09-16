"""النسخة المادية الثابتة للتهيئة الأولى (§٨.١٠؛ ACC-05): جيل وsnapshot_id وقطع ونطاقات وإصدار مخطط
وموعد انتهاء وفهرس صفحات — تُحفظ الصفحات عند الإنشاء فلا يتغير محتواها بين الطلبات.

النطاقات مسمّاة (34-D26 loading): الكتالوج، الأطراف، الأرصدة، الإعدادات — كلٌّ بحجمه وتقدّمه.
الكتالوج والأطراف فارغان حتى نماذجهما (T1.8، T1.19)؛ الأعداد تُقال بصدق.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from core.models import Branch, Device, PaymentMethod, Role, Unit
from sync.models_log import BootstrapImage, BootstrapPage
from sync.reference import list_group
from sync.snapshots import create_snapshot

PAGE_SIZE = 200
IMAGE_TTL = timedelta(hours=24)
GROUPS: tuple[str, ...] = ("catalog", "parties", "balances", "settings")


@dataclass(frozen=True)
class GroupContent:
    group: str
    entities: list[dict[str, Any]]


def _settings_entities(tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for b in Branch.unscoped.filter(tenant_id=tenant_id, is_active=True).order_by("created_at"):
        out.append(
            {
                "entity": "core.Branch",
                "id": str(b.id),
                "payload": {"name": b.name, "code": b.code, "is_default": b.is_default},
            }
        )
    for u in Unit.unscoped.filter(tenant_id=tenant_id).order_by("created_at"):
        out.append(
            {
                "entity": "core.Unit",
                "id": str(u.id),
                "payload": {"code": u.code, "name": u.name, "is_base": u.is_base},
            }
        )
    for p in PaymentMethod.unscoped.filter(tenant_id=tenant_id, is_active=True).order_by(
        "created_at"
    ):
        out.append(
            {
                "entity": "core.PaymentMethod",
                "id": str(p.id),
                "payload": {"code": p.code, "name": p.name, "is_cash": p.is_cash},
            }
        )
    for r in Role.unscoped.filter(tenant_id=tenant_id).order_by("code"):
        out.append(
            {"entity": "core.Role", "id": str(r.id), "payload": {"code": r.code, "name": r.name}}
        )
    return out


def _contents(tenant_id: uuid.UUID, balances: list[dict[str, Any]]) -> list[GroupContent]:
    return [
        GroupContent("catalog", list_group(tenant_id, "catalog")),
        GroupContent("parties", []),
        GroupContent(
            "balances",
            [
                {"entity": "ledger.Balance", "id": str(i), "payload": b}
                for i, b in enumerate(balances)
            ],
        ),
        GroupContent("settings", _settings_entities(tenant_id)),
    ]


def create_image(device: Device) -> BootstrapImage:
    """لقطة جديدة عند القطع الحالي ثم تجميد صفحات كل نطاق في معاملة واحدة."""
    tenant_id = device.tenant_id
    with transaction.atomic():
        snapshot = create_snapshot(tenant_id)
        contents = _contents(tenant_id, list(snapshot.balances))
        image: BootstrapImage = BootstrapImage.unscoped.create(
            tenant_id=tenant_id,
            device=device,
            snapshot=snapshot,
            sync_epoch=snapshot.sync_epoch,
            cutoff_server_seq=snapshot.cutoff_server_seq,
            schema_version=snapshot.schema_version,
            expires_at=timezone.now() + IMAGE_TTL,
            scopes=[
                {
                    "group": c.group,
                    "total": len(c.entities),
                    "pages": max(1, -(-len(c.entities) // PAGE_SIZE)),
                }
                for c in contents
            ],
        )
        for c in contents:
            pages = [
                c.entities[i : i + PAGE_SIZE] for i in range(0, len(c.entities), PAGE_SIZE)
            ] or [[]]
            for n, chunk in enumerate(pages, start=1):
                BootstrapPage.unscoped.create(
                    tenant_id=tenant_id, image=image, group=c.group, page_no=n, entities=chunk
                )
    return image


class ImageExpired(Exception):
    pass


class PageNotFound(Exception):
    pass


def get_page(image: BootstrapImage, group: str, page_no: int) -> BootstrapPage:
    if image.expires_at <= timezone.now():
        raise ImageExpired
    page: BootstrapPage | None = BootstrapPage.unscoped.filter(
        image=image, group=group, page_no=page_no
    ).first()
    if page is None:
        raise PageNotFound
    return page


def image_envelope(image: BootstrapImage) -> dict[str, Any]:
    return {
        "image_id": str(image.id),
        "sync_epoch": image.sync_epoch,
        "snapshot_id": str(image.snapshot_id),
        "cutoff_server_seq": str(image.cutoff_server_seq),
        "schema_version": image.schema_version,
        "as_of": image.created_at.isoformat().replace("+00:00", "Z"),
        "expires_at": image.expires_at.isoformat().replace("+00:00", "Z"),
        "page_size": PAGE_SIZE,
        "scopes": image.scopes,
        "balances": image.snapshot.balances,
    }
