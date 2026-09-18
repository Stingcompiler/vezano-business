"use client";

import { Button, formatMinor, Frame, Notice, SelectField, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/sys/sys.css";
import { AppNav } from "@/features/home/app-nav";
import { api, apiBaseUrl, getAccessToken } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "validation_error" | "partial" | "success" | "server_error";
type Kind = "items" | "parties";

interface Row {
  readonly line: number;
  readonly row_hash: string;
  readonly values: Record<string, string>;
  readonly result: "create" | "update" | "rejected" | "needs_decision";
  readonly reason: string;
  readonly duplicate_of_line?: number;
  readonly price_minor?: string;
  readonly old_price_minor?: string;
  readonly opening_minor?: string;
  readonly applied?: boolean;
}

interface Batch {
  readonly id: string;
  readonly kind: Kind;
  readonly file_name: string;
  readonly status: "previewed" | "applying" | "applied" | "reverted";
  readonly mapping: Record<string, number>;
  readonly rows: readonly Row[];
  readonly total_rows: number;
  readonly create_count: number;
  readonly update_count: number;
  readonly rejected_count: number;
  readonly decision_count: number;
  readonly applied_count: number;
  readonly revert_until: string;
  readonly already_imported: boolean;
  readonly headers?: readonly string[];
  readonly suggested_mapping?: Record<string, number>;
}

const FIELD_LABEL: Record<string, string> = {
  name: "الاسم",
  unit: "الوحدة",
  price: "السعر",
  barcode: "الباركود",
  phone: "الهاتف",
  opening: "الرصيد الافتتاحي",
  side: "الصفة",
};
const FIELDS: Record<Kind, readonly string[]> = {
  items: ["name", "unit", "price", "barcode"],
  parties: ["name", "phone", "opening", "side"],
};

const REASON: Record<string, string> = {
  unit_required: "الوحدة فارغة. بلا وحدة لا يمكن حساب مخزون ولا سعر بيع.",
  negative: "سعر سالب. لا نصحّحه نيابةً عنك ولا نستورده كصفر.",
  not_a_number: "السعر ليس رقماً",
  name_required: "الاسم فارغ",
  unit_unknown: "الوحدة غير معرَّفة في المنشأة",
  barcode_duplicate_in_file: "باركود مكرر داخل الملف نفسه",
  barcode_taken: "الباركود مستعمل لصنف آخر",
  duplicate_in_file: "مكرر داخل الملف",
  opening_invalid: "الرصيد الافتتاحي ليس رقماً موجباً",
  side_invalid: "الصفة يجب أن تكون «عميل» أو «مورد»",
  phone_taken: "الهاتف مسجَّل لطرف آخر",
};

/**
 * SYS-10 — استيراد بيانات (16-D11 ready/loading/validation_error/partial/success/server_error):
 * اختر ملفاً وطابق أعمدته — المطابقة تُقترح لا تُفترض، الوحدة إلزامية؛ لا كتابة أثناء الفحص؛ لا نرفض
 * الملف كلّه — يُستورد السليم ويُصدَّر المرفوض بسبب كل صف ورقم سطره؛ المكرر يحتاج قرارك؛ بصمة الملف
 * تمنع المضاعفة؛ الانقطاع يُستأنف بالبصمة؛ التراجع دفعةً خلال 24 ساعة.
 */
export function ImportClient() {
  const router = useRouter();
  const app = useApp();
  const [kind, setKind] = useState<Kind>("items");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<"idle" | "checking" | "applying">("idle");
  const [failed, setFailed] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "keep" | "skip">>({});
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) router.replace("/login?next=%2Fsync%2Fimport");
  }, [router]);

  const preview = async (override?: Record<string, number>) => {
    if (!content || phase !== "idle") return;
    setPhase("checking");
    setFailed(null);
    try {
      const { data, error, response } = await api().POST("/api/imports/preview", {
        body: { kind, file_name: fileName, content, ...(override ? { mapping: override } : {}) },
      });
      const body = data as unknown as Batch | undefined;
      if (!response.ok || !body) {
        const e = error as unknown as { detail?: string } | undefined;
        setFailed(e?.detail ?? "server_error");
        return;
      }
      setBatch(body);
      setMapping(body.mapping);
      setDecisions({});
    } catch {
      setFailed("server_error");
    } finally {
      setPhase("idle");
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setContent(await file.text());
    setBatch(null);
  };

  const decide = async () => {
    if (!batch) return;
    const { data, response } = await api().POST("/api/imports/{batch_id}/decide", {
      params: { path: { batch_id: batch.id } },
      body: { decisions },
    });
    if (response.ok && data) setBatch(data);
  };

  const apply = async (stopAfter?: number) => {
    if (!batch || phase !== "idle") return;
    setPhase("applying");
    setFailed(null);
    try {
      const { data, error, response } = await api().POST("/api/imports/{batch_id}/apply", {
        params: { path: { batch_id: batch.id } },
        body: stopAfter !== undefined ? { stop_after: stopAfter } : {},
      });
      const body = data as unknown as Batch | undefined;
      if (!response.ok || !body) {
        const e = error as unknown as { detail?: string } | undefined;
        setFailed(e?.detail ?? "server_error");
        return;
      }
      setBatch(body);
    } catch {
      setFailed("server_error");
    } finally {
      setPhase("idle");
    }
  };

  const revert = async () => {
    if (!batch) return;
    const { data, error, response } = await api().POST("/api/imports/{batch_id}/revert", {
      params: { path: { batch_id: batch.id } },
    });
    if (response.ok && data) setBatch(data);
    else setFailed((error as unknown as { detail?: string } | undefined)?.detail ?? "server_error");
  };

  const downloadRejected = () => {
    if (!batch) return;
    void fetch(`${apiBaseUrl()}/api/imports/${batch.id}/rejected.csv`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `rejected-${batch.file_name}`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  const interrupted = batch?.status === "applying";
  const state: State = interrupted
    ? "server_error"
    : phase === "checking"
      ? "loading"
      : batch?.status === "applied" || batch?.status === "reverted"
        ? "success"
        : batch && batch.decision_count > 0
          ? "validation_error"
          : batch && batch.rejected_count > 0
            ? "partial"
            : "ready";

  const rows = batch?.rows ?? [];
  const importable = batch ? batch.create_count + batch.update_count : 0;
  const rejectedRows = rows.filter((r) => r.result === "rejected" || r.result === "needs_decision");
  const columns = [
    { key: "line", header: "الصف", mono: true, render: (r: Row) => String(r.line) },
    {
      key: "name",
      header: kind === "items" ? "الصنف كما ورد" : "الطرف كما ورد",
      render: (r: Row) => r.values["name"] ?? "",
    },
    {
      key: "unit",
      header: kind === "items" ? "الوحدة" : "الهاتف",
      render: (r: Row) => (kind === "items" ? (r.values["unit"] ?? "") : (r.values["phone"] ?? "")),
    },
    {
      key: "price",
      header: kind === "items" ? "السعر" : "الرصيد الافتتاحي",
      mono: true,
      render: (r: Row) =>
        kind === "items"
          ? r.price_minor
            ? formatMinor(r.price_minor)
            : (r.values["price"] ?? "")
          : r.opening_minor
            ? formatMinor(r.opening_minor)
            : (r.values["opening"] ?? ""),
    },
    {
      key: "result",
      header: "النتيجة",
      render: (r: Row) =>
        r.result === "create" ? (
          <>
            <Status state="synced" label="سيُستورد" dot={false} />{" "}
            <span className="acc-choice__note">{kind === "items" ? "صنف جديد" : "طرف جديد"}</span>
          </>
        ) : r.result === "update" ? (
          <>
            <Status state="pending_sync" label="تحديث" dot={false} />{" "}
            <span className="acc-choice__note">
              {kind === "items" ? "مطابق لصنف قائم — سيُحدَّث سعره فقط" : "مطابق لطرف قائم"}
            </span>
          </>
        ) : r.result === "needs_decision" ? (
          <>
            <Status state="conflict" label="يحتاج قرارك" dot={false} />{" "}
            <span className="acc-choice__note">
              مكرر مع الصف <span className="sting-mono">{r.duplicate_of_line}</span> بسعر مختلف.
              أيّهما الصحيح؟ نسألك ولا نختار.
            </span>{" "}
            <Button
              variant={decisions[String(r.line)] === "keep" ? "primary" : "quiet"}
              onClick={() => setDecisions((d) => ({ ...d, [String(r.line)]: "keep" }))}
            >
              هذا الصحيح
            </Button>
          </>
        ) : (
          <>
            <Status state="server_error" label="مرفوض" dot={false} />{" "}
            <span className="acc-choice__note">
              {REASON[r.reason] ?? r.reason}
              {r.duplicate_of_line ? (
                <>
                  {" "}
                  (الصف <span className="sting-mono">{r.duplicate_of_line}</span>)
                </>
              ) : null}
            </span>
          </>
        ),
    },
  ];

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="import" />} footer={null}>
      <div className="sys" data-screen="SYS-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">استيراد بيانات</h2>
            <span className="cat-head__hint">
              مدخل البيانات الجملة. الخطر أن يُستورد الملف مرتين فيتضاعف كل شيء.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جارٍ الفحص">
                <p className="acc-lead">
                  الفحص قبل الكتابة: عدّ الصفوف، كشف التكرار داخل الملف، ومطابقته بما هو موجود.
                </p>
                <p className="acc-choice__note">
                  <strong>لا كتابة أثناء الفحص</strong> · يُقرأ كاملاً ويُعرض تقريره ثم يُكتب بعد
                  موافقة. الكتابة التدريجية تجعل الإلغاء مستحيلاً.
                </p>
              </Notice>
            ) : null}

            {state === "server_error" && batch ? (
              <Notice
                kind="error"
                title="انقطع أثناء الكتابة"
                action={
                  <Button pos onClick={() => void apply()} loading={phase === "applying"}>
                    استئناف
                  </Button>
                }
              >
                <p className="acc-lead">
                  كُتب <span className="sting-mono">{batch.applied_count}</span> من{" "}
                  <span className="sting-mono">{importable}</span> ثم انقطع. الملف نصف مستورد.
                </p>
                <p className="acc-choice__note">
                  <strong>الاستئناف بالبصمة</strong> · نعرف ما كُتب ببصمة كل صف، فنستأنف من{" "}
                  <span className="sting-mono">{batch.applied_count + 1}</span> بلا إعادة كتابة{" "}
                  <span className="sting-mono">{batch.applied_count}</span> ولا تكرارها.
                </p>
              </Notice>
            ) : null}

            {state === "success" && batch ? (
              <Notice
                kind={batch.status === "reverted" ? "info" : "success"}
                title={batch.status === "reverted" ? "تراجعت الدفعة" : "اكتمل الاستيراد"}
              >
                <p className="acc-lead">
                  <span className="sting-mono">{batch.create_count}</span>{" "}
                  {kind === "items" ? "صنفاً" : "طرفاً"} أُضيف و
                  <span className="sting-mono">{batch.update_count}</span> حُدّث
                  {batch.rejected_count > 0 ? (
                    <>
                      {" "}
                      و<span className="sting-mono">{batch.rejected_count}</span> رُفض — ملف
                      المرفوضات أدناه
                    </>
                  ) : null}
                  . والأهم: بصمة الملف محفوظة — رفعه ثانيةً يُكتشف ولا يُضاعف.
                </p>
                <p className="acc-choice__note">
                  <strong>التراجع</strong> · دفعة الاستيراد كيانٌ واحد قابل للتراجع خلال{" "}
                  <span className="sting-mono">24</span> ساعة ما لم تُباع أصنافها. بعدها يصير جزءاً
                  من الدفتر.
                </p>
                <div className="cat-form__actions">
                  {batch.status === "applied" && kind === "items" ? (
                    <Button variant="secondary" onClick={() => void revert()}>
                      التراجع عن الدفعة
                    </Button>
                  ) : null}
                  {batch.rejected_count > 0 ? (
                    <Button variant="quiet" onClick={downloadRejected}>
                      تنزيل المرفوضات لتصحيحها
                    </Button>
                  ) : null}
                </div>
              </Notice>
            ) : null}

            {failed && state !== "server_error" ? (
              <Notice kind="error" title="لم يُنفَّذ">
                <p className="acc-lead">
                  {failed === "decisions_pending"
                    ? "حُسم المكرر أولاً — نسألك ولا نختار."
                    : failed === "import_owner_or_manager"
                      ? "الاستيراد للمالك ومدير الفرع."
                      : failed === "sold_at_new_price" || failed === "item_sold"
                        ? "بيعت أصناف من الدفعة — صارت جزءاً من الدفتر."
                        : failed === "window_passed"
                          ? "مضت 24 ساعة — الدفعة جزء من الدفتر."
                          : "الخادم لم يقبل الطلب."}
                </p>
              </Notice>
            ) : null}

            {!batch || batch.status === "previewed" ? (
              <>
                <Notice kind="info" title="اختر ملفاً وطابق أعمدته">
                  <p className="acc-lead">
                    رفع الملف ثم مطابقة أعمدته بحقول النظام، مع معاينة أول خمسة صفوف كما ستُحفظ
                    فعلاً.
                  </p>
                  <p className="acc-choice__note">
                    <strong>المطابقة تُقترح لا تُفترض</strong> · النظام يخمّن من العناوين ويعرض
                    تخمينه للتعديل. الافتراض الصامت يُدخل السعر في حقل التكلفة.
                  </p>
                  <p className="acc-choice__note">
                    <strong>الوحدة إلزامية</strong> · صنفٌ بلا وحدة لا يُستورد — نفس قاعدة CAT-02.
                    الاستيراد ليس باباً خلفياً يلتفّ على قواعد الإدخال.
                  </p>
                </Notice>
                <div className="cat-form__actions">
                  <Button
                    variant={kind === "items" ? "primary" : "quiet"}
                    onClick={() => setKind("items")}
                  >
                    قالب الأصناف والوحدات والأسعار
                  </Button>
                  <Button
                    variant={kind === "parties" ? "primary" : "quiet"}
                    onClick={() => setKind("parties")}
                  >
                    قالب الأطراف والافتتاحيات
                  </Button>
                </div>
                <label className="cat-form__field">
                  <span>ملف CSV</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    aria-label="ملف الاستيراد"
                    onChange={(ev) => void pick(ev.target.files?.[0])}
                  />
                </label>
                {content && !batch ? (
                  <div className="cat-form__actions">
                    <Button pos onClick={() => void preview()} loading={phase === "checking"}>
                      فحص الملف
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {batch && batch.status === "previewed" && batch.headers ? (
              <>
                <h3 className="cat-head__title">مطابقة الأعمدة</h3>
                <div className="sys-explain">
                  {FIELDS[kind].map((f) => (
                    <SelectField
                      key={f}
                      label={FIELD_LABEL[f] ?? f}
                      aria-label={`عمود ${FIELD_LABEL[f]}`}
                      value={String(mapping[f] ?? -1)}
                      onChange={(ev) => setMapping((m) => ({ ...m, [f]: Number(ev.target.value) }))}
                      options={[
                        { value: "-1", label: "— بلا عمود —" },
                        ...(batch.headers ?? []).map((h, i) => ({
                          value: String(i),
                          label: h || `العمود ${i + 1}`,
                        })),
                      ]}
                    />
                  ))}
                </div>
                <div className="cat-form__actions">
                  <Button
                    variant="secondary"
                    onClick={() => void preview(mapping)}
                    loading={phase === "checking"}
                  >
                    أعد الفحص بهذه المطابقة
                  </Button>
                </div>
              </>
            ) : null}

            {batch && batch.status === "previewed" ? (
              <>
                {state === "partial" ? (
                  <Notice kind="warning" title="تقرير ما لن يُستورد">
                    <p className="acc-lead">
                      <span className="sting-mono">{batch.total_rows}</span> صف:{" "}
                      <span className="sting-mono">{importable}</span> سليم،{" "}
                      <span className="sting-mono">{batch.rejected_count}</span> مرفوض.
                    </p>
                    <p className="acc-choice__note">
                      <strong>لا نرفض الملف كلّه</strong> · يُستورد السليم ويُصدَّر المرفوض في ملف
                      مستقل بسبب كل صف — يُصحَّح ويُعاد رفعه.
                    </p>
                    <p className="acc-choice__note">
                      <strong>المكرر داخل الملف</strong> · يُعرض الصفّان المتعارضان بأرقام أسطرهما.
                    </p>
                  </Notice>
                ) : null}
                {state === "validation_error" ? (
                  <Notice
                    kind="error"
                    title="صفوف تحتاج قرارك"
                    action={
                      <Button
                        pos
                        onClick={() => void decide()}
                        disabledReason={
                          Object.keys(decisions).length === 0
                            ? "اختر الصف الصحيح لكل مكرر"
                            : undefined
                        }
                      >
                        اعتماد القرارات
                      </Button>
                    }
                  >
                    <p className="acc-lead">
                      <span className="sting-mono">{batch.decision_count}</span> صفاً مكرراً داخل
                      الملف بسعرين. نسألك ولا نختار.
                    </p>
                  </Notice>
                ) : null}
                <h3 className="cat-head__title">
                  معاينة استيراد {kind === "items" ? "الأصناف" : "الأطراف"} — قبل الاعتماد
                </h3>
                <p className="acc-choice__note">
                  الملف: <span dir="auto">{batch.file_name}</span> ·{" "}
                  <span className="sting-mono">{batch.total_rows}</span> صفاً ·{" "}
                  <span className="sting-mono">{batch.rejected_count + batch.decision_count}</span>{" "}
                  صفاً لن يُستورد
                </p>
                <Table
                  caption="صفوف الملف"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => String(r.line)}
                />
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void apply()}
                    loading={phase === "applying"}
                    disabledReason={
                      batch.decision_count > 0
                        ? "حُسم المكرر أولاً"
                        : importable === 0
                          ? "لا صفوف صالحة"
                          : undefined
                    }
                  >
                    استيراد <span className="sting-mono">{importable}</span> صفاً الصالحة
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={downloadRejected}
                    disabledReason={rejectedRows.length === 0 ? "لا مرفوضات" : undefined}
                  >
                    تنزيل المرفوضات لتصحيحها
                  </Button>
                  {process.env.NODE_ENV !== "production" ? (
                    <Button variant="quiet" onClick={() => void apply(1)}>
                      محاكاة انقطاع بعد صف
                    </Button>
                  ) : null}
                </div>
                <p className="acc-choice__note">
                  بعد الاستيراد تُعرض نتيجة مكتوبة: كم دخل، كم رُفض، وأين ملف المرفوضات. لا رسالة
                  «تم» مجرّدة.
                </p>
              </>
            ) : null}
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/sync")}>
                مركز المزامنة
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
