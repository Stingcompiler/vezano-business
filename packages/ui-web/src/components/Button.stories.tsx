import type { Meta, StoryObj } from "@storybook/react-vite";
import { Printer } from "lucide-react";

import { Button } from "./Button";

const meta = { title: "C-BTN زر", component: Button } satisfies Meta<typeof Button>;
export default meta;
type S = StoryObj<typeof meta>;

export const Primary: S = { args: { children: "احفظ البيع" } };
export const Secondary: S = { args: { variant: "secondary", children: "إلغاء" } };
export const Quiet: S = { args: { variant: "quiet", children: "عرض التفاصيل" } };
export const Danger: S = { args: { variant: "danger", children: "إلغاء الجهاز" } };
export const IconOnly: S = {
  args: { variant: "icon", iconLabel: "طباعة", icon: <Printer size={20} /> },
};
export const Loading: S = { args: { loading: true, children: "جارٍ الحفظ" } };
export const DisabledWithReason: S = {
  args: {
    children: "احفظ البيع",
    disabledReason: "افتح وردية أولاً — البيع النقدي يحتاج صندوقاً مفتوحاً.",
  },
};
export const FinancialOnPhone: S = {
  args: { financial: true, children: "احفظ البيع — 100.00" },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
