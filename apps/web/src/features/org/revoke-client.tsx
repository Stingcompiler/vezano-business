"use client";

import { Button, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { agoParts } from "@/features/home/format";
import { MonoText } from "@/features/org/mono";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "permission_denied" | "pending_sync" | "success";

interface Preview {
  user: {
    id: string;
    display_name: string;
    is_owner: boolean;
    status: "active" | "disabled";
    deactivated_at: string;
  };
  scopes: { branch_id: string; branch_name: string; role_name: string; in_actor_scope: boolean }[];
  devices: {
    id: string;
    name: string;
    branch_name: string;
    status: string;
    pending: number;
    shared_with: string[];
  }[];
  pending_total: number;
  ledger: {
    invoices: number;
    shifts: number;
    open_shift: { id: string; opened_at: string; branch_name: string } | null;
  };
  can: { disable_user: boolean; revoke_branch: boolean; wipe_device: boolean };
  blockers: string[];
}
interface Result extends Preview {
  action: "disable" | "revoke_branch" | "wipe_device";
  sessions_ended?: number;
  sessions_deferred?: number;
  remaining_branches?: string[];
}

type Choice = "now" | "after_upload" | "wipe";

function daysWord(iso: string): string {
  const p = agoParts(iso);
  if (p.unit !== "day") return "اليوم";
  return p.n === 1 ? "يوم" : p.n === 2 ? "يومين" : `${p.n} أيام`;
}

/**
 * ORG-05 — سحب مستخدم أو نطاق أو جهاز: السحب لا يمحو عملاً (39-D31 ready/permission_denied/
 * success · 20-D15 validation_error · 07-D3 pending_sync): ثلاثة أفعال مختلفة؛ العدد يُعرض قبل
 * التأكيد لا بعده؛ الخيار الأوسط (ارفع المعلّق أولاً) ليس الافتراضي لأن السحب العاجل حالة حقيقية؛
 * التعطيل على جهاز مشترك لا يوقف البقية ولا يُمحى معلّقه (ACC-45، 63، 64؛ §٩.٣).
 */
export function RevokeClient({ userId }: { userId: string }) {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Preview | null>(null);
  const [denied, setDenied] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [ack, setAck] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scopeOnly, setScopeOnly] = useState<string | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/org/users/{user_id}/revocation", {
      params: { path: { user_id: userId } },
    });
    if (response.status === 403) {
      setDenied(true);
      return;
    }
    if (response.ok && data) setP(data);
  }, [userId]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/org/users/${userId}/revoke`)}`);
      return;
    }
    void load().catch(() => setDenied(true));
  }, [router, load, userId]);

  const run = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { data, error, response } = await api().POST("/api/org/users/{user_id}/revocation", {
        params: { path: { user_id: userId } },
        body: body as never,
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (!response.ok || !data) {
        const e = error as unknown as { detail?: string } | undefined;
        setErr(e?.detail ?? "failed");
        return;
      }
      setDone(data);
    } finally {
      setBusy(false);
    }
  };

  const disabledDevice = p?.devices.find((d) => d.pending > 0) ?? p?.devices[0];
  const shared = p?.devices.find((d) => d.shared_with.length > 0);

  const state: State =
    denied || (p && !p.can.disable_user && !p.can.revoke_branch)
      ? "permission_denied"
      : done
        ? "success"
        : p && p.blockers.includes("open_shift")
          ? "validation_error"
          : p &&
              p.pending_total > 0 &&
              shared &&
              !p.can.wipe_device === false &&
              choice === null &&
              scopeOnly === null &&
              p.can.disable_user &&
              p.devices.some((d) => d.shared_with.length > 0 && d.pending > 0)
            ? "pending_sync"
            : "ready";

  const confirm = async () => {
    if (!p) return;
    if (scopeOnly) {
      await run({ action: "revoke_branch", branch_id: scopeOnly, reason });
      return;
    }
    if (choice === "wipe" && disabledDevice) {
      await run({
        action: "wipe_device",
        device_id: disabledDevice.id,
        acknowledgement: ack,
        reason,
      });
      return;
    }
    await run({
      action: "disable",
      mode: choice === "after_upload" ? "after_upload" : "now",
      reason,
    });
  };

  const name = p?.user.display_name ?? "";
  const pendingText = (n: number) =>
    n === 0
      ? "لا معلّق"
      : n === 1
        ? "عملية واحدة معلّقة"
        : n === 2
          ? "عمليتان معلقتان"
          : `${n} عمليات معلّقة`;

  return (
    <Frame title="سحب الوصول" nav={<AppNav currentId="org-users" />} footer={null}>
      <div className="sys" data-screen="ORG-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">سحب مستخدم أو نطاق أو جهاز — السحب لا يمحو عملاً</h2>
            <span className="cat-head__hint">
              أخطر فعل إداري في المنشأة: قد يُنفَّذ في لحظة غضب أو بعد سرقة، وعلى الجهاز المسحوب
              عملٌ لم يُرفع. المنع فوريّ والعمل أمانة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="warning" title="مدير الفرع يسحب في فرعه">
                <p className="acc-lead">
                  يسحب وصول موظف عن فرعه، ولا يسحب المستخدم من المنشأة كلها ولا يمحو جهازاً.
                </p>
                <p className="acc-choice__note">
                  <strong>الحدّ</strong> · السحب من المنشأة ومحو الجهاز فعلان لا رجعة فيهما ويمسّان
                  عهدةً — للمالك وحده.
                </p>
                {p && p.can.revoke_branch ? (
                  <div className="cat-form__actions">
                    {p.scopes
                      .filter((s) => s.in_actor_scope)
                      .map((s) => (
                        <Button
                          key={s.branch_id}
                          variant="secondary"
                          loading={busy}
                          onClick={() =>
                            void run({ action: "revoke_branch", branch_id: s.branch_id })
                          }
                        >
                          سحب نطاق {s.branch_name}
                        </Button>
                      ))}
                  </div>
                ) : null}
              </Notice>
            ) : null}

            {state === "validation_error" && p?.ledger.open_shift ? (
              <Notice
                kind="warning"
                title="إجراء محجوب"
                action={
                  <>
                    <Button disabledReason="وردية مفتوحة باسمه — تُقفل إدارياً بعدّ حاضر أولاً">
                      تعطيل الدخول فوراً
                    </Button>
                    <Button variant="secondary" disabledReason="الحذف يترك أفعالاً بلا فاعل">
                      حذف الحساب — غير متاح
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">
                  <strong>تعطيل حساب «{name}»</strong> · قبل التعطيل نعرض ما يتعلّق به ولا يزال
                  مفتوحاً
                </p>
                <ul className="acc-choice__note">
                  <li>
                    <strong>يوقف</strong> · الدخول والبيع فوراً — لا جلسة تبقى مفتوحة على أي جهاز
                    بعد التعطيل
                  </li>
                  <li>
                    <strong>مانع</strong> · وردية مفتوحة منذ{" "}
                    {daysWord(p.ledger.open_shift.opened_at)} باسمه — تُقفل إدارياً بعدّ حاضر قبل
                    التعطيل، وإلا بقي صندوق بلا شهادة
                  </li>
                  <li>
                    <strong>يبقى</strong> ·{" "}
                    <MonoText
                      text={`${p.ledger.invoices.toLocaleString("en-US")} فاتورة و${p.ledger.shifts.toLocaleString("en-US")} وردية باسمه`}
                    />{" "}
                    — منسوبة إليه للأبد — هي شهادته وشهادة الدفتر معاً
                  </li>
                  <li>
                    <strong>أفعاله في سجل التدقيق</strong> · بما فيها ما اعتُمد له وما رُفض. لا
                    تنظيف للسجل عند الخروج.
                  </li>
                </ul>
                <p className="acc-choice__note">
                  <MonoText
                    text={`الحذف غير متاح لأن ${p.ledger.invoices.toLocaleString("en-US")} فاتورة و${p.ledger.shifts.toLocaleString("en-US")} وردية منسوبة لهذا الاسم.`}
                  />{" "}
                  حذفه يترك أفعالاً بلا فاعل، وسجل تدقيق بفاعل مجهول لا يصلح دليلاً.
                </p>
                <p className="acc-choice__note">
                  <strong>نقل ملكية المنشأة</strong> · أخطر إجراء في النظام: ينقل الدفتر كله ومعه
                  الذمم والأجهزة والاشتراك. لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع.
                </p>
              </Notice>
            ) : null}

            {state === "pending_sync" && p && shared ? (
              <Notice
                kind="info"
                title="معلّق المزامنة"
                action={
                  <>
                    <Button pos onClick={() => setChoice("now")} loading={busy}>
                      تعطيل المستخدم فقط
                    </Button>
                    <Button variant="secondary" onClick={() => router.push("/org/users")}>
                      إلغاء
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">
                  <strong>تعطيل {name}</strong> · يعمل على {shared.name}، وهو جهاز مشترك مع{" "}
                  {shared.shared_with.join(" و")}.
                </p>
                <p className="acc-choice__note">
                  لـ{name} <MonoText text={pendingText(shared.pending)} /> على {shared.name}، محفوظة
                  محلياً ولم تصل الخادم. التعطيل يمنع دخوله الجديد ولا يمحو عمله — يُرفع المعلّق
                  باسمه ويُنسب إليه في سجل التدقيق. {shared.shared_with.join(" و")} يواصلون العمل
                  على الجهاز نفسه بلا انقطاع.
                </p>
                <ul className="acc-choice__note">
                  <li>
                    <strong>تعطيل المستخدم</strong> · يمنع {name} من الدخول بحسابه على أي جهاز. عمله
                    السابق ومعلّقه يبقيان منسوبين إليه. — الجهاز يعمل · المستخدمون الآخرون يعملون
                  </li>
                  <li>
                    <strong>سحب نطاق فرع</strong> · يبقى الحساب نشطاً لكن يفقد الوصول إلى فرع بعينه
                    — يُستعمل عند نقل موظف. — يعمل في فروعه الأخرى
                  </li>
                  <li>
                    <strong>إلغاء الجهاز</strong> · يمحو حالة الجهاز نفسه ويقطعه عن المنشأة —
                    يُستعمل عند ضياع أو سرقة الجهاز. — يوقف كل من يعمل عليه · يحتاج استرداد المعلّق
                    أولاً
                  </li>
                </ul>
                <div className="cat-form__actions">
                  {p.scopes.map((s) => (
                    <Button
                      key={s.branch_id}
                      variant="quiet"
                      onClick={() => setScopeOnly(s.branch_id)}
                    >
                      سحب نطاق {s.branch_name}
                    </Button>
                  ))}
                  <Button variant="quiet" onClick={() => setChoice("wipe")}>
                    إلغاء الجهاز
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "success" && done ? (
              <Notice kind="success" title="سُحب الوصول">
                <p className="acc-lead">
                  ما سُحب بالضبط، ومصير المعلّق:{" "}
                  {done.action === "disable"
                    ? `دخول ${name} إلى المنشأة — مُنع فوراً على كل الأجهزة`
                    : done.action === "revoke_branch"
                      ? `نطاق فرع — يبقى ${name} في ${done.remaining_branches?.length ? done.remaining_branches.join("، ") : "لا فرع آخر"}`
                      : `جهاز ${disabledDevice?.name ?? ""} — مُحي وقُطع عن المنشأة`}
                  {done.pending_total > 0 && done.action !== "wipe_device" ? (
                    <>
                      {" "}
                      · <MonoText text={pendingText(done.pending_total)} /> محفوظة على الجهاز قابلة
                      للاسترداد من شاشة «الاسترداد».
                    </>
                  ) : null}
                </p>
                <p className="acc-choice__note">
                  <strong>لا اختفاء صامت</strong> · الموظف يرى على جهازه رسالةً تقول إن وصوله سُحب —
                  لا شاشةَ خطأٍ غامضة يظنّها عطباً فيتصل بالدعم.
                </p>
                <p className="acc-choice__note">
                  <strong>في سجل التدقيق</strong> · باسم من سحب ووقته وسببه إن كُتب. السحب فعلٌ
                  يُراجَع لاحقاً كغيره.
                </p>
                <div className="cat-form__actions">
                  <Button onClick={() => router.push("/org/users")}>المستخدمون والدعوات</Button>
                </div>
              </Notice>
            ) : null}

            {state === "ready" && p ? (
              <>
                <h3 className="cat-head__title">سحب وصول — {name}</h3>
                <p className="acc-choice__note">
                  <strong>ما الذي يُسحب</strong>
                </p>
                <ul className="acc-choice__note">
                  <li>
                    <strong>الدخول إلى المنشأة</strong> · يُمنع فوراً على كل الأجهزة
                  </li>
                  {p.devices.map((d) => (
                    <li key={d.id}>
                      <strong>جهاز «{d.name}»</strong> · العهدة المسجّلة باسمه
                      {d.pending > 0 ? " · عليه عمل معلّق" : " · لا معلّق"}
                    </li>
                  ))}
                  {p.scopes.map((s) => (
                    <li key={s.branch_id}>
                      <strong>نطاق {s.branch_name}</strong> · {s.role_name}
                      {p.scopes.length > 1 ? (
                        <>
                          {" "}
                          · كان يعمل في <MonoText text={`${p.scopes.length} فروع`} /> · يبقى في{" "}
                          {p.scopes
                            .filter((x) => x.branch_id !== s.branch_id)
                            .map((x) => x.branch_name)
                            .join("، ")}{" "}
                          إن سُحب هذا النطاق وحده
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {p.pending_total > 0 ? (
                  <Notice kind="warning" title="على جهازه عملٌ لم يُرفع">
                    <p className="acc-lead">
                      <MonoText text={pendingText(p.pending_total)} /> — السحب يقطع رفعها. لا نمنعك
                      — قد يكون السحب عاجلاً — لكن العدد يُعرض قبل التأكيد لا بعده.
                    </p>
                  </Notice>
                ) : null}
                <fieldset className="cat-form">
                  <legend className="acc-choice__note">
                    <strong>كيف يُسحب</strong>
                  </legend>
                  {(
                    [
                      ["now", "اسحب الآن — ويبقى المعلّق محفوظاً للاسترداد لاحقاً"],
                      ["after_upload", "ارفع المعلّق أولاً ثم اسحب — دقيقتان تقريباً"],
                      ["wipe", "اسحب فوراً وامحُ بيانات الجهاز — سرقة أو فقد"],
                    ] as [Choice, string][]
                  ).map(([v, label]) => (
                    <label key={v} className="web03-check">
                      <input
                        type="radio"
                        name="revoke-mode"
                        value={v}
                        checked={choice === v && scopeOnly === null}
                        disabled={v === "wipe" && !p.can.wipe_device}
                        onChange={() => {
                          setChoice(v);
                          setScopeOnly(null);
                        }}
                      />{" "}
                      {label}
                    </label>
                  ))}
                  {p.scopes.length > 0 ? (
                    <div className="cat-form__actions">
                      {p.scopes
                        .filter((s) => s.in_actor_scope)
                        .map((s) => (
                          <label key={s.branch_id} className="web03-check">
                            <input
                              type="radio"
                              name="revoke-mode"
                              value={`scope-${s.branch_id}`}
                              checked={scopeOnly === s.branch_id}
                              onChange={() => {
                                setScopeOnly(s.branch_id);
                                setChoice(null);
                              }}
                            />{" "}
                            سحب نطاق {s.branch_name} فقط — يبقى الحساب نشطاً في فروعه الأخرى
                          </label>
                        ))}
                    </div>
                  ) : null}
                </fieldset>
                <p className="acc-choice__note">
                  الخيار الأوسط هو الصحيح في أغلب الحالات، وليس هو الافتراضي — لأن السحب العاجل
                  حالةٌ حقيقية أيضاً، والاختيار للمالك لا لنا.
                </p>
                {choice === "wipe" ? (
                  <TextField
                    label="إقرار مكتوب بفقد المعلّق"
                    hint="يُسجَّل باسمك في سجل التدقيق — المعلّق على الجهاز يُعدّ مفقوداً إلا ما يُسترد من شاشة «الاسترداد» قبل المحو"
                    value={ack}
                    onChange={(e) => setAck(e.target.value)}
                    required
                  />
                ) : null}
                <TextField
                  label="السبب — اختياري"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                {err ? (
                  <p className="acc-choice__note">
                    {err === "acknowledgement_required"
                      ? "الإقرار المكتوب إلزامي حين على الجهاز معلّق"
                      : err === "owner_not_revocable"
                        ? "المالك لا يُسحب إلا بنقل ملكية موثَّق"
                        : "تعذّر السحب — لم يتغيّر شيء"}
                  </p>
                ) : null}
                <div className="cat-form__actions">
                  <Button
                    pos
                    financial
                    onClick={() => void confirm()}
                    loading={busy}
                    disabledReason={
                      choice === null && scopeOnly === null
                        ? "اختر كيف يُسحب"
                        : choice === "wipe" && !ack.trim()
                          ? "الإقرار المكتوب إلزامي"
                          : undefined
                    }
                  >
                    تأكيد السحب
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/org/users")}>
                    إلغاء
                  </Button>
                </div>
                <p className="acc-choice__note">
                  <strong>مدير الفرع يسحب في فرعه</strong> · يسحب وصول موظف عن فرعه، ولا يسحب
                  المستخدم من المنشأة كلها ولا يمحو جهازاً. <strong>الحدّ</strong> · السحب من
                  المنشأة ومحو الجهاز فعلان لا رجعة فيهما ويمسّان عهدةً — للمالك وحده.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
