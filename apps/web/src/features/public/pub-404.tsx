"use client";

import { Button, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./public.css";

type State = "empty" | "expired" | "permission_denied";

/**
 * PUB-04 — صفحة غير موجودة أو رابط منتهٍ (37-D29 empty/permission_denied · 09-D5 expired):
 * نصّ واحد للرابط المنتهي مهما كان سببه (ACC-60)، وثلاثة مخارج للزائر الضالّ.
 */
export function Pub404({ state }: { state: State }) {
  const router = useRouter();
  return (
    <Frame title="فيزانو" footer={null}>
      <div className="sys pub" data-screen="PUB-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="acc-card__body">
            {state === "empty" ? (
              <Notice kind="empty" title="الصفحة غير موجودة">
                <p className="acc-lead">رابط خاطئ أو محتوى حُذف. لا رسم طريف ولا اعتذار طويل.</p>
                <p className="acc-choice__note">
                  <strong>مخارج بحسب من هو</strong> · ثلاثة: الصفحة الرئيسية، دخول التطبيق، السوق.
                  زائرٌ ضالّ أحدُ ثلاثة، ولكلٍّ بابه.
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push("/")}>
                    الصفحة الرئيسية
                  </Button>
                  <Button onClick={() => router.push("/welcome")}>دخول التطبيق</Button>
                  <Button onClick={() => router.push("/market")}>السوق</Button>
                </div>
              </Notice>
            ) : null}

            {state === "expired" ? (
              <Notice kind="error" title="الرابط لم يعد صالحاً">
                <p className="acc-lead">
                  هذا الرابط منتهٍ أو غير متاح لك. لا نقول إن كان موجوداً أصلاً، ولا لمن يخص، ولا ما
                  نوعه — وهذا مقصود: لو غيّرنا النص حسب وجود المستند لصار هذا الاختلاف نفسه تسريباً
                  يُستعمل للتنصت على ما لدى غيرك.
                </p>
                <p className="acc-choice__note">
                  <strong>نص واحد لثلاث حالات:</strong> رابط منتهٍ، رابط لمنشأة أخرى، رابط لا وجود
                  له. الثلاثة تعطي هذه الصفحة بالحرف نفسه وبزمن استجابة متقارب.
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push("/")}>
                    عودة إلى الصفحة الرئيسية
                  </Button>
                  <Button
                    onClick={() => {}}
                    disabledReason="اطلب رابطاً جديداً ممن أرسله إليك — لا نعرف مُرسِله من هنا."
                  >
                    طلب رابط جديد من مُرسِله
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="locked" title="موجودة ولا تملك فتحها">
                <p className="acc-lead">هذه الصفحة تخصّ منشأة أخرى.</p>
                <p className="acc-choice__note">
                  صفحة منشأة أخرى أو مستند لا يخصّه. لا نقول «غير موجودة» — كذبةٌ، ولا نصفها —
                  إفشاء.
                </p>
                <p className="acc-choice__note">
                  <strong>الصيغة</strong> · «هذه الصفحة تخصّ منشأة أخرى» بلا اسم ولا محتوى، مع «ادخل
                  بحسابك» — فقد يكون مخوّلاً بحسابٍ آخر.
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push("/login")}>
                    ادخل بحسابك
                  </Button>
                  <Button onClick={() => router.push("/")}>الصفحة الرئيسية</Button>
                </div>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
