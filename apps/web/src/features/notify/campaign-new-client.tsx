"use client";

import { Button, Frame, Notice, TextAreaField, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./notify.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "validation_error" | "permission_denied";

interface Segment {
  key: string;
  label: string;
  hint: string;
  count: number;
  selected: boolean;
  warning: boolean;
  available: boolean;
}

interface Preview {
  shop_name: string;
  audience: {
    segments: Segment[];
    blocked: { key: string; label: string; hint: string };
    eligible: number;
    consented: number;
    excluded_opt_out: number;
    excluded_no_phone: number;
    duplicates: number;
    with_debt_in_audience: number;
  };
  chars: number;
  parts: number;
  cost_messages: number;
  quota: { used: number; max: number; remaining: number };
  blockers: {
    code: string;
    title: string;
    detail: string;
    need?: number;
    remaining?: number;
    confirmable?: boolean;
  }[];
}

/**
 * NOT-04 — إنشاء حملة واختيار الجمهور (07-D3 ready · 17-D12 ready · 36-D28 empty/validation_error/
 * permission_denied): الجمهور يُبنى من دفترك وحده — زبائن محلك أو متابعوك في السوق، لا جمهور
 * مستأجر آخر بأي حال (ACC-103)؛ العدد يتغير أمامك مع كل شرط ويُحصى خادمياً بعد إزالة التكرار ومن
 * رفض التسويق؛ الرسالة تحمل اسم المحل إلزاماً؛ الموانع مذكورة بأسبابها؛ الاعتماد والجدولة في
 * NOT-05 بصلاحية منفصلة (§١١.٥، §١١.٧، §١١.٨).
 */
export function CampaignNewClient() {
  const router = useRouter();
  const app = useApp();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [segments, setSegments] = useState<string[]>(["subscribed"]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [denied, setDenied] = useState<"role" | "tenant" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const seededName = useRef(false);
  const appRef = useRef(app);
  appRef.current = app;

  const refresh = useCallback(async () => {
    try {
      const { data, error, response } = await api().POST("/api/campaigns/preview", {
        body: { message, audience: { segments } } as never,
      });
      if (response.status === 403) {
        setDenied("role");
        return;
      }
      if (response.status === 400) {
        const e = error as unknown as { detail: string };
        if (e.detail === "audience_out_of_tenant") setDenied("tenant");
        return;
      }
      const body = data as unknown as Preview | undefined;
      if (!response.ok || !body) return;
      setDenied(null);
      setPreview(body);
      // نُلزم بالاسم: يُدرج تلقائياً ويمكن تحريره لا حذفه
      if (!seededName.current && body.shop_name) {
        seededName.current = true;
        setMessage((m) => (m.trim() ? m : `— ${body.shop_name}`));
      }
    } catch {
      /* بلا اتصال: تبقى المعاينة الأخيرة */
    }
  }, [message, segments]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fnotify%2Fcampaigns%2Fnew");
    }
  }, [router]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const toggle = (key: string) => {
    setTouched(true);
    setSaved(null);
    setSegments((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  };

  const save = async (thenApprove = false) => {
    if (saving || !preview) return;
    setSaving(true);
    setTouched(true);
    try {
      const { data, error, response } = await api().POST("/api/campaigns", {
        body: { name, message, audience: { segments } } as never,
      });
      if (response.status === 403) {
        setDenied("role");
        return;
      }
      if (response.status === 400) {
        const e = error as unknown as { detail: string };
        if (e.detail === "audience_out_of_tenant") setDenied("tenant");
        return;
      }
      const body = data as unknown as { campaign: { id: string } } | undefined;
      if (response.ok && body) {
        setSaved(body.campaign.id);
        if (thenApprove) router.push(`/notify/campaigns/${body.campaign.id}/approve`);
      }
    } finally {
      setSaving(false);
    }
  };

  const blockers = preview?.blockers ?? [];
  const identityMissing = blockers.some((b) => b.code === "sender_identity_missing");
  const state: State = denied
    ? "permission_denied"
    : preview && preview.audience.eligible === 0 && touched
      ? "empty"
      : touched && identityMissing
        ? "validation_error"
        : "ready";

  const seg = (k: string) => preview?.audience.segments.find((s) => s.key === k);

  return (
    <Frame title="الإشعارات" nav={<AppNav currentId="campaigns" />} footer={null}>
      <div className="sys not" data-screen="NOT-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">إنشاء حملة واختيار الجمهور</h2>
            <span className="cat-head__hint">
              زبائن محلك أو متابعوك في السوق — لا جمهور مستأجر آخر بأي حال.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              denied === "tenant" ? (
                <Notice kind="locked" title="جمهور خارج منشأتك">
                  <p className="acc-lead">
                    محاولة اختيار شريحة تشمل زبائن منشأة أخرى على نفس الجهاز.
                  </p>
                  <p className="acc-lead">
                    <strong>رفض بلا تسريب</strong> · لا نقول كم عددهم ولا من هم. «الجمهور محصور
                    بزبائن منشأتك» — والعدد وحده خبر.
                  </p>
                </Notice>
              ) : (
                <Notice kind="locked" title="إنشاء الحملة صلاحية">
                  <p className="acc-lead">
                    إنشاء الحملات للمالك ومدير الفرع («الأدوار والصلاحيات»). أنت تنشئ الحملة،
                    والاعتماد والجدولة يحتاجان صلاحية منفصلة في «اعتماد الحملة». الفصل متعمَّد.
                  </p>
                </Notice>
              )
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="warning" title="رسالة بلا هوية المرسل">
                <p className="acc-lead">
                  نصٌّ لا يذكر اسم المحل. الزبون يتلقّى رسالة من رقم لا يعرفه.
                </p>
                <p className="acc-lead">
                  <strong>نُلزم بالاسم</strong> · وهو يُدرج تلقائياً ويمكن تحريره لا حذفه. رسالةٌ
                  مجهولة المصدر تُبلَّغ كإزعاج فيُحظر المحل.
                </p>
                {preview ? (
                  <div className="cat-form__actions">
                    <Button onClick={() => setMessage((m) => `${m.trim()} — ${preview.shop_name}`)}>
                      أدرج اسم المحل
                    </Button>
                  </div>
                ) : null}
              </Notice>
            ) : null}

            {state === "empty" && preview ? (
              <Notice kind="empty" title="لا جمهور مطابق">
                <p className="acc-lead">
                  المرشّح ({segments.map((k) => seg(k)?.label ?? k).join(" و") || "بلا شريحة"}) لا
                  يطابق أحداً.
                </p>
                <p className="acc-lead">
                  <strong>نُفصّل السبب</strong> ·{" "}
                  {preview.audience.segments
                    .filter((s) => s.selected)
                    .map((s) => (
                      <span key={s.key}>
                        <span className="sting-mono">{s.count}</span> {s.label} ·{" "}
                      </span>
                    ))}
                  <span className="sting-mono">{preview.audience.consented}</span> منهم أذن. معرفة
                  أيّ الشرطين أفرغ القائمة هي ما يُصلح الحملة.
                </p>
              </Notice>
            ) : null}

            {state !== "permission_denied" ? (
              <div className="org-effects__row">
                <div className="cat-form">
                  <h3 className="cat-head__title">حملة جديدة</h3>
                  <TextField
                    label="اسم الحملة — داخلي"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setSaved(null);
                    }}
                    required
                  />
                  <TextAreaField
                    label="نص الرسالة"
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      setTouched(true);
                      setSaved(null);
                    }}
                    rows={4}
                    hint={
                      preview
                        ? `${preview.chars} حرفاً = ${preview.parts === 1 ? "رسالة نصية واحدة" : preview.parts === 2 ? "رسالتان نصيتان" : `${preview.parts} رسائل نصية`} لكل مستلم`
                        : undefined
                    }
                  />
                  <p className="acc-choice__note">
                    مثال: سكر أبيض كرتونة 12 كغ بـ1,150 ج.س حتى نهاية الأسبوع — بقالة النيل
                  </p>

                  <h3 className="cat-head__title">الجمهور</h3>
                  <p className="acc-choice__note">
                    <strong>اختيار الجمهور</strong> · العدد يتغير أمامك مع كل شرط. الجمهور يُبنى من
                    دفترك: من اشترى، من عليه ذمة، من يتابع صفحتك في السوق. لا شراء قوائم ولا جمهور
                    مستأجر آخر.
                  </p>
                  <fieldset className="cat-form">
                    <legend className="acc-choice__note">
                      <strong>حدود صريحة</strong>
                    </legend>
                    {preview?.audience.segments.map((s) => (
                      <label key={s.key} className="web03-check">
                        <input
                          type="checkbox"
                          checked={segments.includes(s.key)}
                          disabled={!s.available}
                          onChange={() => toggle(s.key)}
                        />{" "}
                        {s.label} — <span className="sting-mono">{s.count}</span>
                        {s.key === "subscribed" ? " مشتركاً عبر رابط المحل أو QR" : ""}
                        {s.key === "market_followers" ? " منشأة تتابع عروضك — B2B" : ""}
                        <span className="acc-choice__note"> {s.hint}</span>
                      </label>
                    ))}
                    {preview ? (
                      <label className="web03-check">
                        <input type="checkbox" disabled /> {preview.audience.blocked.label} —{" "}
                        <strong>محجوب</strong>
                        <span className="acc-choice__note">
                          {" "}
                          {preview.audience.blocked.hint} غير متاح إطلاقاً — جمهور كل منشأة معزول
                          ولا يُشترى ولا يُستعار
                        </span>
                      </label>
                    ) : null}
                  </fieldset>
                  <div className="cat-form__actions">
                    <Button
                      pos
                      onClick={() => void save()}
                      loading={saving}
                      disabledReason={!name.trim() ? "اسم الحملة مطلوب" : undefined}
                    >
                      حفظ كمسودة
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void save(true)}
                      disabledReason={
                        !name.trim()
                          ? "اسم الحملة مطلوب"
                          : blockers.length
                            ? "لا يمكن الجدولة بعد"
                            : undefined
                      }
                    >
                      حفظ ومعاينة قبل الاعتماد
                    </Button>
                  </div>
                  {saved ? (
                    <p className="acc-choice__note">
                      حُفظت كمسودة. أنت تنشئ الحملة، والاعتماد والجدولة يحتاجان صلاحية منفصلة في{" "}
                      <Button variant="quiet" onClick={() => router.push("/notify/campaigns")}>
                        اعتماد الحملة
                      </Button>
                      . الفصل متعمَّد.
                    </p>
                  ) : null}
                </div>

                <div>
                  <h3 className="cat-head__title">حجم الإرسال</h3>
                  {preview ? (
                    <>
                      <div className="home-kpis rep-kpis">
                        <div className="home-kpi">
                          <div className="home-kpi__label">مشتركون مؤهلون</div>
                          <div className="home-kpi__value sting-mono">
                            {preview.audience.eligible}
                          </div>
                          <div className="home-kpi__scope">
                            الجمهور بعد إزالة التكرار ومن رفض التسويق
                          </div>
                        </div>
                        <div className="home-kpi">
                          <div className="home-kpi__label">ألغوا الاشتراك — مستبعدون</div>
                          <div className="home-kpi__value sting-mono">
                            {preview.audience.excluded_opt_out}
                          </div>
                          <div className="home-kpi__scope">
                            <span className="sting-mono">{preview.audience.excluded_opt_out}</span>{" "}
                            رقماً استُبعد لأن أصحابها أوقفوا الرسائل التسويقية. لا يمكن تجاوز ذلك من
                            داخل الشاشة، والاستبعاد يظهر بالعدد لا بالأسماء.
                          </div>
                        </div>
                        <div className="home-kpi">
                          <div className="home-kpi__label">حصتك المتبقية هذا الشهر</div>
                          <div className="home-kpi__value sting-mono">
                            {preview.quota.remaining}
                          </div>
                          <div className="home-kpi__scope">
                            الحاجة <span className="sting-mono">{preview.cost_messages}</span> رسالة
                            من رصيدك لا{" "}
                            <span className="sting-mono">{preview.audience.eligible}</span>
                          </div>
                        </div>
                      </div>
                      {preview.audience.with_debt_in_audience > 0 ? (
                        <p className="acc-choice__note">
                          <span className="sting-mono">
                            {preview.audience.with_debt_in_audience}
                          </span>{" "}
                          عليهم ذمم مستحقة — رسالة تسويقية لمدين قد تُفهم مطالبةً — تحذير لا منع.
                        </p>
                      ) : null}
                      <h3 className="cat-head__title">المعاينة</h3>
                      <p className="acc-choice__note">
                        المعاينة تعرض الرسالة كما ستصل حرفياً:{" "}
                        <span className="sting-mono">{preview.chars}</span> حرفاً ={" "}
                        {preview.parts === 2 ? (
                          "رسالتان نصيتان"
                        ) : (
                          <>
                            <span className="sting-mono">{preview.parts}</span> رسائل نصية
                          </>
                        )}
                        ، والتكلفة المعروضة{" "}
                        <span className="sting-mono">{preview.cost_messages}</span> رسالة من رصيدك
                        لا <span className="sting-mono">{preview.audience.eligible}</span>.
                      </p>
                      <blockquote className="not-preview">{message || "—"}</blockquote>
                      {blockers.length ? (
                        <Notice kind="warning" title="لا يمكن الجدولة بعد">
                          <p className="acc-lead">
                            {blockers.length === 3
                              ? "ثلاثة نواقص تمنع الإرسال."
                              : blockers.length === 2
                                ? "نقصان يمنعان الإرسال."
                                : "نقص واحد يمنع الإرسال."}{" "}
                            كلٌّ منها مذكور بسببه وبما يلزم لحلّه.
                          </p>
                          <ul className="acc-choice__note">
                            {blockers.map((b) => (
                              <li key={b.code}>
                                <strong>{b.title}</strong> · {b.detail}
                              </li>
                            ))}
                          </ul>
                          <p className="acc-choice__note">جدولة — غير متاحة</p>
                        </Notice>
                      ) : null}
                      <p className="acc-choice__note">
                        <strong>ما لا نعد به.</strong> قبول المزوّد للرسالة ليس تسليماً، والتسليم
                        ليس قراءة. نتائج الحملة تعرض «مقبول من المزوّد» و«فشل» فقط، ولا نسجّل «تم
                        الاطلاع» بلا دليل.
                      </p>
                    </>
                  ) : (
                    <p className="acc-choice__note">يُحسب الجمهور خادمياً…</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
