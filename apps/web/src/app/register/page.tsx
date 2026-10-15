import { Suspense } from "react";

import { pageMetadata } from "@/features/public/site";

import { RegisterClient } from "./register-client";

export const metadata = pageMetadata(
  "حساب جديد",
  "أنشئ حساب فيزانو بلص وابدأ تجربة 30 يوماً مجاناً بلا بطاقة.",
  "/register",
);

/** تسجيل حساب جديد: تحقّق المعرّف (ACC-02 بغرض `register`) ثم كلمة مرور ثم إنشاء المنشأة (ACC-04). */
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterClient />
    </Suspense>
  );
}
