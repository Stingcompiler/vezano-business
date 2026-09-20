"use client";

import { Button } from "@sting/ui-web";
import { useRouter } from "next/navigation";

/** روابط الصفحات العامة — بلا جلسة. */
export function PublicNav({ current }: { current: "about" | "legal" | "status" | "market" }) {
  const router = useRouter();
  const items: [typeof current, string, string][] = [
    ["about", "تعريف فيزانو والباقات", "/"],
    ["legal", "الشروط وسياسة الخصوصية", "/legal"],
    ["status", "حالة الخدمة", "/status"],
    ["market", "السوق", "/market"],
  ];
  return (
    <nav className="pub-nav" aria-label="الصفحات العامة">
      {items.map(([id, label, href]) => (
        <Button
          key={id}
          variant={id === current ? "primary" : "secondary"}
          onClick={() => router.push(href)}
          aria-current={id === current ? "page" : undefined}
        >
          {label}
        </Button>
      ))}
      <Button variant="quiet" onClick={() => router.push("/welcome")}>
        دخول التطبيق
      </Button>
    </nav>
  );
}
