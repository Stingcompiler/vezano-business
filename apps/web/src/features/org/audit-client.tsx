"use client";

import { Button, Frame, Notice, SelectField, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { Ago } from "@/features/org/ago";
import { MonoText } from "@/features/org/mono";
import { api, apiBaseUrl, getAccessToken } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "empty" | "permission_denied";

interface Row {
  id: string;
  at: string;
  actor_name: string;
  actor_role: string;
  branch_id: string;
  branch_name: string;
  kind: string;
  title: string;
  detail: string;
  reason: string;
  sensitive: boolean;
}
interface Payload {
  range: string;
  since: string;
  rows: Row[];
  count: number;
  last_event_at: string;
  scope: "all" | "branch" | "own";
  can_export: boolean;
  branches: { id: string; name: string }[];
}

const RANGE_LABEL: Record<string, string> = {
  today: "اليوم",
  "7d": "آخر 7 أيام",
  "30d": "آخر 30 يوماً",
  all: "الكل",
};

/**
 * ORG-10 — سجل التدقيق: فاعل ووقت وسبب، ولا تعديل (20-D15 ready/permission_denied · 39-D31 loading/
 * empty): يُقرأ ويُصفّى ويُصدَّر ولا يُحرَّر ولو من المالك؛ من يرى السجل يحدَّد بالدور — الكاشير
 * أفعاله وحدها، والمدير فرعه، والمالك الكل؛ التصدير للمالك ويحمل نطاق التصفية (§١٣.٥؛ R-04).
 */
export function AuditClient() {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [range, setRange] = useState("today");
  const [branch, setBranch] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [loading, setLoading] = useState(true);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, response } = await api().GET("/api/org/audit", {
        params: {
          query: {
            range,
            ...(branch ? { branch_id: branch } : {}),
            ...(sensitive ? { sensitive: "1" } : {}),
          },
        },
      });
      if (response.ok && data) setP(data);
    } finally {
      setLoading(false);
    }
  }, [range, branch, sensitive]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Faudit");
      return;
    }
    void load().catch(() => setLoading(false));
  }, [router, load]);

  const exportCsv = async () => {
    const q = new URLSearchParams({
      export: "csv",
      range,
      ...(branch ? { branch_id: branch } : {}),
      ...(sensitive ? { sensitive: "1" } : {}),
    });
    const r = await fetch(`${apiBaseUrl()}/api/org/audit?${q.toString()}`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const state: State =
    loading && !p
      ? "loading"
      : p && p.scope !== "all"
        ? "permission_denied"
        : p && p.rows.length === 0
          ? "empty"
          : "ready";

  const columns = [
    {
      key: "at",
      header: "الوقت",
      render: (r: Row) => (
        <span>
          <span className="sting-mono">{r.at.slice(0, 10)}</span>{" "}
          <span className="sting-mono">{hhmm(r.at)}</span>
        </span>
      ),
    },
    {
      key: "what",
      header: "الفعل",
      render: (r: Row) => (
        <div>
          <strong>
            <MonoText text={r.title} />
          </strong>
          {r.detail ? (
            <p className="acc-choice__note">
              <MonoText text={r.detail} />
            </p>
          ) : null}
          {r.reason ? (
            <p className="acc-choice__note">
              السبب المكتوب: «<MonoText text={r.reason} />»
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "who",
      header: "الفاعل",
      render: (r: Row) => (
        <div>
          <span>{r.actor_name || "—"}</span>
          <p className="acc-choice__note">
            {r.actor_role}
            {r.branch_name ? ` · ${r.branch_name}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "flag",
      header: "حسّاس",
      render: (r: Row) =>
        r.sensitive ? <span className="org-badge org-badge--expired">حسّاس</span> : <span>—</span>,
    },
  ];

  return (
    <Frame title="سجل التدقيق" nav={<AppNav currentId="org-audit" />} footer={null}>
      <div className="sys" data-screen="ORG-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">سجل التدقيق — فاعل ووقت وسبب، ولا تعديل</h2>
            <span className="cat-head__hint">
              السجل الذي يمكن تعديله ليس سجلاً. يُقرأ ويُصفّى ويُصدَّر، ولا يُحرَّر ولو من المالك.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب السجل">
                <p className="acc-lead">
                  مع المدى المختار وعدد الأحداث المتوقَّع. السجل قد يبلغ آلاف الأسطر.
                </p>
              </Notice>
            ) : null}

            <div className="cat-form__actions">
              <SelectField
                label="المدى"
                value={range}
                onChange={(e) => setRange(e.target.value)}
                options={Object.entries(RANGE_LABEL).map(([value, label]) => ({ value, label }))}
              />
              {p && p.scope === "all" ? (
                <SelectField
                  label="الفرع"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  options={[
                    { value: "", label: "كل الفروع" },
                    ...(p.branches ?? []).map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
              ) : null}
              <label className="web03-check">
                <input
                  type="checkbox"
                  checked={sensitive}
                  onChange={(e) => setSensitive(e.target.checked)}
                />{" "}
                الأفعال الحسّاسة فقط
              </label>
              {p?.can_export ? (
                <Button variant="secondary" onClick={() => void exportCsv()}>
                  تصدير
                </Button>
              ) : null}
            </div>

            {state === "permission_denied" && p ? (
              <Notice kind="info" title="سجل التدقيق">
                <p className="acc-lead">
                  <strong>لا زر تعديل ولا زر حذف في هذه الشاشة.</strong> التصحيح يُسجَّل كقيد جديد
                  يشير إلى الأول. من يرى السجل يحدَّد بالدور: الكاشير يرى أفعاله وحدها، والمدير يرى
                  فرعه، والمالك يرى الكل.
                </p>
                <p className="acc-choice__note">
                  {p.scope === "branch" ? "ترى أفعال فرعك." : "ترى أفعالك وحدها."} التصدير من الهاتف
                  متاح للمالك فقط، ويحمل نطاق التصفية في ترويسته.
                </p>
              </Notice>
            ) : null}

            {state === "empty" && p ? (
              <Notice
                kind="empty"
                title="لا أحداث في المدى"
                action={
                  range !== "all" ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setRange(range === "today" ? "7d" : range === "7d" ? "30d" : "all")
                      }
                    >
                      وسّع المدى
                    </Button>
                  ) : undefined
                }
              >
                <p className="acc-lead">المدى بلا أحداث مسجّلة — والسبب المرشّح غالباً.</p>
                <p className="acc-choice__note">
                  <strong>لا نقول «لا سجل»</strong> ·{" "}
                  {p.last_event_at ? (
                    <>
                      لا أحداث في هذا المدى — آخر حدث <Ago iso={p.last_event_at} />.
                    </>
                  ) : (
                    "لا حدث مسجَّل بعد في هذه المنشأة."
                  )}{" "}
                  سجلٌّ يبدو فارغاً يُقلق من يفتّش عن شيء.
                </p>
              </Notice>
            ) : null}

            {p && p.rows.length > 0 ? (
              <>
                <h3 className="cat-head__title">أحدث الأفعال</h3>
                <p className="acc-choice__note">
                  {branch ? (p.branches.find((b) => b.id === branch)?.name ?? "") : "كل الفروع"} ·{" "}
                  {RANGE_LABEL[range] ?? range} · <span className="sting-mono">{p.count}</span>{" "}
                  حدثاً
                </p>
                <Table caption="سجل التدقيق" columns={columns} rows={p.rows} rowKey={(r) => r.id} />
                <p className="acc-choice__note">
                  <strong>لا زر تعديل ولا زر حذف في هذه الشاشة.</strong> التصحيح يُسجَّل كقيد جديد
                  يشير إلى الأول. من يرى السجل يحدَّد بالدور: الكاشير يرى أفعاله وحدها، والمدير يرى
                  فرعه، والمالك يرى الكل. التصدير من الهاتف متاح للمالك فقط، ويحمل نطاق التصفية في
                  ترويسته.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
