/**
 * C-PHASE — وسم مرحلة (G-13 المطبق): M3، M4، مشروط، مقيد بالباقة. الحالات: phase_locked,
 * permission_denied. «هذه الوظيفة مصمَّمة وتُفعَّل في المرحلة M3 أو بعد اعتماد عقدها. ليست نقص
 * صلاحية ولا عطلاً.» الوسم زر يفتح تفسير المرحلة؛ لا زر معطّل بلا تفسير؛ الوسم نص عربي صريح
 * يُعلن سبب عدم التوفر (02-Design-System، 23-Handoff، القاعدة 11 من الأمر).
 */
import { Lock } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Status } from "./Status";

export type PhaseKind = "M3" | "M4" | "conditional" | "plan";

const KIND_LABEL: Record<PhaseKind, string> = {
  // لغة المحل لا رموز المواصفات (0005 §١٢٨): كان «phase_locked · M3» و«مشروط بعقد»
  M3: "الربط",
  M4: "النموّ",
  conditional: "يحتاج تفعيلاً",
  plan: "خارج باقتك",
};

export interface PhaseProps {
  readonly kind: PhaseKind;
  /** النص الحرفي من الإطار لتفسير المرحلة. */
  readonly explanation: string;
  /** ما تشمله المرحلة — قائمة من الإطار. */
  readonly includes?: readonly string[];
  readonly title?: string;
}

export function PhaseTag({ kind, explanation, includes, title = "مرحلة غير مفعّلة" }: PhaseProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className="c-phase" aria-describedby={id} onClick={() => setOpen(true)}>
        <Lock size={14} aria-hidden="true" />
        <span>{title}</span>
        <span className="c-phase__kind">{KIND_LABEL[kind]}</span>
      </button>
      <span id={id} className="visually-hidden">
        {explanation}
      </span>
      <Dialog open={open} kind="info" title={title} onClose={() => setOpen(false)}>
        <p>{explanation}</p>
        {includes && includes.length > 0 ? (
          <>
            <p className="c-field__label">ما تشمله المرحلة</p>
            <ul>
              {includes.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Dialog>
    </>
  );
}

export interface PhaseLockedProps extends PhaseProps {
  /** الواجهة الكاملة مصمَّمة ومعطَّلة — تُعرض خلف الوسم لا تُخفى (القاعدة 11). */
  readonly children: ReactNode;
  /** «مشروط» بمفتاح في يد المالك الآن (32-D24 PUR-05): زرّ حاضر يفعّل، لا زرّ معطّل. */
  readonly onActivate?: (() => void) | undefined;
  readonly activateLabel?: string | undefined;
  readonly activating?: boolean | undefined;
}

/** يغلّف شاشة كاملة بحالة phase_locked: المحتوى مرئي ومعطَّل والوسم في الأعلى. */
export function PhaseLocked({
  children,
  onActivate,
  activateLabel = "تفعيل",
  activating = false,
  ...tag
}: PhaseLockedProps) {
  return (
    <div className="c-phase__locked" data-state="phase_locked">
      <div className="c-phase__bar">
        <Status state="phase_locked" />
        <PhaseTag {...tag} />
      </div>
      <div className="c-phase__content" inert>
        {children}
      </div>
      {onActivate ? (
        <Button variant="primary" onClick={onActivate} loading={activating}>
          {activateLabel}
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => {}} disabledReason={tag.explanation}>
          {activateLabel}
        </Button>
      )}
    </div>
  );
}
