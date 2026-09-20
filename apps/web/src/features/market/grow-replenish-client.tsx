"use client";

import { Button, Frame, Notice, Status, Table, TextField } from "@sting/ui-web";
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
import { hhmm } from "@/features/home/format";
import { PhaseScreenClient } from "@/features/phase/phase-screen-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "permission_denied";

interface Row {
  item_id: string;
  item_name: string;
  base_unit_name: string;
  stock_milli: string;
  stock_label: string;
  days_left: number | null;
  days_left_label: string;
  supplier_id: string;
  supplier_name: string;
  lead_days: number | null;
  supplier_line: string;
  unit_code: string;
  unit_name: string;
  factor_milli: string;
  suggested: number;
  suggested_label: string;
  need: boolean;
  basis: string;
}
interface Payload {
  state: "ready" | "empty" | "phase_locked" | "permission_denied";
  role_name?: string;
  can_convert?: boolean;
  value_hidden?: boolean;
  ask_name?: string;
  forwards?: { by_name: string; at: string; note: string; lines: unknown[]; to_name: string }[];
  computed_at?: string;
  branch_name?: string;
  checked_count?: number;
  rows?: Row[];
  need_count?: number;
  next_check?: string;
}

const itemsWord = (n: number) =>
  n === 1 ? "صنف واحد" : n === 2 ? "صنفان" : n <= 10 ? `${n} أصناف` : `${n} صنفاً`;

