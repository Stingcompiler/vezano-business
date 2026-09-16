/**
 * C-BTN — 23-Handoff: أساسي/ثانوي/خفيف/خطر/أيقونة فقط؛ الحالات: ready, loading, disabled بسبب معلن,
 * permission_denied. الارتفاع ≥44px على كل المنصات (decisions/0004). الزر المعطّل يصاحبه سبب نصي.
 * الأيقونة يمين النص افتراضاً (RTL)؛ loading يضيف aria-busy ولا يزيل النص.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode, useId } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "icon";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  readonly variant?: ButtonVariant;
  readonly loading?: boolean;
  /** التعطيل يستلزم سبباً معلناً — لا زر معطَّل صامت (R-02). */
  readonly disabledReason?: string;
  /** أيقونة فقط: تسمية عربية إلزامية (23-Handoff قارئ الشاشة). */
  readonly iconLabel?: string;
  readonly icon?: ReactNode;
  /** الفعل المالي الأساسي: 56px على الهاتف. */
  readonly financial?: boolean;
  /** على تابلت POS: 46px (S-01). */
  readonly pos?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    loading = false,
    disabledReason,
    iconLabel,
    icon,
    financial,
    pos,
    children,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const reasonId = useId();
  const disabled = Boolean(disabledReason) || loading;
  if (variant === "icon" && !iconLabel) {
    throw new Error("C-BTN icon-only requires iconLabel (aria-label عربي)");
  }
  const button = (
    <button
      ref={ref}
      type={type}
      className={["c-btn", `c-btn--${variant}`, className].filter(Boolean).join(" ")}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-label={variant === "icon" ? iconLabel : undefined}
      aria-describedby={disabledReason ? reasonId : undefined}
      data-financial={financial ? "true" : undefined}
      data-pos={pos ? "true" : undefined}
      {...rest}
    >
      {loading ? <span className="c-btn__spinner" aria-hidden="true" /> : icon}
      {variant === "icon" ? null : children}
    </button>
  );
  if (!disabledReason) return button;
  return (
    <span className="c-btn__wrap">
      {button}
      <span id={reasonId} className="c-btn__reason">
        {disabledReason}
      </span>
    </span>
  );
});
