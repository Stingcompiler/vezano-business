import { STATE_CODES } from "@sting/design";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Status } from "./Status";

const meta = { title: "C-STATUS شارة حالة", component: Status } satisfies Meta<typeof Status>;
export default meta;
type S = StoryObj<typeof meta>;

export const AllSeventeen: S = {
  args: { state: "ready" },
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {STATE_CODES.map((s) => (
        <Status key={s} state={s} />
      ))}
    </div>
  ),
};
export const WithReason: S = {
  args: { state: "conflict", reason: "نسختان متعارضتان — الأصل لم يُكتب فوقه." },
};
export const NoDot: S = { args: { state: "synced", dot: false } };
