import { Suspense } from "react";

import { RegisterClient } from "./register-client";

/** تسجيل حساب جديد: تحقّق المعرّف (ACC-02 بغرض `register`) ثم كلمة مرور ثم إنشاء المنشأة (ACC-04). */
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterClient />
    </Suspense>
  );
}
