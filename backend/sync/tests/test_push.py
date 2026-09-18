"""عقد PUSH — قواعد القبول العشر (§٨.٣) والتجزئة (§٨.٤) والعداد (§٨.٥).

معايير §١٨: ACC-29 (إعادة النقل وقطع الرد)، ACC-30 (عملية ناقصة)، ACC-31 (فاشلة + مستقلة)،
ACC-32 (عضو زائد/ناقص/مختلف)، ACC-33 (أب غير مؤكد)، ACC-34 (وردية offline ثم بيع)، ACC-59.
"""

from __future__ import annotations

import threading
import uuid
from typing import Any

import pytest
from django.db import connections
from django.test import Client

from conftest import TwoTenants
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from sync.canonical import CanonicalError, canonical_json, content_hash, members_hash
from sync.counter import ensure_state, lock_and_reserve
from sync.models import Member, Operation, QuarantinedOperation, SyncState
from sync.push import PROTOCOL_VERSION, PushError, push

pytestmark = pytest.mark.django_db(transaction=True)


def U() -> str:
    return str(uuid.uuid4())


def head(value: str = "1", note: str | None = None) -> dict[str, Any]:
    p: dict[str, Any] = {"value": value}
    if note is not None:
        p["note"] = note
    return p


def probe(
    op_id: str | None = None,
    *,
    lines: int = 1,
    deps: list[str] | None = None,
    head_id: str | None = None,
    value: str = "1",
) -> dict[str, Any]:
    head_id = head_id or U()
    members = [{"entity": "probe.Head", "id": head_id, "schema_version": 1, "payload": head(value)}]
    members += [
        {"entity": "probe.Line", "id": U(), "schema_version": 1, "payload": {"value": str(i)}}
        for i in range(lines)
    ]
    return {
        "operation_id": op_id or U(),
        "kind": "probe",
        "op_version": 1,
        "dependencies": deps or [],
        "members": members,
    }


def envelope(epoch: str, *ops: dict[str, Any], request_id: str = "r1") -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "sync_epoch": epoch,
        "request_id": request_id,
        "operations": list(ops),
    }


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    with platform_context():
        owner = User.objects.create_user(
            tenant=two_tenants.a, username="owner", display_name="المالك", is_owner=True
        )
        owner.set_password("pw-correct-horse-battery")
        owner.save()
        role = Role.unscoped.create(tenant=two_tenants.a, code="owner", name="مالك")
        UserBranchAccess.unscoped.create(
            tenant=two_tenants.a, user=owner, branch=two_tenants.a_branches[0], role=role
        )
    with tenant_context(two_tenants.a.id):
        reg = register_device(user=owner, branch=two_tenants.a_branches[0], name="تابلت")
        epoch = ensure_state(two_tenants.a.id).sync_epoch
    return {
        "tenant": two_tenants.a,
        "other": two_tenants.b,
        "owner": owner,
        "device": reg.device,
        "access": reg.access,
        "epoch": epoch,
    }


def do_push(c: dict[str, Any], *ops: dict[str, Any], epoch: str | None = None) -> dict[str, Any]:
    with tenant_context(c["tenant"].id):
        return push(
            device_id=c["device"].id,
            actor_user_id=c["owner"].id,
            envelope=envelope(epoch or c["epoch"], *ops),
        ).as_dict()


def statuses(resp: dict[str, Any]) -> dict[str, str]:
    return {r["operation_id"]: r["status"] for r in resp["results"]}


# ------------------------------------------------------------------ §٨.٤
class TestCanonicalHash:
    def test_key_order_and_optional_null_do_not_change_hash(self) -> None:
        fields = ("value", "note")
        a = content_hash({"value": "1", "note": None}, fields)
        b = content_hash({"note": None, "value": "1"}, fields)
        c = content_hash({"value": "1"}, fields)
        assert a == b == c

    def test_content_change_changes_hash_and_unknown_field_rejected(self) -> None:
        fields = ("value", "note")
        assert content_hash({"value": "1"}, fields) != content_hash({"value": "2"}, fields)
        with pytest.raises(CanonicalError):
            canonical_json({"value": "1", "received_at": "x"}, fields)

    def test_numeric_strings_kept_verbatim_and_utf8(self) -> None:
        fields = ("value", "note")
        assert (
            canonical_json({"value": "125000", "note": "بقالة"}, fields)
            == b'{"note":"\xd8\xa8\xd9\x82\xd8\xa7\xd9\x84\xd8\xa9","value":"125000"}'
        )

    def test_members_hash_is_order_independent(self) -> None:
        h1 = members_hash({("probe.Head", "a"): "h1", ("probe.Line", "b"): "h2"})
        h2 = members_hash({("probe.Line", "b"): "h2", ("probe.Head", "a"): "h1"})
        assert h1 == h2
        assert h1 != members_hash({("probe.Head", "a"): "h1"})


