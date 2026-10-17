import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./text";
import { SPACE, useColors } from "./theme";

/**
 * C-FRAME للجوال: الأرضية، المناطق الآمنة، عنوان كبير يبدأ الشاشة، وسحب للتحديث اختياري. الرأس
 * والتبويبات يرسمها Expo Router؛ هذا جسم الشاشة. `data-screen`/`data-state` في الويب = `testID`
 * و`accessibilityHint` هنا لاختبارات المطابقة.
 */
export function Screen({
  screenId,
  state,
  title,
  onRefresh,
  refreshing = false,
  children,
}: {
  screenId: string;
  state: string;
  title?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      testID={screenId}
      accessibilityHint={state}
      style={{ flex: 1, backgroundColor: c.surfacePage }}
      contentContainerStyle={{
        padding: SPACE["4"],
        paddingBottom: SPACE["8"] + insets.bottom,
      }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      {title ? (
        <View style={{ marginBottom: SPACE["4"] }}>
          <AppText variant="largeTitle" accessibilityRole="header">
            {title}
          </AppText>
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}
