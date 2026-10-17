import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "./text";
import { RADIUS, SPACE, TOUCH, useColors } from "./theme";

/** قائمة مجمّعة بنمط الإعدادات (HIG inset grouped): عنوان قسم ثم صفوف بفواصل شعرية. */
export function GroupedList({ title, children }: { title?: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ marginBottom: SPACE["6"] }}>
      {title ? (
        <AppText variant="section" muted style={{ marginBottom: SPACE["2"], paddingHorizontal: 4 }}>
          {title}
        </AppText>
      ) : null}
      <View
        style={{
          backgroundColor: c.surfaceCard,
          borderRadius: RADIUS.panelSm,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * الصف: عنوان ووصف على البداية، وقيمة على النهاية (رقم بخط mono عادةً). الصف كله هدف لمس ≥ 52.
 * يقابل صفوف الجداول والقوائم في الويب — الجدول يصير قائمة صفوف على الهاتف (§٢.٢).
 */
export function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
  last = false,
}: {
  title: string;
  subtitle?: string | undefined;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: subtitle ? 64 : TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["2"],
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <AppText>{title}</AppText>
        {subtitle ? (
          <AppText variant="secondary" muted>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? c.surfaceSunken : "transparent" })}
    >
      {body}
    </Pressable>
  );
}
