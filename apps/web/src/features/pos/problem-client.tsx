"use client";

import type { StoredOperation } from "@sting/platform";
import { type LocalSale, readSale } from "@sting/sync-core";
import { Button, formatMinor, Frame, Money, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { countPending, type LastPush, readLastPush } from "@/lib/sync";

import { PosNav } from "./pos-nav";

type State = "offline" | "saved_local" | "validation_error" | "server_error";

/** سطر «فعل → نتيجته»: الحفظ والطباعة والمزامنة ثلاثة أفعال منفصلة تُسمّى بالاسم. */
function Act({ k, v, tone }: { k: string; v: string; tone: "ok" | "wait" | "bad" }) {
  return (
    <div className={`pos-act pos-act--${tone}`}>
      <span className="pos-act__dot" aria-hidden="true" />
      <span className="pos-act__k">{k}</span>
      <span className="pos-act__v">{v}</span>
    </div>
  );
}

/**
 * POS-11 — فشل الحفظ أو الطباعة (33-D25 offline/saved_local/validation_error/server_error): شاشة بلا
 * `ready` — لا توجد إلا حين يقع خطأ. الحفظ والطباعة والمزامنة ثلاثة أفعال منفصلة ونجاح أحدها لا
 * يُشترط بنجاح الآخر؛ الشاشة تقول أيُّها تمّ وأيُّها لم يتمّ بالاسم. البيع لا يُلغى لأن الطابعة صمتت أو
 * الخادم ردّ — النقد قُبض والبضاعة خرجت.
 */
export function ProblemClient({ saleId }: { saleId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [sale, setSale] = useState<LocalSale | null | undefined>(undefined);
  const [op, setOp] = useState<StoredOperation | null>(null);
  const [lastPush, setLastPush] = useState<LastPush | null>(null);
  const [waiting, setWaiting] = useState(0);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/pos/receipt/${saleId}/problem`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const s = await readSale(storage, saleId);
      setSale(s);
      if (s) setOp(await storage.read((tx) => tx.getOperation(s.operation_id)));
      setLastPush(await readLastPush());
      setWaiting(await countPending());
    })();
  }, [router, saleId]);

  useEffect(() => {
    if (sale === null) router.replace("/pos");
  }, [router, sale]);

  const opState = op?.state ?? "local";
  const rejected = opState === "quarantined" || opState === "conflict";
  const serverError = lastPush?.kind === "retry" && (lastPush.status ?? 0) >= 500;
  const state: State = rejected
    ? "validation_error"
    : !online
      ? "offline"
      : serverError
        ? "server_error"
        : "saved_local";

  const newSale = () => router.push("/pos");
  const printAndNew = () => {
    window.print();
    router.push("/pos");
  };

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="pos" canSeeReports={false} />}
      footer={null}
      notice={
        state === "offline" ? (
          <Status
            state="offline"
            label={
              <>
                بلا اتصال · <span className="sting-mono">{waiting}</span> فواتير تنتظر
              </>
            }
          />
        ) : undefined
      }
    >
      <div className="pos" data-screen="POS-11" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {state === "offline"
                ? "بلا اتصال"
                : state === "saved_local"
                  ? "محفوظ محلياً"
                  : state === "validation_error"
                    ? "الخادم رفض الفاتورة"
                    : "خطأ خادم"}
            </h2>
            {sale ? <span className="cat-head__hint sting-mono">{sale.invoice_number}</span> : null}
          </div>
          {sale ? (
            <div className="acc-card__body">
              <div className="pos-pay__change pos-pay__change--big">
                <span>{BigInt(sale.cash_minor) > 0n ? "نقداً" : "الإجمالي"}</span>
                <Money minor={sale.total_minor} currency="ج.س" size="title" />
              </div>

              <div className="pos-acts">
                {state === "offline" ? (
                  <>
                    <Act k="الحفظ" v="تمّ على الجهاز" tone="ok" />
                    <Act k="الطباعة" v="تمّت" tone="ok" />
                    <Act k="المزامنة" v="متوقّفة" tone="wait" />
                  </>
                ) : state === "saved_local" ? (
                  <>
                    <Act k="الحفظ" v="على الجهاز" tone="ok" />
                    <Act k="الرقم النهائي" v="بانتظار الخادم" tone="wait" />
                    <Act k="الطباعة" v="برقم مؤقت" tone="wait" />
                  </>
                ) : state === "validation_error" ? (
                  <>
                    <Act k="النقد" v="في الدرج" tone="ok" />
                    <Act k="الطباعة" v="تمّت" tone="ok" />
                    <Act k="القيد في النظام" v="مرفوض" tone="bad" />
                  </>
                ) : (
                  <>
                    <Act k="الحفظ المحلي" v="تمّ" tone="ok" />
                    <Act k="الخادم" v={`ردّ بخطأ ${lastPush?.status ?? 500}`} tone="bad" />
                    <Act k="إعادة المحاولة" v="بعد 30 ث" tone="wait" />
                  </>
                )}
              </div>

              {state === "offline" ? (
                <>
                  <p className="acc-lead">
                    الشبكة ساقطة والبيع تمّ كاملاً: النقد في الدرج والورقة بيد الزبون. الحالة
                    الوحيدة التي لا تُوقف الكاشير ثانيةً واحدة.
                  </p>
                  <p className="shift-hidden">
                    لا نافذة ولا تأكيد — شريطٌ علويّ دائم يقول «بلا اتصال ·{" "}
                    <span className="sting-mono">{waiting}</span> فواتير تنتظر». الكاشير يواصل،
                    والمزامنة تتم وحدها حين تعود الشبكة.
                  </p>
                </>
              ) : null}
              {state === "saved_local" ? (
                <>
                  <p className="acc-lead">
                    الشبكة قائمة والخادم بطيء. حُفظ البيع محلياً برقم{" "}
                    <span className="sting-mono">{sale.invoice_number}</span> ريثما يُعطى رقمه
                    النهائي.
                  </p>
                  <p className="shift-hidden">
                    الورقة تحمل الرقم المؤقت موسوماً «مؤقت» بخطّ ظاهر. الزبون الذي يعود بورقة برقم
                    يختلف عمّا في النظام يظنّ أن بيعه لم يُسجَّل — والوسم يمنع ذلك.
                  </p>
                  <p className="acc-choice__note">
                    الرقم النهائي يُعطى عند المزامنة. الورقة تحمل المؤقّت ومعه وسم «مؤقت».
                  </p>
                </>
              ) : null}
              {state === "validation_error" ? (
                <>
                  <p className="acc-lead">
                    البيع وقع في الواقع والنظام يرفض قيده — وهذا أخطر ما في الشاشة.
                  </p>
                  <p className="shift-hidden">
                    لا نُلغي ولا نطلب من الكاشير أن يشرح للزبون. نُبقي الفاتورة معلّقة ونُعلمه
                    بصنفها، وتُحلّ بقرار المالك: إعادة الصنف أو قيد يدوي. النقد لا يُنكَر لأن سطراً
                    في قاعدة البيانات اختفى.
                  </p>
                </>
              ) : null}
              {state === "server_error" ? (
                <>
                  <p className="acc-lead">
                    الخادم موجود ويردّ بخطأ. يختلف عن بلا اتصال: هناك لا نتوقّع رداً، وهنا الرد نفسه
                    معطوب — فلا نُعيد إلى ما لا نهاية.
                  </p>
                  <p className="shift-hidden">
                    ثلاث محاولات متباعدة ثم توقّف وسطرٌ في سجل يراه المالك. التكرار بلا حدّ يُخفي
                    العطب أسبوعاً حتى يُكتشف بجرد لا يطابق.
                  </p>
                </>
              ) : null}

              <p className="acc-choice__note">
                <strong>الحفظ والطباعة والمزامنة ثلاثة أفعال منفصلة</strong>، ونجاح أحدها لا يُشترط
                بنجاح الآخر. والبيع لا يُلغى لأن الطابعة صمتت: إلغاء بيعٍ قُبض ثمنه هو الخطأ الأكبر.
              </p>

              <div className="cat-form__actions">
                {state === "offline" ? (
                  <Button onClick={newSale} pos>
                    ابدأ بيعاً جديداً
                  </Button>
                ) : state === "saved_local" ? (
                  <Button onClick={printAndNew} pos>
                    اطبع وابدأ بيعاً جديداً
                  </Button>
                ) : state === "validation_error" ? (
                  <Button variant="danger" onClick={newSale} pos>
                    علّقها للمالك وابدأ بيعاً جديداً
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={newSale} pos>
                    واصل البيع محلياً
                  </Button>
                )}
                <Button variant="quiet" onClick={() => router.push(`/pos/receipt/${sale.id}`)}>
                  الإيصال <span className="sting-mono">{formatMinor(sale.total_minor)}</span>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
