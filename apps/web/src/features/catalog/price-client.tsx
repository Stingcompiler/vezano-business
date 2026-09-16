"use client";

import { lineTotalMinor } from "@sting/domain";
import { Button, formatMinor, Frame, Notice, parseMoneyInput, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

import { describeError, type ItemFieldError, type ServerFieldError } from "./item-errors";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface PriceRow {
  readonly id: string;
  readonly price_minor: string;
  readonly effective_from: string;
  readonly effective_to: string;
  readonly changed_by_name: string;
  readonly batch_id: string;
  readonly note: string;
}
interface PriceView {
  readonly item_id: string;
  readonly name: string;
  readonly base_unit_name: string;
  readonly sale_price_minor: string;
  readonly units: readonly {
    id: string;
    name: string;
    factor_milli: string;
    price_minor: string;
  }[];
  readonly history: readonly PriceRow[];
  readonly can_change: boolean;
  readonly can_see_cost: boolean;
  readonly average_cost_minor: string;
  readonly pending_requests: readonly {
    id: string;
    proposed_price_minor: string;
    reason: string;
    requested_by_name: string;
    requested_at: string;
  }[];
}
interface BelowCost {
  readonly average_cost_minor: string;
  readonly price_minor: string;
  readonly margin_minor: string;
}

/** استجابات السعر غير موصوفة في العقد (responses: None). */
const asView = (x: unknown): PriceView & { changed?: boolean } =>
  x as PriceView & { changed?: boolean };

const asBelowCost = (x: unknown): BelowCost => x as BelowCost;

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
/** «12 أغسطس» — اليوم رقماً لاتينياً في mono والشهر عربياً (القاعدة 2). */
function DayMonth({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <>
      <span className="sting-mono">{String(d.getDate()).padStart(2, "0")}</span>{" "}
      {MONTHS[d.getMonth()]}
    </>
  );
}

/**
 * CAT-04 — سعر صنف وتاريخ تغييره (05-D2 ready · 38-D30 validation_error/permission_denied/success).
 * السعر سلسلة تواريخ لا قيمة واحدة؛ الفواتير الصادرة بالسعر القديم تبقى بسعرها؛ سعر الوحدة الأكبر
 * يتبع تلقائياً (من المجال)؛ سعر دون التكلفة تنبيهٌ لا منع (لمن يرى التكلفة)؛ التغيير للمالك.
 */
export function PriceClient({ itemId }: { itemId: string }) {
  const router = useRouter();
  const app = useApp();
  const [view, setView] = useState<PriceView | null>(null);
  const [price, setPrice] = useState("");
  const [belowCost, setBelowCost] = useState<BelowCost | null>(null);
  const [errors, setErrors] = useState<ItemFieldError[]>([]);
  const [saved, setSaved] = useState<PriceRow | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/catalog/items/{item_id}/price", {
      params: { path: { item_id: itemId } },
    });
    if (response.ok && data) {
      const v = asView(data);
      setView(v);
      setPrice(formatMinor(v.sale_price_minor, 2, false));
    }
  }, [itemId]);

  useEffect(() => {
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/catalog/${itemId}/price`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [app.expired, app.tokens, itemId, load, router]);

  const priceMinor = parseMoneyInput(price || "0");

  const save = async (confirm: boolean) => {
    if (busy || !view) return;
    setBusy(true);
    setErrors([]);
    setSaved(null);
    try {
      const { data, error, response } = await api().POST("/api/catalog/items/{item_id}/price", {
        params: { path: { item_id: itemId } },
        body: { price_minor: priceMinor ?? price, confirm_below_cost: confirm },
      });
      if (response.status === 409 && error) {
        setBelowCost(
          (error as { detail?: string }).detail === "below_cost" ? asBelowCost(error) : null,
        );
        return;
      }
      if (response.status === 400 && error) {
        setErrors(((error as { errors?: ServerFieldError[] }).errors ?? []).map(describeError));
        return;
      }
      if (response.ok && data) {
        const v = asView(data);
        setView(v);
        setBelowCost(null);
        setPrice(formatMinor(v.sale_price_minor, 2, false));
        if (v.changed && v.history[0]) setSaved(v.history[0]);
      }
    } finally {
      setBusy(false);
    }
  };

  const sendRequest = async () => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const { error, response } = await api().POST("/api/catalog/items/{item_id}/price-request", {
        params: { path: { item_id: itemId } },
        body: { proposed_price_minor: parseMoneyInput(proposed || "0") ?? proposed, reason },
      });
      if (response.status === 400 && error) {
        setErrors(((error as { errors?: ServerFieldError[] }).errors ?? []).map(describeError));
        return;
      }
      if (response.ok) {
        setRequesting(false);
        setProposed("");
        setReason("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = !view
    ? "ready"
    : !view.can_change
      ? "permission_denied"
      : saved
        ? "success"
        : belowCost || errors.length
          ? "validation_error"
          : "ready";
  const errorFor = (key: string) => errors.find((e) => e.key === key)?.msg;

  return (
    <Frame title="الكتالوج" nav={<AppNav currentId="catalog" />} footer={null}>
      <div className="home" data-screen="CAT-04" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {view ? `سعر بيع ال${view.name} — ${view.base_unit_name}` : "سعر البيع"}
            </h2>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" && view ? (
              <Notice
                kind="locked"
                title="تغيير السعر للمالك"
                action={
                  requesting ? null : (
                    <Button onClick={() => setRequesting(true)}>اطلب تغييراً</Button>
                  )
                }
              >
                <p className="acc-lead">
                  مدير الفرع يرى السعر وتاريخه ولا يغيّره. السعر قرار منشأة لا فرع.
                </p>
                {requesting ? (
                  <div className="cat-alias-form">
                    <TextField
                      label="السعر المقترح"
                      mono
                      value={proposed}
                      onChange={(e) => setProposed(e.target.value)}
                      error={errorFor("proposed_price_minor")}
                      required
                    />
                    <TextField
                      label="السبب"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      error={errorFor("reason")}
                    />
                    <Button
                      onClick={() => void sendRequest()}
                      loading={busy}
                      disabledReason={proposed.trim() ? undefined : "السعر المقترح"}
                    >
                      اطلب تغييراً
                    </Button>
                  </div>
                ) : null}
                {view.pending_requests.length ? (
                  <ul className="acc-steps">
                    {view.pending_requests.map((r) => (
                      <li key={r.id}>
                        <span>
                          السعر المقترح{" "}
                          <span className="sting-mono">{formatMinor(r.proposed_price_minor)}</span>
                          {r.reason ? ` · ${r.reason}` : ""}
                          {r.requested_by_name ? ` — ${r.requested_by_name}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}

            {state === "validation_error" && belowCost ? (
              <Notice
                kind="error"
                title="سعر دون التكلفة"
                action={
                  <Button onClick={() => void save(true)} loading={busy}>
                    حفظ السعر
                  </Button>
                }
              >
                <p className="acc-lead">سعرٌ يُدخَل أقلّ من متوسط التكلفة — بيعٌ بخسارة.</p>
                <p className="acc-lead">
                  <strong>ننبّه ولا نمنع</strong> · الهامش{" "}
                  <span className="sting-mono">{formatMinor(belowCost.margin_minor)}</span> · متوسط
                  التكلفة{" "}
                  <span className="sting-mono">{formatMinor(belowCost.average_cost_minor)}</span>
                </p>
              </Notice>
            ) : null}

            {state === "success" && saved ? (
              <Notice kind="success" title="سُجّل السعر الجديد">
                <p className="acc-lead">ومعه سريانه: من الآن، والفواتير السابقة بأسعارها.</p>
              </Notice>
            ) : null}

            {view ? (
              <>
                <div className="cat-price__field">
                  <TextField
                    label="السعر الجديد"
                    mono
                    value={price}
                    onChange={(e) => {
                      setPrice(e.target.value);
                      setBelowCost(null);
                      setSaved(null);
                    }}
                    error={errorFor("price_minor")}
                    readOnly={!view.can_change}
                    disabledReason={busy ? "جارٍ الحفظ" : undefined}
                  />
                </div>
                {view.units.map((u) => (
                  <div key={u.id} className="cat-price__follow">
                    <span>سعر ال{u.name} يتبع تلقائياً</span>
                    <span className="sting-mono">
                      {formatMinor(
                        priceMinor
                          ? lineTotalMinor(BigInt(u.factor_milli), BigInt(priceMinor))
                          : u.price_minor,
                      )}
                    </span>
                  </div>
                ))}
                <div className="cat-price__history">
                  <div className="cat-examples__title">تاريخ السعر</div>
                  <table className="cat-price__table">
                    <tbody>
                      {view.history.map((h) => (
                        <tr key={h.id}>
                          <td className="sting-mono">{formatMinor(h.price_minor)}</td>
                          <td>
                            {h.effective_to ? (
                              <>
                                <DayMonth iso={h.effective_from} /> —{" "}
                                <DayMonth iso={h.effective_to} />
                              </>
                            ) : (
                              <>
                                من <DayMonth iso={h.effective_from} /> — سارٍ الآن
                              </>
                            )}
                            {h.changed_by_name ? (
                              <div className="acc-choice__note">
                                {h.changed_by_name} ·{" "}
                                <span className="sting-mono">{hhmm(h.effective_from)}</span>
                                {h.note ? ` · ${h.note}` : ""}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="cat-saving__note">
                  الفواتير الصادرة بالسعر القديم تبقى بسعرها. لا يُعاد تسعير أي مستند محفوظ.
                </p>
                {view.can_change ? (
                  <div className="cat-form__actions">
                    <Button
                      onClick={() => void save(false)}
                      loading={busy}
                      disabledReason={
                        priceMinor === null
                          ? "اكتب سعراً بأرقام لاتينية"
                          : priceMinor === view.sale_price_minor
                            ? "السعر نفسه"
                            : undefined
                      }
                    >
                      حفظ السعر
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="acc-card__sub" role="status">
                جلب الأصناف
              </p>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