# ------------------------------------------------------------------ §٨.٥
class TestCounter:
    def test_reserve_is_serialized_under_lock(self, ctx: dict[str, Any]) -> None:
        tid = ctx["tenant"].id
        seen: list[int] = []

        def worker() -> None:
            try:
                with tenant_context(tid):
                    _, first = lock_and_reserve(tid, 3)
                    seen.append(first)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(seen) == [1 + 3 * i for i in range(8)]
        with platform_context():
            assert SyncState.unscoped.get(tenant_id=tid).sync_counter == 24


# ------------------------------------------------------------------ §٨.٣
class TestAcceptance:
    def test_accept_returns_receipts_only_after_commit(self, ctx: dict[str, Any]) -> None:
        op = probe(lines=2)
        resp = do_push(ctx, op)
        (r,) = resp["results"]
        assert r["status"] == "accepted"
        assert [m["entity"] for m in r["member_receipts"]] == [
            "probe.Head",
            "probe.Line",
            "probe.Line",
        ]
        seqs = [int(m["server_seq"]) for m in r["member_receipts"]]
        assert seqs == [1, 2, 3]
        assert resp["server_seq_high"] == "3"
        with tenant_context(ctx["tenant"].id):
            assert Operation.objects.get(operation_id=op["operation_id"]).members.count() == 3

    def test_rule_10_replay_is_duplicate_with_original_seqs(self, ctx: dict[str, Any]) -> None:
        op = probe()
        first = do_push(ctx, op)["results"][0]
        again = do_push(ctx, op)["results"][0]
        assert again["status"] == "duplicate"
        assert again["member_receipts"] == first["member_receipts"]
        with tenant_context(ctx["tenant"].id):
            assert Member.objects.count() == 2  # لا أثر مكرر

    def test_rule_1_independent_transactions_per_operation(self, ctx: dict[str, Any]) -> None:
        """ACC-31: سليمة + فاشلة + سليمة → السليمتان تلتزمان."""
        good1, bad, good2 = probe(), probe(), probe()
        bad["members"] = []  # ناقصة
        st = statuses(do_push(ctx, good1, bad, good2))
        assert st[good1["operation_id"]] == "accepted"
        assert st[bad["operation_id"]] == "rejected"
        assert st[good2["operation_id"]] == "accepted"

    def test_rule_2_missing_required_member_rejects_whole_operation(
        self, ctx: dict[str, Any]
    ) -> None:
        """ACC-30: probe يشترط Head واحداً؛ سطور بلا رأس تُرفض كلها."""
        op = probe()
        op["members"] = [m for m in op["members"] if m["entity"] != "probe.Head"]
        r = do_push(ctx, op)["results"][0]
        assert (r["status"], r["code"]) == ("rejected", "validation")
        with tenant_context(ctx["tenant"].id):
            assert Member.objects.count() == 0
            q = QuarantinedOperation.objects.get(operation_id=op["operation_id"])
            assert q.reason == "rejected" and q.original["operation_id"] == op["operation_id"]

    def test_rule_2_unknown_kind_and_bad_money_string_rejected(self, ctx: dict[str, Any]) -> None:
        op = probe()
        op["kind"] = "nope"
        assert do_push(ctx, op)["results"][0]["status"] == "rejected"
        shift = {
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
                        "branch_id": U(),
                        "device_id": U(),
                        "user_id": U(),
                        "opening_float_minor": "-0",
                        "business_date": "2026-09-15",
                    },
                }
            ],
        }
        r = do_push(ctx, shift)["results"][0]
        assert r["status"] == "rejected" and "invalid_unsigned" in r["detail"]

    def test_rule_4_extra_missing_or_changed_member_is_conflicted(
        self, ctx: dict[str, Any]
    ) -> None:
        """ACC-32."""
        op = probe(lines=1)
        assert do_push(ctx, op)["results"][0]["status"] == "accepted"
        extra = {
            **op,
            "members": [
                *op["members"],
                {"entity": "probe.Line", "id": U(), "schema_version": 1, "payload": {"value": "x"}},
            ],
        }
        fewer = {**op, "members": op["members"][:1]}
        changed = {
            **op,
            "members": [{**op["members"][0], "payload": {"value": "changed"}}, op["members"][1]],
        }
        st = {r["operation_id"] + r["code"]: r["status"] for r in do_push(ctx, extra)["results"]}
        assert list(st.values()) == ["conflicted"]
        r_fewer = do_push(ctx, fewer)["results"][0]
        r_changed = do_push(ctx, changed)["results"][0]
        assert (r_fewer["status"], r_fewer["code"]) == ("conflicted", "membership_mismatch")
        assert (r_changed["status"], r_changed["code"]) == ("conflicted", "content_mismatch")
        with tenant_context(ctx["tenant"].id):
            assert Member.objects.count() == 2  # لا عضو جديد تحت الهوية القديمة
            assert QuarantinedOperation.objects.filter(reason="conflicted").count() == 3

    def test_rule_5_member_id_owned_by_another_operation_is_conflicted(
        self, ctx: dict[str, Any]
    ) -> None:
        shared_head = U()
        assert do_push(ctx, probe(head_id=shared_head))["results"][0]["status"] == "accepted"
        r = do_push(ctx, probe(head_id=shared_head))["results"][0]
        assert (r["status"], r["code"]) == ("conflicted", "member_already_owned")

    def test_rule_6_7_dependency_within_same_transport_is_ordered(
        self, ctx: dict[str, Any]
    ) -> None:
        """ACC-33/34: التابع قبل الأب في القائمة — يُقبلان بترتيب صحيح."""
        parent = probe()
        child = probe(deps=[parent["operation_id"]])
        resp = do_push(ctx, child, parent)
        st = statuses(resp)
        assert st == {child["operation_id"]: "accepted", parent["operation_id"]: "accepted"}
        with tenant_context(ctx["tenant"].id):
            p_seq = Operation.objects.get(operation_id=parent["operation_id"]).server_seq
            c_seq = Operation.objects.get(operation_id=child["operation_id"]).server_seq
            assert p_seq < c_seq
        # الرد يحافظ على ترتيب الطلب
        assert [r["operation_id"] for r in resp["results"]] == [
            child["operation_id"],
            parent["operation_id"],
        ]

    def test_rule_6_dependency_on_entity_id_of_confirmed_member(self, ctx: dict[str, Any]) -> None:
        """مرجع إلى أثر قديم (هوية عضو) تبعية لا عضو — مثل بيع يشير إلى فتح وردية."""
        head_id = U()
        do_push(ctx, probe(head_id=head_id))
        child = probe(deps=[head_id])
        assert do_push(ctx, child)["results"][0]["status"] == "accepted"

    def test_rule_6_unconfirmed_dependency_waits_not_rejected(self, ctx: dict[str, Any]) -> None:
        orphan = probe(deps=[U()])
        r = do_push(ctx, orphan)["results"][0]
        assert (r["status"], r["code"]) == ("pending_dependency", "dependency_unconfirmed")
        with tenant_context(ctx["tenant"].id):
            assert Operation.objects.count() == 0
            assert QuarantinedOperation.objects.count() == 0  # انتظار لا حجر

    def test_rule_7_rejected_parent_blocks_child_not_independent(self, ctx: dict[str, Any]) -> None:
        parent = probe()
        parent["members"] = []
        child = probe(deps=[parent["operation_id"]])
        free = probe()
        st = statuses(do_push(ctx, parent, child, free))
        assert st[parent["operation_id"]] == "rejected"
        assert st[child["operation_id"]] == "rejected"
        assert st[free["operation_id"]] == "accepted"

    def test_rule_7_cycle_detected(self, ctx: dict[str, Any]) -> None:
        a, b = probe(), probe()
        a["dependencies"] = [b["operation_id"]]
        b["dependencies"] = [a["operation_id"]]
        resp = do_push(ctx, a, b)
        assert {r["code"] for r in resp["results"]} == {"dependency_cycle"}
        assert {r["status"] for r in resp["results"]} == {"rejected"}

    def test_rule_3_uniqueness_across_tenants_is_independent(
        self, ctx: dict[str, Any], two_tenants: TwoTenants
    ) -> None:
        """نفس operation_id عند مستأجرين مختلفين عمليتان مستقلتان؛ والعزل يمنع رؤية الآخر."""
        op = probe()
        assert do_push(ctx, op)["results"][0]["status"] == "accepted"
        with platform_context():
            other_epoch = ensure_state(two_tenants.b.id).sync_epoch
        with tenant_context(two_tenants.b.id):
            r = push(
                device_id=uuid.uuid4(),
                actor_user_id=uuid.uuid4(),
                envelope=envelope(other_epoch, op),
            ).as_dict()["results"][0]
            assert r["status"] == "accepted"
            assert r["member_receipts"][0]["server_seq"] == "1"  # عدّاد مستقل
            assert Operation.objects.count() == 1

    def test_epoch_mismatch_is_rejected_whole_transport(self, ctx: dict[str, Any]) -> None:
        """§٨.١٢: جيل قديم لا يُقبل؛ لا تُطبَّق عملية واحدة منه."""
        with pytest.raises(PushError) as e:
            do_push(ctx, probe(), epoch="epoch-old")
        assert e.value.code == "epoch_mismatch"
        with tenant_context(ctx["tenant"].id):
            assert Operation.objects.count() == 0

    def test_rule_10_concurrent_replay_of_same_operation_yields_one_commit(
        self, ctx: dict[str, Any]
    ) -> None:
        """ACC-29: النقل نفسه من مسارين متزامنين.

        واحد accepted والآخر duplicate، وأعضاء بلا تكرار.
        """
        op = probe(lines=3)
        results: list[str] = []
        barrier = threading.Barrier(2)

        def worker() -> None:
            barrier.wait()
            try:
                results.append(do_push(ctx, op)["results"][0]["status"])
            finally:
                connections.close_all()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(results) == ["accepted", "duplicate"]
        with tenant_context(ctx["tenant"].id):
            assert Member.objects.count() == 4


