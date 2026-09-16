/**
 * C-CAMP — محرر حملة رسالة/إشعار، جدولة، مسودة، منتهية. الحالات: ready, saving, validation_error,
 * pending_sync, partial (تسليم جزئي), server_error. محرر RTL مع معاينة مجاورة؛ المتغيرات بين أقواس
 * تبقى LTR. Ctrl+Enter للحفظ؛ Esc يخرج من المعاينة. «مقبول من المزود» لا يُعلن «مقروء» — الفرق
 * منصوص (§١١.٦). دورة الحملة: draft → preview/test → approved → scheduled → completed | cancelled.
 */
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "./Button";
import { TextAreaField, TextField } from "./Field";
import { Status } from "./Status";

export type CampaignStage =
  "draft" | "preview" | "approved" | "scheduled" | "publishing" | "completed" | "cancelled";

export interface DeliveryCounts {
  readonly accepted: number;
  readonly delivered: number | null;
  readonly read: number | null;
  readonly failed: number;
}

export interface CampaignProps {
  readonly stage: CampaignStage;
  readonly title: string;
  readonly body: string;
  readonly onTitle: (v: string) => void;
  readonly onBody: (v: string) => void;
  readonly onSave?: (() => void) | undefined;
  readonly saving?: boolean | undefined;
  readonly errors?:
    { readonly title?: string | undefined; readonly body?: string | undefined } | undefined;
  /** تعويض المتغيرات في المعاينة — {name} → قيمة تجريبية. */
  readonly variables: Readonly<Record<string, string>>;
  readonly scheduleLabel?: string | undefined;
  readonly delivery?: DeliveryCounts | undefined;
  readonly readOnly?: boolean | undefined;
}

const STAGE_STATE: Record<
  CampaignStage,
  "ready" | "saving" | "pending_sync" | "success" | "partial" | "expired"
> = {
  draft: "ready",
  preview: "ready",
  approved: "success",
  scheduled: "pending_sync",
  publishing: "saving",
  completed: "success",
  cancelled: "expired",
};
const STAGE_LABEL: Record<CampaignStage, string> = {
  draft: "مسودة",
  preview: "معاينة",
  approved: "معتمدة",
  scheduled: "مجدولة",
  publishing: "جارٍ النشر",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

export function renderPreview(body: string, variables: Readonly<Record<string, string>>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => variables[k] ?? m);
}

export function Campaign({
  stage,
  title,
  body,
  onTitle,
  onBody,
  onSave,
  saving,
  errors,
  variables,
  scheduleLabel,
  delivery,
  readOnly,
}: CampaignProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && onSave && !readOnly) {
        e.preventDefault();
        onSave();
      } else if (e.key === "Escape" && previewOpen) {
        setPreviewOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSave, readOnly, previewOpen]);
  return (
    <div ref={rootRef} className="c-camp" data-stage={stage}>
      <header className="c-camp__head">
        <Status state={STAGE_STATE[stage]} label={STAGE_LABEL[stage]} />
        {scheduleLabel ? (
          <span className="c-field__hint">
            الموعد <span className="sting-mono">{scheduleLabel}</span>
          </span>
        ) : null}
      </header>
      <div className="c-camp__grid">
        <div className="c-camp__editor">
          <TextField
            label="عنوان الرسالة"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            error={errors?.title}
            readOnly={readOnly}
          />
          <TextAreaField
            label="نص الرسالة"
            value={body}
            onChange={(e) => onBody(e.target.value)}
            rows={6}
            error={errors?.body}
            readOnly={readOnly}
            hint="المتغيرات بين أقواس مثل {name} تبقى كما هي وتُعوَّض عند الإرسال"
          />
          {onSave && !readOnly ? (
            <Button onClick={onSave} loading={saving}>
              احفظ المسودة
            </Button>
          ) : null}
        </div>
        {previewOpen ? (
          <aside className="c-camp__preview" aria-labelledby={`${id}-pv`}>
            <h3 id={`${id}-pv`}>معاينة</h3>
            <p className="c-camp__preview-title">{renderPreview(title, variables) || "—"}</p>
            <p className="c-camp__preview-body">{renderPreview(body, variables) || "—"}</p>
            <p className="c-field__hint">معاينة ببيانات تجريبية — لا إرسال فعلياً</p>
          </aside>
        ) : (
          <Button variant="quiet" onClick={() => setPreviewOpen(true)}>
            أظهر المعاينة
          </Button>
        )}
      </div>
      {delivery ? (
        <section className="c-camp__delivery-wrap" aria-label="نتيجة التسليم">
          <dl className="c-camp__delivery">
            <div>
              <dt>مقبول من المزود</dt>
              <dd className="sting-mono">{delivery.accepted}</dd>
            </div>
            <div>
              <dt>وصل</dt>
              <dd className="sting-mono">
                {delivery.delivered === null ? "—" : delivery.delivered}
              </dd>
            </div>
            <div>
              <dt>قُرئ</dt>
              <dd className="sting-mono">{delivery.read === null ? "—" : delivery.read}</dd>
            </div>
            <div>
              <dt>فشل</dt>
              <dd className="sting-mono">{delivery.failed}</dd>
            </div>
          </dl>
          <p className="c-field__hint c-camp__delivery-note">
            «مقبول من المزود» ليس «وصل» ولا «قُرئ» — الدرجات منفصلة وما لا دليل عليه يظهر «—».
          </p>
        </section>
      ) : null}
    </div>
  );
}
