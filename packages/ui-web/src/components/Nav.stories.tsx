import type { Meta, StoryObj } from "@storybook/react-vite";
import { Home, Package, ShoppingCart, Users } from "lucide-react";

import { Nav } from "./Nav";

const items = [
  { id: "home", label: "الرئيسية", href: "/", icon: <Home size={18} /> },
  { id: "pos", label: "البيع", href: "/pos", icon: <ShoppingCart size={18} /> },
  { id: "parties", label: "الأطراف", href: "/parties", icon: <Users size={18} /> },
  { id: "inventory", label: "المخزون", href: "/inventory", icon: <Package size={18} /> },
  {
    id: "purchasing",
    label: "المشتريات",
    href: "/purchasing",
    restrictedReason: "مرحلة غير مفعّلة · M3",
  },
];
const meta = {
  title: "C-NAV تنقل",
  component: Nav,
  args: { items, currentId: "pos", label: "التنقل الرئيسي" },
} satisfies Meta<typeof Nav>;
export default meta;
type S = StoryObj<typeof meta>;

export const Side: S = {};
export const Bottom: S = { args: { variant: "bottom", items: items.slice(0, 4) } };
export const Top: S = { args: { variant: "top" } };
