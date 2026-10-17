"use client";

import { NAV_ITEMS } from "@sting/app-core";
import { Nav } from "@sting/ui-web";
import { useRouter } from "next/navigation";

import { LogoutButton } from "@/features/home/logout-button";
import { ThemeToggle } from "@/features/home/theme-toggle";
import "./home.css";

/**
 * التنقل الرئيسي داخل التطبيق (0005 §١٣٤): مجموعات بعلاقة موضوعاتها وبترتيب تكرار الاستعمال — البيع
 * اليومي أولاً، والتقنيّ آخراً. المجموعات تُطوى (مجموعة الصفحة الحالية مفتوحة) فتبقى القائمة قصيرة
 * على الحاسوب والدرج. الرئيسية والبحث بلا مجموعة ظاهران دائماً. التسميات ثابتة (المواصفات تنقر بها).
 * انتقال عميلي يحفظ الجلسة في الذاكرة (§٩.٤: لا localStorage).
 */
export function AppNav({ currentId }: { currentId: string }) {
  const router = useRouter();
  return (
    <>
      <Nav
        label="التنقل الرئيسي"
        currentId={currentId}
        items={NAV_ITEMS}
        collapsible
        onNavigate={(item) => router.push(item.href)}
      />
      {/* المظهر الفاتح/الداكن — آخر عنصر في القائمة الجانبية، وحبّة في شريط الهاتف */}
      <div className="app-nav__tools">
        <ThemeToggle label />
        <LogoutButton />
      </div>
    </>
  );
}
