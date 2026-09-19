"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
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
import { readCart, writeCart } from "@/features/market/cart-store";
import type { CartLine } from "@/features/market/offer-detail-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State = "ready" | "empty" | "offline" | "validation_error" | "stale";

export interface VerifiedLine {
  offer_id: string;
  seller_tenant_id?: string;
  seller_name?: string;
  public_name?: string;
  pack_label?: string;
  unit_name: string;
  qty: number;
  draft_price_minor: string;
  current_price_minor: string;
  changed: boolean;
  expired: boolean;
  status: "confirmed" | "expired" | "withdrawn";
  confirmed_at?: string;
  valid_until?: string;
  min_order_qty: number | null;
  short: number;
  fees_decided?: boolean;
  fees_label?: string;
  currency?: string;
  supplier_suspended?: boolean;
}

const PLURALS: Record<string, string> = {
  كرتونة: "كراتين",
  كيس: "أكياس",
  علبة: "علب",
  قطعة: "قطع",
  حبة: "حبات",
  جوال: "جوالات",
  صندوق: "صناديق",
};

/** «6 كراتين» (3–10 بالجمع) و«12 كرتونة» (11+ بالمفرد) و«كرتونتان» — كما يقولها التاجر. */
export const unitsWord = (n: number, unit: string) => {
  if (n === 1) return `${unit} واحدة`;
  if (n === 2) return `${unit.replace(/ة$/, "ت")}ان`;
  if (n >= 3 && n <= 10) return `${n} ${PLURALS[unit] ?? unit}`;
  return `${n} ${unit}`;
};

