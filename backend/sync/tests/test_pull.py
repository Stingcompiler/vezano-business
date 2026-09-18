"""PULL والمؤشرات واللقطات وsync_log — §٨.٥–٨.٧، §٨.٩؛ معايير §١٨ ACC-36…41 وACC-46."""

from __future__ import annotations

import threading
import uuid
from typing import Any

import pytest
from django.db import DatabaseError, connections, transaction
from django.test import Client

from conftest import TwoTenants
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from sync.counter import ensure_state, lock_and_reserve
from sync.models import Member
from sync.models_log import SyncLog
from sync.pull import pull
from sync.push import PROTOCOL_VERSION, PushError, push
from sync.snapshots import create_snapshot
from sync.tests.test_push import U, envelope, probe

pytestmark = pytest.mark.django_db(transaction=True)


def shift_open(branch_id: str, device_id: str, user_id: str) -> dict[str, Any]:
    return {
        "operation_id": U(),
        "kind": "shift_open",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {
                "entity": "shifts.ShiftOpened",
                "id": U(),
                "schema_version": 1,
                "payload": {
                    "shift_id": U(),
                    "branch_id": branch_id,
                    "device_id": device_id,
                    "user_id": user_id,
                    "opening_float_minor": "5000",
                    "business_date": "2026-09-15",
                },
            }
        ],
    }


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    t = two_tenants.a
    with platform_context():
        owner = User.objects.create_user(
            tenant=t, username="owner", display_name="المالك", is_owner=True
        )
        role = Role.unscoped.create(tenant=t, code="owner", name="مالك")
        for b in two_tenants.a_branches:
            UserBranchAccess.unscoped.create(tenant=t, user=owner, branch=b, role=role)
    with tenant_context(t.id):
        krt = register_device(user=owner, branch=two_tenants.a_branches[0], name="تابلت الرئيسي")
        bhr = register_device(user=owner, branch=two_tenants.a_branches[1], name="تابلت بحري")
        epoch = ensure_state(t.id).sync_epoch
    return {
        "tenant": t,
        "owner": owner,
        "krt": krt,
        "bhr": bhr,
        "epoch": epoch,
        "branches": two_tenants.a_branches,
    }


def do_push(c: dict[str, Any], reg: Any, *ops: dict[str, Any]) -> dict[str, Any]:
    with tenant_context(c["tenant"].id):
        return push(
            device_id=reg.device.id,
            actor_user_id=c["owner"].id,
            envelope=envelope(c["epoch"], *ops),
            branch_id=str(reg.device.branch_id),
        ).as_dict()


def do_pull(
    c: dict[str, Any],
    reg: Any,
    cursors: list[dict[str, str]] | None = None,
    limit: int | None = None,
    epoch: str | None = None,
) -> dict[str, Any]:
    env: dict[str, Any] = {
        "protocol_version": PROTOCOL_VERSION,
        "sync_epoch": epoch or c["epoch"],
        "request_id": "pull-1",
        "cursors": cursors or [],
    }
    if limit:
        env["limit"] = limit
    with tenant_context(c["tenant"].id):
        return pull(
            device_id=reg.device.id, branch_ids=[str(reg.device.branch_id)], envelope=env
        ).as_dict()


def cursor(page: dict[str, Any], scope: str, group: str) -> int:
    return int(
        next(
            c["server_seq"]
            for c in page["cursors"]
            if c["scope"] == scope and c["entity_group"] == group
        )
    )


class TestSyncLog:
    def test_push_writes_log_rows_atomically_with_members(self, ctx: dict[str, Any]) -> None:
        do_push(ctx, ctx["krt"], probe(lines=2))
        with tenant_context(ctx["tenant"].id):
            assert SyncLog.objects.count() == Member.objects.count() == 3
            assert sorted(SyncLog.objects.values_list("server_seq", flat=True)) == [1, 2, 3]
            assert set(SyncLog.objects.values_list("scope", "entity_group")) == {
                ("enterprise", "probe")
            }

    def test_direct_write_without_tenant_lock_is_rejected(self, ctx: dict[str, Any]) -> None:
        """ACC-37: كتابة sync_log بلا القفل الصحيح تُرفض بحارس قاعدة البيانات."""
        with tenant_context(ctx["tenant"].id), pytest.raises(DatabaseError), transaction.atomic():
            SyncLog.unscoped.create(
                tenant=ctx["tenant"],
                scope="enterprise",
                entity_group="probe",
                entity="probe.Head",
                entity_id=uuid.uuid4(),
                server_seq=999,
            )

    def test_write_under_lock_is_accepted(self, ctx: dict[str, Any]) -> None:
        with tenant_context(ctx["tenant"].id), transaction.atomic():
            lock_and_reserve(ctx["tenant"].id, 1)
            SyncLog.unscoped.create(
                tenant=ctx["tenant"],
                scope="enterprise",
                entity_group="probe",
                entity="probe.Head",
                entity_id=uuid.uuid4(),
                server_seq=1,
            )

    def test_branch_scoped_entities_carry_branch_scope_id(self, ctx: dict[str, Any]) -> None:
        krt = ctx["krt"]
        do_push(
            ctx,
            krt,
            shift_open(str(krt.device.branch_id), str(krt.device.id), str(ctx["owner"].id)),
        )
        with tenant_context(ctx["tenant"].id):
            row = SyncLog.objects.get()
            assert (row.scope, row.scope_id, row.entity_group) == (
                "branch",
                str(krt.device.branch_id),
                "shifts",
            )


