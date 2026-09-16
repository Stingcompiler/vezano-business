import type { Meta, StoryObj } from "@storybook/react-vite";

import { Frame } from "./Frame";
import { Nav } from "./Nav";
import { Status } from "./Status";

const meta = { title: "C-FRAME إطار التطبيق", component: Frame } satisfies Meta<typeof Frame>;
export default meta;
type S = StoryObj<typeof meta>;

const nav = (
  <Nav
    label="التنقل الرئيسي"
    currentId="pos"
    items={[
      { id: "home", label: "الرئيسية", href: "/" },
      { id: "pos", label: "البيع", href: "/pos" },
    ]}
  />
);

export const WebWithSidebar: S = {
  args: {
    title: "بقالة النيل — تجريبي",
    nav,
    children: <p>المحتوى</p>,
    footer: "الإصدار 0.0.0 · الجهاز A2",
  },
};
export const Offline: S = {
  args: {
    ...WebWithSidebar.args,
    notice: <Status state="offline" label="بلا اتصال — البيع والوردية يعملان محلياً" />,
  },
};
export const Mobile: S = {
  args: { title: "بقالة النيل — تجريبي", children: <p>المحتوى</p> },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
