"use client";

import { Button, formatMinor, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { dayMonth } from "@/features/home/format";
import type { OfferCard } from "@/features/market/home-client";
import { readSnapshot, writeSnapshot } from "@/features/market/market-store";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State = "ready" | "empty" | "expired" | "permission_denied" | "stale";

interface Tier {
  min: number;
  max: number | null;
  price_minor: string;
  unit_price_minor: string;
  label: string;
}

export interface OfferDetail extends OfferCard {
  seller_badge: "verified" | "expired" | "suspended" | "none";
  seller_badge_label: string;
  description: string;
  unit_price_minor: string;
  base_unit_name: string;
  fees_decided: boolean;
  fees_label: string;
  audience: "public" | "private" | "followers";
  audience_label: string;
  currency: string;
  buyer_currency: string;
  currency_mismatch: boolean;
  confirmed_at: string;
  days_since_confirmed: number | null;
  valid_until: string;
  expired: boolean;
  withdrawn: boolean;
  tiers: Tier[];
  others: OfferCard[];
}

/** سطر في السلة المحلية — تُقرأ في ORD-01 (T3.10)؛ لا تُثبَّت إلا بعد تأكيد خادمي. */
export interface CartLine {
  offer_id: string;
  seller_tenant_id: string;
  seller_name: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  price_minor: string;
  currency: string;
  confirmed_at: string;
  valid_until: string;
  qty: number;
}

const CART = "market.cart";
const CURRENCY_NAME: Record<string, string> = {
  SDG: "الجنيه السوداني",
  EGP: "الجنيه المصري",
  SAR: "الريال السعودي",
  USD: "الدولار الأمريكي",
};
const currencyName = (code: string) => CURRENCY_NAME[code] ?? code;
const Until = ({ dateIso }: { dateIso: string }) => {
  const { day, month } = dayMonth(`${dateIso}T12:00:00`);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}
    </>
  );
};
const daysWord = (n: number) =>
  n === 0
    ? "اليوم"
    : n === 1
      ? "قبل يوم"
      : n === 2
        ? "قبل يومين"
        : n <= 10
          ? `قبل ${n} أيام`
          : `قبل ${n} يوماً`;

