"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
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
import { agoParts, dayMonth } from "@/features/home/format";
import { readArea, readSnapshot, writeArea, writeSnapshot } from "@/features/market/market-store";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State = "loading" | "ready" | "empty" | "offline" | "stale";

export interface SupplierCard {
  tenant_id: string;
  public_name: string;
  category_line: string;
  categories: string[];
  service_areas: string[];
  fulfilment: string[];
  offers_count: number;
  badge: "verified" | "none";
  badge_label: string;
}

export interface OfferCard {
  id: string;
  seller_tenant_id: string;
  seller_name: string;
  public_name: string;
  unit_name: string;
  pack_label: string;
  price_minor: string;
  price_line: string;
  availability: string;
  confirmed_until: string;
  min_order_qty: number | null;
}

interface Home {
  area: string;
  areas: { name: string; suppliers: number }[];
  q: string;
  suppliers: SupplierCard[];
  offers_by_unit: { unit_name: string; offers: OfferCard[] }[];
  offers_count: number;
  suppliers_count: number;
  fetched_at: string;
}

const SNAP = "market.home";
const offersWord = (n: number) =>
  n === 1 ? "عرض واحد" : n === 2 ? "عرضان" : n <= 10 ? `${n} عروض` : `${n} عرضاً`;
const suppliersWord = (n: number) =>
  n === 1 ? "مورد واحد" : n === 2 ? "موردان" : n <= 10 ? `${n} موردين` : `${n} مورداً`;

/** «قبل 22 دقيقة» — الرقم في mono والكلمة خارجه */
function Ago({ iso }: { iso: string }) {
  const p = agoParts(iso);
  const unit = p.unit === "minute" ? "دقيقة" : p.unit === "hour" ? "ساعة" : "يوم";
  return (
    <>
      قبل <span className="sting-mono">{p.n}</span> {unit}
    </>
  );
}

function untilWord(dateIso: string): string {
  const { day, month } = dayMonth(`${dateIso}T12:00:00`);
  return `${day} ${month}`;
}

