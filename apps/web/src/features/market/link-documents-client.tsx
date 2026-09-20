"use client";

import { Button, formatMinor, Frame, Notice, Status, Table, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { PhaseScreenClient } from "@/features/phase/phase-screen-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "conflict" | "permission_denied";

interface Link {
  id: string;
  kind: "receipt" | "return";
  kind_label: string;
  mode: string;
  order_label: string;
  shipment_label: string;
  local_number: string;
  my_value_minor: string;
  their_value_minor: string;
  diff_minor: string;
  path: string;
  settled: boolean;
  settled_by_name: string;
  settlement_path: string;
  settlement_note: string;
}
interface Payment {
  id: string;
  ref_label: string;
  order_label: string;
  amount_minor: string;
  path: string;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_settle: boolean;
  links: Link[];
  payments: Payment[];
  linked_count: number;
  diff_count: number;
}

const docsWord = (n: number) =>
  n === 1
    ? "مستند واحد مرتبط"
    : n === 2
      ? "مستندان مرتبطان"
      : n <= 10
        ? `${n} مستندات مرتبطة`
        : `${n} مستنداً مرتبطاً`;

/** LINK-04 — روابط المستندات وتسوية الفرق (29-D22 ready/conflict/permission_denied · 38-D30 empty): دفتران مستقلّان لا دفتر مشترك. */
export function LinkDocumentsClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [settling, setSettling] = useState<Link | null>(null);
  const [path, setPath] = useState<"dispute" | "agreement">("dispute");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/link/documents");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Flink%2Fdocuments");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const settle = async (l: Link) => {
    if (busy) return;
    setBusy(l.id);
    setErr("");
    try {
      const r = await api().POST("/api/market/link/documents/{link_id}/{action}", {
        params: { path: { link_id: l.id, action: "settle" } },
        body: { path, note } as never,
      });
      const b = (r.data ?? r.error) as unknown as { detail?: string } | undefined;
      if (r.response.ok) {
        setSettling(null);
        setNote("");
        await load();
        return;
      }
      setErr(b?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="LINK-04" />;

  const state: State =
    err === "permission_denied" || (data && !data.can_settle && settling)
      ? "permission_denied"
      : data && data.diff_count === 0
        ? "empty"
        : data && data.diff_count > 0
          ? "conflict"
          : "ready";
  const columns = [
    {
      key: "doc",
      header: "المستند المرتبط",
      render: (l: Link) => (
        <>
          <strong>{l.kind_label}</strong>
          <div className="mp-check__hint">
            <span className="sting-mono">{l.local_number}</span> ↔{" "}
            <span className="sting-mono">{l.shipment_label || l.order_label}</span>
          </div>
        </>
      ),
    },
    {
      key: "mine",
      header: "في دفترك",
      render: (l: Link) => <span className="sting-mono">{formatMinor(l.my_value_minor)}</span>,
    },
    {
      key: "theirs",
      header: "في دفتر المورد",
      render: (l: Link) => <span className="sting-mono">{formatMinor(l.their_value_minor)}</span>,
    },
    {
      key: "diff",
      header: "الفرق",
      render: (l: Link) =>
        l.diff_minor === "0" ? (
          <Status state="success" label="متطابق" />
        ) : (
          <span className="sting-mono">{formatMinor(l.diff_minor)}</span>
        ),
    },
    {
      key: "path",
      header: "المسار",
      render: (l: Link) => (
        <>
          {l.settled ? (
            <>
              سُوّي · {l.settlement_path === "dispute" ? "خلاف موثَّق (ORD-12)" : "اتفاق مكتوب"} ·{" "}
              {l.settled_by_name}
              {l.settlement_note ? <div className="mp-check__hint">{l.settlement_note}</div> : null}
            </>
          ) : (
            l.path
          )}
          {!l.settled && l.diff_minor !== "0" ? (
            <div className="acc-actions">
              <Button
                variant="quiet"
                onClick={() => {
                  setSettling(l);
                  setErr("");
                }}
              >
                سجّل مسار التسوية
              </Button>
            </div>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Frame title="الربط" nav={<AppNav currentId="parties" />} footer={null}>
      <div className="sys mp cus" data-screen="LINK-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              روابط المستندات وتسوية الفرق — دفتران مستقلّان لا دفتر مشترك
            </h2>
            <span className="cat-head__hint">
              نعرض رقمك ورقمه والفرق بينهما. لا نُصدر «الرقم الصحيح» — التسوية إجراء مخوَّل يكتبه
              أحد الطرفين في دفتره وحده.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice
                kind="locked"
                title="الفرق مسجَّل — أُرسل للمالك للمراجعة"
                action={
                  <Button
                    onClick={() => {
                      setSettling(null);
                      setErr("");
                    }}
                  >
                    فهمت
                  </Button>
                }
              >
                <p className="acc-lead">
                  التسوية تكتب رقماً في دفترك المالي، فهي صلاحية من له حدّ مالي. لمن دونه: «الفرق
                  مسجَّل — أُرسل للمالك للمراجعة» ومعه نسخة من المستندين.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && data ? (
              <Notice kind="success" title="لا فروق">
                <p className="acc-lead">كل مستندات السوق طابقت نظائرها المحلية. حالةٌ صحّية.</p>
                <p className="acc-choice__note">
                  <strong>نقول العدد</strong> · «{docsWord(data.linked_count)} · لا فروق». الفراغ
                  الذي يذكر ما فُحص يُطمئن، والفارغ الصامت يُقلق.
                </p>
              </Notice>
            ) : null}
            {err && err !== "permission_denied" ? (
              <Notice kind="warning" title="لم تُسجَّل التسوية">
                <p className="acc-lead">
                  {err === "note_required" ? "الاتفاق المكتوب يحتاج نصّه." : err}
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={data.diff_count ? "conflict" : "success"}
                    label={data.diff_count ? `${data.diff_count} فروق بانتظار مسار` : "لا فروق"}
                  />
                  <span className="acc-choice__note">
                    <span className="sting-mono">{data.linked_count}</span> مستنداً مرتبطاً
                  </span>
                </div>
                <Table
                  caption="روابط المستندات"
                  columns={columns}
                  rows={data.links}
                  rowKey={(l) => l.id}
                  empty={
                    <p className="acc-choice__note">
                      لا مستندات مرتبطة بعد — حوّل استلاماً (LINK-03).
                    </p>
                  }
                />
                {data.payments.length ? (
                  <>
                    <h3 className="cat-head__title">إثبات دفع بلا مقابل</h3>
                    <ul className="cus-list">
                      {data.payments.map((p) => (
                        <li key={p.id}>
                          <strong>
                            <span className="sting-mono">{p.ref_label}</span> على{" "}
                            <span className="sting-mono">{p.order_label}</span> ·{" "}
                            <span className="sting-mono">{formatMinor(p.amount_minor)}</span>
                          </strong>
                          <div className="cus-sub">{p.path}</div>
                          <Status state="stale" label="معلّق للمطابقة" />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {settling && data.can_settle ? (
                  <>
                    <h3 className="cat-head__title">مسار التسوية — {settling.local_number}</h3>
                    <div className="pos-chips" role="group" aria-label="المسار">
                      <button
                        type="button"
                        className={`pos-chip${path === "dispute" ? " pos-chip--on" : ""}`}
                        onClick={() => setPath("dispute")}
                      >
                        فتح خلاف موثَّق (ORD-12)
                      </button>
                      <button
                        type="button"
                        className={`pos-chip${path === "agreement" ? " pos-chip--on" : ""}`}
                        onClick={() => setPath("agreement")}
                      >
                        اتفاق مكتوب
                      </button>
                    </div>
                    <TextField
                      label="نصّ الاتفاق أو مرجع الخلاف"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy === settling.id}
                        onClick={() => void settle(settling)}
                      >
                        سجّل — في دفترك وحده
                      </Button>
                      <Button variant="quiet" onClick={() => setSettling(null)}>
                        إلغاء
                      </Button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
