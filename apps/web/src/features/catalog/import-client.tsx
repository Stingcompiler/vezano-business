"use client";

import { Button, formatMinor, Frame, Notice, Table, Upload, type UploadItem } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import { AppNav } from "@/features/home/app-nav";
import { api, apiBaseUrl, getAccessToken } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "validation_error" | "partial" | "success" | "server_error";

interface Row {
  readonly line: number;
  readonly key: string;
  readonly price_text: string;
  readonly item_id: string;
  readonly name: string;
  readonly old_price_minor: string;
  readonly new_price_minor: string;
  readonly result: "update" | "unchanged" | "rejected";
  readonly reason: string;
  readonly applied?: boolean;
}
interface Batch {
  readonly id: string;
  readonly file_name: string;
  readonly status: "previewed" | "applying" | "applied" | "reverted";
  readonly rows: readonly Row[];
  readonly ready_count: number;
  readonly rejected_count: number;
  readonly unchanged_count: number;
  readonly applied_count: number;
  readonly max_increase_pct: number;
  readonly revert_until: string;
}

/** أسباب الرفض كما في جدول الإطار 05-D2: «مرفوض: سعر سالب»، «مرفوض: لا صنف بهذا المعرّف». */
const REASONS: Record<string, string> = {
  negative: "سعر سالب",
  item_not_found: "لا صنف بهذا المعرّف",
  not_a_number: "سعر غير رقمي",
  out_of_range: "سعر خارج الحدّ",
  duplicate: "الصنف مكرّر في الملف",
  missing_item: "بلا معرّف صنف",
};

/** استجابات الدفعة غير موصوفة في العقد (responses: None) — تُقرأ على شكل Batch. */
const asBatch = (x: unknown): Batch => x as Batch;

function resultText(r: Row): string {
  if (r.result === "update") return `سيُحدَّث من ${formatMinor(r.old_price_minor || "0")}`;
  if (r.result === "unchanged") return "بلا تغيير — نفس السعر";
  return `مرفوض: ${REASONS[r.reason] ?? r.reason}`;
}

/**
 * CAT-05 — استيراد أو تعديل أسعار متعدد (38-D30 ready/loading/validation_error/success/server_error ·
 * 05-D2 partial). معاينة الأخطاء قبل الاعتماد، ونتيجة جزئية صريحة (ACC-86): الاعتماد يطبّق
 * الصالح فقط ويترك المرفوض؛ الملف نفسه لا يكرّر التطبيق؛ المرفوض يُنزَّل بسببه ورقم سطره (R-06)؛
 * الانقطاع يُستأنف: ما اكتمل يبقى؛ والتراجع دفعةً خلال 24 ساعة.
 */
