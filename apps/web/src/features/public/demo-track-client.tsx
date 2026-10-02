"use client";

/**
 * متابعة طلب الجولة (0005 §١٤٧) — ثلاث خطوات:
 * 1. `find`: البريد أو رقم الهاتف أو الاسم.
 * 2. `code`: الرمز يُرسل إلى **بريد الطلب** أياً كان مفتاح البحث، ويظهر مقنَّعاً.
 * 3. `ready`: الحالة وما تعنيه، وتعليقات الفريق، وتحديث برمز متابعة موقَّع (30 دقيقة) بلا رمز جديد.
 */
import { Button, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { type FormEvent, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/sys/sys.css";
import "./public.css";
import "./demo-track.css";
import { CodeInput } from "@/features/acc/code-input";
import { dayMonth, hhmm } from "@/features/home/format";
import {
  type CodeSent,
  devCodeFor,
  errorText,
  getJson,
  postJson,
  type TrackRequest,
} from "@/features/public/demo-api";
import { PublicFooter } from "@/features/public/public-footer";
import { PublicHeader } from "@/features/public/public-header";

type Step = "find" | "code" | "ready";

const TONE: Record<TrackRequest["status"], "pending_sync" | "stale" | "success" | "expired"> = {
  new: "pending_sync",
  contacted: "stale",
  converted: "success",
  closed: "expired",
};

const When = ({ iso }: { iso: string }) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

export function DemoTrackClient() {
  const [step, setStep] = useState<Step>("find");
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [req, setReq] = useState<TrackRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  const start = async () => {
    setErr(null);
    if (!query.trim()) return setErr("اكتب البريد أو رقم الهاتف أو الاسم الذي سجّلت به.");
    setBusy(true);
    try {
      const r = await postJson<CodeSent>("/api/public/demo-track/start", { query: query.trim() });
      if (!r.ok) return setErr(errorText(r.body.detail));
      setSent(r.body);
      setCode("");
      setAttemptsLeft(null);
      setStep("code");
      // رمز التطوير يُقرأ بالبريد الكامل وحده — في التطوير يكون البحث بالبريد غالباً
      setDevCode(query.includes("@") ? await devCodeFor(query.trim()) : null);
    } catch {
      setErr("لا اتصال — المتابعة تحتاج الشبكة.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await postJson<{ token: string; request: TrackRequest }>(
        "/api/public/demo-track/verify",
        { query: query.trim(), code },
      );
      if (!r.ok) {
        setAttemptsLeft(r.body.detail === "code_invalid" ? (r.body.attempts_left ?? null) : null);
        return setErr(errorText(r.body.detail));
      }
      setToken(r.body.token);
      setReq(r.body.request);
      setStep("ready");
    } catch {
      setErr("لا اتصال — المتابعة تحتاج الشبكة.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await getJson<{ request: TrackRequest }>(
        `/api/public/demo-track?token=${encodeURIComponent(token)}`,
      );
      if (r.ok) return setReq(r.body.request);
      setErr(errorText(r.body.detail));
      if (r.status === 401) {
        setStep("find");
        setReq(null);
      }
    } catch {
      setErr("لا اتصال — المتابعة تحتاج الشبكة.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step === "find") void start();
    else if (step === "code") void verify();
  };

  const state = step === "ready" ? "ready" : err ? "validation_error" : "ready";

  return (
    <Frame
      title="فيزانو بلص"
      back={false}
      chrome={<PublicHeader cta="login" />}
      footer={<PublicFooter inFrame compact />}
    >
      <div className="sys pub dt" data-screen="PUB-06" data-state={state} data-step={step}>
        <form className="dt__card" onSubmit={onSubmit} noValidate>
          <div className="dt__head">
            <span className="dt__kicker">طلب الجولة</span>
            <h1 className="dt__title">تابع طلبك</h1>
            <p className="dt__lead">
              ابحث بالبريد أو رقم الهاتف أو الاسم الذي سجّلت به. نرسل رمز الدخول إلى البريد المسجَّل
              في الطلب — فلا يرى الطلب غير صاحبه.
            </p>
          </div>

          {step === "find" ? (
            <>
              {err ? <Notice kind="warning" title={err} /> : null}
              <TextField
                label="البريد أو رقم الهاتف أو الاسم"
                placeholder="name@example.com أو 0912345678"
                autoComplete="email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                readOnly={busy}
              />
              <div className="acc-actions">
                <Button type="submit" pos loading={busy}>
                  أرسل رمز الدخول
                </Button>
              </div>
            </>
          ) : null}

          {step === "code" && sent ? (
            <>
              <p className="acc-lead">
                أرسلنا رمزاً إلى <span className="sting-mono">{sent.sent_to}</span> — البريد
                المسجَّل في الطلب.
              </p>
              {devCode ? (
                <Notice
                  kind="info"
                  title="بيئة تطوير — لا مزوّد إرسال بعد"
                  action={<Button onClick={() => setCode(devCode)}>املأ الرمز</Button>}
                >
                  <p className="acc-choice__note">
                    الرمز الذي كان سيصلك: <span className="sting-mono">{devCode}</span>
                  </p>
                </Notice>
              ) : null}
              <CodeInput
                label="رمز الدخول"
                length={sent.code_length}
                value={code}
                onChange={setCode}
                locked={busy}
                invalid={err !== null && attemptsLeft !== null}
              />
              {err ? <Status state="validation_error" label={err} /> : null}
              {attemptsLeft !== null ? (
                <p className="acc-choice__note">
                  بقيت <span className="sting-mono">{attemptsLeft}</span> محاولات.
                </p>
              ) : null}
              <div className="acc-actions">
                <Button
                  type="submit"
                  pos
                  loading={busy}
                  disabledReason={code.length < sent.code_length ? "أكمل الرمز" : undefined}
                >
                  اعرض طلبي
                </Button>
                <Button variant="secondary" loading={busy} onClick={() => void start()}>
                  إرسال رمز جديد
                </Button>
                <Button variant="quiet" onClick={() => setStep("find")}>
                  ابحث ببيانات أخرى
                </Button>
              </div>
            </>
          ) : null}

          {step === "ready" && req ? (
            <section className="dt__result" aria-label="حالة الطلب">
              {err ? <Notice kind="warning" title={err} /> : null}
              <div className="dt__status">
                <div>
                  <span className="dt__ref">
                    طلب رقم <span className="sting-mono">{req.reference}</span>
                  </span>
                  <strong className="dt__name">{req.name}</strong>
                </div>
                <Status state={TONE[req.status]} label={req.status_label} />
              </div>
              <p className="dt__note">{req.status_note}</p>
              <dl className="dt__facts">
                <div>
                  <dt>قُدِّم</dt>
                  <dd>
                    <When iso={req.created_at} />
                  </dd>
                </div>
                <div>
                  <dt>آخر تحديث</dt>
                  <dd>
                    <When iso={req.updated_at} />
                  </dd>
                </div>
                <div>
                  <dt>طريقة التواصل</dt>
                  <dd>{req.channel_label}</dd>
                </div>
                <div>
                  <dt>البريد</dt>
                  <dd className="sting-mono">{req.email}</dd>
                </div>
              </dl>
              <h2 className="dt__sub">تعليقات الفريق</h2>
              {req.comments.length === 0 ? (
                <p className="acc-choice__note">
                  لا تعليقات بعد — سيظهر هنا ما يكتبه الفريق لك عن طلبك.
                </p>
              ) : (
                <ol className="dt__comments">
                  {req.comments.map((c, i) => (
                    <li key={`${c.at}-${i}`}>
                      <p>{c.body}</p>
                      <span className="acc-choice__note">
                        {c.author} · <When iso={c.at} />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="acc-actions">
                <Button variant="secondary" loading={busy} onClick={() => void refresh()}>
                  حدّث الحالة
                </Button>
              </div>
            </section>
          ) : null}
        </form>
      </div>
    </Frame>
  );
}
