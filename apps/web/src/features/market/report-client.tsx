"use client";

import {
  Button,
  Frame,
  Notice,
  RadioGroupField,
  Status,
  TextField,
  Upload,
  type UploadItem,
} from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import type { Preview } from "@/features/market/share-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface Reason {
  code: string;
  label: string;
  hint: string;
  needs_evidence: boolean;
}

export interface Report {
  id: string;
  number: number;
  number_label: string;
  target_label: string;
  reason: string;
  reason_label: string;
  note: string;
  evidence_name: string;
  status: "under_review" | "actioned" | "closed";
  status_label: string;
  outcome: string;
  created_at: string;
  decided_at: string;
  may_happen: string[];
  wont_happen: string[];
  not_given: string[];
}

interface Payload {
  reports: Report[];
  reasons: Reason[];
}

const MAX_EVIDENCE = 2 * 1024 * 1024;

async function toBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function Outcome({ r }: { r: Report }) {
  return (
    <>
      <p className="acc-lead">
        بلاغك رقمه <span className="sting-mono">{r.number_label}</span>
      </p>
      <p className="acc-choice__note">
        تتابع حالته من حسابك: «قيد المراجعة» ثم «أُجري إجراء» أو «أُغلق بلا إجراء» مع سبب. لا نتركك
        في صمت، ولا نُخبرك بتفاصيل دفاتر الطرف الآخر.
      </p>
      <div className="acc-actions">
        <Status
          state={
            r.status === "under_review" ? "stale" : r.status === "actioned" ? "success" : "expired"
          }
          label={r.status_label}
        />
        {r.outcome ? <span className="acc-choice__note">{r.outcome}</span> : null}
      </div>
      {r.reason === "impersonation" ? (
        <>
          <h3 className="cat-head__title">وصل بلاغك عن انتحال هوية</h3>
          <p className="acc-choice__note">
            بلّغتَ أن ملفاً في السوق يستخدم اسم منشأتك وشعارها. المراجعة في PLT-07 وأقصى إجراء هو
            تعليق النشر. للمنشأة المعلَّقة حق اعتراض موثق، والقرار ونتيجته يظهران لك بلا تفاصيل
            داخلية عنها.
          </p>
        </>
      ) : null}
      <div className="pub-cols">
        <div>
          <strong>ما قد يحدث</strong>
          <ul className="pub-list">
            {r.may_happen.map((t) => (
              <li key={t}>
                <span className="pub-mark">قد</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <strong>ما لن يحدث</strong>
          <ul className="pub-list">
            {r.wont_happen.map((t) => (
              <li key={t}>
                <span className="pub-mark">لا</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <strong>ما لا نعطيك</strong>
          <ul className="pub-list">
            {r.not_given.map((t) => (
              <li key={t}>
                <span className="pub-mark">لا</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

/** MP-15 — بلاغ عن عرض أو انتحال (29-D22 ready/validation_error/success · 43-D35 permission_denied · 10-D6 success): سبب ودليل ومسار متابعة. */
export function ReportClient({ reportId = "" }: { reportId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const offer = params.get("offer") ?? "";
  const supplier = params.get("supplier") ?? "";
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<{ item: UploadItem; file: File } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Report | null>(null);
  const [tracked, setTracked] = useState<Report | null>(null);
  const [denied, setDenied] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/reports");
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) setData(body);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      const next = reportId
        ? `/market/reports/${reportId}`
        : `/market/report${offer ? `?offer=${offer}` : supplier ? `?supplier=${supplier}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    void load().catch(() => undefined);
    if (reportId) {
      void (async () => {
        const { data, response } = await api().GET("/api/market/reports/{report_id}", {
          params: { path: { report_id: reportId } },
        });
        if (response.status === 404) {
          setDenied(true);
          return;
        }
        const body = data as unknown as { report: Report } | undefined;
        if (response.ok && body) setTracked(body.report);
      })().catch(() => undefined);
      return;
    }
    if (!offer && !supplier) return;
    void (async () => {
      const { data, response } = await api().GET("/api/market/share/preview", {
        params: { query: { offer, supplier } },
      });
      const body = data as unknown as { preview: Preview } | undefined;
      if (response.ok && body) setPreview(body.preview);
    })().catch(() => undefined);
  }, [router, load, offer, supplier, reportId]);

  const onFiles = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile({
      file: f,
      item: {
        id: "evidence",
        name: f.name,
        sizeLabel:
          f.size >= 1024 * 1024
            ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.ceil(f.size / 1024)} KB`,
        error: f.size > MAX_EVIDENCE ? "أكبر من 2 MB" : undefined,
      },
    });
  };

  const selected = data?.reasons.find((r) => r.code === reason) ?? null;
  const evidenceMissing =
    Boolean(selected?.needs_evidence) && !(file && file.file.size <= MAX_EVIDENCE);
  const invalid = !selected || evidenceMissing;

  const submit = async () => {
    setAttempted(true);
    if (invalid || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { reason, note };
      if (offer) body.offer_id = offer;
      if (supplier) body.supplier_tenant_id = supplier;
      if (file && file.file.size <= MAX_EVIDENCE) {
        body.evidence_name = file.file.name;
        body.evidence_data_url = `data:${file.file.type || "image/jpeg"};base64,${await toBase64(file.file)}`;
      }
      const r = await api().POST("/api/market/reports", { body: body as never });
      const b = r.data as unknown as { report: Report } | undefined;
      if (r.response.ok && b) {
        setSent(b.report);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : sent
      ? "success"
      : attempted && invalid
        ? "validation_error"
        : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-reports" />} footer={null}>
      <div className="sys mp cus" data-screen="MP-15" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">بلاغ عن عرض أو انتحال — سبب ودليل ومسار متابعة</h2>
            <span className="cat-head__hint">
              البلاغ ليس زرّ شكوى مجهولاً: سبب من قائمة محدَّدة، ودليل مرفوع، ورقم متابعة يرى
              المبلِّغ حالته. ولا يُعلَّق شيء بمجرّد البلاغ.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="warning" title="متابعة البلاغ لصاحبه">
                <p className="acc-lead">رابط متابعة بلاغ فُتح من غير مقدِّمه.</p>
                <p className="acc-choice__note">
                  <strong>هوية المبلّغ محفوظة</strong> · المبلَّغ عنه لا يرى من بلّغ، وغير المقدِّم
                  لا يرى البلاغ أصلاً. كشفُ المبلّغين يقتل الإبلاغ في سوقٍ صغيرة يعرف الجميع فيها
                  الجميع (PLT-07).
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/reports")}>بلاغاتي</Button>
                </div>
              </Notice>
            ) : null}

            {state === "success" && sent ? (
              <Notice
                kind="success"
                title="أُرسل"
                action={<Button onClick={() => router.push("/market/reports")}>بلاغاتي</Button>}
              >
                <Outcome r={sent} />
              </Notice>
            ) : null}

            {tracked && !denied ? (
              <Notice
                kind="info"
                title={`البلاغ ${tracked.number_label} — ${tracked.target_label}`}
              >
                <Outcome r={tracked} />
              </Notice>
            ) : null}

            {!reportId && !sent && (offer || supplier) ? (
              <>
                <h3 className="cat-head__title">إبلاغ عن «{preview ? preview.title : "…"}»</h3>
                {preview?.subtitle ? <p className="acc-choice__note">{preview.subtitle}</p> : null}
                {data ? (
                  <RadioGroupField
                    label="سبب البلاغ — اختر واحداً"
                    name="reason"
                    value={reason}
                    onChange={setReason}
                    options={data.reasons.map((r) => ({
                      value: r.code,
                      label: r.label,
                      hint: r.hint,
                    }))}
                    error={attempted && !selected ? "اختر سبباً من القائمة" : undefined}
                  />
                ) : null}
                <Upload
                  label="الدليل"
                  accept="image/*,application/pdf"
                  camera
                  constraintsText="صورة أو مستند حتى 2 MB · يراه مراجع السوق وحده"
                  items={file ? [file.item] : []}
                  onFiles={onFiles}
                  onRemove={() => setFile(null)}
                  error={
                    attempted && evidenceMissing
                      ? "بلاغ «انتحال» بلا دليل مرفوع لا يُرسل"
                      : undefined
                  }
                />
                <TextField
                  label="ملاحظة (اختيارية)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                {state === "validation_error" ? (
                  <Notice kind="warning" title="لا يُرسل بلا سبب ودليل">
                    <p className="acc-lead">
                      بلاغ «انتحال» بلا دليل مرفوع لا يُرسل. الانتحال اتهام ثقيل يُعلَّق به نشر
                      منشأة، فنطلب ما يسنده — وسبب «سعر لا يعجبني» ليس في القائمة أصلاً.
                    </p>
                  </Notice>
                ) : null}
                <p className="acc-choice__note">
                  <strong>البلاغ لا يُعلّق شيئاً بنفسه</strong> · التعليق قرار مراجِع بشري في
                  PLT-07. لو كان البلاغ يُخفي عرضاً تلقائياً لصار سلاحاً بيد منافس — عشرة بلاغات
                  كاذبة تُخرج بائعاً من السوق بلا أن يراجعها أحد.
                </p>
                <div className="acc-actions">
                  <Button pos loading={busy} onClick={() => void submit()}>
                    أرسل البلاغ
                  </Button>
                </div>
              </>
            ) : null}

            {!reportId && !sent && !offer && !supplier && data ? (
              <>
                <h3 className="cat-head__title">بلاغاتي</h3>
                {data.reports.length ? (
                  <ul className="cus-list">
                    {data.reports.map((r) => (
                      <li key={r.id}>
                        <Button
                          variant="quiet"
                          onClick={() => router.push(`/market/reports/${r.id}`)}
                        >
                          <span className="sting-mono">{r.number_label}</span> · {r.target_label}
                        </Button>
                        <div className="cus-sub">{r.reason_label}</div>
                        <Status
                          state={
                            r.status === "under_review"
                              ? "stale"
                              : r.status === "actioned"
                                ? "success"
                                : "expired"
                          }
                          label={r.status_label}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="acc-choice__note">
                    لا بلاغات بعد — يبدأ البلاغ من صفحة العرض أو ملف المنشأة.
                  </p>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