export function ImportClient() {
  const router = useRouter();
  const app = useApp();
  const [file, setFile] = useState<UploadItem | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "applying" | "cut" | "done">("idle");
  const [blocked, setBlocked] = useState<"owner" | "subscription" | null>(null);
  const [revertRefused, setRevertRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!app.tokens && !app.expired) router.replace("/login?next=%2Fcatalog%2Fimport");
  }, [app.expired, app.tokens, router]);

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile({
      id: f.name,
      name: f.name,
      sizeLabel: `${Math.max(1, Math.round(f.size / 1024))} KB`,
    });
    setBatch(null);
    setBlocked(null);
    setRevertRefused(null);
    setPhase("checking");
    const content = await f.text();
    const { data, error, response } = await api().POST("/api/catalog/prices/import/preview", {
      body: { file_name: f.name, content },
    });
    if (response.status === 403 && error) {
      const detail = (error as { detail?: string }).detail;
      setBlocked(detail === "bulk_pricing_blocked" ? "subscription" : "owner");
      setPhase("idle");
      return;
    }
    if (response.ok && data) {
      const b = asBatch(data);
      setBatch(b);
      setPhase(b.status === "applied" || b.status === "reverted" ? "done" : "idle");
    } else {
      setPhase("idle");
    }
  };

  const apply = async () => {
    if (!batch || busy) return;
    setBusy(true);
    setPhase("applying");
    try {
      const { data, response } = await api().POST("/api/catalog/prices/import/{batch_id}/apply", {
        params: { path: { batch_id: batch.id } },
        body: {},
      });
      if (response.ok && data) {
        const b = asBatch(data);
        setBatch(b);
        setPhase(b.status === "applied" ? "done" : "cut");
        return;
      }
      throw new Error("apply_failed");
    } catch {
      // انقطع أثناء التطبيق: نسأل الخادم أين وقفنا — ما اكتمل يبقى
      const { data } = await api()
        .GET("/api/catalog/prices/import/{batch_id}", { params: { path: { batch_id: batch.id } } })
        .catch(() => ({ data: undefined }));
      if (data) setBatch(asBatch(data));
      setPhase("cut");
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!batch || busy) return;
    setBusy(true);
    try {
      const { data, error, response } = await api().POST(
        "/api/catalog/prices/import/{batch_id}/revert",
        { params: { path: { batch_id: batch.id } }, body: undefined },
      );
      if (response.status === 409 && error) {
        setRevertRefused((error as { reason?: string }).reason ?? "refused");
        return;
      }
      if (response.ok && data) setBatch(asBatch(data));
    } finally {
      setBusy(false);
    }
  };

  const downloadRejected = async () => {
    if (!batch) return;
    const res = await fetch(`${apiBaseUrl()}/api/catalog/prices/import/${batch.id}/rejected.csv`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rejected.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const state: State =
    phase === "checking"
      ? "loading"
      : phase === "cut"
        ? "server_error"
        : !batch
          ? "ready"
          : batch.status === "applied" || batch.status === "reverted"
            ? "success"
            : batch.ready_count === 0 && batch.rejected_count > 0
              ? "validation_error"
              : batch.rejected_count > 0
                ? "partial"
                : "ready";

  const changes = batch ? batch.rows.filter((r) => r.result === "update") : [];
  const tableRows = state === "ready" ? changes : (batch?.rows ?? []);
  const columns = [
    { key: "line", header: "السطر", mono: true, render: (r: Row) => String(r.line) },
    { key: "name", header: "الصنف", render: (r: Row) => r.name },
    {
      key: "price",
      header: "السعر",
      mono: true,
      render: (r: Row) => (r.new_price_minor ? formatMinor(r.new_price_minor) : r.price_text),
    },
    { key: "result", header: "النتيجة", render: (r: Row) => resultText(r) },
  ];

  return (
    <Frame title="الكتالوج" nav={<AppNav currentId="catalog" />} footer={null}>
      <div className="home" data-screen="CAT-05" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {batch ? (
                <>
                  معاينة استيراد الأسعار — <span className="sting-mono">{batch.file_name}</span>
                </>
              ) : (
                "استيراد أو تعديل أسعار متعدد"
              )}
            </h2>
          </div>
          <div className="acc-card__body">
            {blocked === "subscription" ? (
              <Notice kind="locked" title="التسعير الجماعي">
                <p className="acc-lead">
                  المحجوب هو التسعير الجماعي، مثل رفع مجموعة بنسبة أو استيراد قائمة أسعار.
                </p>
                <p className="acc-lead">
                  تعديل السعر الأساسي لصنف واحد يبقى متاحاً للإدارة عند الاتصال.
                </p>
              </Notice>
            ) : null}
            {blocked === "owner" ? (
              <Notice kind="locked" title="تغيير السعر للمالك">
                <p className="acc-lead">
                  مدير الفرع يرى السعر وتاريخه ولا يغيّره. السعر قرار منشأة لا فرع.
                </p>
              </Notice>
            ) : null}

            {state === "loading" ? (
              <Notice kind="info" title="جارٍ الفحص">
                <p className="acc-lead">قراءة كاملة ومطابقة قبل أي كتابة.</p>
              </Notice>
            ) : null}

            {state === "ready" && batch ? (
              <Notice kind="info" title="معاينة ما سيتغيّر">
                <p className="acc-lead">
                  الملف مقروء ولم يُكتب شيء. نعرض الفرق:{" "}
                  <span className="sting-mono">{batch.ready_count}</span> سعراً سيتغيّر، أكبر ارتفاع{" "}
                  <span className="sting-mono">{batch.max_increase_pct}</span>٪.
                </p>
                <p className="acc-lead">
                  <strong>الفرق لا القائمة</strong>
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" && batch ? (
              <Notice
                kind="error"
                title="صفوف لا تُقبل"
                action={
                  <Button variant="secondary" onClick={() => void downloadRejected()}>
                    تنزيل المرفوض للتصحيح
                  </Button>
                }
              >
                <p className="acc-lead">
                  <span className="sting-mono">{batch.rejected_count}</span> صفاً بسعر غير رقمي أو
                  بصنف غير موجود أو بسعر سالب.
                </p>
                <p className="acc-lead">
                  <strong>يُستورد السليم</strong> ويُصدَّر المرفوض بسببه ورقم سطره ليُصحَّح ويُعاد.
                </p>
              </Notice>
            ) : null}

            {state === "partial" && batch ? (
              <div className="cat-counters">
                <div className="cat-counter cat-counter--ok">
                  <div className="cat-counter__k">جاهز للاعتماد</div>
                  <div className="cat-counter__v sting-mono">{batch.ready_count}</div>
                </div>
                <div className="cat-counter cat-counter--bad">
                  <div className="cat-counter__k">مرفوض</div>
                  <div className="cat-counter__v sting-mono">{batch.rejected_count}</div>
                </div>
                <div className="cat-counter">
                  <div className="cat-counter__k">بلا تغيير</div>
                  <div className="cat-counter__v sting-mono">{batch.unchanged_count}</div>
                </div>
              </div>
            ) : null}

            {state === "success" && batch ? (
              <Notice
                kind="success"
                title="طُبّقت الأسعار"
                action={
                  batch.status === "applied" ? (
                    <Button variant="secondary" onClick={() => void revert()} loading={busy}>
                      التراجع دفعةً
                    </Button>
                  ) : null
                }
              >
                <p className="acc-lead">
                  <span className="sting-mono">{batch.applied_count}</span> سعراً سرى الآن، وكلٌّ
                  منها سطرٌ في تاريخ صنفه موسومٌ بالدفعة.
                </p>
                <p className="acc-lead">
                  الدفعة كيانٌ واحد يُتراجَع عنه خلال <span className="sting-mono">24</span> ساعة ما
                  لم يُبع بالسعر الجديد — وبعدها يصير جزءاً من الدفتر.
                </p>
                {batch.status === "reverted" ? (
                  <p className="acc-lead">
                    <strong>التراجع دفعةً</strong> — أُعيدت الأسعار السابقة.
                  </p>
                ) : null}
                {revertRefused ? (
                  <p className="acc-lead" role="alert">
                    {revertRefused === "sold_at_new_price"
                      ? "بيع بالسعر الجديد — صارت جزءاً من الدفتر."
                      : "مضت 24 ساعة — صارت جزءاً من الدفتر."}
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {state === "server_error" && batch ? (
              <Notice
                kind="error"
                title="انقطع أثناء التطبيق"
                action={
                  <Button onClick={() => void apply()} loading={busy}>
                    استئناف
                  </Button>
                }
              >
                <p className="acc-lead">
                  طُبّق <span className="sting-mono">{batch.applied_count}</span> من{" "}
                  <span className="sting-mono">{batch.ready_count}</span> ثم انقطع. بعض الأصناف
                  بالسعر الجديد وبعضها بالقديم.
                </p>
                <p className="acc-lead">
                  <strong>لا نصف تسعيرة</strong> · الدفعة تُطبَّق كوحدة قابلة للتراجع: ما اكتمل يبقى
                  وما انقطع يُلغى، ونعرض أين وقفنا وزرّ استئناف.
                </p>
              </Notice>
            ) : null}

            {!batch ? (
              <Upload
                label="استيراد أو تعديل أسعار متعدد"
                accept=".csv,text/csv"
                constraintsText="CSV بعمودين: الصنف، السعر"
                items={file ? [file] : []}
                onFiles={(fs) => void onFiles(fs)}
                onRemove={() => setFile(null)}
              />
            ) : null}

            {batch && (state === "partial" || state === "ready" || state === "validation_error") ? (
              <>
                <Table
                  caption="معاينة استيراد الأسعار"
                  columns={columns}
                  rows={tableRows}
                  rowKey={(r) => String(r.line)}
                />
                {state !== "validation_error" ? (
                  <p className="cat-saving__note">
                    الاعتماد يطبّق <span className="sting-mono">{batch.ready_count}</span> سطراً
                    صالحاً فقط ويترك المرفوض دون تغيير. إعادة رفع الملف نفسه لا تكرّر التطبيق —
                    يُطابَق بالمعرّف لا بالترتيب.
                  </p>
                ) : null}
                <div className="cat-form__actions">
                  {batch.ready_count > 0 ? (
                    <Button onClick={() => void apply()} loading={busy}>
                      اعتماد <span className="sting-mono">{batch.ready_count}</span> سطراً
                    </Button>
                  ) : null}
                  {batch.rejected_count > 0 && state !== "validation_error" ? (
                    <Button variant="secondary" onClick={() => void downloadRejected()}>
                      تنزيل المرفوض للتصحيح
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setBatch(null);
                      setFile(null);
                      setPhase("idle");
                    }}
                  >
                    استورد ملفاً
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
