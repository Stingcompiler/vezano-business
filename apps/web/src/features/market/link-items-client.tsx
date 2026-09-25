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
import { PhaseScreenClient } from "@/features/phase/phase-screen-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "conflict" | "success";

interface Mapping {
  id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  offer_id: string;
  offer_name: string;
  offer_unit_name: string;
  offer_pack_label: string;
  factor_milli: string;
  status: "matched" | "needs_definition" | "needs_review";
  status_label: string;
  supplier_changed: boolean;
}
interface UnmappedOffer {
  offer_id: string;
  public_name: string;
  unit_name: string;
  pack_label: string;
  defined: boolean;
}
interface ItemRow {
  item_id: string;
  name: string;
  base_unit_code: string;
  base_unit_name: string;
  units: { code: string; name: string; factor_milli: string }[];
}
interface Payload {
  state: "ready" | "phase_locked";
  counterparties: { tenant_id: string; name: string }[];
  counterparty_tenant_id: string;
  mappings: Mapping[];
  matched_count: number;
  review_count: number;
  unmapped_offers: UnmappedOffer[];
  items: ItemRow[];
}

const factorWord = (milli: string) => {
  const n = Number(milli) / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
};
/** جمع وحدتك مضافاً إليك كما يكتبه الإطار («أكياسك») — لأشهر الوحدات، وإلا «وحداتك (…)». */
const unitsOfYours = (unitName: string) => {
  const u = unitName.trim();
  if (u.startsWith("كيس")) return "أكياسك";
  if (u.startsWith("علبة")) return "علبك";
  if (u.startsWith("عبوة")) return "عبواتك";
  if (u.startsWith("كرتونة")) return "كراتينك";
  if (u.startsWith("قطعة")) return "قطعك";
  return `وحداتك (${u})`;
};
/** «كرتونته»: وحدة المورد مضافةً إليه — التاء المربوطة تُفتح قبل الضمير. */
const hisUnit = (u: string) =>
  u.trim().endsWith("ة") ? `${u.trim().slice(0, -1)}ته` : `${u.trim()}ه`;
const itemsWord = (n: number) =>
  n === 1 ? "صنف واحد" : n === 2 ? "صنفان" : n <= 10 ? `${n} أصناف` : `${n} صنفاً`;