/** GROW-01 — اقتراح إعادة التوريد (32-D24 ready/empty/permission_denied): رأيٌ يُعرَض بسببه؛ لا شيء يُطلب حتى تختار. */
export function GrowReplenishClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [forwarded, setForwarded] = useState<{ to_name: string } | null>(null);
  const [created, setCreated] = useState<{ number: string; id: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async (compute = false) => {
    const { data, error, response } = await api().GET("/api/grow/replenish", {
      params: { query: compute ? { compute: "1" } : {} },
    });
    const b = (data ?? error) as unknown as Payload | undefined;
    if ((response.ok || response.status === 403) && b) setData(b);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fgrow%2Freplenish");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="GROW-01" />;

  const rows = data?.rows ?? [];
  const state: State =
    data?.state === "permission_denied"
      ? "permission_denied"
      : data?.state === "empty"
        ? "empty"
        : "ready";
  const selected = rows.filter(
    (r) => picked[r.item_id] !== undefined && Number(picked[r.item_id]) > 0,
  );
  const supplierIds = new Set(selected.map((r) => r.supplier_id));

  const canConvert = data?.can_convert !== false;

  const forward = async () => {
    if (busy) return;
    setBusy("forward");
    setErr("");
    try {
      const r = await api().POST("/api/grow/replenish", {
        body: {
          action: "forward",
          note,
          lines: selected.map((r) => ({
            item_id: r.item_id,
            unit_code: r.unit_code,
            qty_milli: String(Math.round(Number(picked[r.item_id]) * 1000)),
          })),
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { forwarded?: { to_name: string }; detail?: string } | undefined;
      if (r.response.ok && b?.forwarded) {
        setForwarded(b.forwarded);
        setPicked({});
        setNote("");
        return;
      }
      setErr(b?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const convert = async () => {
    if (busy || selected.length === 0) return;
    if (supplierIds.size !== 1) {
      setErr("supplier_mixed");
      return;
    }
    setBusy("convert");
    setErr("");
    try {
      const r = await api().POST("/api/grow/replenish", {
        body: {
          supplier_id: selected[0]!.supplier_id,
          lines: selected.map((r) => ({
            item_id: r.item_id,
            unit_code: r.unit_code,
            qty_milli: String(Math.round(Number(picked[r.item_id]) * 1000)),
          })),
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { order?: { id: string; number: string }; detail?: string } | undefined;
      if (r.response.ok && b?.order) {
        setCreated(b.order);
        setPicked({});
        return;
      }
      setErr(b?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const columns = [
    {
      key: "item",
      header: "الصنف",
      render: (r: Row) => (
        <>
          <strong>{r.item_name}</strong>
          <div className="mp-check__hint">{r.supplier_line}</div>
        </>
      ),
    },
    {
      key: "stock",
      header: "الرصيد",
      render: (r: Row) =>
        r.stock_label === "نفد" ? (
          <Status state="conflict" label="نفد" />
        ) : (
          <span>{r.stock_label}</span>
        ),
    },
    { key: "days", header: "يكفي", render: (r: Row) => r.days_left_label },
    {
      key: "suggested",
      header: "المقترح",
      render: (r: Row) =>
        r.need ? (
          <>
            <span>{r.suggested_label}</span>
            <TextField
              label={`الكمية بـ${r.unit_name}`}
              kind="number"
              mono
              value={picked[r.item_id] ?? ""}
              onChange={(e) => setPicked({ ...picked, [r.item_id]: e.target.value })}
            />
          </>
        ) : r.supplier_id ? (
          <>
            <span>—</span>
            <TextField
              label={`ضمّه (${r.unit_name})`}
              kind="number"
              mono
              value={picked[r.item_id] ?? ""}
              onChange={(e) => setPicked({ ...picked, [r.item_id]: e.target.value })}
            />
          </>
        ) : (
          "—"
        ),
    },
    { key: "basis", header: "على أيّ أساس", render: (r: Row) => r.basis },
  ];

  return (
    <Frame title="النموّ" nav={<AppNav currentId="inventory" />} footer={null}>
      <div className="sys mp cus" data-screen="GROW-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">اقتراح إعادة التوريد — رأيٌ يُعرَض بسببه</h2>
            <span className="cat-head__hint">
              النظام لا يشتري نيابةً عنك. يقترح كمية ويقول من أين جاءت: متوسط بيع، ومهلة توريد،
              ورصيد أمان. كل رقم في الاقتراح قابل للفتح على حسابه.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" && !data?.rows ? (
              <Notice kind="locked" title="اقتراح التوريد للمالك ومدير الفرع وأمين المخزن">
                <p className="acc-lead">
                  الاقتراح يصير أمر شراء — التزام مالي. دورك
                  {data?.role_name ? ` «${data.role_name}»` : ""} لا يرى المخزون ولا الاقتراح.
                </p>
              </Notice>
            ) : null}
            {state === "permission_denied" && data?.rows ? (
              <Notice kind="locked" title="يُرى ولا يُحوَّل">
                <p className="acc-lead">
                  أمين المخزن يرى الاقتراح — هو أدرى بما على الرفّ — ولا يحوّله إلى أمر شراء.
                </p>
                <p className="acc-choice__note">
                  <strong>المخرج</strong> · «أرسل الاقتراح إلى {data.ask_name || "المالك"}»
                  بملاحظاته على الكميات. معرفته بالرفّ أدقّ من الحساب، فلا تُهدَر.
                </p>
                <p className="acc-choice__note">
                  <strong>العمود المحجوب</strong> · القيمة التقديرية محجوبة كما في PUR-01 — وللسبب
                  نفسه.
                </p>
              </Notice>
            ) : null}
            {forwarded ? (
              <Notice kind="success" title={`أُرسل الاقتراح إلى ${forwarded.to_name || "المالك"}`}>
                <p className="acc-lead">تعديلاتك على الكميات أُرسلت مع الاقتراح موسومةً باسمك.</p>
              </Notice>
            ) : null}
            {data?.forwards?.length && canConvert ? (
              <Notice kind="info" title={`اقتراح مُرسَل من ${data.forwards[0]!.by_name}`}>
                <p className="acc-lead">
                  {data.forwards[0]!.note || "بلا ملاحظة"} ·{" "}
                  <span className="sting-mono">{hhmm(data.forwards[0]!.at)}</span> · تعديلاته على
                  الكميات موسومة باسمه.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && data ? (
              <Notice kind="success" title="لا اقتراحات">
                <p className="acc-lead">
                  كل الأصناف فوق حدّ الأمان. الفراغ هنا نتيجة حسابٍ تمّ، لا غياب بيانات — والفرق
                  يُقال.
                </p>
                <p className="acc-choice__note">
                  <strong>نقول</strong> · «فُحص{" "}
                  <span className="sting-mono">{data.checked_count ?? 0}</span> صنفاً · لا شيء يحتاج
                  توريداً اليوم · الفحص التالي {data.next_check ?? "غداً 6 ص"}».
                </p>
              </Notice>
            ) : null}
            {created ? (
              <Notice kind="success" title={`أُنشئ أمر الشراء ${created.number}`}>
                <p className="acc-lead">الكميات كما اخترتها — قابلة للتعديل قبل الإرسال وبعده.</p>
                <div className="acc-actions">
                  <Button onClick={() => router.push(`/purchasing/orders/${created.id}`)}>
                    افتح الأمر (PUR-02)
                  </Button>
                </div>
              </Notice>
            ) : null}
            {err ? (
              <Notice kind="warning" title="لم يُنشأ الأمر">
                <p className="acc-lead">
                  {err === "supplier_mixed"
                    ? "اختر أصناف مورد واحد لكل أمر — الأمر يذهب إلى مورد بعينه."
                    : err}
                </p>
              </Notice>
            ) : null}

            {data && data.rows ? (
              <>
                <div className="acc-actions">
                  <Status state="synced" label="M4" />
                  <span className="acc-choice__note">
                    اقتراح التوريد — {itemsWord(rows.length)} · محسوب{" "}
                    <span className="sting-mono">
                      {data.computed_at ? hhmm(data.computed_at) : "—"}
                    </span>
                  </span>
                  <Button
                    variant="quiet"
                    loading={busy === "compute"}
                    onClick={() => {
                      setBusy("compute");
                      void load(true).finally(() => setBusy(""));
                    }}
                  >
                    احسب الآن
                  </Button>
                </div>
                <p className="acc-choice__note">
                  <strong>لا شيء يُطلب حتى تختار</strong> · لا صندوق اختيار محدَّداً سلفاً ولا «اختر
                  الكل» بارزاً. الاقتراح يصير أمر شراء (PUR-02) باختيار صريح، والكميات تبقى قابلة
                  للتعديل قبل ذلك وبعده.
                </p>
                <Table
                  caption="اقتراح التوريد"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.item_id}
                  empty={<p className="acc-choice__note">لا أصناف في الاقتراح.</p>}
                />
                {canConvert ? (
                  <div className="acc-actions">
                    <Button
                      pos
                      loading={busy === "convert"}
                      onClick={() => void convert()}
                      disabledReason={selected.length ? undefined : "اختر صنفاً واكتب كميته أولاً"}
                    >
                      حوّل المختار إلى أمر شراء
                    </Button>
                  </div>
                ) : (
                  <>
                    <TextField
                      label="ملاحظاتك على الكميات"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="acc-actions">
                      <Button loading={busy === "forward"} onClick={() => void forward()}>
                        أرسل الاقتراح إلى {data.ask_name || "المالك"}
                      </Button>
                      <Button disabledReason="أمين المخزن يرى الاقتراح ولا يحوّله إلى أمر شراء">
                        حوّل المختار إلى أمر شراء
                      </Button>
                    </div>
                    <p className="acc-choice__note">
                      تعديلاته على الكميات تُرسل مع الاقتراح موسومةً باسمه.
                    </p>
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
