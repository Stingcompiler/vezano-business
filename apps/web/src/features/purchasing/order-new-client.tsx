"use client";

import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  SelectField,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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

type State = "ready" | "validation_error" | "saving" | "success";

interface ItemOpt {
  id: string;
  name: string;
  base_unit_code: string;
  base_unit_name: string;
  base_unit_decimal_places: 0 | 1 | 2 | 3;
  units: { code: string; name: string; factor_milli: string }[];
}

interface Draft {
  key: number;
  item_id: string;
  unit_code: string;
  qty: string;
}

interface PreviewLine {
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  factor_milli: string;
  qty_milli: string;
  base_qty_milli: string;
  base_unit_name: string;
  base_decimal_places: 0 | 1 | 2 | 3;
  balance_milli: string;
  days_of_stock: number | null;
  est_unit_price_minor: string;
  est_total_minor: string;
}

interface LineError {
  line: number;
  code: string;
  item_name?: string;
  qty_milli?: string;
  confirmable?: boolean;
}

interface Preview {
  supplier: { id: string; name: string };
  lines: PreviewLine[];
  errors: LineError[];
  estimated_total_minor: string;
  estimated_partial: boolean;
  supplier_known_items: number;
}

interface Order {
  id: string;
  number: string;
  status: string;
  status_label: string;
  send_error: string;
}

