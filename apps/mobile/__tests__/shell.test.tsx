import { NAV_GROUPS, NAV_ITEMS } from "@sting/app-core";
import { states } from "@sting/design";
import { mtx } from "@sting/texts";
import { Money } from "@sting/ui-native";
import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NotBuilt } from "@/components/not-built";
import More from "@/app/(tabs)/more";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderApp = (ui: ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

describe("قشرة الجوال (M1)", () => {
  it("«المزيد» يعرض كل مجموعات تنقّل الويب وبنودها — لا شاشة ويب تغيب", async () => {
    await renderApp(<More />);
    for (const g of Object.values(NAV_GROUPS)) expect(screen.getByText(g)).toBeTruthy();
    for (const i of NAV_ITEMS.filter((x) => x.group))
      expect(screen.getByText(i.label)).toBeTruthy();
  });

  it("المبلغ بخط mono واتجاه LTR بلا تقريب", async () => {
    await renderApp(<Money minor="123456" />);
    const style = screen.getByText("1,234.56").props.style as {
      writingDirection: string;
      fontFamily: string;
    };
    expect(style.writingDirection).toBe("ltr");
    expect(style.fontFamily).toBe("IBMPlexMono-Medium");
  });

  it("الوحدة غير المبنية تعرض حالة مسجّلة وزرّ الويب", async () => {
    await renderApp(<NotBuilt href="/pos" />);
    expect(screen.getByText(states.phase_locked.label)).toBeTruthy();
    expect(screen.getByText(mtx("notBuiltTitle"))).toBeTruthy();
    expect(screen.getByRole("button", { name: mtx("openWeb") })).toBeTruthy();
  });
});
