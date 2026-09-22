"use client";

import { Button, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/public/public.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "permission_denied";

interface Operator {
  id: string;
  name: string;
  email: string;
  active: boolean;
  created_at: string;
  last_login_at: string;
  is_me: boolean;
}
interface Payload {
  operators: Operator[];
  active_count: number;
  fetched_at: string;
  rule: string;
}

const ERRORS: Record<string, string> = {
  name_required: "الاسم مطلوب.",
  password_too_short: "كلمة المرور 10 أحرف على الأقل.",
  invalid_email: "بريد غير صالح — المشغّل يدخل ببريد لا هاتف.",
  tenant_account_email: "هذا بريد حساب متجر — المشغّل حساب من نوع آخر ولا يُنشأ عليه.",
  account_exists: "يوجد حساب بهذا البريد أصلاً.",
  cannot_disable_self: "لا تعطّل حسابك أنت.",
  already_in_state: "الحالة كما هي.",
};

const When = ({ iso }: { iso: string }) => {
  if (!iso) return <>—</>;
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

/** PLT-15 — حسابات المشغّلين: إنشاء، تعطيل يُسقط الجلسات، وإعادة تعيين كلمة المرور (بلا تحقّق ثنائي — 0005 §١٠٨). */
export function OperatorsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [resetFor, setResetFor] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data: d, response } = await platformApi().GET("/api/platform/operators");
    if (response.status === 403 || response.status === 401) {
      setDenied(true);
      return;
    }
    const b = d as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const fail = (code: string, status: number) =>
    setError(ERRORS[code] ?? `تعذّر التنفيذ (${code || status})`);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy("create");
    try {
      const r = await platformApi().POST("/api/platform/operators", {
        body: { name, email, password } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { operator: Operator } | { detail?: string } | undefined;
      if (r.response.ok && b && "operator" in b) {
        setDone(`أُنشئ المشغّل ${b.operator.name} — يدخل ببريده وكلمة المرور الأولية`);
        setName("");
        setEmail("");
        setPassword("");
        await load();
      } else fail((b as { detail?: string } | undefined)?.detail ?? "", r.response.status);
    } finally {
      setBusy("");
    }
  };

  const act = async (op: Operator, action: "disable" | "enable" | "reset_password") => {
    setError("");
    setDone("");
    setBusy(`${action}:${op.id}`);
    try {
      const r = await platformApi().POST("/api/platform/operators/{operator_id}/{action}", {
        params: { path: { operator_id: op.id, action } },
        body: (action === "reset_password" ? { password: newPassword } : {}) as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { operator: Operator } | { detail?: string } | undefined;
      if (r.response.ok && b && "operator" in b) {
        if (action === "reset_password") {
          setDone(`أُعيد تعيين كلمة مرور ${b.operator.name} — جلساته القديمة أُسقطت`);
          setResetFor("");
          setNewPassword("");
        }
        await load();
      } else fail((b as { detail?: string } | undefined)?.detail ?? "", r.response.status);
    } finally {
      setBusy("");
    }
  };

  const state: State = denied ? "permission_denied" : data ? "ready" : "loading";

  return (
    <PlatformFrame current="operators">
      <div className="sys plt-frame" data-screen="PLT-15" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">المشغّلون — حسابات من نوع آخر</h2>
            <span className="cat-head__hint">
              كل مشغّل ببريد وكلمة مرور. الإنشاء والتعطيل وإعادة التعيين تُسجَّل باسم من قام بها.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب المشغّلين">
                <p className="acc-lead">القائمة بحالة كلٍّ وآخر دخول له.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="مساحة المشغّل فقط">
                <p className="acc-lead">حسابات المشغّلين لا تُقرأ بغير صفة مشغّل.</p>
              </Notice>
            ) : null}
            {done ? <Status state="success" label={done} /> : null}

            {data ? (
              <>
                <h3 className="cat-head__title">
                  <span className="sting-mono">{data.active_count}</span> مشغّل فعّال
                </h3>
                <ul className="plt-demo">
                  {data.operators.map((op) => (
                    <li
                      key={op.id}
                      className="plt-demo__item"
                      data-status={op.active ? "converted" : "closed"}
                    >
                      <div className="plt-demo__top">
                        <strong>
                          {op.name}
                          {op.is_me ? <span className="plt-badge plt-badge--me">أنت</span> : null}
                        </strong>
                        <Status
                          state={op.active ? "success" : "expired"}
                          label={op.active ? "فعّال" : "معطَّل"}
                        />
                      </div>
                      <div className="cus-sub">
                        <span className="sting-mono">{op.email}</span> · أُنشئ{" "}
                        <When iso={op.created_at} /> · آخر دخول <When iso={op.last_login_at} />
                      </div>
                      {!op.is_me ? (
                        <div className="acc-actions plt-ops-row">
                          {op.active ? (
                            <Button
                              variant="danger"
                              loading={busy === `disable:${op.id}`}
                              onClick={() => void act(op, "disable")}
                            >
                              عطّل
                            </Button>
                          ) : (
                            <Button
                              loading={busy === `enable:${op.id}`}
                              onClick={() => void act(op, "enable")}
                            >
                              فعّل
                            </Button>
                          )}
                          {resetFor === op.id ? (
                            <>
                              <TextField
                                label="كلمة مرور جديدة"
                                kind="password"
                                autoComplete="new-password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                              />
                              <Button
                                loading={busy === `reset_password:${op.id}`}
                                disabledReason={
                                  newPassword.length < 10 ? "10 أحرف على الأقل" : undefined
                                }
                                onClick={() => void act(op, "reset_password")}
                              >
                                احفظ كلمة المرور
                              </Button>
                              <Button variant="quiet" onClick={() => setResetFor("")}>
                                إلغاء
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setResetFor(op.id);
                                setNewPassword("");
                              }}
                            >
                              أعد تعيين كلمة المرور
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {error ? <Status state="validation_error" label={error} /> : null}

                <h3 className="cat-head__title">مشغّل جديد</h3>
                <form className="plt-ops" onSubmit={(e) => void create(e)} noValidate>
                  <div className="plt-ops__fields plt-ops__fields--3">
                    <TextField
                      label="الاسم"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <TextField
                      label="البريد"
                      mono
                      inputMode="email"
                      autoComplete="off"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <TextField
                      label="كلمة مرور أولية"
                      kind="password"
                      autoComplete="new-password"
                      hint="10 أحرف على الأقل — يغيّرها المشغّل بعد أول دخول"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <div className="acc-actions">
                    <Button
                      type="submit"
                      loading={busy === "create"}
                      disabledReason={
                        !name.trim() || !email.trim() || password.length < 10
                          ? "الاسم والبريد وكلمة مرور من 10 أحرف"
                          : undefined
                      }
                    >
                      أنشئ المشغّل
                    </Button>
                  </div>
                </form>
                <p className="acc-choice__note">{data.rule}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
