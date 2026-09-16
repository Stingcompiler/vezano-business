/**
 * C-AUD — جمهور كل الزبائن، شريحة بمرشّحات، قائمة مرفوعة، جمهور مقيد بالمستأجر. الحالات: ready,
 * loading, empty, permission_denied, validation_error. حجم الجمهور يُعلن عند كل تغيير؛ محاولة الوصول
 * لجمهور مستأجر آخر تُرفض برسالة لا تكشف وجوده (R-12). الجمهور من دفترك وحده (§١١.٥).
 */
import { type ReactNode, useEffect, useId, useState } from "react";

import { RadioGroupField } from "./Field";

export type AudienceKind = "all" | "segment" | "upload";

export interface AudienceProps {
  readonly kind: AudienceKind;
  readonly onKind: (kind: AudienceKind) => void;
  /** حجم الجمهور المحسوب خادمياً — يُعلن عند التغيير. */
  readonly size: number | null;
  readonly loading?: boolean | undefined;
  readonly sizeLabel: (n: number) => string;
  /** مرشّحات الشريحة (حقول C-FIELD) */
  readonly segmentControls?: ReactNode;
  readonly uploadControl?: ReactNode;
  readonly error?: string | undefined;
  /** تنبيه ثابت: الجمهور من مشتركي هذا المحل فقط. */
  readonly scopeNote: string;
}

export function Audience({
  kind,
  onKind,
  size,
  loading,
  sizeLabel,
  segmentControls,
  uploadControl,
  error,
  scopeNote,
}: AudienceProps) {
  const id = useId();
  const [live, setLive] = useState("");
  useEffect(() => {
    setLive(loading ? "جارٍ حساب الجمهور" : size === null ? "" : sizeLabel(size));
  }, [size, loading, sizeLabel]);
  return (
    <div className="c-aud" data-kind={kind}>
      <RadioGroupField
        label="الجمهور"
        name={`${id}-kind`}
        value={kind}
        onChange={(v) => onKind(v as AudienceKind)}
        options={[
          { value: "all", label: "كل المشتركين", hint: "مشتركو قناة هذا المحل" },
          { value: "segment", label: "شريحة بمرشّحات" },
          { value: "upload", label: "قائمة مرفوعة", hint: "تُطابَق مع المشتركين فقط" },
        ]}
        error={error}
      />
      {kind === "segment" && segmentControls ? (
        <div className="c-aud__controls">{segmentControls}</div>
      ) : null}
      {kind === "upload" && uploadControl ? (
        <div className="c-aud__controls">{uploadControl}</div>
      ) : null}
      <p className="c-aud__size" role="status">
        {loading ? (
          "جارٍ حساب الجمهور…"
        ) : size === null ? (
          "—"
        ) : (
          <>
            <span className="sting-mono">{size}</span> {sizeLabel(size).replace(/^\d+\s*/, "")}
          </>
        )}
      </p>
      <p className="c-field__hint">{scopeNote}</p>
      <span className="visually-hidden" aria-live="polite">
        {live}
      </span>
    </div>
  );
}
