/**
 * سمة الجوال: الألوان من `@sting/design/native` (فاتح/داكن حسب النظام)، وسلّم الخط المكيَّف للهاتف
 * (خطة الجوال §٢.٢ — المتن 17، والملاحظة 13 حدّاً أدنى). لا قيمة لون تُكتب هنا يدوياً.
 */
import { darkColors, lightColors, type NativeColors, radius, space } from "@sting/design/native";
import { useColorScheme } from "react-native";

/** أسماء الألوان الدلالية (الفاتح والداكن من الشكل نفسه — `satisfies` في المولّد). */
export type Colors = NativeColors;

/** أسماء الخطوط كما تُحمَّل في التطبيق (`useFonts`) — عائلة لكل وزن لأن RN لا يركّب الأوزان المخصّصة. */
export const FONT = {
  regular: "Tajawal-Regular",
  medium: "Tajawal-Medium",
  bold: "Tajawal-Bold",
  mono: "IBMPlexMono-Regular",
  monoMedium: "IBMPlexMono-Medium",
  monoSemiBold: "IBMPlexMono-SemiBold",
  wordmark: "ReemKufi",
} as const;

/** المقاس / ارتفاع السطر بالنقاط. Tajawal أصغر بصرياً من SF فالمتن 17 لا 15. */
export const TYPE = {
  largeTitle: { fontSize: 32, lineHeight: 40, fontFamily: FONT.bold },
  title: { fontSize: 22, lineHeight: 28, fontFamily: FONT.bold },
  section: { fontSize: 15, lineHeight: 20, fontFamily: FONT.medium },
  body: { fontSize: 17, lineHeight: 26, fontFamily: FONT.regular },
  bodyStrong: { fontSize: 17, lineHeight: 26, fontFamily: FONT.medium },
  secondary: { fontSize: 15, lineHeight: 22, fontFamily: FONT.regular },
  note: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular },
  moneyLarge: { fontSize: 28, lineHeight: 34, fontFamily: FONT.monoSemiBold },
  money: { fontSize: 17, lineHeight: 22, fontFamily: FONT.monoMedium },
} as const;

export const SPACE = space;
export const RADIUS = { ...radius, button: 12, sheet: 16 } as const;
/** لمس ≥ 44؛ الأزرار المالية 56 (قاعدة الويب `data-financial`). */
export const TOUCH = { min: 44, financial: 56, row: 52 } as const;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? darkColors : lightColors;
}