/** MP-01 — رئيسية السوق (47-D38 S-06 ready · 12-D7 empty · 43-D35 loading/offline/stale): بلا حساب، الخاص يبقى خاصاً. */
export function MarketHomeClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Home | null>(null);
  const [snapshot, setSnapshot] = useState<{ at: string; data: Home } | null>(null);
  const [failed, setFailed] = useState(false);
  const [pickArea, setPickArea] = useState(false);
  const signedIn = Boolean(app.tokens && app.session.tenantId);

  useEffect(() => {
    setArea(readArea());
    setSnapshot(readSnapshot<Home>(SNAP));
  }, []);

  const load = useCallback(async (a: string, query: string) => {
    setFailed(false);
    try {
      const { data, response } = await api().GET("/api/public/market", {
        params: { query: { area: a, q: query } },
      });
      const body = data as unknown as Home | undefined;
      if (response.ok && body) {
        setData(body);
        writeSnapshot(SNAP, body);
        setSnapshot({ at: new Date().toISOString(), data: body });
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => void load(area, q), 120);
    return () => clearTimeout(t);
  }, [area, q, online, load]);

  const shown = data ?? (failed || !online ? (snapshot?.data ?? null) : null);
  const state: State =
    !online && !shown
      ? "offline"
      : !online || (failed && shown)
        ? "stale"
        : !shown
          ? "loading"
          : shown.suppliers.length === 0
            ? "empty"
            : "ready";
  const areaLabel = area || "كل المناطق";

  return (
    <Frame title="السوق" footer={null}>
      <div className="sys mp cus" data-screen="MP-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">السوق{area ? ` — ${area}` : ""}</h2>
            <span className="cat-head__hint">
              المنطقة: {areaLabel} —{" "}
              <Button variant="quiet" onClick={() => setPickArea((v) => !v)}>
                بدِّلها
              </Button>{" "}
              · بحثٌ بالاسم أو الصنف
            </span>
          </div>
          <div className="acc-card__body">
            {signedIn ? (
              <div className="pub-nav" aria-label="أقسام السوق">
                <Button variant="secondary" onClick={() => router.push("/market/directory")}>
                  المنشآت
                </Button>
                <Button variant="secondary" onClick={() => router.push("/market")}>
                  المنتجات
                </Button>
                <Button variant="secondary" onClick={() => router.push("/market/orders")}>
                  طلباتي
                </Button>
                <Button variant="secondary" onClick={() => router.push("/market/following")}>
                  المتابَعون
                </Button>
                <Button variant="quiet" onClick={() => router.push("/market/offers")}>
                  عروضي
                </Button>
                <Button variant="quiet" onClick={() => router.push("/market/customer-orders")}>
                  طلبات العملاء
                </Button>
              </div>
            ) : null}
            {pickArea && shown ? (
              <div className="pos-chips" role="group" aria-label="المنطقة">
                <button
                  type="button"
                  className={`pos-chip${!area ? " pos-chip--on" : ""}`}
                  onClick={() => {
                    setArea("");
                    writeArea("");
                    setPickArea(false);
                  }}
                >
                  كل المناطق
                </button>
                {shown.areas.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    className={`pos-chip${area === a.name ? " pos-chip--on" : ""}`}
                    onClick={() => {
                      setArea(a.name);
                      writeArea(a.name);
                      setPickArea(false);
                    }}
                  >
                    {a.name} — <span className="sting-mono">{a.suppliers}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <TextField
              label="ابحث عن صنف أو مورد"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            {state === "loading" ? (
              <Notice kind="info" title="العروض تَرِد">
                <p className="acc-lead">
                  الهيكل والفئات فوراً، والعروض المنشورة تلحق. لا يُعرض إلا المنشور المؤكَّد.
                </p>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Notice kind="offline" title="السوق يحتاج اتصالاً">
                <p className="acc-lead">بخلاف POS — أسعار الآخرين لا تُخزَّن صادقةً على جهازك.</p>
                <p className="acc-choice__note">
                  <strong>نقولها ونحفظ العمل</strong> · «السوق يعمل بالاتصال» مع ما يبقى متاحاً:
                  مسودات سلتك (ORD-01) وطلباتك المحفوظة. صفحةٌ بيضاء تُقرأ عطلاً في التطبيق كله.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && snapshot ? (
              <Notice kind="warning" title="عروض من آخر جلب">
                <p className="acc-lead">
                  الاتصال متقطع والمعروض من الكاش — <Ago iso={snapshot.at} />.
                </p>
                <p className="acc-choice__note">
                  <strong>الصلاحية مع كل عرض</strong> · عرضٌ انتهت صلاحيته في الكاش يسقط من العرض
                  ولا يُعرض بسعره القديم — التأكيد الخادمي وحده يجعل السعر حالياً (ACC-143).
                </p>
              </Notice>
            ) : null}
            {state === "empty" && shown ? (
              <Notice kind="empty" title={`لا موردين ينشرون في ${area || "منطقتك"} بعد`}>
                <p className="acc-lead">
                  هذه حقيقة عن السوق لا خطأ في بحثك ولا عطل عندنا. السوق يُبنى منطقة منطقة، ومنطقتك
                  لم يصلها مورد ناشر حتى الآن.
                </p>
                <p className="acc-lead">
                  لن نعرض لك موردي الخرطوم كأنهم خيار: التوصيل خارج منطقتهم ليس منشوراً، وعرض ما لا
                  يُنفَّذ إهدار لوقتك.
                </p>
                <ul className="pub-list">
                  <li>
                    <span className="pub-mark">•</span>
                    <span>
                      <strong>اطلب من مورد تعرفه أن ينشر</strong>
                      <br />
                      رابط دعوة تُرسله بنفسك. لن ندعو أحداً باسمك ولن ننشئ له ملفاً — ACC-118.
                    </span>
                  </li>
                  <li>
                    <span className="pub-mark">•</span>
                    <span>
                      <strong>أبلغنا بالمنطقة لنعرف أين نعمل</strong>
                      <br />
                      طلبك يُحتسب في تخطيط التوسّع ولا يُترجم وعداً بموعد.
                    </span>
                  </li>
                  <li>
                    <span className="pub-mark">•</span>
                    <span>
                      <strong>سجّل مورديك في دفترك المحلي</strong>
                      <br />
                      PTY-02 يعمل بلا سوق: ذمم وطلبات ومستندات بينك وبينهم بلا حاجة إلى وجودهم هنا.
                    </span>
                  </li>
                </ul>
              </Notice>
            ) : null}

            {shown && shown.suppliers.length ? (
              <>
                <p className="acc-choice__note">
                  {offersWord(shown.offers_count)} · {suppliersWord(shown.suppliers_count)} ·
                  الترتيب داخل كل وحدة على حدة — لا «الأرخص» عبر وحدات مختلفة.
                </p>
                <ul className="cus-list">
                  {shown.suppliers.map((s) => (
                    <li key={s.tenant_id}>
                      <Button
                        variant="quiet"
                        onClick={() => router.push(`/market/suppliers/${s.tenant_id}`)}
                      >
                        {s.public_name}
                      </Button>
                      <div className="cus-sub">
                        {[s.category_line, s.fulfilment[0]].filter(Boolean).join(" · ")} ·{" "}
                        {offersWord(s.offers_count)}
                      </div>
                      <Status
                        state={s.badge === "verified" ? "success" : "stale"}
                        label={s.badge === "verified" ? "متحقَّقة" : "بلا شارة"}
                      />
                    </li>
                  ))}
                </ul>
                {shown.offers_by_unit.map((g) => (
                  <div key={g.unit_name}>
                    <h3 className="cat-head__title">{g.unit_name}</h3>
                    <ul className="cus-list">
                      {g.offers.map((o) => (
                        <li key={o.id}>
                          <Button
                            variant="quiet"
                            onClick={() => router.push(`/market/offers/public/${o.id}`)}
                          >
                            {o.public_name}
                          </Button>
                          <div className="cus-sub">
                            {[o.pack_label, o.seller_name].filter(Boolean).join(" · ")}
                          </div>
                          <div>
                            {o.price_minor ? (
                              <>
                                <span className="sting-mono">{formatMinor(o.price_minor)}</span>{" "}
                                <Status state="success" label="مؤكد" />
                                {o.confirmed_until
                                  ? ` مؤكَّد حتى ${untilWord(o.confirmed_until)}`
                                  : ""}
                              </>
                            ) : (
                              <>
                                {o.price_line} · {o.availability} — بسعرٍ عند الطلب
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </div>

        {!signedIn ? (
          <div className="cat-table pos-card">
            <div className="acc-card__body">
              <div className="acc-actions">
                <Button pos onClick={() => router.push("/welcome")}>
                  أنشئ حساب سوق مجاناً
                </Button>
                <Button variant="quiet" onClick={() => router.push("/")}>
                  تعرَّف على Sting
                </Button>
              </div>
              <p className="acc-choice__note">
                حساب السوق مجاني ولا يشترط شراء POS (§١٤.٦) — ولا يُحتسب اشتراك إدارة مدفوعاً.
              </p>
              <p className="acc-choice__note">
                <strong>الخاص يبقى خاصاً</strong> · لا سعر شريحة ولا قائمة خاصة في أي عرضٍ عام، ولو
                فُتح الرابط من هاتف مشترٍ مخوَّل (ACC-150 · ACC-121).
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}
