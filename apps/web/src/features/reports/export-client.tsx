"use client";

import { Button, DocPreview, Frame, Notice, SelectField, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./reports.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api, apiBaseUrl } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "validation_error" | "success" | "server_error";
type Report = "sales" | "receivables" | "stock" | "cash";
type Fmt = "html" | "csv";
type RangeKey = "today" | "7d" | "30d" | "custom";

interface Preview {
  report: Report;
  label: string;
  format: Fmt;
  file_name: string;
  monthly: boolean;
  expected_pages: number;
  row_count: number;
  first_page_html: string;
  range: { start: string; end: string; label: string; months: number };
  quota: { used: number; limit: number };
  months_limit: number;
}

interface Export {
  id: string;
  report: Report;
  label: string;
  format: Fmt;
  range: { start: string; end: string };
  file_name: string;
  byte_size: number;
  page_count: number;
  row_count: number;
  url: string;
  generated_at: string;
  generated_by_name: string;
  open_count: number;
}

interface TooWide {
  months: number;
  limit: number;
  alternatives: {
    key: "split" | "monthly_summary" | "request_wider";
    first_end?: string;
    rest_months?: number;
    months?: number;
    limit?: number;
  }[];
}

const REPORTS: { value: Report; label: string }[] = [
  { value: "sales", label: "تقرير المبيعات" },
  { value: "receivables", label: "تقرير الذمم" },
  { value: "stock", label: "تقرير المخزون" },
  { value: "cash", label: "تقرير الصندوق" },
];

