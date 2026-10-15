import { Suspense } from "react";

import { pageMetadata } from "@/features/public/site";

import { LoginClient } from "./login-client";

export const metadata = pageMetadata("الدخول", "الدخول إلى فيزانو بلص.", "/login");

/** ACC-02 — تسجيل ودخول واستعادة الوصول (06-D2 · 13-D8 · 34-D26). */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