class TestEndpoint:
    def test_push_requires_device_session_and_uses_auth_identity(self, ctx: dict[str, Any]) -> None:
        c = Client()
        op = probe()
        body = envelope(ctx["epoch"], op)
        r = c.post(
            "/api/sync/push",
            body,
            content_type="application/json",
            headers={"Authorization": f"Bearer {ctx['access']}"},
        )
        assert r.status_code == 200, r.content
        assert r.json()["results"][0]["status"] == "accepted"
        with tenant_context(ctx["tenant"].id):
            stored = Operation.objects.get(operation_id=op["operation_id"])
            assert stored.device == ctx["device"].id and stored.actor_user == ctx["owner"].id

    def test_push_without_device_session_forbidden(self, ctx: dict[str, Any]) -> None:
        c = Client()
        tokens = c.post(
            "/api/auth/login",
            {
                "tenant_id": str(ctx["tenant"].id),
                "username": "owner",
                "password": "pw-correct-horse-battery",
            },
            content_type="application/json",
        ).json()
        r = c.post(
            "/api/sync/push",
            envelope(ctx["epoch"], probe()),
            content_type="application/json",
            headers={"Authorization": f"Bearer {tokens['access']}"},
        )
        assert r.status_code == 403

    def test_old_epoch_returns_409_with_current_epoch(self, ctx: dict[str, Any]) -> None:
        r = Client().post(
            "/api/sync/push",
            envelope("epoch-old", probe()),
            content_type="application/json",
            headers={"Authorization": f"Bearer {ctx['access']}"},
        )
        assert r.status_code == 409
        assert r.json() == {"detail": "epoch_mismatch", "sync_epoch": ctx["epoch"]}