const daysWord = (n: number) =>
  n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوماً`;

/**
 * PUR-02 — إنشاء أمر شراء (32-D24 ready/validation_error/saving/success): الوحدة التي تشتري بها
 * لا التي تبيع بها — الأمر يُكتب بوحدة الشراء ويُعرض معه المكافئ بوحدة البيع فلا يصل عشرة أضعاف
 * ما أردت؛ المجموع تقديري من آخر أسعار الشراء؛ كمية بلا وحدة أو مورد لا يورّد الصنف يُسأل عنهما قبل
 * الحفظ والسطر الخاطئ وحده يُعلَّم؛ الحفظ والإرسال فعلان منفصلان يظهران منفصلين؛ النجاح يقول ما تغيّر
 * وما لم يتغيّر (§٧.٧، §٣.٣).
 */
export function OrderNewClient() {
  const router = useRouter();
  const app = useApp();
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [supplier, setSupplier] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([{ key: 1, item_id: "", unit_code: "", qty: "" }]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "sending">("idle");
  const [saved, setSaved] = useState<Order | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [denied, setDenied] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpurchasing%2Forders%2Fnew");
      return;
    }
    void (async () => {
      const [o, i] = await Promise.all([
        api().GET("/api/inventory/purchasing/orders", { params: { query: { scope: "open" } } }),
        api().GET("/api/catalog/items", { params: { query: {} } }),
      ]);
      if (o.response.status === 403) {
        setDenied(true);
        return;
      }
      const ob = o.data as unknown as
        { suppliers: { id: string; name: string }[]; can_create: boolean } | undefined;
      if (ob) {
        setSuppliers(ob.suppliers);
        if (!ob.can_create) setDenied(true);
        if (ob.suppliers[0] && !supplier) setSupplier(ob.suppliers[0].id);
      }
      const ib = i.data as unknown as { items: ItemOpt[] } | undefined;
      if (ib) setItems(ib.items);
    })().catch(() => undefined);
  }, [router]);

  const lines = () =>
    drafts
      .filter((d) => d.item_id)
      .map((d) => ({
        item_id: d.item_id,
        unit_code: d.unit_code,
        qty_milli: d.qty ? String(Math.round(Number(d.qty) * 1000)) : "0",
      }));

  const previewNow = useCallback(async (): Promise<Preview | null> => {
    if (!supplier) return null;
    const body = { supplier_id: supplier, lines: lines(), confirmed };
    const { data, response } = await api().POST("/api/inventory/purchasing/orders/preview", {
      body: body as never,
    });
    if (response.status === 403) {
      setDenied(true);
      return null;
    }
    const p = data as unknown as Preview | undefined;
    if (response.ok && p) {
      setPreview(p);
      return p;
    }
    return null;
  }, [supplier, drafts, confirmed]);

  const refresh = previewNow;

  useEffect(() => {
    const t = setTimeout(() => void refresh().catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const setDraft = (key: number, patch: Partial<Draft>) => {
    setAttempted(false);
    setConfirmed(false);
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const addLine = () =>
    setDrafts((ds) => [
      ...ds,
      { key: (ds.at(-1)?.key ?? 0) + 1, item_id: "", unit_code: "", qty: "" },
    ]);

  const save = async () => {
    if (phase !== "idle") return;
    setAttempted(true);
    // نسأل قبل الحفظ لا بعده: معاينة طازجة بما كُتب الآن
    const fresh = await previewNow().catch(() => null);
    if ((fresh ?? preview)?.errors.length) return;
    setPhase("saving");
    try {
      const { data, response } = await api().POST("/api/inventory/purchasing/orders", {
        body: { supplier_id: supplier, lines: lines(), confirmed } as never,
      });
      const body = data as unknown as { order: Order } | undefined;
      if (!response.ok || !body) return;
      setPhase("sending");
      const s = await api().POST("/api/inventory/purchasing/orders/{order_id}/{action}", {
        params: { path: { order_id: body.order.id, action: "send" } },
        body: {} as never,
      });
      const sb = (s.data ?? (s.error as unknown as { extra?: { order?: Order } })?.extra) as
        { order?: Order } | undefined;
      setSaved(sb?.order ?? body.order);
    } finally {
      setPhase("idle");
    }
  };

  const resend = async () => {
    if (!saved) return;
    setPhase("sending");
    try {
      const s = await api().POST("/api/inventory/purchasing/orders/{order_id}/{action}", {
        params: { path: { order_id: saved.id, action: "send" } },
        body: {} as never,
      });
      const sb = (s.data ?? (s.error as unknown as { extra?: { order?: Order } })?.extra) as
        { order?: Order } | undefined;
      if (sb?.order) setSaved(sb.order);
    } finally {
      setPhase("idle");
    }
  };

  const errors = preview?.errors ?? [];
  const errorAt = (i: number) => errors.find((e) => e.line === i);
  const state: State =
    phase !== "idle"
      ? "saving"
      : saved
        ? "success"
        : attempted && errors.length
          ? "validation_error"
          : "ready";

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const supplierName = suppliers.find((s) => s.id === supplier)?.name ?? "";
  const lineIndex = (key: number) =>
    drafts.filter((d) => d.item_id).findIndex((d) => d.key === key);

  return (
    <Frame title="المشتريات" nav={<AppNav currentId="purchasing" />} footer={null}>
      <div className="sys pur" data-screen="PUR-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              إنشاء أمر شراء — الوحدة التي تشتري بها لا التي تبيع بها
            </h2>
            <span className="cat-head__hint">
              تطلب كراتين وتبيع أكياساً. الأمر يُكتب بوحدة الشراء ويُعرض معه المكافئ بوحدة البيع،
              فلا يصل عشرة أضعاف ما أردت.
            </span>
          </div>
          <div className="acc-card__body">
            {denied ? (
              <Notice kind="locked" title="الإنشاء للمالك والمحاسب">
                <p className="acc-lead">
                  الإنشاء والإلغاء التزام مالي — أمين المخزن يرى ولا يُنشئ.
                </p>
              </Notice>
            ) : null}

            {state === "saving" ? (
              <Notice kind="info" title="جارٍ الحفظ والإرسال">
                <p className="acc-lead">
                  الحفظ والإرسال فعلان منفصلان يظهران منفصلين: يُحفظ الأمر أولاً، ثم يُرسل للمورد.
                  {phase === "saving" ? " — يُحفظ الآن." : " — حُفظ، ويُرسل الآن."}
                </p>
                <p className="acc-lead">
                  <strong>لو فشل الإرسال</strong> · الأمر محفوظ ومُعلَّم «لم يُرسل» مع زرّ إعادة. لا
                  نُرجع المستخدم إلى نموذج فارغ بعد دقيقة عمل.
                </p>
                <p className="acc-choice__note">
                  الأزرار معطّلة والصفحة لا تُغادَر — والإلغاء متاح قبل الإرسال لا بعده.
                </p>
              </Notice>
            ) : null}

            {state === "success" && saved ? (
              <Notice
                kind={saved.status === "unsent" ? "warning" : "success"}
                title={
                  saved.status === "unsent"
                    ? `حُفظ الأمر ${saved.number} ولم يُرسل`
                    : `أُرسل الأمر ${saved.number}`
                }
                action={
                  saved.status === "unsent" ? (
                    <Button pos onClick={() => void resend()}>
                      أعد الإرسال
                    </Button>
                  ) : (
                    <Button pos onClick={() => router.push(`/purchasing/orders/${saved.id}`)}>
                      تابع الأمر
                    </Button>
                  )
                }
              >
                <p className="acc-lead">
                  {saved.status === "unsent"
                    ? "الأمر محفوظ ومُعلَّم «لم يُرسل» مع زرّ إعادة. لا نُرجع المستخدم إلى نموذج فارغ بعد دقيقة عمل."
                    : "الأمر محفوظ ومُرسل. لم يتحرّك مخزون ولا ذمّة — وهذا مكتوب في شاشة النجاح لا مفترضاً."}
                </p>
                <p className="acc-lead">
                  <strong>ما تغيّر</strong> · أمر مفتوح في «أوامر الشراء» ينتظر الاستلام.
                </p>
                <p className="acc-lead">
                  <strong>ما لم يتغيّر</strong> · الرصيد والتكلفة والذمّة كما كانت. تتحرّك عند
                  اعتماد مستند الشراء.
                </p>
                <p className="acc-choice__note">
                  المسار التالي واحد وواضح: «تابع الأمر» — لا ثلاثة أزرار متساوية.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="warning" title="كمية بلا وحدة شراء">
                {errors.map((e) => (
                  <p key={`${e.line}-${e.code}`} className="acc-lead">
                    {e.code === "unit_required" ? (
                      <>
                        صنف {e.item_name ? `«${e.item_name}»` : ""} أُضيف بكمية{" "}
                        <span className="sting-mono">{formatQty(e.qty_milli ?? "0", 0)}</span> ولم
                        تُختر وحدته. <strong>الوحدة</strong> ·{" "}
                        <span className="sting-mono">{formatQty(e.qty_milli ?? "0", 0)}</span> ماذا:
                        كيساً أم كرتوناً. الفرق عشرة أضعاف، ويظهر يوم الاستلام لا اليوم.
                      </>
                    ) : e.code === "supplier_mismatch" ? (
                      <>
                        <strong>المورد</strong> · «{supplierName}» لا يورّد {e.item_name}. لا نمنع —
                        قد يكون توريداً جديداً — لكن نسأل قبل الحفظ لا بعده.{" "}
                        <Button variant="secondary" onClick={() => setConfirmed(true)}>
                          نعم، توريد جديد
                        </Button>
                      </>
                    ) : e.code === "qty_required" ? (
                      <>الكمية مطلوبة لـ{e.item_name ?? "الصنف"}.</>
                    ) : (
                      <>سطر غير صالح.</>
                    )}
                  </p>
                ))}
                <p className="acc-choice__note">
                  السطر الخاطئ وحده يُعلَّم؛ السطور الصحيحة تبقى كما كُتبت.
                </p>
              </Notice>
            ) : null}

            {!denied && !saved ? (
              <div className="cat-form">
                <h3 className="cat-head__title">
                  أمر جديد{supplierName ? ` — ${supplierName}` : ""}
                </h3>
                <SelectField
                  label="المورد"
                  value={supplier}
                  onChange={(e) => {
                    setSupplier(e.target.value);
                    setConfirmed(false);
                    setAttempted(false);
                  }}
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">الكمية ووحدة الشراء</th>
                      <th scope="col">المكافئ بوحدة البيع</th>
                      <th scope="col">سعر تقديري</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => {
                      const it = itemOf(d.item_id);
                      const idx = lineIndex(d.key);
                      const err = idx >= 0 ? errorAt(idx) : undefined;
                      const pl =
                        idx >= 0 ? preview?.lines.find((l) => l.item_id === d.item_id) : undefined;
                      return (
                        <tr
                          key={d.key}
                          className={err && attempted ? "pur-line--error" : undefined}
                        >
                          <td>
                            <SelectField
                              label="الصنف"
                              value={d.item_id}
                              onChange={(e) =>
                                setDraft(d.key, { item_id: e.target.value, unit_code: "" })
                              }
                              options={[
                                { value: "", label: "— اختر —" },
                                ...items.map((i) => ({ value: i.id, label: i.name })),
                              ]}
                            />
                            {pl && pl.balance_milli ? (
                              <div className="acc-choice__note">
                                رصيد{" "}
                                <span className="sting-mono">
                                  {formatQty(pl.balance_milli, pl.base_decimal_places)}
                                </span>{" "}
                                {pl.base_unit_name}
                                {pl.days_of_stock !== null
                                  ? ` · يكفي ${daysWord(pl.days_of_stock)}`
                                  : ""}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <TextField
                              label="الكمية"
                              mono
                              value={d.qty}
                              onChange={(e) => setDraft(d.key, { qty: e.target.value })}
                              error={
                                err?.code === "qty_required" && attempted
                                  ? "الكمية مطلوبة"
                                  : undefined
                              }
                            />
                            <SelectField
                              label="وحدة الشراء"
                              value={d.unit_code}
                              onChange={(e) => setDraft(d.key, { unit_code: e.target.value })}
                              error={
                                err?.code === "unit_required" && attempted
                                  ? "اختر الوحدة"
                                  : undefined
                              }
                              options={[
                                { value: "", label: "— الوحدة —" },
                                ...(it
                                  ? [
                                      ...it.units.map((u) => ({ value: u.code, label: u.name })),
                                      { value: it.base_unit_code, label: it.base_unit_name },
                                    ]
                                  : []),
                              ]}
                            />
                          </td>
                          <td>
                            {pl ? (
                              <>
                                <span className="sting-mono">
                                  = {formatQty(pl.base_qty_milli, pl.base_decimal_places)}
                                </span>{" "}
                                {pl.base_unit_name}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="sting-mono">
                            {pl?.est_total_minor ? formatMinor(pl.est_total_minor) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="cat-form__actions">
                  <Button variant="secondary" onClick={addLine}>
                    أضف صنفاً
                  </Button>
                </div>
                <p className="acc-lead">
                  <strong>تقديري</strong> ·{" "}
                  <span className="sting-mono">
                    {preview?.estimated_total_minor
                      ? formatMinor(preview.estimated_total_minor)
                      : "—"}
                  </span>
                  {preview?.estimated_partial ? " (صنف بلا سعر شراء معروف)" : ""}
                </p>
                <p className="acc-choice__note">
                  المجموع تقديري من آخر أسعار الشراء. الفاتورة قد تخالفه، والتكلفة تتبع الفاتورة لا
                  هذا الرقم.
                </p>
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => void save()}
                    loading={phase !== "idle"}
                    disabledReason={
                      !supplier
                        ? "اختر المورد"
                        : lines().length === 0
                          ? "أضف صنفاً واحداً على الأقل"
                          : undefined
                    }
                  >
                    حفظ وإرسال
                  </Button>
                  <Button variant="secondary" onClick={() => router.push("/purchasing/orders")}>
                    إلغاء
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
