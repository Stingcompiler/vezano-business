import { Suspense } from "react";

import { LoginClient } from "./login-client";

/** ACC-02 — تسجيل ودخول واستعادة الوصول (06-D2 · 13-D8 · 34-D26). */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
