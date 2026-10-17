import { ActivityIndicator, Pressable, View } from "react-native";

import { AppText } from "./text";
import { FONT, RADIUS, SPACE, TOUCH, useColors } from "./theme";

/**
 * C-BTN للجوال: أساسي (التركوازي للإجراء الأساسي وحده) وثانوي وهادئ وخطر. لا زرّ معطّل صامت — سبب
 * التعطيل نص ظاهر تحته (R-02). `financial` = 56 نقطة (قاعدة الويب للأزرار المالية).
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  financial = false,
  loading = false,
  disabledReason,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  financial?: boolean;
  loading?: boolean;
  disabledReason?: string | undefined;
}) {
  const c = useColors();
  const disabled = Boolean(disabledReason) || loading;
  const bg =
    variant === "primary" ? c.brandPrimary : variant === "danger" ? c.danger : "transparent";
  const fg = variant === "primary" || variant === "danger" ? "#FFFFFF" : c.brandStrong;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: financial ? TOUCH.financial : TOUCH.min,
          borderRadius: RADIUS.button,
          paddingHorizontal: SPACE["4"],
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bg,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor: c.brandLine,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <AppText variant="bodyStrong" style={{ color: fg, fontFamily: FONT.medium }}>
            {label}
          </AppText>
        )}
      </Pressable>
      {disabledReason ? (
        <AppText variant="note" muted style={{ marginTop: SPACE["1"] }}>
          {disabledReason}
        </AppText>
      ) : null}
    </View>
  );
}