class TestFaults:
    """مفاتيح §١٥.٤ في PUSH: فقد الإقرار يطبّق ولا يردّ فتُرفض الإعادة تكراراً بالهوية (ACC-05)؛
    تجميد المصالحة/قطع الشبكة لا يطبّقان شيئاً فيبقى المعلّق ولا يتضاعف بعد الرفع (ACC-07)."""

    def _post(self, ctx: dict[str, Any], body: dict[str, Any]) -> Any:
        return Client().post(
            "/api/sync/push",
            body,
            content_type="application/json",
            headers={"Authorization": f"Bearer {ctx['access']}"},
        )

    def test_drop_ack_applies_then_hides_reply(self, ctx: dict[str, Any]) -> None:
        from core.scenario import faults

        op = probe()
        faults.set_fault("drop_ack", True)
        try:
            r = self._post(ctx, envelope(ctx["epoch"], op))
            assert r.status_code == 502 and r.json()["detail"] == "ack_dropped"
        finally:
            faults.set_fault("drop_ack", False)
        with tenant_context(ctx["tenant"].id):
            assert Operation.objects.filter(operation_id=op["operation_id"]).count() == 1
        r = self._post(ctx, envelope(ctx["epoch"], op, request_id="r2"))
        assert r.status_code == 200
        assert r.json()["results"][0]["status"] == "duplicate"
        with tenant_context(ctx["tenant"].id):
            assert Operation.objects.filter(operation_id=op["operation_id"]).count() == 1

    def test_freeze_and_network_cut_apply_nothing(self, ctx: dict[str, Any]) -> None:
        from core.scenario import faults

        op = probe()
        keys: tuple[faults.FaultKey, ...] = ("freeze_reconciliation", "network_cut")
        for key in keys:
            faults.set_fault(key, True)
            try:
                r = self._post(ctx, envelope(ctx["epoch"], op))
                assert r.status_code == 503 and r.json()["detail"] == key
            finally:
                faults.set_fault(key, False)
            with tenant_context(ctx["tenant"].id):
                assert not Operation.objects.filter(operation_id=op["operation_id"]).exists()
        r = self._post(ctx, envelope(ctx["epoch"], op, request_id="r3"))
        assert r.status_code == 200 and r.json()["results"][0]["status"] == "accepted"
