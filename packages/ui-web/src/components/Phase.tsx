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
  M3: "phase_locked · M3",
  M4: "phase_locked · M4",
  conditional: "مشروط بعقد",
  plan: "غير مشمول بالباقة",
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
}

/** يغلّف شاشة كاملة بحالة phase_locked: المحتوى مرئي ومعطَّل والوسم في الأعلى. */
export function PhaseLocked({ children, ...tag }: PhaseLockedProps) {
  return (
    <div className="c-phase__locked" data-state="phase_locked">
      <div className="c-phase__bar">
        <Status state="phase_locked" />
        <PhaseTag {...tag} />
      </div>
      <div className="c-phase__content" inert>
        {children}
      </div>
      <Button variant="secondary" onClick={() => {}} disabledReason={tag.explanation}>
        تفعيل
      </Button>
    </div>
  );
}
