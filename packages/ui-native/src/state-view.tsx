import { states, type StateCode } from "@sting/design";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText } from "./text";
import { RADIUS, SPACE, useColors } from "./theme";

/**
 * C-NOTICE للجوال: إحدى الحالات الـ17 بألوانها (خلفية/نص/حدّ من الرموز) — العنوان والنص من الشاشة
 * (نصوص الويب حرفياً عبر `tx`)، والشارة من `@sting/design`. لون الحالة على الإشعار وحده لا على البطاقة.
 */
export function StateView({
  state,
  title,
  children,
}: {
  state: StateCode;
  title: string;
  children?: ReactNode;
}) {
  const c = useColors();
  const tone = c.state[state];
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: tone.bg,
        borderColor: tone.border,
        borderWidth: 1,
        borderRadius: RADIUS.panelSm,
        padding: SPACE["4"],
        gap: SPACE["2"],
        marginBottom: SPACE["4"],
      }}
    >
      <AppText variant="note" style={{ color: tone.fg }}>
        {states[state].label}
      </AppText>
      <AppText variant="bodyStrong" style={{ color: tone.fg }}>
        {title}
      </AppText>
      {children}
    </View>
  );
}
