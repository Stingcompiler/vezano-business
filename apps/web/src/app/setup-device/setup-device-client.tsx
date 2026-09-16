"use client";

import { capabilities, percentDone } from "@sting/sync-core";
import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import "@/features/acc/acc.css";
import { useBootstrap } from "@/features/acc/use-bootstrap";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State = "loading" | "partial" | "stale" | "server_error" | "success" | "offline";

/** أسماء النطاقات المسمّاة كما في 34-D26 loading: الكتالوج، الأطراف، الأرصدة، الإعدادات. */
const GROUP_LABEL: Record<string, string> = {
  catalog: "الكتالوج",
  parties: "الأطراف",
  balances: "الأرصدة",
  settings: "الإعدادات",
};

/**
 * ACC-05. الترويسة وقائمة الخطوات من `28-D21#ACC-05` (offline)؛ بقية الحالات من `34-D26#ACC-05`.
 * الجاهزية قائمة قدرات؛ ما نزل يبقى؛ الانتهاء يبدأ من جديد ويقول ذلك؛ لا وعد بمزامنة دائمة.
 */
export function SetupDeviceClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const b = useBootstrap(online);

  useEffect(() => {
    if ((!app.tokens || !app.session.tenantId) && !app.expired) router.replace("/login");
  }, [app.tokens, app.session.tenantId, router]);

  const p = b.progress;
  const caps = p ? capabilities(p) : { sell: false, inventory: false };
  const state: State = !online
    ? "offline"
    : b.phase === "done"
      ? "success"
      : b.stop === "expired"
        ? "stale"
        : b.stop === "error"
          ? caps.sell || caps.inventory
            ? "partial"
            : "server_error"
          : b.stop === "offline"
            ? "offline"
            : "loading";

  const pct = p ? percentDone(p) : 0;
  const counts = {
    items: p?.received.catalog ?? 0,
    parties: p?.received.parties ?? 0,
  };

  return (
    <Frame title="Sting" footer={null}>
      <div className="acc-page" data-screen="ACC-05" data-state={state}>
        <div className="acc-card">
          <div className="acc-card__body">
            <div>
              <h2 className="acc-card__title" style={{ fontSize: 19 }}>
                تجهيز الجهاز
              </h2>
              <p className="acc-lead">
                التنزيل الأول يحتاج اتصالاً. بعده يعمل الجهاز كاملاً بلا إنترنت.
              </p>
            </div>

            {state === "loading" ? (
              <div role="status" aria-live="polite">
                <p className="acc-card__sub">التنزيل جارٍ</p>
                <ul className="acc-steps" aria-label="التنزيل جارٍ">
                  {(p?.image.scopes ?? []).map((s) => (
                    <li key={s.group}>
                      <span>{GROUP_LABEL[s.group] ?? s.group}</span>
                      <span>
                        <span className="sting-mono">{p?.received[s.group] ?? 0}</span> من{" "}
                        <span className="sting-mono">{s.total}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {state === "offline" ? (
              <>
                <ol className="acc-steps">
                  <li>
                    <span>حساب المنشأة</span>
                    <span className="acc-tag acc-tag--current">تم</span>
                  </li>
                  <li>
                    <span>الكتالوج والوحدات</span>
                    <span className={`acc-tag${caps.sell ? " acc-tag--current" : ""}`}>
                      {caps.sell ? (
                        "تم"
                      ) : (
                        <>
                          <span className="sting-mono">{pct}</span>%
                        </>
                      )}
                    </span>
                  </li>
                  <li>
                    <span>الخطوط وواجهة العمل</span>
                    <span className="acc-tag">لاحقاً</span>
                  </li>
                  <li>
                    <span>الطابعة</span>
                    <span className="acc-tag">لاحقاً</span>
                  </li>
                </ol>
                <Notice
                  kind="offline"
                  title={
                    <>
                      انقطع الاتصال عند <span className="sting-mono">{pct}</span>%
                    </>
                  }
                >
                  <p className="acc-lead">
                    التقدّم محفوظ ويُستأنف من حيث توقّف — لا يبدأ من الصفر. وما نُزّل من كتالوج
                    وخطوط يعمل الآن؛ ما ينتظر هو الباقي فقط.
                  </p>
                </Notice>
              </>
            ) : null}

            {state === "partial" ? (
              <Notice kind="warning" title="بعض النطاقات وصلت">
                <p className="acc-lead">
                  {caps.sell ? "تستطيع البيع الآن" : null}
                  {caps.sell && !caps.inventory ? " · " : null}
                  {!caps.inventory ? "الجرد يحتاج الأرصدة" : null}
                </p>
                <p className="acc-lead">من حيث توقّف لا من الصفر.</p>
                <div className="acc-links">
                  <Button onClick={b.retry}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}

            {state === "stale" ? (
              <Notice kind="warning" title="تهيئة قديمة غير مكتملة">
                <p className="acc-lead">ما نُزِّل قديم — نبدأ من جديد</p>
                <div className="acc-links">
                  <Button onClick={b.retry}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice kind="error" title="انقطع التنزيل بخطأ">
                <p className="acc-lead">المُنزَّل سليم والباقي لا. ما نزل يبقى.</p>
                <div className="acc-links">
                  <Button onClick={b.retry}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}

            {state === "success" ? (
              <>
                <Notice kind="success" title="الجهاز جاهز">
                  <p className="acc-lead">
                    <span className="sting-mono">{counts.items}</span> صنفاً و
                    <span className="sting-mono">{counts.parties}</span> طرفاً وفرعٌ واحد.
                  </p>
                  <p className="acc-lead">يعمل بلا اتصال ويُزامن حين تعود الشبكة</p>
                </Notice>
                {b.persist === "denied" ? <Status state="permission_denied" /> : null}
                <div className="acc-actions">
                  <Button
                    onClick={() => router.push("/shifts/open")}
                    disabledReason={b.persist === "denied" ? "صلاحية مرفوضة" : undefined}
                  >
                    افتح وردية وابدأ البيع
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
