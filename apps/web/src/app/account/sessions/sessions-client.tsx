"use client";

import { Button, Dialog, Frame, Notice, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State =
  "loading" | "ready" | "permission_denied" | "pending_sync" | "success" | "server_error";

interface Row {
  readonly session_id: string;
  readonly kind: "own" | "device";
  readonly session_label: string;
  readonly is_current: boolean;
  readonly tenant_name: string;
  readonly branch_name: string;
  readonly device_id: string;
  readonly last_seen_at: string;
  readonly revoked_at: string;
  readonly revoke_after_upload: boolean;
  readonly reported_pending: number | null;
  readonly can_revoke: boolean;
}

/** «آخر نشاط قبل N ساعات» / «نشطة الآن» — بأرقام لاتينية في mono. */
function whenOf(row: Row): React.ReactNode {
  const ms = Date.now() - new Date(row.last_seen_at).getTime();
  const place = row.branch_name || row.tenant_name;
  if (row.revoked_at) return <>أُبطلت</>;
  if (ms < 5 * 60_000) return <>نشطة الآن{place ? <> · {place}</> : null}</>;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return (
    <>
      آخر نشاط قبل <span className="sting-mono">{hours}</span> ساعات
    </>
  );
}

function effectOf(row: Row): React.ReactNode {
  if (row.revoked_at) return "أُبطلت";
  if (row.is_current) return "الجلسة الحالية. إبطالها يخرجك أنت.";
  if (row.kind === "device" && (row.reported_pending ?? 0) > 0)
    return (
      <>
        الإبطال يمنع بيعاً جديداً من هذا الجهاز، وتبقى الـ
        <span className="sting-mono">{row.reported_pending}</span> عملية في طابوره حتى ترفعها جلسة
        مصرَّحة. لا تُمحى.
      </>
    );
  return "الإبطال يمنع بيعاً جديداً من هذا الجهاز";
}

/**
 * ACC-09. الجدول من `28-D21#ACC-09` (ready)؛ بقية الحالات من `34-D26#ACC-09`. القائمة من الخادم دائماً
 * لا من كاش؛ لا تفاؤل: الجلسة لا تُعرض منتهية قبل تأكيد الخادم؛ ولا يُمحى معلّق عند الإبطال.
 */
export function SessionsClient() {
  const router = useRouter();
  const app = useApp();
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [skeletons, setSkeletons] = useState(3);
  const [target, setTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const { data, response } = await api().GET("/api/account/sessions");
    if (response.ok && data) {
      setRows(data.sessions);
      setSkeletons(Math.max(1, data.sessions.length));
    } else {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Faccount%2Fsessions");
      return;
    }
    void load().catch(() => setRows([]));
  }, [app.tokens, load, router]);

  const revoke = async (row: Row, afterUpload: boolean) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setDenied(false);
    try {
      const { data, response } = await api().POST("/api/account/sessions/{session_id}/revoke", {
        params: { path: { session_id: row.session_id } },
        body: { after_upload: afterUpload },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (!response.ok || !data) {
        setFailed(true);
        return;
      }
      setTarget(null);
      setEnded(data);
      setRows((rs) => rs?.map((r) => (r.session_id === data.session_id ? data : r)) ?? null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const onRevokeClick = (row: Row) => {
    if (row.kind === "device" && (row.reported_pending ?? 0) > 0) {
      setTarget(row);
      return;
    }
    void revoke(row, false);
  };

  const state: State =
    rows === null
      ? "loading"
      : denied
        ? "permission_denied"
        : failed
          ? "server_error"
          : target
            ? "pending_sync"
            : ended
              ? "success"
              : "ready";

  const columns = [
    {
      key: "session",
      header: "الجلسة",
      render: (r: Row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.session_label}</div>
          <div className="acc-choice__note">{whenOf(r)}</div>
        </div>
      ),
    },
    {
      key: "pending",
      header: "معلّق محلي",
      mono: true,
      render: (r: Row) => (r.reported_pending ?? 0).toString(),
    },
    {
      key: "effect",
      header: "أثر الإبطال",
      render: (r: Row) => (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="acc-choice__note">{effectOf(r)}</span>
          {r.can_revoke && !r.revoked_at ? (
            <div>
              <Button
                variant="secondary"
                onClick={() => onRevokeClick(r)}
                loading={busy && target?.session_id === r.session_id}
              >
                إنهاء الجلسة
              </Button>
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Frame title="فيزانو" footer={null}>
      <div className="acc-page" data-screen="ACC-09" data-state={state}>
        <div className="acc-card" style={{ inlineSize: "min(100%, 760px)" }}>
          <div className="acc-card__head">
            <h2 className="acc-card__title">· الجلسات النشطة</h2>
            <span
              className="acc-card__sub"
              style={{ marginInlineStart: "auto", color: "var(--color-ink-faint)" }}
            >
              إبطال الجلسة يمنع الاستمرار لا الماضي
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? <p className="acc-card__sub">جلب الجلسات</p> : null}

            {state === "permission_denied" ? (
              <Notice kind="error" title="إنهاء جلسة جهاز آخر">
                <p className="acc-lead">الجهاز عهدةُ المنشأة لا ملكُ من دخل عليه.</p>
                <div className="acc-links">
                  <Button variant="secondary" onClick={() => setDenied(false)}>
                    الجلسات النشطة
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر إنهاء الجلسة">
                <p className="acc-lead">لا نُظهر الجلسة كمنتهية قبل تأكيد الخادم.</p>
                <div className="acc-links">
                  <Button onClick={() => setFailed(false)}>الجلسات النشطة</Button>
                </div>
              </Notice>
            ) : null}

            {state === "success" && ended ? (
              <Notice kind="success" title="أُنهيت الجلسة">
                <p className="acc-lead">
                  {ended.session_label}
                  {ended.branch_name ? <> · {ended.branch_name}</> : null}
                </p>
                <p className="acc-lead">الإنهاء لا يُلغى.</p>
                <div className="acc-links">
                  <Button variant="secondary" onClick={() => setEnded(null)}>
                    الجلسات النشطة
                  </Button>
                </div>
              </Notice>
            ) : null}

            <Table
              caption="الجلسات النشطة"
              columns={columns}
              rows={rows ?? []}
              rowKey={(r) => r.session_id}
              loading={rows === null ? skeletons : undefined}
              forceCards={false}
            />

            <div className="acc-item acc-item--violet">
              <div className="acc-item__label">لا نمحو عملية معلّقة عند الإبطال.</div>
              <div className="acc-item__note">
                الجهاز المُبطَلة جلسته يُمنع من بيع جديد، وتبقى عملياته المحفوظة محلياً في الطابور
                حتى ترفعها جلسة مصرَّحة. الخيار الآخر — محوها — يعني إتلاف بيع حقيقي حدث فعلاً.
              </div>
            </div>
          </div>
        </div>

        <Dialog
          open={target !== null}
          title="إنهاء جلسة على جهاز فيه معلّق"
          kind="danger"
          onClose={() => setTarget(null)}
          primaryLabel="إنهاء الجلسة"
          onPrimary={() => target && void revoke(target, false)}
          saving={busy}
        >
          <p className="acc-lead">
            هذا الجهاز عليه <span className="sting-mono">{target?.reported_pending ?? 0}</span>{" "}
            عملية لم تُرفع
          </p>
          <p className="acc-lead">الإنهاء يقطع الرفع.</p>
          <div className="acc-links">
            <Button variant="secondary" onClick={() => target && void revoke(target, true)}>
              أنهِ بعد رفع المعلّق
            </Button>
          </div>
        </Dialog>
      </div>
    </Frame>
  );
}
