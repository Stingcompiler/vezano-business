"use client";

import { Button, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./portal.css";
import { readToken } from "@/features/portal/portal-store";
import { api } from "@/lib/api";

type State = "ready" | "permission_denied" | "expired";

interface Me {
  shop_name: string;
  active: boolean;
  push_permission: string;
  unread: number;
  undo_expired: boolean;
}

/** CUS-05 — إذن مرفوض أو اشتراك منتهٍ (37-D29 ready · 08-D4 permission_denied · 21-D16 expired). */
export function PortalStatusClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = readToken(slug);
    if (!t) {
      setGone(true);
      return;
    }
    let cancelled = false;
    void api()
      .GET("/api/portal/{slug}/me", { params: { path: { slug }, query: { t } } })
      .then(({ data, response }) => {
        if (cancelled) return;
        if (response.status === 404) {
          setGone(true);
          return;
        }
        const body = data as unknown as { subscriber: Me } | undefined;
        if (response.ok && body) setMe(body.subscriber);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const state: State =
    gone || (me && !me.active && me.undo_expired)
      ? "expired"
      : me?.push_permission === "denied"
        ? "permission_denied"
        : "ready";
  const unread = me?.unread ?? 0;

  return (
    <Frame title={me?.shop_name ?? "فيزانو بلص"} footer={null}>
      <div className="sys cus" data-screen="CUS-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h1 className="cat-head__title">إذن مرفوض أو اشتراك منتهٍ</h1>
            <span className="cat-head__hint">
              شاشةٌ تُشرح فيها الحالة وتُعرض بدائلها: إذن مرفوض فالرسائل تصل بالبريد، أو اشتراك
              انتهى فالتجديد بضغطة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "ready" ? (
              <Notice kind="success" title="شرح الحالة ومخرجها">
                <p className="acc-lead">
                  اشتراكك في {me?.shop_name ?? "المحل"} قائم ولا منع. لكل منع طريقٌ ثانٍ. صفحةٌ تقول
                  «لا تستطيع» ثم تصمت أسوأ من عدمها.
                </p>
                <p className="acc-choice__note">
                  <strong>البديل لا الاعتذار</strong> · الصفحة في وضعها المعتاد قبل أن يقع منع.
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push(`/portal/${slug}/inbox`)}>
                    رسائل المحل
                  </Button>
                  <Button onClick={() => router.push("/portal/prefs")}>التفضيلات</Button>
                </div>
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice
                kind="locked"
                title="إذن التنبيه مرفوض"
                action={
                  <Button pos onClick={() => router.push(`/portal/${slug}/inbox`)}>
                    فتح صندوق الوارد — <span className="sting-mono">{unread}</span> جديدة
                  </Button>
                }
              >
                <p className="acc-lead">
                  متصفحك يرفض إشعارات هذا الموقع. الرفض قرارك ومحترم، والخدمة لا تتوقف — تتحول إلى
                  صندوق وارد تفتحه أنت.
                </p>
                <p className="acc-lead">
                  <strong>صندوق الوارد يعمل الآن</strong> ·{" "}
                  <span className="sting-mono">{unread}</span> رسائل غير مقروءة من المحل محفوظة هنا.
                  لا تحتاج إذناً لقراءتها.
                </p>
                <p className="acc-lead">
                  <strong>لن نطلب الإذن مرة أخرى</strong> · إعادة الطلب بعد الرفض يحجبها المتصفح
                  نفسه. لو غيّرت رأيك، تُفعّلها من إعدادات الموقع.
                </p>
                <p className="acc-choice__note">
                  <strong>ما لن نفعله</strong> · لا رسائل نصية بدلاً من الإشعار دون موافقة منفصلة
                  على القناة.
                </p>
              </Notice>
            ) : null}

            {state === "expired" ? (
              <Notice
                kind="warning"
                title="انتهت صلاحية الرابط"
                action={
                  <Button pos onClick={() => router.push(`/portal/${slug}`)}>
                    اذهب لصفحة المحل
                  </Button>
                }
              >
                <p className="acc-lead">
                  اشتراكك انتهى — التراجع كان متاحاً 7 أيام، بعدها تحتاج الرابط أو QR من جديد.
                </p>
                <p className="acc-lead">
                  <strong>نقول متى انتهى</strong> · لا «حدث خطأ» غامضة.{" "}
                  <strong>ونعرض الوجهة البديلة</strong> · صفحة المحل نفسها تعمل.
                </p>
                <p className="acc-choice__note">
                  <strong>ولا نكشف ما لا يخصّك</strong> · رابط محل آخر يعطي الرسالة نفسها. الانتهاء
                  حالة متوقَّعة لا عطل. الشاشة تعطي مخرجاً بدل أن تترك الزبون في طريق مسدود.
                </p>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
