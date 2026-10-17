import { tx } from "@sting/texts";
import { Screen } from "@sting/ui-native";

import { NotBuilt } from "@/components/not-built";

/** POS-01 — تُبنى في معلمها (docs/mobile-ui-plan.md §٢.٣)؛ حتى ذلك تفتح الويب. */
export default function Tab() {
  return (
    <Screen
      screenId="POS-01"
      state="phase_locked"
      title={tx("shared:app-core/nav.ts", "نقطة البيع")}
    >
      <NotBuilt href="/pos" />
    </Screen>
  );
}
