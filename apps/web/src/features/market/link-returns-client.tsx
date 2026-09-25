"use client";

import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
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

type State = "ready" | "partial" | "validation_error" | "success";

interface RLine {
  offer_id: string;
  name: string;
  unit_name: string;
  requested: number;
  approved: number;
  pending: number;
  reason: string;
  price_minor: number;
}
interface Ret {
  return_id: string;
  ref_label: string;
  order_label: string;
  supplier_name: string;
  status: "approved" | "partial" | "rejected" | "executed";
  status_label: string;
  decision_note: string;
  lines: RLine[];
  converted: boolean;
  local_number: string;
  reverse_partial: boolean;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_convert: boolean;
  returns: Ret[];
  pending_count: number;
}
interface Row {
  key: string;
  ret: Ret;
  line: RLine;
}

const n = (x: number) => <span className="sting-mono">{x}</span>;

/** LINK-05 — تحويل المرتجع لمستند عكسي (29-D22 ready/partial/success · 38-D30 validation_error): بالكمية المتفَق عليها فقط (ACC-132). */
export function LinkReturnsClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{
    code: string;
    errors: { name: string; max_qty_milli?: string }[];
  } | null>(null);
  const [done, setDone] = useState<{ local_number: string; ref: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/link/returns");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Flink%2Freturns");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const convert = async (r: Ret) => {
    if (busy) return;
    setBusy(r.return_id);
    setErr(null);
    try {
      const res = await api().POST("/api/market/link/returns/{return_id}/{action}", {
        params: { path: { return_id: r.return_id, action: "convert" } },
        body: {} as never,
      });
      const b = (res.data ?? res.error) as unknown as
        | {
            link?: { local_number: string };
            detail?: string;
            extra?: { errors?: { name: string; max_qty_milli?: string }[] };
          }
        | undefined;
      if (res.response.ok && b?.link) {
        setDone({ local_number: b.link.local_number, ref: r.ref_label });
        await load();
        return;
      }
      setErr({ code: b?.detail ?? "server_error", errors: b?.extra?.errors ?? [] });
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="LINK-05" />;

  const rows: Row[] = (data?.returns ?? []).flatMap((ret) =>
    ret.lines.map((line) => ({ key: `${ret.return_id}:${line.offer_id}`, ret, line })),
  );
  const anyPartial = (data?.returns ?? []).some((r) => r.converted && r.reverse_partial);
  const state: State =
    err?.code === "exceeds_received"
      ? "validation_error"
      : done
        ? "success"
        : anyPartial
          ? "partial"
          : "ready";
  const columns = [
    {
      key: "item",
      header: "الصنف",
      render: (r: Row) => (
        <>
          <strong>
            {r.line.name} — {r.line.unit_name}
          </strong>
          <div className="mp-check__hint">
            {r.ret.ref_label} · {r.ret.order_label} · {r.ret.supplier_name}
          </div>
        </>
      ),
    },
    { key: "requested", header: "طُلب إرجاعه", render: (r: Row) => n(r.line.requested) },
    {
      key: "approved",
      header: "وافق المورد",
      render: (r: Row) =>
        r.ret.status === "rejected" ? <Status state="expired" label="رُفض" /> : n(r.line.approved),
    },
    {
      key: "reverse",
      header: "المستند العكسي",
      render: (r: Row) =>
        r.ret.status === "rejected" ? (
          <>رُفض الإرجاع بسبب مكتوب. لا مستند عكسي، والبند مفتوح لخلاف إن أردت.</>
        ) : r.ret.converted ? (
          r.line.pending > 0 ? (
            <div>
              <span>
                عكسي بـ{n(r.line.approved)} فقط.{" "}
                {r.line.pending === 8 ? "الثمانية الباقية" : <>الباقي ({n(r.line.pending)})</>} بند
                معلّق بسبب المورد المكتوب — لا تُلغى ولا تُكتب.
              </span>
              <div className="mp-check__hint">
                <span className="sting-mono">{r.ret.local_number}</span>
              </div>
            </div>
          ) : (
            <>
              مستند عكسي <span className="sting-mono">{r.ret.local_number}</span> — كامل
            </>
          )
        ) : (
          <div className="acc-actions">
            <Button
              pos
              loading={busy === r.ret.return_id}
              onClick={() => void convert(r.ret)}
              disabledReason={data?.can_convert ? undefined : "التحويل للمالك ومدير الفرع"}
            >
              اكتب المستند العكسي بالمقبول ({r.line.approved})
            </Button>
          </div>
        ),
    },
  ];

  return (
    <Frame title="الربط" nav={<AppNav currentId="inventory" />} footer={null}>
      <div className="sys mp cus" data-screen="LINK-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تحويل المرتجع لمستند عكسي</h2>
            <span className="cat-head__hint">
              المستند العكسي يُكتب بالكمية المتفَق عليها فقط. ما لم يوافق عليه المورد لا يُكتب ولا
              يُلغى — يظل بنداً معلّقاً بسببه، لأن طيّه صامتاً يعني تنازلاً لم تقرّه.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "validation_error" && err ? (
              <Notice kind="warning" title="مرتجع يتجاوز ما استُلم">
                <p className="acc-lead">مرتجع السوق أكبر مما دخل دفترك من مستند الاستلام.</p>
                <p className="acc-choice__note">
                  <strong>الحدّ من دفترك</strong> · لا من دفتر الطرف الآخر. دفتراهما مستقلان، وما
                  نعكسه هو ما دخل عندنا.
                </p>
                <ul className="cus-list">
                  {err.errors.map((e, i) => (
                    <li key={i}>
                      <strong>{e.name}</strong>
                      {e.max_qty_milli ? (
                        <div className="cus-sub">
                          الحدّ من دفترك:{" "}
                          <span className="sting-mono">{Number(e.max_qty_milli) / 1000}</span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {err && err.code !== "exceeds_received" ? (
              <Notice kind="warning" title="لم يُكتب المستند العكسي">
                <p className="acc-lead">
                  {err.code === "receipt_not_converted"
                    ? "حوّل استلام هذا الطلب أولاً — العكسي يشير إلى الأصل."
                    : err.code}
                </p>
              </Notice>
            ) : null}
            {state === "success" && done ? (
              <Notice
                kind="success"
                title="كُتب المستند العكسي بالمقبول وحده"
                action={<Button onClick={() => setDone(null)}>التالي</Button>}
              >
                <p className="acc-lead">
                  <span className="sting-mono">{done.local_number}</span> من {done.ref}.{" "}
                  <strong>الجزء المتبقّي يبقى مطلباً مفتوحاً.</strong>
                </p>
                <p className="acc-choice__note">
                  <strong>الأثر السابق محفوظ</strong> · مستند الاستلام الأصلي لا يُعدَّل ولا يُحذف.
                  المرتجع مستند مستقلّ يشير إليه. من يعود بعد سنة يرى ما استُلم فعلاً وما أُرجع
                  فعلاً وتاريخ كلٍّ — لا رقماً صافياً بلا قصة.
                </p>
              </Notice>
            ) : null}
            {state === "partial" ? (
              <Notice kind="warning" title="الجزء المتبقّي يبقى مطلباً مفتوحاً.">
                <p className="acc-lead">
                  المستند العكسي يُكتب بالكمية المتفَق عليها فقط. ما لم يوافق عليه المورد لا يُكتب
                  ولا يُلغى — يظل بنداً معلّقاً بسببه، لأن طيّه صامتاً يعني تنازلاً لم تقرّه.
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={anyPartial ? "partial" : "synced"}
                    label={anyPartial ? "بند معلّق" : "مرتجعات محسومة"}
                  />
                  <span className="acc-choice__note">
                    <span className="sting-mono">{data.pending_count}</span> بانتظار مستند عكسي
                  </span>
                </div>
                <Table
                  caption="المرتجعات ومستنداتها العكسية"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.key}
                  empty={<p className="acc-choice__note">لا مرتجعات محسومة من منشآت مربوطة بعد.</p>}
                />
                <p className="acc-choice__note">
                  <strong>الأثر السابق محفوظ</strong> · مستند الاستلام الأصلي لا يُعدَّل ولا يُحذف.
                  المرتجع مستند مستقلّ يشير إليه. من يعود بعد سنة يرى ما استُلم فعلاً وما أُرجع
                  فعلاً وتاريخ كلٍّ — لا رقماً صافياً بلا قصة.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