/** ORD-01 — سلة ومسودة طلب (41-D33 ready/empty/validation_error/stale · 08-D4 offline): كل مورد اتفاقٌ منفصل ولا مجموع كلّي. */
export function CartClient() {
  const router = useRouter();
  const online = useOnline();
  const app = useApp();
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [verified, setVerified] = useState<Record<string, VerifiedLine>>({});
  const [saved, setSaved] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const verify = useCallback(async (ls: CartLine[]) => {
    if (!ls.length) return;
    try {
      const { data, response } = await api().POST("/api/market/orders/verify", {
        body: {
          lines: ls.map((l) => ({ offer_id: l.offer_id, qty: l.qty, price_minor: l.price_minor })),
        } as never,
      });
      const body = data as unknown as { lines: VerifiedLine[] } | undefined;
      if (response.ok && body) {
        const map: Record<string, VerifiedLine> = {};
        for (const v of body.lines) map[v.offer_id] = v;
        setVerified(map);
      }
    } catch {
      // بلا اتصال: المسودة كما هي — لا تقدير محلي
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Fcart");
      return;
    }
    const cart = readCart();
    setLines(cart.lines);
    setSavedAt(cart.at);
    if (navigator.onLine) void verify(cart.lines);
  }, [router, verify]);

  const update = (next: CartLine[]) => {
    setLines(next);
    writeCart(next);
    setSavedAt(new Date().toISOString());
    setSaved(false);
  };
  const setQty = (id: string, qty: number) =>
    update((lines ?? []).map((l) => (l.offer_id === id ? { ...l, qty: Math.max(0, qty) } : l)));
  const remove = (id: string) => update((lines ?? []).filter((l) => l.offer_id !== id));
  const acceptPrice = (id: string) => {
    const v = verified[id];
    if (!v) return;
    update(
      (lines ?? []).map((l) =>
        l.offer_id === id
          ? { ...l, price_minor: v.current_price_minor, unit_name: v.unit_name }
          : l,
      ),
    );
  };

  const groups = new Map<string, CartLine[]>();
  for (const l of lines ?? []) {
    const g = groups.get(l.seller_tenant_id) ?? [];
    g.push(l);
    groups.set(l.seller_tenant_id, g);
  }
  const changedLines = (lines ?? []).filter((l) => verified[l.offer_id]?.changed);
  const unitMismatch = (lines ?? []).filter((l) => {
    const v = verified[l.offer_id];
    return v && !v.expired && v.unit_name && v.unit_name !== l.unit_name;
  });
  const shortOf = (ls: CartLine[]) =>
    ls.reduce((acc, l) => {
      const v = verified[l.offer_id];
      const min = v?.min_order_qty ?? l.min_order_qty ?? 0;
      return acc + Math.max(0, min - l.qty);
    }, 0);
  const anyShort = [...groups.values()].some((ls) => shortOf(ls) > 0);

  const state: State =
    lines && lines.length === 0
      ? "empty"
      : !online
        ? "offline"
        : changedLines.length
          ? "stale"
          : anyShort || unitMismatch.length
            ? "validation_error"
            : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-cart" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {state === "offline"
                ? "سلة ومسودة طلب بلا اتصال — لا تأكيد محلي"
                : "سلة ومسودة طلب — كل مورد اتفاقٌ منفصل"}
            </h2>
            <span className="cat-head__hint">
              {state === "offline"
                ? "ACC-123: المسودة تُحفظ محلياً، والإرسال يحتاج شبكة، وتغيّر السعر يحتاج موافقتك بعد الاتصال."
                : "السلة مقسومة بالمورد: لكل قسم حدّه الأدنى ورسومه وشروط تنفيذه، ولكل قسم زرّ إرسال مستقل. الإرسال يُنشئ طلباً لكل مورد (ACC-126)."}
            </span>
          </div>
          <div className="acc-card__body">
            {state === "empty" ? (
              <Notice kind="empty" title="سلة فارغة">
                <p className="acc-lead">حالةٌ سويّة — الشراء من السوق ليس عملاً يومياً.</p>
                <p className="acc-choice__note">
                  <strong>المسار</strong> · «ابحث في السوق» (MP-04) أو «موردون تتابعهم» (MP-06). ولا
                  اقتراح إعادة توريد: ذاك GROW-01 وهو مؤجَّل إلى M4.
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push("/market/search")}>
                    ابحث في السوق
                  </Button>
                  <Button onClick={() => router.push("/market/following")}>موردون تتابعهم</Button>
                </div>
              </Notice>
            ) : null}

            {state === "offline" ? (
              <Notice kind="warning" title="بلا اتصال">
                <p className="acc-lead">
                  السلة —{" "}
                  {groups.size === 1
                    ? "مورد واحد"
                    : groups.size === 2
                      ? "موردان"
                      : `${groups.size} موردين`}{" "}
                  · آخر تحديث <span className="sting-mono">{savedAt ? hhmm(savedAt) : "—"}</span>
                </p>
                <p className="acc-choice__note">
                  <strong>ما يعمل الآن بلا اتصال:</strong> تعديل الكميات، حفظ المسودة، مقارنة ما هو
                  محمَّل.
                </p>
                <p className="acc-choice__note">
                  <strong>ما لا يعمل:</strong> إرسال الطلب، التحقق من السعر الحالي، الاطلاع على توفر
                  جديد. لن نعطيك رقم طلب محلياً لأن الرقم يعني أن المورد استلم، وهو لم يستلم.
                </p>
                <div className="acc-actions">
                  <Button
                    pos
                    onClick={() => {
                      update(lines ?? []);
                      setSaved(true);
                    }}
                  >
                    حفظ المسودة على الجهاز
                  </Button>
                  <Button disabledReason="الإرسال معطَّل حتى يعود الاتصال. لا رقم طلب قبل وصوله للمورد.">
                    إرسال — يحتاج اتصالاً
                  </Button>
                  {saved ? <Status state="saved_local" label="حُفظت المسودة" /> : null}
                </div>
              </Notice>
            ) : null}

            {state === "stale" ? (
              <Notice kind="warning" title="السعر تغيّر بعد المسودة">
                <p className="acc-lead">
                  المسودة أُعدّت بلا اتصال، والعرض جُدِّد بسعر آخر قبل الإرسال.
                </p>
                <p className="acc-choice__note">
                  <strong>لا تأكيد محلي</strong> · المسودة لا تُثبّت سعراً (ACC-123). السعر يُثبت
                  بقبول المورد لا بحفظ المشتري.
                </p>
                <p className="acc-choice__note">
                  <strong>الموافقة صريحة</strong> · يُعرض السعران القديم والجديد والفرق، ويُطلب
                  قبولٌ سطراً سطراً. الترقية الصامتة للسعر سرقةٌ بالسهو.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="warning" title="وحدة أو حدٌّ أدنى غير مستوفى">
                <p className="acc-lead">
                  {anyShort && unitMismatch.length
                    ? "قسمٌ تحت حدّه الأدنى، وصنفٌ مطلوب بوحدة والعرض بوحدة أخرى."
                    : anyShort
                      ? "قسمٌ تحت حدّه الأدنى — الحدّ يُعرض بالفارق لا بالرفض."
                      : "صنفٌ مطلوب بوحدة والعرض بوحدة أخرى."}
                </p>
                <p className="acc-choice__note">
                  <strong>لا مقارنة بالوحدة المختلفة</strong> · كرتونة 12 عند مورد و24 عند آخر لا
                  تُقارَن بالسعر (ACC-122). نعرض السعر للوحدة الأساسية ونسمّي الفرق.
                </p>
                <p className="acc-choice__note">
                  <strong>الحدّ الأدنى يُعرض بالفارق</strong> · «ناقص 340 للوصول إلى الحدّ» لا
                  «الطلب مرفوض» — المشتري يحتاج المسافة لا الرفض.
                </p>
              </Notice>
            ) : null}

            {[...groups.entries()].map(([sid, ls]) => {
              const first = ls[0];
              if (!first) return null;
              const short = shortOf(ls);
              const minMax = Math.max(
                ...ls.map((l) => verified[l.offer_id]?.min_order_qty ?? l.min_order_qty ?? 0),
              );
              const fees = verified[first.offer_id]?.fees_label ?? first.fees_label ?? "";
              const subtotal = ls.reduce((acc, l) => acc + l.qty * Number(l.price_minor || 0), 0);
              const blocked =
                ls.some((l) => verified[l.offer_id]?.changed || verified[l.offer_id]?.expired) ||
                short > 0;
              return (
                <div key={sid} className="mp-preview-card pos-card">
                  <div className="acc-choice__head">
                    <strong>{first.seller_name}</strong>
                    <span className="acc-choice__note">
                      {minMax
                        ? `حد أدنى ${unitsWord(minMax, first.unit_name || "وحدة")}`
                        : "بلا حدّ أدنى"}
                      {fees ? ` · ${fees}` : ""}
                    </span>
                  </div>
                  <table className="pur-lines">
                    <thead>
                      <tr>
                        <th scope="col">الصنف</th>
                        <th scope="col">الكمية</th>
                        <th scope="col">السعر</th>
                        <th scope="col">الحال</th>
                        <th scope="col">
                          <span className="visually-hidden">إجراء</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ls.map((l) => {
                        const v = verified[l.offer_id];
                        const minQ = v?.min_order_qty ?? l.min_order_qty ?? 0;
                        const lineShort = Math.max(0, minQ - l.qty);
                        return (
                          <tr
                            key={l.offer_id}
                            className={v?.expired ? "cus-item--expired" : undefined}
                          >
                            <td>
                              <strong>{l.public_name}</strong>
                              <div className="mp-check__hint">{l.pack_label || l.unit_name}</div>
                            </td>
                            <td>
                              <TextField
                                label={`الكمية — ${l.public_name}`}
                                kind="number"
                                mono
                                value={String(l.qty)}
                                onChange={(e) => setQty(l.offer_id, Number(e.target.value))}
                              />
                              {lineShort ? (
                                <div className="mp-reason">
                                  ناقص <span className="sting-mono">{lineShort}</span> للوصول إلى
                                  الحدّ
                                </div>
                              ) : null}
                            </td>
                            <td>
                              {l.price_minor ? (
                                <span className="sting-mono">{formatMinor(l.price_minor)}</span>
                              ) : (
                                "بلا سعر"
                              )}
                              {v?.changed ? (
                                <div className="mp-reason">
                                  الجديد{" "}
                                  <span className="sting-mono">
                                    {formatMinor(v.current_price_minor)}
                                  </span>{" "}
                                  · الفرق{" "}
                                  <span className="sting-mono">
                                    {formatMinor(
                                      String(
                                        Number(v.current_price_minor) - Number(l.price_minor || 0),
                                      ),
                                    )}
                                  </span>
                                </div>
                              ) : null}
                              {state === "offline" ? (
                                <div className="mp-check__hint">
                                  {l.price_minor ? (
                                    <>
                                      سعر محمَّل{" "}
                                      <span className="sting-mono">
                                        {savedAt ? hhmm(savedAt) : ""}
                                      </span>
                                    </>
                                  ) : (
                                    "سعر غير محمَّل"
                                  )}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              {v?.expired ? (
                                <Status state="expired" label="انتهى تأكيده — غير قابل للإرسال" />
                              ) : v?.changed ? (
                                <Button onClick={() => acceptPrice(l.offer_id)}>
                                  اقبل السعر الجديد
                                </Button>
                              ) : v && v.unit_name !== l.unit_name ? (
                                <Status
                                  state="stale"
                                  label={`الوحدة تغيّرت: ${l.unit_name} ← ${v.unit_name}`}
                                />
                              ) : v ? (
                                <Status state="success" label="مؤكد خادمياً" />
                              ) : (
                                <Status
                                  state="saved_local"
                                  label={l.price_minor ? "محمَّل" : "بلا سعر"}
                                />
                              )}
                            </td>
                            <td>
                              <Button variant="quiet" onClick={() => remove(l.offer_id)}>
                                أزل
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="acc-actions">
                    <span className="acc-choice__note">
                      مجموع القسم{" "}
                      <span className="sting-mono">{formatMinor(String(subtotal))}</span>{" "}
                      <span className="sting-mono">{first.currency}</span>
                      {short ? (
                        <>
                          {" "}
                          · ناقص <span className="sting-mono">{short}</span> للوصول إلى الحدّ
                        </>
                      ) : (
                        " · الحد الأدنى مستوفى بالكميات المحمَّلة. سيُعاد التحقق عند الإرسال."
                      )}
                    </span>
                    <Button
                      pos
                      onClick={() => router.push(`/market/checkout?supplier=${sid}`)}
                      disabledReason={
                        state === "offline"
                          ? "الإرسال معطَّل حتى يعود الاتصال. لا رقم طلب قبل وصوله للمورد."
                          : blocked
                            ? "أكمل الحدّ الأدنى واقبل الأسعار الجديدة أولاً"
                            : undefined
                      }
                    >
                      راجع وأرسل — {first.seller_name}
                    </Button>
                  </div>
                </div>
              );
            })}

            {lines && lines.length ? (
              <>
                <p className="acc-choice__note">
                  <strong>سلة بموردين</strong> · السلة مقسومة بالمورد: لكل قسم حدّه الأدنى ورسومه
                  وشروط تنفيذه، ولكل قسم زرّ إرسال مستقل.
                </p>
                <p className="acc-choice__note">
                  <strong>طلبان لا طلب</strong> · الإرسال يُنشئ طلباً لكل مورد (ACC-126). طلبٌ واحد
                  لموردين يعني مسؤوليةً مشتركة لا تقبلها منشأتان مستقلتان.
                </p>
                <p className="acc-choice__note">
                  <strong>لا مجموع كلّي</strong> · لا نعرض «إجمالي السلة» عبر الموردين: رقمٌ لا
                  يُدفع لأحد، ورسومُ كل مورد تُحسب على قسمه.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
