"use client";

import { Button, formatMinor, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import type { CartLine, OfferDetail } from "@/features/market/offer-detail-client";
import { readSnapshot } from "@/features/market/market-store";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "expired" | "permission_denied";

interface SupplierStatus {
  tenant_id: string;
  public_name: string;
  suspended: boolean;
  suspended_line: string;
  badge: string;
  badge_label: string;
  blocked: { title: string; detail: string }[];
  kept: { title: string; detail: string }[];
}

const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};

/** MP-14 — عرض منتهٍ أو منشأة معلَّقة (29-D22 expired/permission_denied · 43-D35 ready): منع الجديد دون محو السابق (ACC-135). */
export function UnavailableClient() {
  const router = useRouter();
  const params = useSearchParams();
  const supplier = params.get("supplier") ?? "";
  const offerId = params.get("offer") ?? "";
  const app = useApp();
  const signedIn = Boolean(app.tokens && app.session.tenantId);
  const [s, setS] = useState<SupplierStatus | null>(null);
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const cart = readSnapshot<CartLine[]>("market.cart")?.data ?? [];
    setLines(supplier ? cart.filter((l) => l.seller_tenant_id === supplier) : cart);
    void (async () => {
      if (supplier) {
        const { data, response } = await api().GET(
          "/api/public/market/suppliers/{tenant_id}/status",
          { params: { path: { tenant_id: supplier } } },
        );
        const body = data as unknown as { supplier: SupplierStatus } | undefined;
        if (response.ok && body) setS(body.supplier);
      }
      if (offerId) {
        const { data, response } = await api().GET("/api/market/offers/public/{offer_id}", {
          params: { path: { offer_id: offerId } },
        });
        const body = data as unknown as { offer: OfferDetail } | undefined;
        if (response.ok && body) setOffer(body.offer);
      }
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, [supplier, offerId]);

  const state: State = s?.suspended ? "permission_denied" : offer?.expired ? "expired" : "ready";
  const cartLine = lines.find((l) => l.offer_id === offerId) ?? null;

  return (
    <Frame title="السوق" footer={null} nav={app.tokens ? <AppNav currentId="market" /> : undefined}>
      <div className="sys mp cus" data-screen="MP-14" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              عرض منتهٍ أو منشأة معلّقة — منع الجديد دون محو السابق
            </h2>
            <span className="cat-head__hint">
              تعليق البائع يمنع طلباً جديداً ويُبقي الطلبات القائمة والتصدير. الرقم المنتهي يُعرض
              كـ«آخر سعر معروف» لا كسعر (ACC-135).
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" && s ? (
              <>
                <div className="acc-actions">
                  <Status state="expired" label="معلّق" />
                </div>
                <Notice kind="warning" title="نشر هذه المنشأة معلَّق حالياً">
                  <p className="acc-lead">
                    {s.public_name} · {s.suspended_line}
                  </p>
                </Notice>
                <div className="pub-cols">
                  <div>
                    <strong>يُمنع</strong>
                    <ul className="pub-list">
                      {s.blocked.map((b) => (
                        <li key={b.title}>
                          <span className="pub-mark">لا</span>
                          <span>
                            <strong>{b.title}</strong> — {b.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>يبقى</strong>
                    <ul className="pub-list">
                      {s.kept.map((k) => (
                        <li key={k.title}>
                          <span className="pub-mark">نعم</span>
                          <span>
                            <strong>{k.title}</strong> — {k.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="acc-actions">
                  <Button disabledReason="النشر معلَّق — لا طلب جديد من هذه المنشأة حتى يُرفع التعليق">
                    طلب جديد — موقوف
                  </Button>
                  <Button onClick={() => router.push(`/market/suppliers/${s.tenant_id}`)}>
                    ملف المنشأة
                  </Button>
                </div>
              </>
            ) : null}

            {state === "expired" && offer ? (
              <>
                <h3 className="cat-head__title">عرض منتهٍ في سلّة مشترٍ</h3>
                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">آخر سعر معروف — لا يصلح للتأكيد</div>
                    <div className="home-kpi__value">
                      <span className="sting-mono">
                        {formatMinor(cartLine?.price_minor || offer.price_minor)}
                      </span>{" "}
                      <span className="sting-mono">{offer.currency}</span>
                    </div>
                    <div className="home-kpi__note home-kpi__note--warn">
                      انتهت الصلاحية{" "}
                      <span className="sting-mono">
                        {offer.valid_until ? dm(offer.valid_until) : "—"}
                      </span>
                      {" · "}
                      {offer.public_name} — {offer.pack_label || offer.unit_name} ·{" "}
                      {offer.seller_name}
                    </div>
                  </div>
                </div>
                <p className="acc-choice__note">
                  لا نحذف السطر من السلّة ولا نحدّث سعره تلقائياً. الاثنان خطأ: الحذف يُخفي ما
                  اختاره المشتري، والتحديث الصامت يُبدّل رقماً بناء عليه قراراً.
                </p>
                <div className="acc-actions">
                  <Button
                    pos
                    onClick={() => router.push(`/market/suppliers/${offer.seller_tenant_id}`)}
                  >
                    طلب تأكيد سعر جديد
                  </Button>
                  <Button onClick={() => router.push(`/market/offers/public/${offer.id}`)}>
                    تفاصيل العرض
                  </Button>
                </div>
              </>
            ) : null}

            {state === "ready" ? (
              <>
                <Notice kind="info" title="المنتهي عند ناشره">
                  <p className="acc-lead">
                    العرض المنتهي يبقى في قائمة البائع بوسمه وزرّ تجديده — وعند المشتري يسقط من
                    النتائج ولا يُعرض سعراً.
                  </p>
                  <p className="acc-choice__note">
                    <strong>وجهان لحقيقة واحدة</strong> · الناشر يحتاج رؤية المنتهي ليجدّده؛
                    والمشتري لا يحتاج سعراً ميتاً. الشاشة نفسها بجمهورين (ACC-110 · ACC-143).
                  </p>
                  <p className="acc-choice__note">
                    <strong>المعلَّقة أوسع</strong> · تعليق المنشأة يمنع الجديد كله ويبقي السابق
                    للاطلاع والتصدير — لا محو (ACC-135).
                  </p>
                </Notice>
                {s ? (
                  <p className="acc-choice__note">
                    {s.public_name} · {s.badge_label} — النشر قائم ولا مانع من طلب جديد.
                  </p>
                ) : null}
                {loaded && lines.length ? (
                  <>
                    <h3 className="cat-head__title">أسطر سلّتك</h3>
                    <ul className="cus-list">
                      {lines.map((l) => (
                        <li key={l.offer_id}>
                          <Button
                            variant="quiet"
                            onClick={() => router.push(`/market/offers/public/${l.offer_id}`)}
                          >
                            {l.public_name}
                          </Button>
                          <div className="cus-sub">
                            {l.pack_label || l.unit_name} · {l.seller_name}
                          </div>
                          <div>
                            <span className="sting-mono">{formatMinor(l.price_minor)}</span>{" "}
                            <span className="sting-mono">{l.currency}</span> · مؤكَّد حتى{" "}
                            <span className="sting-mono">
                              {l.valid_until ? dm(l.valid_until) : "—"}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : loaded ? (
                  <p className="acc-choice__note">لا أسطر في سلّتك بعد.</p>
                ) : null}
                {signedIn ? (
                  <div className="acc-actions">
                    <Button onClick={() => router.push("/market/renewals")}>
                      عروضي المنتهية — تجديد التأكيد
                    </Button>
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
