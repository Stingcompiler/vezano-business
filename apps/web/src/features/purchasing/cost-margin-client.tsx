"use client";

import { Button, formatMinor, Frame, Notice, PhaseLocked, Table, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./purchasing.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "permission_denied" | "phase_locked";

interface Row {
  item_id?: string;
  item_name: string;
  base_unit_name?: string;
  sale_price_minor: string;
  cost_minor: string;
  cost_unit_name?: string;
  method_label: string;
  docs_count?: number;
  margin_bps: number | null;
  note:
    | ""
    | "example"
    | "manual"
    | "unit_mismatch"
    | "single_doc"
    | "negative"
    | "cost_rose"
    | "stable";
  note_extra?: {
    document_number?: string;
    previous_margin_bps?: number | null;
    price_moved?: boolean;
    months?: number;
  };
}

interface Report {
  state: State;
  policy: string;
  can_enable: boolean;
  rows: Row[];
  items_count: number;
}

const LOCK_EXPLANATION =
  "المنشأة لم تفعّل وحدة الشراء الداخلي. لا تكلفة محسوبة لأن لا مستندات شراء أصلاً — والقفل هنا صدقٌ لا منع.";

/** «14%» حين يكون صحيحاً، وإلا بمنزلتين — بلا تقريب مخفٍ. */
const pct = (bp: number) => (bp % 100 === 0 ? `${bp / 100}%` : `${(bp / 100).toFixed(2)}%`);

const MONTH_WORDS = ["", "شهر", "شهرين", "ثلاثة أشهر", "أربعة أشهر", "خمسة أشهر", "ستة أشهر"];
const monthsWord = (n: number) => (n <= 6 ? (MONTH_WORDS[n] ?? "") : `${n} شهراً`);

/** «12 صنفاً» */
const itemsWord = (n: number) =>
  n === 1 ? "صنف واحد" : n === 2 ? "صنفان" : n <= 10 ? `${n} أصناف` : `${n} صنفاً`;

function noteText(r: Row): ReactNode {
  switch (r.note) {
    case "unit_mismatch":
      return `الوحدتان مختلفتان: التكلفة لل${r.cost_unit_name ?? ""} والسعر لل${r.base_unit_name ?? ""}. لا نحسب هامشاً من وحدتين — نُظهر شرطة ونطلب ضبط التحويل.`;
    case "single_doc":
      return "مبنيّ على مستند واحد — المتوسط يصير ذا معنى بعد ثلاثة.";
    case "negative":
      return "بيع بخسارة. قد يكون مقصوداً — والشاشة لا تحكم.";
    case "manual":
      return "تكلفة افتتاحية يدوية — تُستبدل بأول مستند حقيقي.";
    case "cost_rose": {
      const x = r.note_extra ?? {};
      return (
        <>
          التكلفة ارتفعت بمستند <span className="sting-mono">{x.document_number ?? ""}</span>
          {x.price_moved ? " وتحرّك السعر" : " والسعر لم يتحرّك"}.
          {typeof x.previous_margin_bps === "number" ? (
            <>
              {" "}
              الهامش كان <span className="sting-mono">{pct(x.previous_margin_bps)}</span> قبل
              المستند.
            </>
          ) : null}
        </>
      );
    }
    case "stable": {
      const m = r.note_extra?.months ?? 0;
      return m > 0 ? `مستقرّ منذ ${monthsWord(m)}.` : "مستقرّ.";
    }
    case "example":
      return "مثال";
    default:
      return "";
  }
}

export function CostMarginClient() {
  const router = useRouter();
  const app = useApp();
  const [rep, setRep] = useState<Report | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualFor, setManualFor] = useState<Row | null>(null);
  const [manualCost, setManualCost] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/inventory/purchasing/cost-margin");
    if (response.status === 403) {
      const e = data as unknown as { extra?: { role_name?: string } } | undefined;
      setDenied(e?.extra?.role_name ?? "");
      return;
    }
    const body = data as unknown as Report | undefined;
    if (response.ok && body) setRep(body);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpurchasing%2Fcost-margin");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const act = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/inventory/purchasing/cost-margin", {
        body: body as never,
      });
      const r = data as unknown as Report | undefined;
      if (response.ok && r) {
        setRep(r);
        setManualFor(null);
        setManualCost("");
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied !== null ? "permission_denied" : (rep?.state ?? "empty");
  const rows = rep?.rows ?? [];

  const columns = [
    {
      key: "item",
      header: "الصنف",
      render: (r: Row) => (
        <>
          <strong>{r.item_name}</strong>
          {r.method_label ? <div className="acc-choice__note">{r.method_label}</div> : null}
        </>
      ),
    },
    {
      key: "cost",
      header: "التكلفة",
      mono: true,
      render: (r: Row) => (r.cost_minor ? formatMinor(r.cost_minor) : ""),
    },
    {
      key: "price",
      header: "سعر البيع",
      mono: true,
      render: (r: Row) =>
        r.cost_minor || r.note === "example" ? formatMinor(r.sale_price_minor) : "",
    },
    {
      key: "margin",
      header: "الهامش",
      mono: true,
      render: (r: Row) =>
        r.margin_bps === null ? (
          r.cost_minor ? (
            "—"
          ) : (
            ""
          )
        ) : (
          <span className={r.margin_bps < 0 ? "pur-neg" : undefined}>{pct(r.margin_bps)}</span>
        ),
    },
    { key: "note", header: "ملاحظة", render: (r: Row) => noteText(r) },
  ];

  const table = (caption: string) => (
    <Table
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.item_id ?? r.item_name}
    />
  );

  return (
    <Frame title="المشتريات" nav={<AppNav currentId="cost-margin" />} footer={null}>
      <div className="sys pur" data-screen="PUR-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">التكلفة والهامش — الرقم الذي لا يُعرض إلا لمن يملكه</h2>
            <span className="cat-head__hint">
              التكلفة تتبع مستندات الشراء بالمتوسط المرجّح، وتتغيّر مع كل استلام. والهامش مشتقٌّ
              منها ومن سعر البيع — فمن يرى الهامش يرى التكلفة ضمناً، ولذلك صلاحيتهما واحدة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="الشاشة كلها محجوبة">
                <p className="acc-lead">
                  الاستثناء الوحيد في النظام: هنا نحجب الشاشة لا عموداً منها. كل رقم فيها يقود إلى
                  التكلفة — والهامش يكشفها بالطرح.
                </p>
                <p className="acc-lead">
                  <strong>لماذا لا نحجب عموداً</strong> · إخفاء التكلفة وإبقاء الهامش والسعر يعني
                  إعطاءها: التكلفة = السعر ÷ (1 + الهامش). الحجب الجزئي هنا وهمٌ لا سياسة.
                </p>
                <p className="acc-lead">
                  <strong>ما يبقى</strong> · الشاشة تظهر في القائمة بقفل مرئي لا تختفي — الموظف يعرف
                  أن ثمّة تقريراً يطلبه إن احتاجه.
                </p>
                <p className="acc-choice__note">
                  للمالك والمحاسب فقط، والقائمة معرّفة في ORG لا في الكود.
                </p>
              </Notice>
            ) : null}

            {state === "phase_locked" && rep ? (
              <PhaseLocked
                kind="conditional"
                title="الشراء الداخلي غير مفعّل"
                explanation={LOCK_EXPLANATION}
                onActivate={rep.can_enable ? () => void act({ action: "enable" }) : undefined}
                activateLabel="فعّل الشراء الداخلي"
                activating={busy}
              >
                <Notice kind="locked" title="الشراء الداخلي غير مفعّل">
                  <p className="acc-lead">{LOCK_EXPLANATION}</p>
                  <p className="acc-lead">
                    <strong>صيغة «مشروط»</strong> · الوحدة مبنيّة وتنتظر مفتاحاً في يد المالك: «فعّل
                    الشراء الداخلي» زرٌّ حاضر، لا «تواصل مع المبيعات».
                  </p>
                  <p className="acc-lead">
                    <strong>ما نُريه خلف القفل</strong> · لقطة حقيقية بأرقام تجريبية موسومة «مثال» —
                    القرار بالتفعيل يحتاج أن يرى ما سيحصل عليه.
                  </p>
                  <p className="acc-choice__note">
                    يفترق هذا عن قفل M4: ذاك قرار منتج لم يُفتح بعد، وهذا مفتاح في يد المالك الآن.
                  </p>
                </Notice>
                {table("مثال — التكلفة والهامش")}
              </PhaseLocked>
            ) : null}

            {state === "empty" && rep ? (
              <Notice kind="empty" title="لا تكلفة بعد">
                <p className="acc-lead">
                  المنشأة تبيع ولم تُسجّل مستند شراء واحداً — أصنافها أُدخلت برصيد افتتاحي بلا سعر
                  تكلفة.
                </p>
                <p className="acc-lead">
                  <strong>نقول السبب</strong> · «التكلفة تُبنى من مستندات الشراء، ولم يُسجَّل مستند
                  بعد» — لا «لا بيانات».
                </p>
                <p className="acc-lead">
                  <strong>المخرج</strong> · سجّل مستند شراء، أو أدخل تكلفة افتتاحية يدوية تُوسم
                  «يدوية» وتُستبدل بأول مستند حقيقي.
                </p>
                <p className="acc-choice__note">
                  الجدول يُعرض بأعمدته فارغةً ليُفهم ما الذي سيملؤه، لا رسالة في وسط شاشة بيضاء.
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push("/purchasing/orders")}>
                    سجّل مستند شراء
                  </Button>
                </div>
              </Notice>
            ) : null}

            {(state === "ready" || state === "empty") && rep ? (
              <>
                <div className="acc-choice__head">
                  <strong>التكلفة والهامش — {itemsWord(rep.items_count)}</strong>
                  <span className="acc-choice__note">مرئية للمالك والمحاسب</span>
                </div>
                {table("التكلفة والهامش")}
                {state === "ready" ? (
                  <p className="acc-choice__note">
                    الهامش السالب يُعرض بلونه ولا يُنبَّه عليه بنافذة: بيعٌ بخسارة قد يكون قراراً
                    واعياً (تصريف قارب الانتهاء) وقد يكون سهواً. الشاشة تُري ولا تحكم — والحكم في يد
                    من يملك السعر.
                  </p>
                ) : null}
                {rows.some((r) => !r.cost_minor) ? (
                  <div className="acc-choice">
                    <p className="acc-choice__note">تكلفة افتتاحية يدوية لصنف بلا مستند:</p>
                    <div className="acc-actions">
                      {rows
                        .filter((r) => !r.cost_minor)
                        .map((r) => (
                          <Button
                            key={r.item_id ?? r.item_name}
                            onClick={() => {
                              setManualFor(r);
                              setManualCost("");
                            }}
                          >
                            {r.item_name}
                          </Button>
                        ))}
                    </div>
                    {manualFor ? (
                      <>
                        <TextField
                          label={`تكلفة ${manualFor.base_unit_name ?? "الوحدة"} — ${manualFor.item_name}`}
                          mono
                          value={manualCost}
                          onChange={(e) => setManualCost(e.target.value)}
                          hint="تُوسم «يدوية» وتُستبدل بأول مستند حقيقي."
                        />
                        <div className="acc-actions">
                          <Button
                            pos
                            loading={busy}
                            onClick={() =>
                              void act({
                                action: "manual_cost",
                                item_id: manualFor.item_id,
                                unit_cost_minor: String(
                                  Math.round(Number(manualCost || "0") * 100),
                                ),
                              })
                            }
                          >
                            احفظ التكلفة اليدوية
                          </Button>
                          <Button onClick={() => setManualFor(null)}>إلغاء</Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
