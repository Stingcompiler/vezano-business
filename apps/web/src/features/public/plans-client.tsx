"use client";

import { Button, formatMinor, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./public.css";
import "./landing.css";
import "@/features/market/market.css";
import { PublicHeader } from "@/features/public/public-header";
import { api } from "@/lib/api";
import { useOnline } from "@/lib/online";

type State = "ready" | "loading" | "offline";

type Cycle = "monthly" | "quarterly" | "yearly";

interface Plan {
  code: string;
  name: string;
  price_minor: string;
  price_quarterly_minor?: string;
  price_yearly_minor?: string;
  trial_days?: number | null;
  next_price_minor?: string | null;
  next_price_effective_at?: string;
  max_branches: number;
  max_devices: number;
  campaign_quota: number;
  blurb: string;
  trial: boolean;
  addons?: { devices: string; users: string; branches: string };
}

interface Row<V> {
  label: string;
  values: Record<string, V>;
}

interface PlansPayload {
  plans: Plan[];
  on_expiry: { hidden: string[]; never_hidden: string[]; grace_days: number };
  comparison: {
    limits: Row<string>[];
    features: (Row<boolean> & { code: string; note: string })[];
    continues: string[];
    stops: string[];
  };
}

/** PUB-05 — الباقات والمقارنة: الأسعار كاملة، الحدود رقماً، وكل خاصية نعم/لا لكل باقة. */
export function PlansClient() {
  const router = useRouter();
  const online = useOnline();
  const [data, setData] = useState<PlansPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .GET("/api/public/plans")
      .then(({ data: d, response }) => {
        const body = d as unknown as PlansPayload | undefined;
        if (!cancelled && response.ok && body) setData(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const state: State = data ? "ready" : online ? "loading" : "offline";
  const plans = data?.plans ?? [];
  const hot = plans.findIndex((p) => p.code === "dual");
  // دورة الفوترة (0005 §١١٠): تظهر حين يعرض الكتالوج سعراً ربعياً/سنوياً لأي باقة
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const priceOf = (p: Plan, c: Cycle) =>
    c === "yearly"
      ? (p.price_yearly_minor ?? "0")
      : c === "quarterly"
        ? (p.price_quarterly_minor ?? "0")
        : p.price_minor;
  const cycles: { cycle: Cycle; label: string; months: number }[] = [
    { cycle: "monthly", label: "شهري", months: 1 },
    { cycle: "quarterly", label: "ربعي", months: 3 },
    { cycle: "yearly", label: "سنوي", months: 12 },
  ].filter(
    (c) => c.cycle === "monthly" || plans.some((p) => priceOf(p, c.cycle as Cycle) !== "0"),
  ) as {
    cycle: Cycle;
    label: string;
    months: number;
  }[];
  const savings = (p: Plan, c: Cycle) => {
    const months = c === "yearly" ? 12 : c === "quarterly" ? 3 : 1;
    const full = BigInt(p.price_minor) * BigInt(months);
    const price = BigInt(priceOf(p, c));
    if (months === 1 || full === 0n || price >= full) return 0;
    return Number(((full - price) * 100n) / full);
  };

  return (
    <Frame title="فيزانو" footer={null} back={false} chrome={<PublicHeader cta="register" />}>
      <div className="sys pub pb pl" data-screen="PUB-05" data-state={state}>
        <section className="pb-hero pl-hero">
          <span className="pb-eyebrow">الأسعار كاملة — لا «تواصل معنا للسعر»</span>
          <h2 className="pb-hero__title">الباقات والمقارنة</h2>
          <p className="pb-hero__sub">
            ثلاث باقات بأسعارها وحدودها، وجدول يقول عن كل ميزة: في أي باقة هي. ما يحجبه انتهاء
            الاشتراك وما لا يُحجب أبداً مكتوب هنا لا في العقد.
          </p>
        </section>

        {state === "loading" ? (
          <Notice kind="info" title="جلب الباقات">
            <p className="acc-lead">تُجلب الباقات من الخادم…</p>
          </Notice>
        ) : null}
        {state === "offline" ? (
          <Notice kind="offline" title="بلا اتصال">
            <p className="acc-lead">الباقات تحتاج اتصالاً — لا سعر من الذاكرة.</p>
          </Notice>
        ) : null}

        {data ? (
          <>
            {cycles.length > 1 ? (
              <div className="pos-chips pl-cycles" role="group" aria-label="دورة الفوترة">
                {cycles.map((c) => (
                  <button
                    key={c.cycle}
                    type="button"
                    className={`pos-chip${cycle === c.cycle ? " pos-chip--on" : ""}`}
                    aria-pressed={cycle === c.cycle}
                    onClick={() => setCycle(c.cycle)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="pl-plans">
              {plans.map((p, i) => (
                <li key={p.code} className={`pl-plan${i === hot ? " pl-plan--hot" : ""}`}>
                  {i === hot ? <span className="lp__tag">الأكثر طلباً</span> : null}
                  <h3 className="pl-plan__name">{p.name}</h3>
                  {p.trial ? (
                    <div className="lp__price lp__price--free">مجاناً</div>
                  ) : priceOf(p, cycle) === "0" ? (
                    <div className="lp__price lp__price--free">
                      {formatMinor(p.price_minor)} <small>/ شهرياً</small>
                    </div>
                  ) : (
                    <div className="lp__price">
                      {formatMinor(priceOf(p, cycle))}{" "}
                      <small>
                        /{" "}
                        {cycle === "yearly"
                          ? "سنوياً"
                          : cycle === "quarterly"
                            ? "ربعياً"
                            : "شهرياً"}
                      </small>
                    </div>
                  )}
                  {!p.trial && savings(p, cycle) > 0 ? (
                    <span className="lp__tag">
                      وفّر <span className="sting-mono">{savings(p, cycle)}</span>٪ عن الشهري
                    </span>
                  ) : null}
                  {!p.trial && p.next_price_minor && p.next_price_effective_at ? (
                    <p className="pl-plan__next">
                      السعر الشهري يصير{" "}
                      <span className="sting-mono">{formatMinor(p.next_price_minor)}</span> من{" "}
                      <span className="sting-mono">{p.next_price_effective_at.slice(0, 10)}</span>
                    </p>
                  ) : null}
                  <p className="pl-plan__blurb">{p.blurb}</p>
                  <ul className="pl-plan__limits">
                    <li>
                      <span className="sting-mono">{p.max_branches}</span>{" "}
                      {p.max_branches === 1 ? "فرع" : "فروع"}
                    </li>
                    <li>
                      <span className="sting-mono">{p.max_devices}</span>{" "}
                      {p.max_devices <= 10 ? "أجهزة" : "جهازاً"}
                    </li>
                    {p.campaign_quota ? (
                      <li>
                        <span className="sting-mono">{p.campaign_quota}</span> رسالة حملات شهرياً
                      </li>
                    ) : null}
                    {p.trial ? (
                      <li>
                        <span className="sting-mono">{p.trial_days ?? 30}</span> يوماً
                      </li>
                    ) : null}
                  </ul>
                  {!p.trial && p.addons && Object.values(p.addons).some((v) => v !== "0") ? (
                    <p className="pl-plan__addons" data-testid="plan-addons">
                      إضافات شهرياً:{" "}
                      {(
                        [
                          ["devices", "جهاز"],
                          ["users", "مستخدم"],
                          ["branches", "فرع"],
                        ] as const
                      )
                        .filter(([k]) => p.addons && p.addons[k] !== "0")
                        .map(([k, label], j) => (
                          <span key={k}>
                            {j ? " · " : ""}
                            {label} <span className="sting-mono">{formatMinor(p.addons![k])}</span>
                          </span>
                        ))}
                    </p>
                  ) : null}
                  <Button pos={i === hot} onClick={() => router.push("/register")}>
                    {p.trial ? "ابدأ التجربة" : "ابدأ بهذه الباقة"}
                  </Button>
                </li>
              ))}
            </ul>

            <div className="pb-card">
              <div className="pb-card__head">
                <h3 className="pb-card__title">مقارنة الميزات</h3>
                <p className="pb-card__hint">
                  كل خاصية بحالتها في كل باقة. ما ليس في أي باقة يُعرض ولا يُخفى.
                </p>
              </div>
              <div className="pl-table-wrap">
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th scope="col">الميزة</th>
                      {plans.map((p) => (
                        <th key={p.code} scope="col">
                          {p.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="pl-table__group">
                      <th scope="rowgroup" colSpan={plans.length + 1}>
                        الحدود
                      </th>
                    </tr>
                    {data.comparison.limits.map((r) => (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        {plans.map((p) => {
                          const v = r.values[p.code] ?? "";
                          const numeric = /^\d+$/.test(v);
                          return (
                            <td key={p.code} data-label={p.name}>
                              {v ? (
                                <span className={numeric ? "sting-mono" : undefined}>{v}</span>
                              ) : (
                                <span className="pl-no" aria-label="لا">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="pl-table__group">
                      <th scope="rowgroup" colSpan={plans.length + 1}>
                        الميزات
                      </th>
                    </tr>
                    {data.comparison.features.map((r) => (
                      <tr key={r.code}>
                        <th scope="row">
                          {r.label}
                          {r.note ? <small className="pl-note">{r.note}</small> : null}
                        </th>
                        {plans.map((p) => (
                          <td key={p.code} data-label={p.name}>
                            {r.values[p.code] ? (
                              <span className="pl-yes" role="img" aria-label="نعم">
                                ✓
                              </span>
                            ) : (
                              <span className="pl-no" role="img" aria-label="لا">
                                —
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pl-expiry">
              <div className="pb-card pb-card--pad pl-expiry__col pl-expiry__col--ok">
                <p className="pb-kicker">
                  <strong>ما لا يُحجب أبداً</strong>
                </p>
                <p className="pb-card__hint">
                  {data.on_expiry.never_hidden.join("، ")} — بعد الانتهاء يستمر:
                </p>
                <ul className="pl-list">
                  {data.comparison.continues.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="pb-card pb-card--pad pl-expiry__col pl-expiry__col--stop">
                <p className="pb-kicker">
                  <strong>ما يحجبه الانتهاء</strong>
                </p>
                <p className="pb-card__hint">
                  بعد مهلة <span className="sting-mono">{data.on_expiry.grace_days}</span> يوماً
                  يتوقف:
                </p>
                <ul className="pl-list">
                  {data.comparison.stops.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>

            <section className="mk-cta pl-cta">
              <div>
                <h3 className="mk-cta__title">ابدأ بالتجريبية، وانتقل حين تحتاج</h3>
                <p className="acc-choice__note">
                  التجريبية بكل ميزات باقة الفرع الواحد <span className="sting-mono">30</span> يوماً
                  بلا بطاقة. الترقية إلى باقة أوسع من إعدادات المنشأة (الاشتراك) في أي وقت.
                </p>
              </div>
              <div className="mk-cta__actions">
                <Button pos onClick={() => router.push("/register")}>
                  ابدأ تجربتك المجانية
                </Button>
                <Button variant="quiet" onClick={() => router.push("/#lp-contact")}>
                  اطلب جولة
                </Button>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </Frame>
  );
}
