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
import { dayMonth } from "@/features/home/format";
import type { OfferCard, SupplierCard } from "@/features/market/home-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "loading" | "ready" | "permission_denied" | "expired";

interface Supplier extends SupplierCard {
  since: string;
  badge_means: string[];
  badge_not: string[];
  verified_until: string;
  suspended_at: string;
  facts: { confirmed_orders: number; fulfilled: number; partial: number; open_disputes: number };
  offers: OfferCard[];
}

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
const monthWord = (iso: string) => MONTHS[new Date(iso).getMonth()] ?? "";
const offersWord = (n: number) =>
  n === 1 ? "عرض واحد" : n === 2 ? "عرضان" : n <= 10 ? `${n} عروض` : `${n} عرضاً`;
const untilWord = (dateIso: string) => {
  const { day, month } = dayMonth(`${dateIso}T12:00:00`);
  return `${day} ${month}`;
};

/** MP-03 — ملف منشأة منشور (12-D7 + 47-D38 ready · 43-D35 loading/permission_denied/expired). */
export function SupplierClient({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const wantedList = params.get("list") ?? "";
  const app = useApp();
  const [s, setS] = useState<Supplier | null>(null);
  const [listDenied, setListDenied] = useState(false);
  const signedIn = Boolean(app.tokens && app.session.tenantId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, response } = await api().GET("/api/public/market/suppliers/{tenant_id}", {
        params: { path: { tenant_id: id } },
      });
      if (cancelled) return;
      if (response.status === 404) {
        router.replace("/link-expired");
        return;
      }
      const body = data as unknown as { supplier: Supplier } | undefined;
      if (response.ok && body) setS(body.supplier);
      if (wantedList) {
        // رابط قائمة خاصة على الملف: غير المخوَّل لا يرى قسماً ولا تلميحاً — القسم الخاص لا يظهر أصلاً
        const r = await api().GET("/api/market/lists/{list_id}", {
          params: { path: { list_id: wantedList } },
        });
        if (!cancelled && !r.response.ok) setListDenied(true);
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, wantedList, router]);

  const state: State = !s
    ? "loading"
    : s.badge === "expired" || s.badge === "suspended"
      ? "expired"
      : listDenied
        ? "permission_denied"
        : "ready";

  return (
    <Frame
      title={s?.public_name ?? "السوق"}
      footer={null}
      nav={app.tokens ? <AppNav currentId="market" /> : undefined}
    >
      <div className="sys mp cus" data-screen="MP-03" data-state={state}>
        {state === "loading" ? (
          <div className="cat-table pos-card">
            <div className="acc-card__body">
              <Notice kind="info" title="جلب الملف">
                <p className="acc-lead">الهوية والشارة أولاً ثم العروض.</p>
              </Notice>
            </div>
          </div>
        ) : null}

        {s ? (
          <>
            <div className="cat-table pos-card">
              <div className="acc-card__body cus-head">
                <h1>{s.public_name}</h1>
                <div className="cus-sub">
                  {[s.category_line, s.service_areas[0], s.fulfilment[0]]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · {offersWord(s.offers_count)}
                  {s.since ? ` · ينشر منذ ${monthWord(s.since)}` : ""}
                </div>
                <div className="acc-actions">
                  <Status
                    state={
                      s.badge === "verified" ? "success" : s.badge === "none" ? "stale" : "expired"
                    }
                    label={s.badge === "verified" ? "هوية متحققة" : s.badge_label}
                  />
                  <Button
                    pos
                    onClick={() =>
                      router.push(signedIn ? `/market/following?follow=${s.tenant_id}` : "/welcome")
                    }
                    disabledReason={
                      s.badge === "suspended"
                        ? "النشر معلَّق — لا متابعة جديدة حتى يُرفع التعليق"
                        : undefined
                    }
                  >
                    تابع هذا المورد
                  </Button>
                </div>
                <p className="acc-choice__note">
                  المتابعة اشتراك B2B باسم منشأتك — تحتاج حساباً وصلاحية. والعروض أعلاه تُرى بلا
                  حساب.
                </p>
                {signedIn ? (
                  <div className="acc-actions">
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/share?supplier=${s.tenant_id}`)}
                    >
                      شارك الرابط أو اطلب تخويلاً
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/report?supplier=${s.tenant_id}`)}
                    >
                      بلّغ عن انتحال
                    </Button>
                    {s.badge === "suspended" ? (
                      <Button
                        variant="quiet"
                        onClick={() => router.push(`/market/unavailable?supplier=${s.tenant_id}`)}
                      >
                        ما يُمنع وما يبقى
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {state === "expired" ? (
              <Notice kind="warning" title="تحقق منتهٍ أو منشأة معلَّقة">
                <p className="acc-lead">الشارة سقطت أو النشر عُلِّق.</p>
                <p className="acc-choice__note">
                  <strong>الشارة بحدودها</strong> · تسقط الشارة ويبقى الملف:{" "}
                  {s.badge === "expired" && s.verified_until
                    ? `«التحقق منتهٍ منذ ${untilWord(s.verified_until)}»`
                    : "«النشر معلَّق»"}{" "}
                  — لا محو ولا إخفاء صامت. والمعلَّقة يُمنع جديدها ويبقى سابقها للاطلاع.
                </p>
              </Notice>
            ) : null}

            {s.badge === "verified" || s.badge === "expired" ? (
              <div className="cat-table pos-card">
                <div className="cat-head">
                  <h2 className="cat-head__title">ماذا تعني «هوية متحققة» وماذا لا تعني</h2>
                  <span className="cat-head__hint">
                    نص الحدود ليس تنويهاً صغيراً: هو أهم سطر في الصفحة، فمن يقرأه يبني عليه قراراً
                    مالياً.
                  </span>
                </div>
                <div className="acc-card__body pub-cols">
                  <div>
                    <strong>تعني</strong>
                    <ul className="pub-list">
                      {s.badge_means.map((t) => (
                        <li key={t}>
                          <span className="pub-mark">نعم</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>لا تعني</strong>
                    <ul className="pub-list">
                      {s.badge_not.map((t) => (
                        <li key={t}>
                          <span className="pub-mark">لا</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="cat-table pos-card">
              <div className="cat-head">
                <h2 className="cat-head__title">حقائق قابلة للتحقق — لا تقييم نجوم</h2>
                <span className="cat-head__hint">
                  لا تقييم بالنجوم في الإصدار الأول: رقم واحد من مراجعات قليلة يُفسد سمعة مورد أو
                  يزيّنها بلا أساس. الحقائق أعلاه تُحتسب من طلبات فعلية مؤكدة من طرفين.
                </span>
              </div>
              <div className="acc-card__body home-kpis">
                {(
                  [
                    ["طلبات مؤكدة من طرفين", s.facts.confirmed_orders],
                    ["نُفِّذت كاملة", s.facts.fulfilled],
                    ["نُفِّذت جزئياً", s.facts.partial],
                    ["خلافات مفتوحة الآن", s.facts.open_disputes],
                  ] as const
                ).map(([label, n]) => (
                  <div className="home-kpi" key={label}>
                    <div className="home-kpi__label">{label}</div>
                    <div className="home-kpi__value sting-mono">{n}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="cat-table pos-card">
              <div className="cat-head">
                <h2 className="cat-head__title">العروض المنشورة</h2>
              </div>
              <div className="acc-card__body">
                {s.offers.length ? (
                  <ul className="cus-list">
                    {s.offers.map((o) => (
                      <li key={o.id}>
                        <strong>{o.public_name}</strong>
                        <div className="cus-sub">{o.pack_label}</div>
                        <div>
                          {o.price_minor ? (
                            <>
                              <span className="sting-mono">{formatMinor(o.price_minor)}</span>
                              {o.confirmed_until
                                ? ` · مؤكَّد حتى ${untilWord(o.confirmed_until)}`
                                : ""}
                            </>
                          ) : (
                            `${o.price_line} · ${o.availability} — بسعرٍ عند الطلب`
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="acc-choice__note">لا عروض عامة منشورة الآن.</p>
                )}
              </div>
            </div>

            {signedIn ? (
              <div className="cat-table pos-card">
                <div className="cat-head">
                  <h2 className="cat-head__title">متابعاتك</h2>
                </div>
                <div className="acc-card__body">
                  <p className="acc-lead">لا تتابع أحداً بعد</p>
                  <p className="acc-choice__note">
                    المتابعة اشتراك تسويقي: تصلك عروض من تختاره وحده. ليست شرطاً للشراء ولا للوصول
                    إلى سعر — يمكنك الطلب من مورد بلا متابعته. إلغاء المتابعة لاحقاً لا يمحو طلباتك
                    السابقة ولا ذممك.
                  </p>
                  <div className="acc-actions">
                    <Button onClick={() => router.push("/market/directory")}>
                      استعراض موردي منطقتك
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Frame>
  );
}
