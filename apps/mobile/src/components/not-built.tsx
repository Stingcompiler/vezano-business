import { mtx } from "@sting/texts";
import { Button, StateView, AppText } from "@sting/ui-native";

import { openOnWeb } from "@/lib/web";

/**
 * وحدة لم تُبنَ على الجوال بعد: تفتح الشاشة نفسها على الويب بدل شاشة ناقصة (خطة الجوال §٢.٤).
 * الحالة المعروضة `phase_locked` من الـ17 — أقرب حالة مسجّلة لـ«متاح لاحقاً» (0005 §١٦٦).
 */
export function NotBuilt({ href }: { href: string }) {
  return (
    <StateView state="phase_locked" title={mtx("notBuiltTitle")}>
      <AppText variant="secondary">{mtx("notBuiltBody")}</AppText>
      <Button label={mtx("openWeb")} variant="secondary" onPress={() => void openOnWeb(href)} />
    </StateView>
  );
}
