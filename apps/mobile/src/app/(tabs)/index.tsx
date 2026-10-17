import { tx } from "@sting/texts";
import { Screen } from "@sting/ui-native";

import { NotBuilt } from "@/components/not-built";

/** HOME-01 — تُبنى في معلمها (docs/mobile-ui-plan.md §٢.٣)؛ حتى ذلك تفتح الويب. */
export default function Tab() {
  return (
    <Screen
      screenId="HOME-01"
      state="phase_locked"
      title={tx("shared:app-core/nav.ts", "الرئيسية")}
    >
      <NotBuilt href="/" />
    </Screen>
  );
}
