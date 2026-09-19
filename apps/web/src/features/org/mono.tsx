import type { ReactNode } from "react";

/** يفصل الأرقام اللاتينية في نصّ عربي إلى `.sting-mono` — «200 للعملية» بلا حرف عربي داخل mono. */
export function MonoText({ text }: { text: string }): ReactNode {
  const parts = text.split(/([0-9][0-9,.:/-]*)/);
  return (
    <>
      {parts.map((p, i) =>
        /^[0-9]/.test(p) ? (
          <span key={i} className="sting-mono">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}