/** LINK-02 — مطابقة الأصناف والوحدات (29-D22 ready/conflict · 38-D30 validation_error/success): التحويل مؤكَّد أو لا يكون. */
export function LinkItemsClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [cp, setCp] = useState("");
  const [offer, setOffer] = useState<UnmappedOffer | null>(null);
  const [itemId, setItemId] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [factor, setFactor] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; extra: Record<string, string> } | null>(null);
  const [saved, setSaved] = useState<Mapping | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async (counterparty: string) => {
    const { data, response } = await api().GET("/api/market/link/items", {
      params: { query: counterparty ? { counterparty } : {} },
    });
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) {
      setData(b);
      setCp(b.counterparty_tenant_id);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Flink%2Fitems");
      return;
    }
    void load("").catch(() => undefined);
  }, [router, load]);

  const save = async () => {
    if (busy || !offer) return;
    setBusy("save");
    setErr(null);
    try {
      const r = await api().POST("/api/market/link/items", {
        body: {
          counterparty_tenant_id: cp,
          item_id: itemId,
          offer_id: offer.offer_id,
          unit_code: unitCode,
          factor_milli: factor ? String(Math.round(Number(factor) * 1000)) : "",
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { mapping?: Mapping; detail?: string; extra?: Record<string, string> } | undefined;
      if (r.response.ok && b?.mapping) {
        setSaved(b.mapping);
        setOffer(null);
        setFactor("");
        await load(cp);
        return;
      }
      setErr({ code: b?.detail ?? "server_error", extra: b?.extra ?? {} });
    } finally {
      setBusy("");
    }
  };

  const act = async (m: Mapping, action: "confirm" | "remove") => {
    if (busy) return;
    setBusy(`${action}:${m.id}`);
    try {
      const r = await api().POST("/api/market/link/items/{mapping_id}/{action}", {
        params: { path: { mapping_id: m.id, action } },
        body: {} as never,
      });
      if (r.response.ok) await load(cp);
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="LINK-02" />;

  const state: State =
    err?.code === "factor_required"
      ? "validation_error"
      : saved
        ? "success"
        : data && data.review_count > 0
          ? "conflict"
          : "ready";
  const item = data?.items.find((i) => i.item_id === itemId) ?? null;
  const unitName = item
    ? unitCode === item.base_unit_code || !unitCode
      ? item.base_unit_name
      : (item.units.find((u) => u.code === unitCode)?.name ?? item.base_unit_name)
    : "";
  const columns = [
    {
      key: "mine",
      header: "صنفك ووحدتك",
      render: (m: Mapping) => (
        <>
          <strong>{m.item_name}</strong>
          <div className="mp-check__hint">{m.unit_name}</div>
        </>
      ),
    },
    {
      key: "theirs",
      header: "صنف المورد ووحدته",
      render: (m: Mapping) => (
        <>
          <strong>{m.offer_name}</strong>
          <div className="mp-check__hint">{m.offer_pack_label || m.offer_unit_name}</div>
        </>
      ),
    },
    {
      key: "factor",
      header: "معامل التحويل",
      render: (m: Mapping) =>
        m.status === "needs_definition" ? (
          <>
            وحدته «{m.offer_unit_name}» بلا عدد معلَن. لا نُخمّن 4 أو 6 — نطلب توضيحاً منه قبل
            المطابقة.
          </>
        ) : m.status === "needs_review" ? (
          <>
            غيّر المورد تعريف صنفه. المطابقة القديمة موقوفة حتى تراجعها — لا نُمرّرها بافتراض أنها
            كما كانت.
          </>
        ) : m.factor_milli === "1000" && m.item_name !== m.offer_name ? (
          <>مطابَق. الاسم مختلف والصنف واحد — الأسماء لا تُطابِق، أنت تُطابِق.</>
        ) : (
          <>
            تحويل مؤكَّد: {hisUnit(m.offer_unit_name)} ={" "}
            <span className="sting-mono">{factorWord(m.factor_milli)}</span> من{" "}
            {unitsOfYours(m.unit_name)}. أنت أقررته.
          </>
        ),
    },
    {
      key: "status",
      header: "حالة المطابقة",
      render: (m: Mapping) => (
        <>
          <Status
            state={
              m.status === "matched"
                ? "success"
                : m.status === "needs_review"
                  ? "conflict"
                  : "partial"
            }
            label={m.status_label}
          />
          <div className="acc-actions">
            {m.status === "needs_review" ? (
              <Button
                variant="quiet"
                loading={busy === `confirm:${m.id}`}
                onClick={() => void act(m, "confirm")}
              >
                راجعتها — ثبّت المطابقة
              </Button>
            ) : null}
            <Button
              variant="quiet"
              loading={busy === `remove:${m.id}`}
              onClick={() => void act(m, "remove")}
            >
              إزالة
            </Button>
          </div>
        </>
      ),
    },
  ];

  return (
    <Frame title="الربط" nav={<AppNav currentId="catalog" />} footer={null}>
      <div className="sys mp cus" data-screen="LINK-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مطابقة الأصناف والوحدات — التحويل مؤكَّد أو لا يكون</h2>
            <span className="cat-head__hint">
              صنفك وصنف المورد كيانان مستقلّان لكلٍّ ملكيته. المطابقة تربط بينهما بمعامل تحويل صريح،
              ولا نُخمّن أن «كرتونة» عنده = «كرتونة» عندك.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "validation_error" && err ? (
              <Notice kind="warning" title="وحدتان لا تتطابقان">
                <p className="acc-lead">
                  مطابقة صنفٍ يُباع بالكرتون بصنفٍ يُخزَّن بالكيس بلا معامل بينهما.
                </p>
                <p className="acc-choice__note">
                  <strong>نطلب المعامل</strong> · لا نخمّنه من الاسم. «
                  {err.extra.offer_unit_name ?? "كرتون"} = كم {err.extra.unit_name ?? "كيساً"}؟»
                  سؤالٌ واحد يمنع أن يدخل 10 كراتين مخزونك 10 أكياس.
                </p>
              </Notice>
            ) : null}
            {err && err.code !== "factor_required" ? (
              <Notice kind="warning" title="لم تُحفظ المطابقة">
                <p className="acc-lead">
                  {err.code === "not_linked" ? "اربط الطرف أولاً." : err.code}
                </p>
              </Notice>
            ) : null}
            {state === "success" && data ? (
              <Notice
                kind="success"
                title="طوبقت الأصناف"
                action={<Button onClick={() => setSaved(null)}>التالي</Button>}
              >
                <p className="acc-lead">
                  {itemsWord(data.matched_count)} مطابَقاً و
                  {data.unmapped_offers.length === 0
                    ? "لا شيء"
                    : itemsWord(data.unmapped_offers.length)}{" "}
                  بلا مقابل. و{data.unmapped_offers.length === 3 ? "الثلاثة" : "الباقي"} لا تمنع
                  العمل — تُنشأ عند أول استلام.
                </p>
                <p className="acc-choice__note">
                  <strong>المطابقة تُراجَع</strong> · قابلة للتعديل دائماً، وتغييرها لا يمسّ مستنداً
                  مضى — كمعامل التحويل تماماً.
                </p>
              </Notice>
            ) : null}
            {state === "conflict" && data ? (
              <Notice kind="warning" title="تغيّر تعريف صنف المورد — راجع المطابقة">
                <p className="acc-lead">
                  <span className="sting-mono">{data.review_count}</span>{" "}
                  {data.review_count === 1 ? "مطابقة موقوفة" : "مطابقات موقوفة"} حتى تراجعها — لا
                  نُمرّرها بافتراض أنها كما كانت.
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                {data.counterparties.length > 1 ? (
                  <div className="pos-chips" role="group" aria-label="المنشأة">
                    {data.counterparties.map((c) => (
                      <button
                        key={c.tenant_id}
                        type="button"
                        className={`pos-chip${cp === c.tenant_id ? " pos-chip--on" : ""}`}
                        onClick={() => void load(c.tenant_id)}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                {data.counterparties.length === 0 ? (
                  <Notice kind="empty" title="لا منشأة مربوطة بعد">
                    <p className="acc-lead">المطابقة تبدأ بعد ربط الطرف.</p>
                  </Notice>
                ) : null}
                <Table
                  caption="المطابقات"
                  columns={columns}
                  rows={data.mappings}
                  rowKey={(m) => m.id}
                  empty={<p className="acc-choice__note">لا مطابقات بعد.</p>}
                />
                <p className="acc-choice__note">
                  <strong>الملكية تبقى داخلية.</strong> تعديل المورد لاسم صنفه أو تغليفه لا يعيد
                  كتابة صنفك ولا اسمه في دفترك. تظهر لك ملاحظة «تغيّر تعريف صنف المورد — راجع
                  المطابقة» ويبقى القرار لك.
                </p>

                {data.unmapped_offers.length ? (
                  <>
                    <h3 className="cat-head__title">
                      أصناف المورد بلا مقابل —{" "}
                      <span className="sting-mono">{data.unmapped_offers.length}</span>
                    </h3>
                    <ul className="cus-list">
                      {data.unmapped_offers.map((o) => (
                        <li key={o.offer_id}>
                          <Button
                            variant="quiet"
                            onClick={() => {
                              setOffer(o);
                              setErr(null);
                              setSaved(null);
                            }}
                          >
                            {o.public_name}
                          </Button>
                          <div className="cus-sub">{o.pack_label || o.unit_name}</div>
                          {!o.defined ? <Status state="partial" label="ناقص تعريف" /> : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {offer ? (
                  <>
                    <h3 className="cat-head__title">
                      مطابقة «{offer.public_name}» ({offer.pack_label || offer.unit_name})
                    </h3>
                    <div className="pos-chips" role="group" aria-label="صنفك">
                      {data.items.map((i) => (
                        <button
                          key={i.item_id}
                          type="button"
                          className={`pos-chip${itemId === i.item_id ? " pos-chip--on" : ""}`}
                          onClick={() => {
                            setItemId(i.item_id);
                            setUnitCode(i.base_unit_code);
                          }}
                        >
                          {i.name}
                        </button>
                      ))}
                    </div>
                    {item ? (
                      <div className="pos-chips" role="group" aria-label="وحدتك">
                        {[
                          { code: item.base_unit_code, name: item.base_unit_name },
                          ...item.units,
                        ].map((u) => (
                          <button
                            key={u.code}
                            type="button"
                            className={`pos-chip${unitCode === u.code ? " pos-chip--on" : ""}`}
                            onClick={() => setUnitCode(u.code)}
                          >
                            {u.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <TextField
                      label={`${offer.unit_name || "وحدة المورد"} الواحدة = كم من ${unitName || "وحدتك"}؟`}
                      kind="number"
                      mono
                      value={factor}
                      onChange={(e) => setFactor(e.target.value)}
                      hint="لا يُخمَّن من الاسم — اكتبه أنت."
                    />
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy === "save"}
                        onClick={() => void save()}
                        disabledReason={itemId ? undefined : "اختر صنفك"}
                      >
                        ثبّت المطابقة
                      </Button>
                      <Button variant="quiet" onClick={() => setOffer(null)}>
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
