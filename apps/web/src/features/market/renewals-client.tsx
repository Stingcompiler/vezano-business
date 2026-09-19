"use client";

import { Button, formatMinor, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import type { Offer } from "@/features/market/offers-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "saving" | "expired" | "permission_denied" | "success";

interface RenewOffer extends Offer {
  number: number;
  confirmed_at: string;
  days_left: number | null;
}

interface Rule {
  action: string;
  effect: string;
  verdict: string;
}

interface Payload {
  offers: RenewOffer[];
  can_renew: boolean;
  renew_hours: number;
  rules: Rule[];
}

const dm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

/** MP-13 — تجديد تأكيد سعر وتوفر (43-D35 ready/saving/permission_denied/success · 10-D6 expired). */
export function RenewalsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const focus = params.get("o") ?? "";
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [renewed, setRenewed] = useState<RenewOffer | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/renewals");
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) setData(body);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Frenewals");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const renew = async (o: RenewOffer) => {
    if (saving) return;
    setSaving(o.id);
    try {
      const { data: d, response } = await api().POST("/api/market/offers/{offer_id}/renew", {
        params: { path: { offer_id: o.id } },
        body: {} as never,
      });
      const b = d as unknown as { offer: Offer } | undefined;
      if (response.ok && b) {
        setRenewed({ ...o, ...b.offer });
        await load();
      }
    } finally {
      setSaving(null);
    }
  };

  const focused = data?.offers.find((o) => o.id === focus) ?? null;
  const state: State = renewed
    ? "success"
    : saving
      ? "saving"
      : data && !data.can_renew
        ? "permission_denied"
        : focused && focused.status === "expired"
          ? "expired"
          : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-renewals" />} footer={null}>
      <div className="sys mp" data-screen="MP-13" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تجديد التأكيد والمتابعة — فعلان لا يُنجزان تلقائياً</h2>
            <span className="cat-head__hint">
              ما ينتهي وما انتهى: قائمة عروضك بصلاحياتها، والأقرب انتهاءً أولاً — والتجديد فعل صريح
              لكل عرض: «ما زال السعر قائماً؟».
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && renewed ? (
              <Notice
                kind="success"
                title="جُدِّد التأكيد"
                action={<Button onClick={() => setRenewed(null)}>حسناً</Button>}
              >
                <p className="acc-lead">
                  صلاحية جديدة بتاريخها، والعرض يعود إلى نتائج البحث إن كان سقط.{" "}
                  {renewed.public_name} — سارٍ حتى{" "}
                  <span className="sting-mono">
                    {renewed.valid_until ? dm(renewed.valid_until) : ""}
                  </span>
                  .
                </p>
                <p className="acc-choice__note">
                  <strong>الماضي ثابت</strong> · التجديد بسعرٍ جديد لا يمسّ طلباً قُبل على السعر
                  القديم (ACC-145) — نسخة الاتفاق محفوظة هناك.
                </p>
              </Notice>
            ) : null}

            {state === "saving" ? (
              <Notice kind="info" title="جارٍ التجديد">
                <p className="acc-lead">
                  التأكيد يُرفع للخادم — التجديد المحلي لا معنى له: صدقه في وصوله.
                </p>
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="locked" title="التجديد إقرار سعري">
                <p className="acc-lead">
                  محرّر الوصف لا يجدّد الأسعار — التجديد بصلاحية من يلتزم بالسعر.
                </p>
              </Notice>
            ) : null}

            {state === "expired" && focused && data ? (
              <Notice
                kind="warning"
                title="تعديل عرض قائم — ما يجدّد التأكيد وما لا يجدّده"
                action={
                  <Button pos onClick={() => void renew(focused)}>
                    تجديد تأكيد السعر والتوفر —{" "}
                    <span className="sting-mono">{data.renew_hours}</span> ساعة
                  </Button>
                }
              >
                <p className="acc-lead">
                  العرض <span className="sting-mono">{focused.number}</span> · تأكيده الخادمي انتهى{" "}
                  <span className="sting-mono">
                    {focused.confirmed_at ? hhmm(focused.confirmed_at) : dm(focused.valid_until)}
                  </span>
                </p>
                <p className="acc-lead">
                  <strong>لماذا لا نجدّد تلقائياً عند أي تعديل؟</strong> لأن تصحيح خطأ إملائي في
                  الوصف سيصبح حينها إعلاناً بأن السعر ساري اليوم، والمشتري يبني عليه طلباً. التجديد
                  فعل صريح بزر وختم وقت.
                </p>
                <ul className="mp-check">
                  {data.rules.map((r) => (
                    <li key={r.action}>
                      <span>
                        <strong>{r.action}</strong>
                        <div className="mp-check__hint">{r.effect}</div>
                      </span>
                      <Status
                        state={
                          r.verdict === "يجدّد"
                            ? "success"
                            : r.verdict === "يُلغي التأكيد"
                              ? "validation_error"
                              : "stale"
                        }
                        label={r.verdict}
                      />
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}

            <p className="acc-choice__note">
              <strong>الوصف لا يجدّد</strong> · تعديل وصفٍ أو صورة لا يجدّد تأكيد السعر (ACC-144).
              التجديد إقرارٌ سعري له زرّه — وإلا صار كل تحريرٍ تمديداً خفياً.
            </p>

            {data ? (
              <ul className="mp-check">
                {data.offers.map((o) => (
                  <li key={o.id}>
                    <span>
                      <Button
                        variant="quiet"
                        onClick={() => router.push(`/market/renewals?o=${o.id}`)}
                      >
                        {o.public_name}
                        {o.pack_label ? ` — ${o.pack_label}` : ""}
                      </Button>
                      <div className="mp-check__hint">
                        {o.price_minor ? (
                          <>
                            <span className="sting-mono">{formatMinor(o.price_minor)}</span> ·{" "}
                          </>
                        ) : null}
                        {o.status === "expired"
                          ? `انتهى ${dm(o.valid_until)}`
                          : `سارٍ حتى ${dm(o.valid_until)}${typeof o.days_left === "number" ? ` · ${o.days_left} أيام` : ""}`}
                      </div>
                    </span>
                    <span>
                      <Status
                        state={o.status === "expired" ? "expired" : "success"}
                        label={o.status_label}
                      />
                      {data.can_renew ? (
                        <Button onClick={() => void renew(o)} loading={saving === o.id}>
                          تجديد التأكيد
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {data && !data.offers.length ? (
              <p className="acc-choice__note">لا عروض منشورة أو منتهية بعد.</p>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
