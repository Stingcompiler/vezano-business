"use client";

import { Button } from "@sting/ui-web";
import { useRouter } from "next/navigation";

import "./platform.css";
import { clearOperatorSession, operatorName } from "@/features/platform/operator-session";

/** إطار المشغّل — منفصل عن تطبيق المتاجر؛ كل فتح سجل يُدقَّق. */
export function PlatformNav({
  current,
}: {
  current: "tenants" | "login" | "proofs" | "announcements";
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