const kb = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`pos-chip${on ? " pos-chip--on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * REP-06 — تصدير تقرير ومعاينته (36-D28 ready/loading/success/server_error · 19-D14
 * validation_error): الورقة التي تخرج من النظام إلى محاسبٍ أو بنك — معاينةٌ للصفحة الأولى كما
 * ستُطبع بالضبط قبل التصدير؛ التوليد مع عدد الصفحات المتوقَّع؛ الملف باسمٍ يحمل مداه؛ حدّ 12 شهراً
 * من الباقة بالبدائل الثلاثة؛ فشل التوليد لا يُنزِّل ملفاً ناقصاً ويقترح البديل (§٧.٧، §١٤.١).
 */
export function ExportClient() {
  const router = useRouter();
  const app = useApp();
  const [report, setReport] = useState<Report>("sales");
  const [fmt, setFmt] = useState<Fmt>("html");
  const [range, setRange] = useState<RangeKey>("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [tooWide, setTooWide] = useState<TooWide | null>(null);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState<Export | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [recent, setRecent] = useState<Export[]>([]);
  const [limitRequested, setLimitRequested] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const query = useCallback(() => {
    const q: Record<string, string> = { report, range, format: fmt };
    if (range === "custom") {
      q.start = start;
      q.end = end;
    }
    if (monthly) q.summary = "monthly";
    return q;
  }, [report, range, fmt, start, end, monthly]);

  const loadPreview = useCallback(async () => {
    if (range === "custom" && (!start || !end)) return;
    setPreviewing(true);
    setTooWide(null);
    setFailed(null);
    try {
      const { data, error, response } = await api().GET("/api/reports/export/preview", {
        params: { query: query() },
      });
      if (response.status === 403) {
        router.replace("/reports");
        return;
      }
      if (response.status === 400) {
        const e = error as unknown as { detail: string; extra: TooWide };
        if (e.detail === "range_too_wide") setTooWide(e.extra);
        return;
      }
      const body = data as unknown as Preview | undefined;
      if (!response.ok || !body) {
        setFailed("preview");
        return;
      }
      setPreview(body);
    } catch {
      setFailed("preview");
    } finally {
      setPreviewing(false);
    }
  }, [query, range, start, end, router]);

  const loadRecent = useCallback(async () => {
    const { data, response } = await api().GET("/api/reports/exports", {});
    const body = data as unknown as { exports: Export[] } | undefined;
    if (response.ok && body) setRecent(body.exports);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Freports%2Fexport");
      return;
    }
    void loadRecent().catch(() => undefined);
  }, [router, loadRecent]);

  useEffect(() => {
    setDone(null);
    void loadPreview();
  }, [loadPreview]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setFailed(null);
    setDone(null);
    try {
      const { data, error, response } = await api().POST("/api/reports/exports", {
        body: query() as never,
      });
      if (response.status === 400) {
        const e = error as unknown as { detail: string; extra: TooWide };
        if (e.detail === "range_too_wide") setTooWide(e.extra);
        else setFailed(e.detail);
        return;
      }
      const body = data as unknown as { export: Export } | undefined;
      if (!response.ok || !body) {
        setFailed("server");
        return;
      }
      setDone(body.export);
      void loadRecent();
    } catch {
      setFailed("server");
    } finally {
      setGenerating(false);
    }
  };

  const requestWider = async () => {
    if (!tooWide) return;
    const { response } = await api().POST("/api/reports/exports/limit-request", {
      body: { months: tooWide.months } as never,
    });
    if (response.ok) setLimitRequested(true);
  };

  const state: State = tooWide
    ? "validation_error"
    : failed
      ? "server_error"
      : done
        ? "success"
        : generating || (previewing && !preview)
          ? "loading"
          : "ready";

  const label = REPORTS.find((r) => r.value === report)?.label ?? "";

  return (
    <Frame title="التقارير" nav={<AppNav currentId="reports-export" />} footer={null}>
      <div className="sys rep" data-screen="REP-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تصدير تقرير ومعاينته</h2>
            <span className="cat-head__hint">
              الورقة التي تخرج من النظام إلى محاسبٍ أو بنك. معاينةٌ للصفحة الأولى كما ستُطبع بالضبط:
              الترويسة والاتجاه والأرقام.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="org-effects__row">
              <div className="cat-form">
                <h3 className="cat-head__title">اختر المدى والصيغة</h3>
                <SelectField
                  label="التقرير"
                  value={report}
                  onChange={(e) => {
                    setReport(e.target.value as Report);
                    setMonthly(false);
                  }}
                  options={REPORTS}
                />
                <div className="pos-chips" role="group" aria-label="المدى">
                  <Chip on={range === "today"} onClick={() => setRange("today")}>
                    اليوم
                  </Chip>
                  <Chip on={range === "7d"} onClick={() => setRange("7d")}>
                    آخر 7 أيام
                  </Chip>
                  <Chip on={range === "30d"} onClick={() => setRange("30d")}>
                    آخر 30 يوماً
                  </Chip>
                  <Chip on={range === "custom"} onClick={() => setRange("custom")}>
                    مدى مخصَّص
                  </Chip>
                </div>
                {range === "custom" ? (
                  <>
                    <TextField
                      label="من تاريخ"
                      kind="date"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                    <TextField
                      label="إلى تاريخ"
                      kind="date"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </>
                ) : null}
                <div className="pos-chips" role="group" aria-label="الصيغة">
                  <Chip on={fmt === "html"} onClick={() => setFmt("html")}>
                    HTML للطباعة أو PDF
                  </Chip>
                  <Chip on={fmt === "csv"} onClick={() => setFmt("csv")}>
                    CSV
                  </Chip>
                </div>
                {monthly ? (
                  <p className="acc-choice__note">
                    <strong>ملخص شهري</strong> · سطر لكل شهر بدل التفصيل.{" "}
                    <Button variant="quiet" onClick={() => setMonthly(false)}>
                      عُد إلى التفصيل
                    </Button>
                  </p>
                ) : null}
                {preview ? (
                  <p className="acc-choice__note">
                    الحصة هذا الشهر: <span className="sting-mono">{preview.quota.used}</span> من{" "}
                    <span className="sting-mono">{preview.quota.limit}</span> · حدّ المدى{" "}
                    <span className="sting-mono">{preview.months_limit}</span> شهراً
                  </p>
                ) : null}
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => void generate()}
                    loading={generating}
                    disabledReason={
                      tooWide ? "المدى أوسع من الحدّ" : !preview ? "بانتظار المعاينة" : undefined
                    }
                  >
                    صدِّر
                  </Button>
                </div>
              </div>

              <div>
                {state === "loading" ? (
                  <Notice kind="info" title="جارٍ التوليد">
                    <p className="acc-lead">
                      مع عدد الصفحات المتوقَّع
                      {preview ? (
                        <>
                          : <span className="sting-mono">{preview.expected_pages}</span> صفحات
                        </>
                      ) : null}
                      . تقرير ثلاثة أشهر قد يبلغ أربعين صفحة.
                    </p>
                  </Notice>
                ) : null}
                {state === "validation_error" && tooWide ? (
                  <Notice kind="warning" title="التصدير متوقف — REP-06">
                    <p className="acc-lead">
                      النطاق المطلوب <span className="sting-mono">{tooWide.months}</span> شهراً وحدّ
                      التصدير <span className="sting-mono">{tooWide.limit}</span>. نقول الحدّ ونعرض
                      بديلين بدل رسالة «فشل التصدير».
                    </p>
                    <ul className="acc-choice__note">
                      <li>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const alt = tooWide.alternatives.find((a) => a.key === "split");
                            if (alt?.first_end) {
                              setRange("custom");
                              setEnd(alt.first_end);
                              setTooWide(null);
                            }
                          }}
                        >
                          قسّمه إلى ملفين
                        </Button>{" "}
                        <span className="sting-mono">{tooWide.limit}</span> شهراً ثم{" "}
                        <span className="sting-mono">{tooWide.months - tooWide.limit}</span> شهراً.
                        الترويسة في كل ملف تقول أي مدى يغطيه ومتى حُسب.
                      </li>
                      <li>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setReport("sales");
                            setMonthly(true);
                            setTooWide(null);
                          }}
                        >
                          صدّر الملخص الشهري بدل التفصيل
                        </Button>{" "}
                        يغطي <span className="sting-mono">{tooWide.months}</span> شهراً كاملة بسطر
                        لكل شهر — مناسب للبنك والمراجع الخارجي.
                      </li>
                      <li>
                        <Button
                          variant="secondary"
                          onClick={() => void requestWider()}
                          disabledReason={limitRequested ? "سُجّل الطلب" : undefined}
                        >
                          اطلب مدى أوسع
                        </Button>{" "}
                        حدّ الـ<span className="sting-mono">{tooWide.limit}</span> شهراً من الباقة
                        لا من النظام. يُرفع بطلب ويُذكر تأثيره على حجم الملف.
                        {limitRequested ? " — سُجّل طلبك." : ""}
                      </li>
                    </ul>
                  </Notice>
                ) : null}
                {state === "server_error" ? (
                  <Notice
                    kind="error"
                    title="فشل التوليد"
                    action={
                      <>
                        <Button
                          onClick={() => {
                            setFailed(null);
                            setRange("7d");
                          }}
                        >
                          مدى أقصر
                        </Button>
                        <Button
                          onClick={() => {
                            setFailed(null);
                            setFmt("csv");
                          }}
                        >
                          صيغة CSV أخفّ
                        </Button>
                      </>
                    }
                  >
                    <p className="acc-lead">التقرير كبير أو الخادم تعثّر. لا ملف ناقص يُنزَّل.</p>
                    <p className="acc-lead">
                      <strong>البديل</strong> · مدى أقصر، أو صيغة CSV أخفّ. نقترح البديل ولا نكتفي
                      بالاعتذار.
                    </p>
                  </Notice>
                ) : null}
                {state === "success" && done ? (
                  <Notice
                    kind="success"
                    title="جاهز للتنزيل"
                    action={
                      <a
                        className="c-btn c-btn--primary"
                        href={`${apiBaseUrl()}${done.url}?download=1`}
                        download={done.file_name}
                      >
                        تنزيل
                      </a>
                    }
                  >
                    <p className="acc-lead">
                      <span className="sting-mono">{done.file_name}</span> ·{" "}
                      <span className="sting-mono">{kb(done.byte_size)}</span> ·{" "}
                      <span className="sting-mono">{done.page_count}</span> صفحات ·{" "}
                      <span className="sting-mono">
                        {done.range.start} – {done.range.end}
                      </span>
                    </p>
                    <p className="acc-choice__note">
                      اسم الملف وحجمه وعدد صفحاته ومداه. والمدى في اسم الملف نفسه لا في محتواه وحده.{" "}
                      <strong>لماذا في الاسم</strong> · لأنه سيُرسل بالبريد ويُحفظ بين عشرة ملفات.
                      ملفٌ اسمه «تقرير.pdf» ضائع بعد أسبوع.
                    </p>
                  </Notice>
                ) : null}

                <h3 className="cat-head__title">المعاينة قبل التصدير</h3>
                <p className="acc-choice__note">
                  لأن الخطأ يُكتشف بعد الإرسال إلى المحاسب عادةً، وحينها تكون الورقة خرجت.
                </p>
                <DocPreview
                  title={`معاينة ${label}`}
                  textAlternative={
                    preview
                      ? `${preview.label} من ${preview.range.start} إلى ${preview.range.end} — ${preview.row_count} صفاً في ${preview.expected_pages} صفحات`
                      : "لا معاينة بعد"
                  }
                  pageCount={preview?.expected_pages}
                  loading={previewing && !preview}
                >
                  {preview ? (
                    <iframe
                      className="rep-preview"
                      title={`الصفحة الأولى من ${preview.label}`}
                      srcDoc={preview.first_page_html}
                    />
                  ) : null}
                </DocPreview>
                {preview ? (
                  <p className="acc-choice__note">
                    <span className="sting-mono">{preview.file_name}</span> ·{" "}
                    <span className="sting-mono">{preview.expected_pages}</span> صفحات متوقَّعة ·{" "}
                    <span className="sting-mono">{preview.row_count}</span> صفاً
                  </p>
                ) : null}
              </div>
            </div>

            {recent.length ? (
              <section aria-label="آخر التصديرات">
                <h3 className="cat-head__title">آخر التصديرات</h3>
                <ul className="acc-choice__note">
                  {recent.map((e) => (
                    <li key={e.id}>
                      <a href={`${apiBaseUrl()}${e.url}?download=1`} download={e.file_name}>
                        <span className="sting-mono">{e.file_name}</span>
                      </a>{" "}
                      · <span className="sting-mono">{kb(e.byte_size)}</span> ·{" "}
                      {e.generated_by_name}{" "}
                      <span className="sting-mono">{hhmm(e.generated_at)}</span> · فُتح{" "}
                      <span className="sting-mono">{e.open_count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
