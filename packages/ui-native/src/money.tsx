import { formatMinor, formatMinorShort, formatQty } from "@sting/app-core";
import { Text, type TextStyle } from "react-native";

import { TYPE, useColors } from "./theme";

/**
 * رقم لاتيني بخط mono معزول الاتجاه (القاعدة 2): لا حرف عربي داخله، والعملة تُكتب خارجه. يقابل
 * `.sting-mono` في الويب. `short` بلا «.00» للجنيهات الكاملة (0005 §١٢٨).
 */
export function Money({
  minor,
  short = false,
  large = false,
  tone,
}: {
  minor: string;
  short?: boolean;
  large?: boolean;
  tone?: "ok" | "warn" | "danger";
}) {
  const c = useColors();
  const style: TextStyle = {
    ...(large ? TYPE.moneyLarge : TYPE.money),
    color: tone ? c[tone] : c.inkStrong,
    writingDirection: "ltr",
    fontVariant: ["tabular-nums"],
  };
  return (
    <Text style={style} accessibilityLanguage="en">
      {short ? formatMinorShort(minor) : formatMinor(minor)}
    </Text>
  );
}

export function Qty({ milli, places }: { milli: string; places: 0 | 1 | 2 | 3 }) {
  const c = useColors();
  return (
    <Text style={{ ...TYPE.money, color: c.inkStrong, writingDirection: "ltr" }}>
      {formatQty(milli, places)}
    </Text>
  );
}

/** رقم عادي (عدد، رمز، وقت) بخط mono. */
export function Mono({ children }: { children: string | number }) {
  const c = useColors();
  return (
    <Text style={{ ...TYPE.money, color: c.inkStrong, writingDirection: "ltr" }}>
      {String(children)}
    </Text>
  );
}