/** MP-05 — تفاصيل عرض (43-D35 ready/empty/permission_denied/stale · 08-D4 expired): حيث يقرَّر الشراء. */
export function OfferDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const online = useOnline();
  const app = useApp();
  const signedIn = Boolean(app.tokens && app.session.tenantId);
  const [o, setO] = useState<OfferDetail | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const snapKey = `market.offer.${id}`;

  const load = useCallback(async (): Promise<OfferDetail | null> => {
    setFailed(false);
    try {
      const { data, response } = await api().GET("/api/market/offers/public/{offer_id}", {
        params: { path: { offer_id: id } },
      });
      if (response.status === 404) {
        setDenied(true);
        return null;
      }
      const body = data as unknown as { offer: OfferDetail } | undefined;
      if (response.ok && body) {
        setO(body.offer);
        writeSnapshot(snapKey, body.offer);
        return body.offer;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    }
    return null;
  }, [id, snapKey]);

  useEffect(() => {
    setO(readSnapshot<OfferDetail>(snapKey)?.data ?? null);
    void load();
  }, [load, snapKey]);

  const addToCart = async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      // ACC-143: الإضافة تجلب تأكيداً خادمياً قبل التثبيت — المعروض من الكاش لا يُلزم أحداً
      const fresh = await load();
      if (!fresh || fresh.expired || fresh.withdrawn || fresh.currency_mismatch) return;
      const lines = readSnapshot<CartLine[]>(CART)?.data ?? [];
      const line: CartLine = {
        offer_id: fresh.id,
        seller_tenant_id: fresh.seller_tenant_id,
        seller_name: fresh.seller_name,
        public_name: fresh.public_name,
        pack_label: fresh.pack_label,
        unit_name: fresh.unit_name,
        price_minor: fresh.price_minor,
        currency: fresh.currency,
        confirmed_at: fresh.confirmed_at,
        valid_until: fresh.valid_until,
        qty: fresh.min_order_qty ?? 1,
      };
      writeSnapshot(CART, [...lines.filter((l) => l.offer_id !== fresh.id), line]);
      setAdded(true);
    } finally {
      setVerifying(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : o?.withdrawn
      ? "empty"
      : o?.expired
        ? "expired"
        : (!online || failed) && o
          ? "stale"
          : "ready";
  const blocked = o ? o.expired || o.currency_mismatch : false;

  return (
    <Frame title="السوق" footer={null}>
      <div className="sys mp cus" data-screen="MP-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تفاصيل عرض</h2>
            <span className="cat-head__hint">
              السعر بشروطه كاملة: السعر وصلاحيته المؤكَّدة، والحد الأدنى، والوحدة بتحويلها،
              والجمهور، وتاريخ آخر تأكيد من الناشر.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="empty" title="لم يعد هذا العرض متاحاً">
                <p className="acc-lead">لا عرض بهذا الرابط، أو لم يعد ضمن ما يُعرض لك.</p>
                <p className="acc-choice__note">
                  <strong>رفضٌ لا يصف</strong> · لا اسم ولا سعر — الصيغة نفسها لغير الموجود (ACC-60
                  · ACC-121).
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/search")}>ابحث في السوق</Button>
                </div>
              </Notice>
            ) : null}

            {state === "empty" && o ? (
              <>
                <Notice kind="empty" title="لم يعد هذا العرض متاحاً">
                  <p className="acc-lead">الناشر أخفاه أو حذفه بعد أن وصل الرابط.</p>
                  <p className="acc-choice__note">
                    <strong>لا نسخة قديمة</strong> · عرضُ آخر نسخة محفوظة يُغري بطلبٍ على سعرٍ لم
                    يعد قائماً.
                  </p>
                </Notice>
                <h3 className="cat-head__title">عروض الناشر القائمة — {o.seller_name}</h3>
                {o.others.length ? (
                  <ul className="cus-list">
                    {o.others.map((x) => (
                      <li key={x.id}>
                        <Button
                          variant="quiet"
                          onClick={() => router.push(`/market/offers/public/${x.id}`)}
                        >
                          {x.public_name}
                        </Button>
                        <div className="cus-sub">{x.pack_label}</div>
                        <div>
                          {x.price_minor ? (
                            <span className="sting-mono">{formatMinor(x.price_minor)}</span>
                          ) : (
                            x.price_line
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="acc-choice__note">لا عروض عامة قائمة للناشر الآن.</p>
                )}
                <div className="acc-actions">
                  <Button onClick={() => router.push(`/market/suppliers/${o.seller_tenant_id}`)}>
                    ملف الناشر
                  </Button>
                </div>
              </>
            ) : null}

            {o && state !== "empty" && state !== "permission_denied" ? (
              <>
                <div className="cus-head">
                  <div className="acc-actions">
                    {state === "expired" ? (
                      <Status state="expired" label="منتهي الصلاحية" />
                    ) : state === "stale" ? (
                      <Status state="stale" label="من الكاش — يحتاج تأكيداً" />
                    ) : (
                      <Status state="success" label="مؤكَّد خادمياً" />
                    )}
                    <Status state="synced" label={o.audience_label} />
                  </div>
                  <h1>
                    {o.public_name} — {o.pack_label || o.unit_name}
                  </h1>
                  <div className="cus-sub">
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/suppliers/${o.seller_tenant_id}`)}
                    >
                      {o.seller_name}
                    </Button>{" "}
                    ·{" "}
                    {o.seller_badge === "verified"
                      ? "شارة تحقق هوية فقط، لا ضمان جودة"
                      : o.seller_badge === "none"
                        ? "بلا شارة تحقق"
                        : o.seller_badge_label}
                  </div>
                </div>

                {state === "expired" ? (
                  <Notice kind="warning" title="انتهت صلاحية السعر">
                    <p className="acc-lead">هذا السعر لم يعد مؤكداً</p>
                    <p className="acc-choice__note">
                      صلاحية العرض انتهت {o.valid_until ? <Until dateIso={o.valid_until} /> : "—"}.
                      الوسم من الخادم — وإن تأخّر عامل الجدولة فبأثر رجعي (ACC-143). الرقم أدناه{" "}
                      <strong>آخر سعر معروف</strong> ولا يصلح لتأكيد طلب.
                    </p>
                  </Notice>
                ) : null}
                {state === "stale" ? (
                  <Notice kind="warning" title="صلاحية تحتاج تأكيداً">
                    <p className="acc-lead">المعروض من الكاش وصلاحيته على الحدّ.</p>
                    <p className="acc-choice__note">
                      <strong>الشراء يتحقق أولاً</strong> · زر الإضافة إلى السلة يجلب تأكيداً
                      خادمياً قبل التثبيت — انتهاء عامل الجدولة عند المنصة لا يجعل المنتهي سعراً
                      حالياً (ACC-143).
                    </p>
                  </Notice>
                ) : null}

                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">
                      {state === "expired" ? "آخر سعر معروف للعبوة" : "سعر العبوة"}
                    </div>
                    <div className="home-kpi__value">
                      {o.price_minor ? (
                        <>
                          <span className="sting-mono">{formatMinor(o.price_minor)}</span>{" "}
                          <span className="sting-mono">{o.currency}</span>
                        </>
                      ) : (
                        o.price_line
                      )}
                    </div>
                    <div className="home-kpi__note">
                      {o.unit_price_minor ? (
                        <>
                          <span className="sting-mono">{formatMinor(o.unit_price_minor)}</span>{" "}
                          <span className="sting-mono">{o.currency}</span> لكل {o.base_unit_name} ·{" "}
                          {o.fees_decided ? o.fees_label : "قبل رسوم التوصيل"}
                        </>
                      ) : (
                        o.availability
                      )}
                    </div>
                  </div>
                  {signedIn && o.buyer_currency ? (
                    <div className="home-kpi">
                      <div className="home-kpi__label">عملة حسابك</div>
                      <div className="home-kpi__value sting-mono">{o.buyer_currency}</div>
                      <div
                        className={
                          o.currency_mismatch
                            ? "home-kpi__note home-kpi__note--warn"
                            : "home-kpi__note"
                        }
                      >
                        {o.currency_mismatch
                          ? `العرض ب${currencyName(o.currency)}. لا نحوّل ضمناً.`
                          : "عملة العرض هي عملة حسابك."}
                      </div>
                    </div>
                  ) : null}
                </div>

                <dl className="mp-preview">
                  <dt>الحد الأدنى للطلب</dt>
                  <dd>
                    {o.min_order_qty != null ? (
                      <>
                        <span className="sting-mono">{o.min_order_qty}</span> {o.unit_name}
                      </>
                    ) : (
                      "بلا حدّ أدنى"
                    )}
                  </dd>
                  <dt>الوحدة وتحويلها</dt>
                  <dd>
                    {o.pack_label || o.unit_name}
                    {o.base_unit_name && o.base_unit_name !== o.unit_name
                      ? ` — سعر الوحدة يُحسب على ${o.base_unit_name}`
                      : ""}
                  </dd>
                  <dt>الرسوم والتوصيل</dt>
                  <dd>{o.fees_label}</dd>
                  <dt>الجمهور</dt>
                  <dd>{o.audience_label}</dd>
                  <dt>التوفر</dt>
                  <dd>{o.availability}</dd>
                  <dt>آخر تأكيد من الناشر</dt>
                  <dd>
                    {o.confirmed_at && o.days_since_confirmed != null ? (
                      <>
                        أكّده الناشر {daysWord(o.days_since_confirmed)}
                        {o.valid_until && !o.expired ? (
                          <>
                            {" "}
                            · يسري حتى <Until dateIso={o.valid_until} />
                          </>
                        ) : null}
                      </>
                    ) : (
                      "بلا تأكيد قائم — ينتظر تجديداً من الناشر"
                    )}
                  </dd>
                  {o.description ? (
                    <>
                      <dt>الوصف</dt>
                      <dd>{o.description}</dd>
                    </>
                  ) : null}
                </dl>

                {o.tiers.length ? (
                  <>
                    <h3 className="cat-head__title">شرائحك في القائمة الخاصة</h3>
                    <table className="pur-lines">
                      <thead>
                        <tr>
                          <th scope="col">الشريحة</th>
                          <th scope="col">سعر العبوة</th>
                          <th scope="col">سعر الوحدة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.tiers.map((t) => (
                          <tr key={t.label}>
                            <td>{t.label}</td>
                            <td className="sting-mono">{formatMinor(t.price_minor)}</td>
                            <td>
                              {t.unit_price_minor ? (
                                <>
                                  <span className="sting-mono">
                                    {formatMinor(t.unit_price_minor)}
                                  </span>{" "}
                                  /{o.base_unit_name}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}

                {blocked ? (
                  <Notice kind="warning" title="ممتنع">
                    <p className="acc-lead">
                      {o.expired && o.currency_mismatch
                        ? "التأكيد موقوف لسببين مستقلين."
                        : o.expired
                          ? "التأكيد موقوف: السعر منتهٍ."
                          : "التأكيد موقوف: عملة العرض تختلف عن عملة حسابك."}
                    </p>
                    <p className="acc-choice__note">
                      {o.expired && o.currency_mismatch
                        ? "السعر منتهٍ، وعملة العرض تختلف عن عملة حسابك. "
                        : ""}
                      {o.currency_mismatch
                        ? "لن نطبّق سعر صرف من عندنا لأن أي رقم نختاره سيصبح التزاماً مالياً بينك وبين المورد لم يتفق عليه أحد. اطلب تأكيداً جديداً يشمل العملة."
                        : "الناشر وحده يجدّد التأكيد بختم خادمي (MP-13) — لا سعر جديد بتأكيد قديم."}
                    </p>
                  </Notice>
                ) : null}

                <div className="acc-actions">
                  {blocked ? (
                    <>
                      <Button
                        pos
                        onClick={() => router.push(`/market/suppliers/${o.seller_tenant_id}`)}
                      >
                        {o.currency_mismatch
                          ? "طلب تأكيد سعر وعملة من المورد"
                          : "طلب تأكيد سعر من المورد"}
                      </Button>
                      <Button
                        disabledReason={
                          o.expired
                            ? "السعر منتهٍ ولا يصلح لتأكيد طلب"
                            : "عملة العرض تختلف عن عملة حسابك"
                        }
                      >
                        إضافة إلى السلة — غير متاح
                      </Button>
                    </>
                  ) : added ? (
                    <Status state="success" label="أُضيف إلى السلة بعد تأكيد خادمي" />
                  ) : (
                    <Button pos loading={verifying} onClick={() => void addToCart()}>
                      إضافة إلى السلة
                    </Button>
                  )}
                </div>
                <p className="acc-choice__note">
                  <strong>الشراء يتحقق أولاً</strong> · الإضافة تجلب تأكيداً خادمياً قبل التثبيت؛
                  سعرٌ بلا عمر يُقرأ لحظياً — وهذه شاشةُ قرارِ شراء.
                </p>
                <div className="acc-actions">
                  {signedIn ? (
                    <>
                      <Button
                        variant="quiet"
                        onClick={() => router.push(`/market/share?offer=${o.id}`)}
                      >
                        شارك الرابط
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => router.push(`/market/report?offer=${o.id}`)}
                      >
                        بلّغ عن هذا العرض
                      </Button>
                    </>
                  ) : null}
                  {o.expired ? (
                    <Button
                      variant="quiet"
                      onClick={() =>
                        router.push(
                          `/market/unavailable?supplier=${o.seller_tenant_id}&offer=${o.id}`,
                        )
                      }
                    >
                      ما يُمنع وما يبقى
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
