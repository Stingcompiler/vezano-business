"use client";

import { Button, Frame, PhaseLocked } from "@sting/ui-web";
import { useRouter } from "next/navigation";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import { AppNav } from "@/features/home/app-nav";
import { phaseScreen } from "@/features/phase/phase-screens";

/** شاشة M3/M4 بحالة `phase_locked` وحدها: المحتوى مرئي ومعطَّل خلف الوسم، والبديل الحاضر معلَن (G-13). */
export function PhaseScreenClient({ id }: { id: string }) {
  const router = useRouter();
  const s = phaseScreen(id);
  if (!s) return null;
  return (
    <Frame
      title={s.kind === "M3" ? "الربط" : "النموّ"}
      nav={<AppNav currentId={s.navId} />}
      footer={null}
    >
      <div className="sys mp cus" data-screen={s.id} data-state="phase_locked">
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">{s.title}</h2>
            <span className="cat-head__hint">{s.hint}</span>
          </div>
          <div className="acc-card__body">
            <PhaseLocked
              kind={s.kind}
              title={s.kind === "M3" ? "مرحلة الربط لم تُفتح بعد" : "مرحلة النموّ لم تُفتح بعد"}
              explanation={s.lock}
              activateLabel={`يُفتح مع ${s.kind === "M3" ? "مرحلة الربط" : "مرحلة النموّ"} — لا مفتاح هنا`}
            >
              <p className="acc-choice__note">
                <strong>مثال</strong> · لقطة موسومة «مثال» — ما يُرى يُقنع بالانتظار أكثر مما يُقنع
                الوصف.
              </p>
              {s.sample.map((block) => (
                <div key={block.heading} className="mp-preview-card pos-card">
                  <strong>{block.heading}</strong>
                  <ul className="pub-list">
                    {block.lines.map((t) => (
                      <li key={t}>
                        <span className="pub-mark">·</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </PhaseLocked>
            <p className="acc-choice__note">
              <strong>صيغة القفل</strong> · {s.lock}
            </p>
            {s.alternative ? (
              <>
                <p className="acc-choice__note">
                  <strong>البديل الحاضر</strong> · {s.alternative.note}
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push(s.alternative?.href ?? "/")}>
                    {s.alternative.label}
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