class TestPull:
    def test_page_carries_entities_receipts_projection_and_absolute_cursors(
        self, ctx: dict[str, Any]
    ) -> None:
        op = probe(lines=1)
        do_push(ctx, ctx["krt"], op)
        page = do_pull(ctx, ctx["krt"])
        assert {e["entity"] for e in page["entities"]} == {"probe.Head", "probe.Line"}
        assert all(e["operation_id"] == op["operation_id"] for e in page["entities"])
        proj = page["operation_projections"][0]
        assert (
            proj["operation_id"] == op["operation_id"]
            and len(proj["members"]) == 2
            and proj["authorized_complete"]
        )
        assert cursor(page, "enterprise", "probe") == 2
        assert cursor(page, "branch", "shifts") == 0
        assert page["has_more"] is False
        assert page["access_manifest_version"] == "1"

    def test_has_more_and_resume_without_gaps_or_regression(self, ctx: dict[str, Any]) -> None:
        """ACC-40/41: صفحات متعددة، لا فجوة، والمؤشرات لا تتراجع."""
        for _ in range(5):
            do_push(ctx, ctx["krt"], probe(lines=1))  # 10 أعضاء
        seen: list[int] = []
        cursors: list[dict[str, str]] = []
        pages = 0
        while True:
            page = do_pull(ctx, ctx["krt"], cursors=cursors, limit=3)
            pages += 1
            seen += [int(e["server_seq"]) for e in page["entities"]]
            new_c = cursor(page, "enterprise", "probe")
            assert not cursors or new_c >= cursor({"cursors": cursors}, "enterprise", "probe")
            cursors = page["cursors"]
            if not page["has_more"]:
                break
        assert pages == 4
        assert seen == list(range(1, 11))

    def test_branch_isolation_and_cursor_forbidden(self, ctx: dict[str, Any]) -> None:
        """ACC-46 (عكس): جهاز فرع لا يسحب ورديات فرع آخر، ومؤشر لمفتاح غير مصرح يُرفض."""
        krt, bhr = ctx["krt"], ctx["bhr"]
        do_push(
            ctx,
            krt,
            shift_open(str(krt.device.branch_id), str(krt.device.id), str(ctx["owner"].id)),
        )
        do_push(
            ctx,
            bhr,
            shift_open(str(bhr.device.branch_id), str(bhr.device.id), str(ctx["owner"].id)),
        )
        page_krt = do_pull(ctx, krt)
        assert len(page_krt["entities"]) == 1
        assert page_krt["entities"][0]["payload"]["branch_id"] == str(krt.device.branch_id)
        with pytest.raises(PushError) as e:
            do_pull(
                ctx,
                krt,
                cursors=[
                    {
                        "scope": "branch",
                        "entity_group": "shifts",
                        "scope_id": str(bhr.device.branch_id),
                        "server_seq": "0",
                    }
                ],
            )
        assert e.value.code == "cursor_forbidden"

    def test_enterprise_data_visible_to_both_branches(self, ctx: dict[str, Any]) -> None:
        do_push(ctx, ctx["krt"], probe())
        assert len(do_pull(ctx, ctx["bhr"])["entities"]) == 2

    def test_epoch_mismatch_rejected(self, ctx: dict[str, Any]) -> None:
        with pytest.raises(PushError) as e:
            do_pull(ctx, ctx["krt"], epoch="epoch-old")
        assert e.value.code == "epoch_mismatch"

    def test_page_is_consistent_snapshot_under_concurrent_write(self, ctx: dict[str, Any]) -> None:
        """ACC-39: كتابة تلتزم بين قراءة الفهرس والمحتوى لا تظهر نصفاً — الصفحة من لقطة واحدة."""
        do_push(ctx, ctx["krt"], probe(lines=1))
        started = threading.Event()
        release = threading.Event()
        page_holder: dict[str, Any] = {}

        def reader() -> None:
            try:
                # معاملة قراءة مستقلة: العزل قبل أول استعلام (مستخدم متفوق؛ لا سياق RLS)
                with transaction.atomic():
                    from django.db import connection

                    with connection.cursor() as cur:
                        cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                        cur.execute("SELECT count(*) FROM sync_log")  # يثبّت اللقطة
                    started.set()
                    release.wait(5)
                    with connection.cursor() as cur:
                        cur.execute("SELECT count(*) FROM sync_log")
                        page_holder["log_after"] = cur.fetchone()[0]
                        cur.execute("SELECT count(*) FROM sync_member")
                        page_holder["members_after"] = cur.fetchone()[0]
            finally:
                started.set()
                connections.close_all()

        t = threading.Thread(target=reader)
        t.start()
        assert started.wait(5)
        do_push(ctx, ctx["krt"], probe(lines=3))  # 4 أعضاء جديدة تلتزم أثناء القراءة
        release.set()
        t.join()
        assert page_holder["log_after"] == page_holder["members_after"] == 2

    def test_access_manifest_version_bumps_when_branches_change(self, ctx: dict[str, Any]) -> None:
        """ACC-45: سحب/منح الوصول يصل بقائمة كاملة بإصدار جديد لا بالاختفاء."""
        reg = ctx["krt"]
        assert do_pull(ctx, reg)["access_manifest_version"] == "1"
        assert do_pull(ctx, reg)["access_manifest_version"] == "1"
        with tenant_context(ctx["tenant"].id):
            page = pull(
                device_id=reg.device.id,
                branch_ids=[str(b.id) for b in ctx["branches"]],
                envelope={
                    "protocol_version": 1,
                    "sync_epoch": ctx["epoch"],
                    "request_id": "x",
                    "cursors": [],
                },
            ).as_dict()
        assert page["access_manifest_version"] == "2"


