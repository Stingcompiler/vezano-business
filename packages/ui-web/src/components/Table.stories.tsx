import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { Status } from "./Status";
import { Table, type Column, type SortDir } from "./Table";

interface Item {
  id: string;
  name: string;
  price: string;
  available: string;
  state: "synced" | "pending_sync";
}
const rows: Item[] = [
  { id: "1", name: "سكر", price: "100.00", available: "10", state: "synced" },
  { id: "2", name: "زيت 1 لتر", price: "780.00", available: "-2", state: "pending_sync" },
  { id: "3", name: "أرز", price: "95.94", available: "0.446", state: "synced" },
];
const columns: Column<Item>[] = [
  { key: "name", header: "الصنف", render: (r) => r.name, sortable: true },
  { key: "price", header: "السعر", render: (r) => r.price, mono: true, sortable: true },
  { key: "available", header: "المتاح", render: (r) => r.available, mono: true },
  { key: "state", header: "الحالة", render: (r) => <Status state={r.state} /> },
];

const meta = { title: "C-TABLE جدول ← بطاقة صف", component: Table } satisfies Meta<
  typeof Table<Item>
>;
export default meta;

export const Ready: StoryObj = {
  render: function Demo() {
    const [sort, setSort] = useState<{ key: string; dir: SortDir } | undefined>({
      key: "name",
      dir: "ascending",
    });
    return (
      <Table
        caption="الأصناف"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={sort}
        onSort={(key) =>
          setSort((s) => ({
            key,
            dir: s?.key === key && s.dir === "ascending" ? "descending" : "ascending",
          }))
        }
        onOpenRow={() => {}}
      />
    );
  },
};
export const Cards: StoryObj = {
  render: () => (
    <Table caption="الأصناف" columns={columns} rows={rows} rowKey={(r) => r.id} forceCards />
  ),
};
export const Loading: StoryObj = {
  render: () => (
    <Table caption="الأصناف" columns={columns} rows={[]} rowKey={(r: Item) => r.id} loading={4} />
  ),
};
export const Empty: StoryObj = {
  render: () => (
    <Table
      caption="الأصناف"
      columns={columns}
      rows={[]}
      rowKey={(r: Item) => r.id}
      empty={<Notice kind="empty" title="لا أصناف بعد" action={<Button>أضف صنفاً</Button>} />}
    />
  ),
};
export const Stale: StoryObj = {
  render: () => (
    <Table
      caption="الأصناف"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      notice={<Notice kind="warning" title="آخر تحديث خادمي 10:30 — قد تتغير" bar />}
    />
  ),
};
