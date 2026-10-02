"use client";

/**
 * نموذج «اطلب الجولة» في الهبوط (0005 §١٤٧) — أربع حالات:
 * - `form`: الحقول، والبريد إلزامي (إليه يُرسل رمز التأكيد ثم المتابعة).
 * - `code`: رمز البريد؛ لا يُحفظ الطلب قبل تأكيده.
 * - `duplicate`: طلب سابق بالبريد أو الهاتف أو الاسم نفسه؛ رسالة تدلّ على صفحة المتابعة.
 * - `done`: رقم الطلب ورابط المتابعة.
 */
import { Button, Notice, RadioGroupField, Status, TextAreaField, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";

import "@/features/acc/acc.css";
import "./demo-track.css";
import { CodeInput } from "@/features/acc/code-input";
import { type CodeSent, devCodeFor, errorText, postJson } from "@/features/public/demo-api";

type Step = "form" | "code" | "duplicate" | "done";

export function DemoRequestForm({ intro }: { intro: ReactNode }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [whats, setWhats] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const fields = () => ({
    name: name.trim(),
    whatsapp: whats.trim(),
    email: email.trim(),
    channel,
    message: msg.trim(),
  });

  const requestCode = async () => {
    setErr(null);
    if (!name.trim()) return setErr(errorText("name_required"));
    if (whats.replace(/\D/g, "").length < 8) return setErr(errorText("whatsapp_invalid"));
    if (!email.trim()) return setErr(errorText("email_required"));
    if (!email.includes("@")) return setErr(errorText("email_invalid"));
    setBusy(true);
    try {
      const r = await postJson<CodeSent>("/api/public/contact/start", fields());
      if (r.ok) {
        setSent(r.body);
        setCode("");
        setAttemptsLeft(null);
        setStep("code");
        setDevCode(await devCodeFor(email.trim()));
        return;
      }
      if (r.body.detail === "duplicate") return setStep("duplicate");
      setErr(errorText(r.body.detail));
    } catch {
      setErr("لا اتصال — الطلب يحتاج الشبكة.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await postJson<{ reference: string }>("/api/public/contact", {
        ...fields(),
        code,
      });
      if (r.ok) {
        setReference(r.body.reference);
        return setStep("done");
      }
      if (r.body.detail === "duplicate") return setStep("duplicate");
      setAttemptsLeft(r.body.detail === "code_invalid" ? (r.body.attempts_left ?? null) : null);
      setErr(errorText(r.body.detail));
    } catch {
      setErr("لا اتصال — الطلب يحتاج الشبكة.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "form") void requestCode();
    else if (step === "code") void confirm();
  };

  const track = (
    <Button pos onClick={() => router.push("/demo/track")}>
      تابع طلبك
    </Button>
  );

  return (
    <form className="lp__contact" onSubmit={onSubmit} noValidate data-step={step}>
      {intro}

      {step === "done" ? (
        <Notice kind="success" title="وصل طلبك — نتواصل معك على القناة التي اخترتها">
          <p className="acc-lead">
            رقم الطلب <span className="sting-mono">{reference}</span>. لا نعد بموعد قبل أن نتصل —
            لكننا نقرأ كل طلب. تابع حالته وردود الفريق من صفحة المتابعة.
          </p>
          <div className="acc-actions">{track}</div>
        </Notice>
      ) : null}

      {step === "duplicate" ? (
        <Notice kind="warning" title="طلبك وصلنا من قبل">
          <p className="acc-lead">
            وجدنا طلب جولة بهذه البيانات. تابعه من صفحة المتابعة بدل إرسال طلب جديد — نرسل رمز
            الدخول إلى البريد الذي سجّلته فيه.
          </p>
          <div className="acc-actions">
            {track}
            <Button variant="quiet" onClick={() => setStep("form")}>
              عدّل البيانات
            </Button>
          </div>
        </Notice>
      ) : null}

      {step === "code" && sent ? (
        <div className="lp__code">
          <p className="acc-lead">
            أرسلنا رمز تأكيد إلى <span className="sting-mono">{sent.sent_to}</span>. أدخله ليصل طلبك
            — لا نحفظ شيئاً قبل تأكيد البريد.
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
            label="رمز التأكيد"
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
          <div className="lp__cta">
            <Button
              type="submit"
              pos
              loading={busy}
              disabledReason={code.length < sent.code_length ? "أكمل الرمز" : undefined}
            >
              أكّد وأرسل الطلب
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => void requestCode()}>
              إرسال رمز جديد
            </Button>
            <Button variant="quiet" onClick={() => setStep("form")}>
              عدّل البيانات
            </Button>
          </div>
        </div>
      ) : null}

      {step === "form" ? (
        <>
          {err ? <Notice kind="error" title={err} /> : null}
          <div className="lp__contact-grid">
            <TextField
              label="اسمك"
              placeholder="اسمك"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={busy}
              required
            />
            <TextField
              label="رقم الواتساب"
              placeholder="رقم الواتساب"
              kind="tel"
              autoComplete="tel"
              value={whats}
              onChange={(e) => setWhats(e.target.value)}
              readOnly={busy}
              required
            />
          </div>
          <TextField
            label="بريدك"
            placeholder="name@example.com"
            hint="نرسل إليه رمز تأكيد، وبه تتابع طلبك."
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={busy}
            required
          />
          <RadioGroupField
            label="كيف نتواصل معك؟"
            name="contact-channel"
            value={channel}
            onChange={setChannel}
            options={[
              { value: "whatsapp", label: "واتساب" },
              { value: "call", label: "مكالمة" },
              { value: "email", label: "بريد" },
            ]}
          />
          <TextAreaField
            label="ما الذي تودّ حلّه؟"
            placeholder="ما الذي تودّ حلّه؟"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            readOnly={busy}
            rows={4}
          />
          <div className="lp__cta">
            <Button type="submit" pos loading={busy}>
              اطلب الجولة — مجاناً
            </Button>
          </div>
          <p className="lp__note">
            لا رسائل تسويقية. الطلب يصل إلى فريق فيزانو بلص ويُردّ عليه بشرياً. سبق أن طلبت؟{" "}
            <a
              href="/demo/track"
              onClick={(e) => {
                e.preventDefault();
                router.push("/demo/track");
              }}
            >
              تابع طلبك
            </a>
          </p>
        </>
      ) : null}
    </form>
  );
}
