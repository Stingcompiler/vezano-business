"use client";

import {
  Button,
  formatMinor,
  Frame,
  Notice,
  Status,
  SwitchField,
  TextAreaField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { PosNav } from "@/features/pos/pos-nav";
import { api, apiBaseUrl } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "permission_denied" | "success" | "server_error";
type Range = "30" | "all";
type Kind = "pdf" | "link";

interface Row {
  readonly doc: string;
  readonly doc_id: string;
  readonly kind: string;
  readonly label: string;
  readonly occurred_at: string;
  readonly business_date: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly balance_minor: string;
  readonly branch_id: string;
  readonly info: boolean;
}

interface Statement {
  readonly party: { readonly id: string; readonly name: string };
  readonly rows: readonly Row[];
  readonly balance_minor: string;
  readonly hidden_other_branch: number;
  readonly as_of: string;
  readonly scope: "all" | "branch";
  readonly branch_names: Record<string, string>;
  readonly tenant_name: string;
}

interface Export {
  readonly id: string;
  readonly kind: Kind;
  readonly file_name: string;
  readonly page_count: number;
  readonly url: string;
  readonly generated_at: string;
  readonly opened_at: string;
  readonly open_count: number;
}

/** سطور الصفحة A4 المتوقَّعة — لعدّ الصفحات قبل التوليد (كما الخادم). */
const ROWS_PER_PAGE = 40;

/**
 * PTY-08 — طباعة وتصدير ومشاركة الكشف (04-D2 ready · 40-D32 loading/permission_denied/success/
 * server_error): معاينة الحقول والجمهور قبل المشاركة؛ الطباعة للحاضر من الشاشة، والملف والرابط
 * المخوَّل للمالك (ACC-85)؛ لا وعد بالتسليم — «أُرسل» ليست «وصل» (R-06/R-09)؛ قالب تذكير الدين
 * يدوي يراجعه المالك ويرسله بنفسه (N-01) — لا زرّ إرسال آلي.
 */
export function ShareClient({ partyId, range }: { partyId: string; range: Range }) {
  const router = useRouter();
  const app = useApp();
  const [stmt, setStmt] = useState<Statement | null | undefined>(undefined);
  const [rng, setRng] = useState<Range>(range);
  const [movements, setMovements] = useState(true);
  const [invoices, setInvoices] = useState(false);
  const [branches, setBranches] = useState(false);
  const [phase, setPhase] = useState<"idle" | "generating" | "done" | "failed">("idle");
  const [kind, setKind] = useState<Kind>("pdf");
  const [exp, setExp] = useState<Export | null>(null);
  const [denied, setDenied] = useState(false);
  const [failReason, setFailReason] = useState<"too_long" | "server">("server");
  const [reminder, setReminder] = useState("");
  const [copied, setCopied] = useState<"" | "reminder" | "link">("");
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    const here = `/parties/${partyId}/statement/share?range=${rng}`;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/parties/{party_id}/statement", {
          params: { path: { party_id: partyId }, query: { range: rng } },
        });
        if (!alive) return;
        if (response.status === 403) {
          setDenied(true);
          setStmt(null);
          return;
        }
        const body = data as unknown as Statement | undefined;
        if (!response.ok || !body) {
          setStmt(null);
          return;
        }
        setStmt(body);
      } catch {
        if (alive) setStmt(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [partyId, rng, router]);

  useEffect(() => {
    if (stmt === null && !denied) router.replace(`/parties/${partyId}/statement`);
  }, [stmt, denied, router, partyId]);

  // قالب التذكير يُملأ من الكشف مرة واحدة ثم يبقى ملكاً للمالك يعدّله ويرسله بنفسه
  useEffect(() => {
    if (!stmt || reminder) return;
    const d = dayMonth(stmt.as_of);
    setReminder(
      `${stmt.party.name}، رصيدكم المستحق لدى ${stmt.tenant_name} حتى ${d.day} ${d.month}: ${formatMinor(
        stmt.balance_minor,
      )}. الإرسال للزبون يحمل ختم وقته وما ينقصه إن كان هناك معلّق.`,
    );
  }, [stmt, reminder]);

  const isOwner = stmt?.scope === "all";
  const rows = stmt?.rows ?? [];
  const shown = movements ? rows : [];
  const expectedPages = Math.max(1, Math.ceil(shown.length / ROWS_PER_PAGE));
  const asOf = stmt ? dayMonth(stmt.as_of) : null;

  const state: State = denied
    ? "permission_denied"
    : stmt === undefined || phase === "generating"
      ? "loading"
      : phase === "done" && exp
        ? "success"
        : phase === "failed"
          ? "server_error"
          : "ready";

  const generate = async (k: Kind) => {
    if (!stmt || phase === "generating") return;
    setKind(k);
    setPhase("generating");
    try {
      const { data, error, response } = await api().POST(
        "/api/parties/{party_id}/statement/export",
        {
          params: { path: { party_id: stmt.party.id } },
          body: { kind: k, range: rng, include_invoices: invoices, include_branch: branches },
        },
      );
      if (response.status === 403) {
        setDenied(true);
        setPhase("idle");
        return;
      }
      if (response.status === 400) {
        const errs = (error as { errors?: { code: string }[] } | undefined)?.errors;
        setFailReason(errs?.[0]?.code === "too_long" ? "too_long" : "server");
        setPhase("failed");
        return;
      }
      const body = data as unknown as { export: Export } | undefined;
      if (!response.ok || !body) {
        setFailReason("server");
        setPhase("failed");
        return;
      }
      setExp(body.export);
      setPhase("done");
    } catch {
      setFailReason("server");
      setPhase("failed");
    }
  };

  const refreshStatus = async () => {
    if (!exp) return;
    const { data, response } = await api().GET("/api/parties/statement-exports/{export_id}", {
      params: { path: { export_id: exp.id } },
    });
    const body = data as unknown as { export: Export } | undefined;
    if (response.ok && body) setExp(body.export);
  };

  const copy = async (what: "reminder" | "link") => {
    const text = what === "reminder" ? reminder : exp ? `${apiBaseUrl()}${exp.url}` : "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied("");
    }
  };

  const print = () => window.print();

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={!denied} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              مشاركة كشف حساب{stmt ? <> {stmt.party.name}</> : null}
            </h2>
            <span className="cat-head__hint">
              معاينة الحقول والجمهور قبل المشاركة، بلا وعد بالتسليم.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="المشاركة الخارجية للمالك">
                <p className="acc-lead">
                  الكاشير يطبع نسخةً للطرف الحاضر، ولا يرسل الكشف برابط خارجي.
                </p>
                <p className="acc-choice__note">
                  <strong>الفرق</strong> · الطباعة للحاضر الذي يعرف رقمه؛ والرابط قد يُعاد توجيهه.
                  الأخير قرار مالك.
                </p>
              </Notice>
            ) : null}

            {state === "loading" ? (
              <Notice kind="info" title="جارٍ التوليد">
                <p className="acc-lead">مع عدد الصفحات المتوقَّع ومعاينة الأولى.</p>
                {stmt ? (
                  <p className="acc-choice__note">
                    الصفحات المتوقَّعة <span className="sting-mono">{expectedPages}</span> ·{" "}
                    {kind === "pdf" ? "تصدير PDF" : "مشاركة رابط"}
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice kind="error" title="فشل التوليد">
                <p className="acc-lead">الكشف طويل أو الخادم تعثّر.</p>
                <p className="acc-choice__note">
                  <strong>البديل</strong> · مدى أقصر، أو طباعة مباشرة من الشاشة بلا توليد ملف.
                  والطرف قد يكون واقفاً ينتظر.
                </p>
                <div className="cat-form__actions">
                  {failReason === "too_long" || rng === "all" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setRng("30");
                        setPhase("idle");
                      }}
                      disabledReason={rng === "30" ? "المدى الأقصر معروض" : undefined}
                    >
                      مدى أقصر
                    </Button>
                  ) : null}
                  <Button onClick={print}>طباعة</Button>
                  <Button variant="quiet" onClick={() => setPhase("idle")}>
                    إلغاء
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "success" && exp ? (
              <>
                <Notice kind="success" title="جاهز">
                  <p className="acc-lead">
                    الملف بمداه في اسمه، ومعه وقت توليده — والكشف المطبوع يحمل الوقت في ترويسته.
                  </p>
                  <p className="acc-choice__note">
                    <span className="pty-doc__file">{exp.file_name}</span> ·{" "}
                    <span className="sting-mono">{exp.page_count}</span>{" "}
                    {exp.page_count === 1 ? "صفحة" : "صفحات"} · وُلِّد{" "}
                    <span className="sting-mono">{hhmm(exp.generated_at)}</span>
                  </p>
                </Notice>
                <Notice kind="warning" title="لا وعد تسليم">
                  <p className="acc-lead">
                    المشاركة تُنشئ رابطاً ولا تَعِد بأن الطرف قرأه. «أُرسل» ليست «وصل».
                  </p>
                  <div className="shift-status">
                    <Status
                      state={exp.opened_at ? "synced" : "pending_sync"}
                      label={
                        exp.opened_at ? (
                          <>
                            تم الاطلاع <span className="sting-mono">{hhmm(exp.opened_at)}</span>
                          </>
                        ) : (
                          "لم يُفتح بعد"
                        )
                      }
                      dot={false}
                    />
                    <Button variant="quiet" onClick={() => void refreshStatus()}>
                      تحديث الحالة
                    </Button>
                  </div>
                </Notice>
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => window.open(`${apiBaseUrl()}${exp.url}`, "_blank", "noopener")}
                  >
                    {exp.kind === "pdf" ? "تصدير PDF" : "مشاركة رابط"}
                  </Button>
                  {exp.kind === "link" ? (
                    <Button variant="secondary" onClick={() => void copy("link")}>
                      {copied === "link" ? "نُسخ الرابط" : "نسخ الرابط"}
                    </Button>
                  ) : null}
                  <Button variant="quiet" onClick={() => setPhase("idle")}>
                    إلغاء
                  </Button>
                </div>
              </>
            ) : null}

            {stmt && asOf && state !== "permission_denied" ? (
              <>
                {state === "ready" ? (
                  <>
                    <div className="cat-head">
                      <h3 className="cat-head__title">ما سيراه المستلم</h3>
                    </div>
                    <SwitchField
                      label="الحركات والأرصدة"
                      checked={movements}
                      onChange={setMovements}
                    />
                    <SwitchField
                      label="أرقام الفواتير التفصيلية"
                      checked={invoices}
                      onChange={setInvoices}
                    />
                    <SwitchField
                      label="اسم الفرع لكل حركة"
                      checked={branches}
                      onChange={setBranches}
                    />
                  </>
                ) : null}

                <div className="cat-head">
                  <h3 className="cat-head__title">معاينة المستند</h3>
                </div>
                <div className="pty-doc">
                  <div className="pty-doc__shop">{stmt.tenant_name}</div>
                  <div className="acc-choice__note">
                    كشف حساب: {stmt.party.name} · حتى <span className="sting-mono">{asOf.day}</span>{" "}
                    {asOf.month}
                  </div>
                  <div className="pty-doc__stamp acc-choice__note">
                    وُلِّد <span className="sting-mono">{hhmm(new Date().toISOString())}</span> ·
                    المدى {rng === "all" ? "كامل" : <span className="sting-mono">30</span>}
                  </div>
                  {shown.length ? (
                    <table className="pty-doc__table">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>البيان</th>
                          {invoices ? <th>المستند</th> : null}
                          {branches ? <th>الفرع</th> : null}
                          <th>عليه</th>
                          <th>له</th>
                          <th>الرصيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => {
                          const d = dayMonth(r.business_date || r.occurred_at);
                          return (
                            <tr key={r.doc_id}>
                              <td>
                                <span className="sting-mono">{d.day}</span> {d.month}
                              </td>
                              <td>{r.label}</td>
                              {invoices ? <td className="sting-mono">{r.doc}</td> : null}
                              {branches ? (
                                <td>{stmt.branch_names[r.branch_id] ?? "الرئيسي"}</td>
                              ) : null}
                              <td className="sting-mono">
                                {r.debit_minor ? formatMinor(r.debit_minor) : "—"}
                              </td>
                              <td className="sting-mono">
                                {r.credit_minor ? formatMinor(r.credit_minor) : "—"}
                              </td>
                              <td className="sting-mono">{formatMinor(r.balance_minor)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : null}
                  <div className="pty-doc__total">
                    <span>الرصيد المستحق</span>
                    <span className="sting-mono">{formatMinor(stmt.balance_minor)}</span>
                  </div>
                </div>

                {state === "ready" ? (
                  <>
                    <Notice
                      kind="warning"
                      title="المشاركة تُنشئ ملفاً أو رابطاً. لا نضمن وصوله ولا قراءته، ولا نسجّل «تم الاطلاع» ما لم يفتح المستلم رابطاً مخوَّلاً."
                    />
                    <div className="cat-form__actions">
                      <Button pos onClick={print}>
                        طباعة
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void generate("pdf")}
                        disabledReason={isOwner ? undefined : "المشاركة الخارجية للمالك"}
                      >
                        تصدير PDF
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void generate("link")}
                        disabledReason={isOwner ? undefined : "المشاركة الخارجية للمالك"}
                      >
                        مشاركة رابط
                      </Button>
                    </div>
                    {isOwner ? (
                      <>
                        <TextAreaField
                          label="تذكير الدين — يدوي، تراجعه وترسله بنفسك"
                          value={reminder}
                          onChange={(e) => setReminder(e.target.value)}
                          rows={4}
                        />
                        <div className="cat-form__actions">
                          <Button variant="secondary" onClick={() => void copy("reminder")}>
                            {copied === "reminder" ? "نُسخ القالب" : "نسخ القالب"}
                          </Button>
                          <Button
                            variant="quiet"
                            onClick={() => router.push(`/parties/${stmt.party.id}/statement`)}
                          >
                            كشف الحساب
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="cat-form__actions">
                        <Button
                          variant="quiet"
                          onClick={() => router.push(`/parties/${stmt.party.id}/statement`)}
                        >
                          كشف الحساب
                        </Button>
                      </div>
                    )}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
