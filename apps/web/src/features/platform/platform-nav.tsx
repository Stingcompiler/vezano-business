"use client";

import { Button } from "@sting/ui-web";
import { useRouter } from "next/navigation";

import "./platform.css";
import { clearOperatorSession, operatorName } from "@/features/platform/operator-session";

/** إطار المشغّل — منفصل عن تطبيق المتاجر؛ كل فتح سجل يُدقَّق. */
export function PlatformNav({
  current,
}: {
  current:
    | "tenants"
    | "login"
    | "proofs"
    | "announcements"
    | "outbound"
    | "verifications"
    | "reports"
    | "disputes"
    | "health"
    | "backups"
    | "m0"
    | "entitlements";
}) {
  const router = useRouter();
  return (
    <div className="plt-nav">
      <span className="plt-badge">ADMIN</span>
      <strong>إدارة Sting — مشغّل الخدمة</strong>
      <span className="acc-choice__note">إطار منفصل عن تطبيق المتاجر · كل فتح سجل يُدقَّق</span>
      {current !== "login" ? (
        <>
          <Button
            variant={current === "tenants" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/tenants")}
          >
            المستأجرون
          </Button>
          <Button
            variant={current === "proofs" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/proofs")}
          >
            مراجعة الدفع
          </Button>
          <Button
            variant={current === "announcements" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/announcements")}
          >
            الإعلانات
          </Button>
          <Button
            variant={current === "outbound" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/outbound")}
          >
            الإرسال
          </Button>
          <Button
            variant={current === "verifications" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/verifications")}
          >
            طلبات التحقُّق
          </Button>
          <Button
            variant={current === "reports" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/reports")}
          >
            البلاغات
          </Button>
          <Button
            variant={current === "disputes" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/disputes")}
          >
            الخلافات
          </Button>
          <Button
            variant={current === "health" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/health")}
          >
            الصحة
          </Button>
          <Button
            variant={current === "backups" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/backups")}
          >
            النسخ
          </Button>
          <Button
            variant={current === "m0" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/m0")}
          >
            M0
          </Button>
          <Button
            variant={current === "entitlements" ? "secondary" : "quiet"}
            onClick={() => router.push("/platform/entitlements")}
          >
            الاستحقاقات
          </Button>
          <span className="acc-choice__note">{operatorName()}</span>
          <Button
            variant="quiet"
            onClick={() => {
              clearOperatorSession();
              router.push("/platform/login");
            }}
          >
            خروج
          </Button>
        </>
      ) : null}
    </div>
  );
}
