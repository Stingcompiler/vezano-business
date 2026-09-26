"use client";

import { Button, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./portal.css";
import type { ShopPage } from "@/features/portal/shop-client";
import { saveToken } from "@/features/portal/portal-store";
import { api } from "@/lib/api";
import { pushPermission, requestPushPermission, subscribePush } from "@/lib/pwa";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface Subscriber {
  token: string;
  active: boolean;
  push_enabled: boolean;
  unread: number;
}

/** CUS-02 — اشتراك وإذن تنبيه (08-D4 ready/permission_denied · 37-D29 validation_error/success). */
export function SubscribeClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [page, setPage] = useState<ShopPage | null>(null);
  const [phone, setPhone] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [sub, setSub] = useState<Subscriber | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [howTo, setHowTo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api()
      .GET("/api/portal/{slug}", { params: { path: { slug }, query: {} } })
      .then(({ data, response }) => {
        if (cancelled) return;
        if (response.status === 404) {
          router.replace("/link-expired");
          return;
        }
        const body = data as unknown as ShopPage | undefined;
        if (response.ok && body) setPage(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, router]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setInvalid(false);
    try {
      // الإذن يُطلب بعد الشرح والنقر — والرفض قرارٌ محترم لا يوقف الاشتراك
      let permission = pushPermission();
      if (permission === "default") permission = await requestPushPermission();
      const keys =
        permission === "granted" && page?.push_public_key
          ? await subscribePush(page.push_public_key)
          : null;
      const { data, response } = await api().POST("/api/portal/{slug}/subscribe", {
        params: { path: { slug } },
        body: { phone, push_permission: permission, push: keys ?? undefined } as never,
      });
      if (response.status === 400) {
        setInvalid(true);
        return;
      }
      const body = data as unknown as { subscriber: Subscriber } | undefined;
      if (response.ok && body) {
        saveToken(slug, body.subscriber.token);
        setSub(body.subscriber);
        setDenied(permission === "denied");
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = sub
    ? denied
      ? "permission_denied"
      : "success"
    : invalid
      ? "validation_error"
      : "ready";
  const shop = page?.shop.name ?? "";
  const unread = sub?.unread ?? 0;

  return (
    <Frame title={shop || "فيزانو بلص"} footer={null}>
      <div className="sys cus" data-screen="CUS-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h1 className="cat-head__title">تنبيهات المحل</h1>
            <span className="cat-head__hint">
              وصلتك عبر رابط المحل أو رمز QR. الاشتراك هنا فعل صريح منك، ولا ينشئ حساباً ولا يربطك
              بنظام المحل الداخلي.
            </span>
          </div>
          <div className="acc-card__body">
            {shop ? <p className="acc-lead">{shop}</p> : null}

            {state === "success" ? (
              <Notice
                kind="success"
                title="اشتركتَ"
                action={
                  <Button pos onClick={() => router.push(`/portal/${slug}`)}>
                    إلى صفحة المحل
                  </Button>
                }
              >
                <p className="acc-lead">
                  ستصلك عروض {shop} وتغيّر ساعات العمل — بضع رسائل في الشهر لا أكثر. الإلغاء بنقرة
                  واحدة في أي وقت، ولمحل واحد دون غيره.
                </p>
                <p className="acc-lead">
                  نقول بالضبط ما سيصل وكم مرة تقريباً وكيف يُلغى — في شاشة النجاح لا في شروط مطويّة.
                </p>
                <p className="acc-choice__note">
                  <strong>الإلغاء من أول لحظة</strong> · رابط الإلغاء في أول رسالة تصل. من يعرف أنه
                  يستطيع الخروج يبقى أطول.
                </p>
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
                <p className="acc-lead">
                  <strong>ما لن نفعله</strong> · لا رسائل نصية بدلاً من الإشعار دون موافقة منفصلة
                  على القناة.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => setHowTo((v) => !v)}>
                    كيف تُفعّل الإشعارات من إعدادات المتصفح — تعليمات حسب جهازك.
                  </Button>
                </div>
                {howTo ? (
                  <p className="acc-choice__note">
                    أندرويد/كروم: إعدادات الموقع ← الإشعارات ← السماح. آيفون: أضف الصفحة إلى الشاشة
                    الرئيسية أولاً ثم فعّل الإشعارات من إعدادات التطبيق.
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {state === "ready" || state === "validation_error" ? (
              <>
                {state === "validation_error" ? (
                  <Notice kind="error" title="رقم غير صالح">
                    <p className="acc-lead">رقم هاتف ناقص أو بصيغة غير مفهومة.</p>
                    <p className="acc-choice__note">
                      <strong>نتساهل في الصيغة</strong> · نقبل بمسافات وشرطات وبصيغة دولية أو محلية
                      ونُطبّعها نحن. رفضُ رقمٍ صحيح لأن صيغته مختلفة عناءٌ لا لزوم له.
                    </p>
                  </Notice>
                ) : null}
                <p className="acc-lead">
                  <strong>ما ستصلك</strong> · عروض المحل وتغيّر ساعات العمل. لا رسائل من محال أخرى
                  ولا من فيزانو بلص.
                </p>
                <p className="acc-lead">
                  <strong>ما لا نطلبه</strong> · لا اسم ولا عنوان ولا كلمة مرور. رقمك يُستخدم
                  للإرسال وحده.
                </p>
                <TextField
                  label="رقم الهاتف"
                  kind="tel"
                  mono
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  error={
                    state === "validation_error"
                      ? "رقم هاتف ناقص أو بصيغة غير مفهومة — اكتبه كاملاً بأي صيغة."
                      : undefined
                  }
                />
                <div className="acc-actions">
                  <Button pos onClick={() => void submit()} loading={busy}>
                    أشترك في تنبيهات هذا المحل
                  </Button>
                  <Button onClick={() => router.push(`/portal/${slug}`)}>رجوع</Button>
                </div>
                <p className="acc-choice__note">
                  الإلغاء بنقرة واحدة في أي وقت، ولمحل واحد دون غيره.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
