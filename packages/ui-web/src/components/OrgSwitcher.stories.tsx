import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { OrgSwitcher, type OrgOption } from "./OrgSwitcher";

const options: OrgOption[] = [
  { id: "a-krt", name: "بقالة النيل — تجريبي", branch: "الرئيسي" },
  { id: "a-bhr", name: "بقالة النيل — تجريبي", branch: "بحري" },
  { id: "b", name: "مخزن البركة — تجريبي" },
];
const meta = { title: "C-ORGSW محوّل منشأة وفرع", component: OrgSwitcher } satisfies Meta<
  typeof OrgSwitcher
>;
export default meta;
type S = StoryObj<typeof meta>;

function Demo({ opts }: { opts: OrgOption[] }) {
  const [id, setId] = useState(opts[0]!.id);
  return <OrgSwitcher options={opts} selectedId={id} onChange={(o) => setId(o.id)} />;
}
export const OrgAndBranch: S = {
  args: { options, selectedId: "a-krt", onChange: () => {} },
  render: () => <Demo opts={options} />,
};
export const ReadOnlySingle: S = {
  args: { options: options.slice(2), selectedId: "b", onChange: () => {} },
  render: () => <Demo opts={options.slice(2)} />,
};