class TestSnapshots:
    def test_snapshot_at_cutoff_after_lock_and_offered_as_candidate(
        self, ctx: dict[str, Any]
    ) -> None:
        do_push(ctx, ctx["krt"], probe(lines=2))  # عداد = 3
        with tenant_context(ctx["tenant"].id):
            snap = create_snapshot(
                ctx["tenant"].id,
                balances=[
                    {
                        "party_id": U(),
                        "account_role": "customer",
                        "currency": "SDG",
                        "amount_minor": "125000",
                    }
                ],
            )
            assert snap.cutoff_server_seq == 3 and snap.sync_epoch == ctx["epoch"]
        page = do_pull(ctx, ctx["krt"])
        cand = page["snapshot_candidates"][0]
        assert cand["snapshot_id"] == str(snap.id) and cand["cutoff_server_seq"] == "3"
        assert cand["balances"][0]["amount_minor"] == "125000"

    def test_cutoff_never_regresses_and_only_latest_offered(self, ctx: dict[str, Any]) -> None:
        with tenant_context(ctx["tenant"].id):
            s1 = create_snapshot(ctx["tenant"].id)
        do_push(ctx, ctx["krt"], probe())
        with tenant_context(ctx["tenant"].id):
            s2 = create_snapshot(ctx["tenant"].id)
            assert s2.cutoff_server_seq > s1.cutoff_server_seq
        cands = do_pull(ctx, ctx["krt"])["snapshot_candidates"]
        assert [c["snapshot_id"] for c in cands] == [str(s2.id)]


class TestPullEndpoint:
    def test_endpoint_requires_device_and_returns_page(self, ctx: dict[str, Any]) -> None:
        do_push(ctx, ctx["krt"], probe())
        r = Client().post(
            "/api/sync/pull",
            {"protocol_version": 1, "sync_epoch": ctx["epoch"], "request_id": "p1"},
            content_type="application/json",
            headers={"Authorization": f"Bearer {ctx['krt'].access}"},
        )
        assert r.status_code == 200, r.content
        assert len(r.json()["entities"]) == 2


@pytest.mark.django_db(transaction=True)
class TestSyncStatus:
    def test_status_reports_reach_seq_and_this_device_review_counts(
        self, ctx: dict[str, Any]
    ) -> None:
        """SYS-01: «هناك شبكة» ≠ «نجح الوصول» — ردّ مصادَق بوقت الخادم ورقمه الأعلى وما للجهاز من
        محجور؛ لا يغيّر شيئاً."""
        headers = {"Authorization": f"Bearer {ctx['krt'].access}"}
        r = Client().get("/api/sync/status", headers=headers)
        assert r.status_code == 200, r.content
        body = r.json()
        assert body["sync_epoch"] == ctx["epoch"]
        assert body["server_seq_high"] == "0"
        assert body["quarantined"] == 0 and body["conflicted"] == 0
        assert body["last_accepted_at"] is None

        do_push(ctx, ctx["krt"], probe())
        # عملية مرفوضة (نوع مجهول) تُحجر لهذا الجهاز وحده
        do_push(ctx, ctx["krt"], {**probe(), "kind": "no_such_kind"})
        body = Client().get("/api/sync/status", headers=headers).json()
        assert int(body["server_seq_high"]) >= 1
        assert body["quarantined"] == 1 and body["conflicted"] == 0
        assert body["last_accepted_at"] is not None
        other = (
            Client()
            .get("/api/sync/status", headers={"Authorization": f"Bearer {ctx['bhr'].access}"})
            .json()
        )
        assert other["quarantined"] == 0

    def test_status_requires_device_session(self, ctx: dict[str, Any]) -> None:
        assert Client().get("/api/sync/status").status_code in (401, 403)
