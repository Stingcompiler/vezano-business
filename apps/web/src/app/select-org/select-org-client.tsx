"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import {
  type MembershipRow,
  readMembershipsCache,
  writeMembershipsCache,
} from "@/features/acc/memberships-cache";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { localSetupTenants } from "@/lib/device-setup";
import { useOnline } from "@/lib/online";
import { wipeLocalStorage } from "@/lib/storage";

type State = "loading" | "ready" | "empty" | "offline" | "stale" | "permission_denied";

/**
 * ACC-03. القائمة من الخادم بتذكرة الاختيار أو الجلسة؛ تُحفظ محلياً لتُعرض بلا اتصال (بوقتها) —
 * والمنشآت المهيّأة على الجهاز وحدها قابلة للفتح حينها. التبديل يُفرّغ الذاكرة المحلية للحساب السابق.
 */
export function SelectOrgClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [rows, setRows] = useState<readonly MembershipRow[] | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [skeletons, setSkeletons] = useState(1);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [setupTenants, setSetupTenants] = useState<readonly string[]>([]);
  const [denied, setDenied] = useState<MembershipRow | null>(null);
  const [busy, setBusy] = useState(false);

  const headers = useCallback(
    () => (app.selection ? { "X-Select-Ticket": app.selection.ticket } : {}),
    [app.selection],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cache, setup] = await Promise.all([readMembershipsCache(), localSetupTenants()]);
      if (cancelled) return;
      setSetupTenants(setup);
      if (cache) {
        setSkeletons(Math.max(1, cache.items.length));
        setSavedAt(cache.savedAt);
      }
      if (!app.selection && !app.tokens) {
        // لا هوية: القائمة المحفوظة تُعرض بلا اتصال فقط؛ مع الاتصال يعود إلى الدخول
        if (cache && !navigator.onLine) setRows(cache.items);
        else router.replace("/login");
        return;
      }
      if (!navigator.onLine) {
        setRows(cache?.items ?? app.selection?.memberships.map(fromOption) ?? []);
        return;
      }
      try {
        const { data, response } = await api().GET("/api/account/memberships", {
          headers: headers(),
        });
        if (cancelled) return;
        if (!response.ok || !data) {
          setFetchFailed(true);
          setRows(cache?.items ?? []);
          return;
        }
        setRows(data.memberships);
        setSavedAt(null);
        await writeMembershipsCache(data.memberships);
      } catch {
        if (cancelled) return;
        setFetchFailed(true);
        setRows(cache?.items ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.selection, app.tokens, headers, router]);

  const select = async (m: MembershipRow) => {
    if (busy) return;
    if (m.status === "suspended") {
      setDenied(m);
      return;
    }
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/account/select", {
        headers: headers(),
        body: { tenant_id: m.tenant_id },
      });
      if (response.status === 403) {
        setDenied(m);
        return;
      }
      if (!data) return;
      // التبديل يُفرّغ الذاكرة المحلية للحساب السابق (ACC-138)
      if (app.session.tenantId && app.session.tenantId !== data.tenant_id) {
        await wipeLocalStorage();
      }
      app.setTokens({ access: data.access, refresh: data.refresh, sessionId: data.session_id });
      app.setSession({
        ...app.session,
        userId: data.user_id,
        tenantId: data.tenant_id,
        branchId: null,
        displayName: m.tenant_name,
      });
      app.setSelection(null);
      router.replace("/");
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : rows === null
      ? "loading"
      : !online
        ? "offline"
        : fetchFailed && rows.length > 0
          ? "stale"
          : rows.length === 0
            ? "empty"
            : "ready";

  const currentTenant = app.session.tenantId;
  const tag = (m: MembershipRow) =>
    m.status === "suspended" ? "موقوف" : m.tenant_id === currentTenant ? "الحالي" : "تبديل";
  const noteOf = (m: MembershipRow) =>
    m.status === "suspended"
      ? "دخولك موقوف بقرار المالك. اتصل به لرفع الوقف — بياناتك وأثرك محفوظان."
      : m.scope === "كل الفروع"
        ? `${m.role_name} · ${m.scope}`
        : `${m.role_name} · ${m.scope} فقط. لا ترى فروعاً أخرى ولا دفاتر المنشأة.`;
  const openable = (m: MembershipRow) =>
    m.status !== "suspended" && (online || setupTenants.includes(m.tenant_id));

  return (
    <Frame title="Sting" footer={null}>
      <div className="acc-page" data-screen="ACC-03" data-state={state}>
        <div className="acc-card">
          <div className="acc-card__body">
            <h2 className="acc-card__title" style={{ fontSize: 19 }}>
              اختر المنشأة والفرع
            </h2>

            {state === "loading" ? (
              <div className="acc-skeletons" aria-busy="true" aria-label="جلب منشآتك">
                <p className="acc-lead">جلب منشآتك</p>
                {Array.from({ length: skeletons }, (_, i) => (
                  <div key={i} className="acc-skeleton" aria-hidden="true" />
                ))}
              </div>
            ) : null}

            {state === "offline" ? (
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">
                  القائمة من الذاكرة المحلية، والمنشآت التي هُيّئت على هذا الجهاز وحدها قابلة للفتح.
                </p>
              </Notice>
            ) : null}

            {state === "stale" ? (
              <Notice kind="warning" title="قائمة قديمة">
                <p className="acc-lead">
                  <Status
                    state="stale"
                    label={
                      <>
                        محفوظة{" "}
                        <time className="sting-mono" dateTime={savedAt ?? ""}>
                          {savedAt ? formatSavedAt(savedAt) : ""}
                        </time>
                      </>
                    }
                  />
                </p>
              </Notice>
            ) : null}

            {state === "permission_denied" && denied ? (
              <Notice kind="error" title="موقوف">
                <p className="acc-lead">{noteOf(denied)}</p>
                <div className="acc-links">
                  <Button variant="secondary" onClick={() => setDenied(null)}>
                    اختر المنشأة والفرع
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا منشأة بعد"
                action={
                  <div className="acc-links">
                    <Link href="/create-org" className="c-btn c-btn--primary">
                      أنشئ منشأتك
                    </Link>
                    <Link href="/invite" className="c-btn c-btn--primary">
                      عندي دعوة
                    </Link>
                  </div>
                }
              >
                حسابٌ أُنشئ ولم يُنشئ منشأة ولم تصله دعوة.
              </Notice>
            ) : null}

            {rows && rows.length > 0 && state !== "permission_denied"
              ? rows.map((m) => {
                  const kind =
                    m.status === "suspended"
                      ? "acc-choice--suspended"
                      : m.tenant_id === currentTenant
                        ? "acc-choice--primary"
                        : "";
                  const disabledReason = openable(m)
                    ? undefined
                    : m.status === "suspended"
                      ? undefined
                      : "تحتاج اتصالاً أول مرة";
                  return (
                    <div key={m.tenant_id} className="acc-membership">
                      <button
                        type="button"
                        className={`acc-choice ${kind}`}
                        onClick={() => void select(m)}
                        disabled={Boolean(disabledReason) || busy}
                        aria-disabled={Boolean(disabledReason) || busy || undefined}
                      >
                        <span className="acc-choice__row">
                          <span className="acc-choice__k">{m.tenant_name}</span>
                          <span
                            className={`acc-tag ${
                              m.status === "suspended"
                                ? "acc-tag--suspended"
                                : m.tenant_id === currentTenant
                                  ? "acc-tag--current"
                                  : ""
                            }`}
                          >
                            {tag(m)}
                          </span>
                        </span>
                        <span className="acc-choice__note">{noteOf(m)}</span>
                      </button>
                      {disabledReason ? <p className="acc-note">{disabledReason}</p> : null}
                    </div>
                  );
                })
              : null}

            {rows && rows.length > 0 && state !== "permission_denied" ? (
              <div className="acc-item acc-item--violet">
                <div className="acc-item__label">التبديل يُفرّغ الذاكرة المحلية للحساب السابق.</div>
                <div className="acc-item__note">
                  قوائم الأسعار والسلال والكتالوج المخزَّن كلها تُمحى من الجهاز قبل تحميل الحساب
                  الجديد — لا رقم من متجر يظهر في متجر آخر.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function fromOption(o: {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly is_owner: boolean;
}): MembershipRow {
  return {
    user_id: o.user_id,
    tenant_id: o.tenant_id,
    tenant_name: o.tenant_name,
    role_name: o.is_owner ? "مالك" : "",
    scope: o.is_owner ? "كل الفروع" : "",
    status: "active",
  };
}

/** وقت الحفظ بأرقام لاتينية داخل mono — YYYY-MM-DD HH:MM محلياً. */
function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
