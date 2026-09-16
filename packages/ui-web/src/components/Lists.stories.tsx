import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { DocPreview } from "./DocPreview";
import { FilterBar, LoadMore, Pagination } from "./Filter";
import { Notice } from "./Notice";
import { Pick } from "./Pick";
import { Status } from "./Status";
import { TimeList } from "./TimeList";
import { Upload } from "./Upload";

const meta = { title: "C-FILTER · C-PICK · C-TIMELIST · C-UPLOAD · C-DOCPRV" } satisfies Meta;
export default meta;

export const Filter: StoryObj = {
  render: function Demo() {
    const [chips, setChips] = useState([
      { key: "branch", label: "الفرع: الرئيسي" },
      { key: "state", label: "الحالة: معلّق" },
    ]);
    return (
      <FilterBar
        chips={chips}
        onRemove={(k) => setChips((c) => c.filter((x) => x.key !== k))}
        onClearAll={() => setChips([])}
        resultCount={12}
        hiddenCount={38}
        countLabel={(n, h) => (h ? `${n} نتيجة — الفلتر أخفى ${h}` : `${n} نتيجة`)}
      >
        <input
          className="c-field__input"
          placeholder="بحث"
          aria-label="بحث"
          style={{ maxWidth: 240 }}
        />
      </FilterBar>
    );
  },
};
export const PaginationAndMore: StoryObj = {
  render: function Demo() {
    const [p, setP] = useState(2);
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Pagination page={p} pageCount={5} onPage={setP} />
        <LoadMore onLoadMore={() => {}} remaining={38} />
      </div>
    );
  },
};

const parties = [
  { id: "1", label: "أحمد الطيب — تجريبي", hint: "عليه 180.00" },
  { id: "2", label: "أحمد محمد — تجريبي" },
  { id: "3", label: "بقالة النيل — تجريبي", hint: "مورد" },
];
export const PickSearch: StoryObj = {
  render: function Demo() {
    const [q, setQ] = useState("");
    const [v, setV] = useState<readonly string[]>([]);
    const opts = parties.filter((p) => p.label.startsWith(q));
    return (
      <Pick
        label="العميل"
        options={opts}
        value={v}
        onChange={setV}
        query={q}
        onQuery={setQ}
        countLabel={(n) => `${n} نتيجة`}
        emptyText="لا عميل بهذا الاسم — يُنشأ عند أول بيع آجل"
        placeholder="ابحث بالاسم"
      />
    );
  },
};
export const PickMultipleOffline: StoryObj = {
  render: function Demo() {
    const [q, setQ] = useState("");
    const [v, setV] = useState<readonly string[]>(["1"]);
    return (
      <Pick
        label="الأصناف"
        multiple
        options={parties}
        value={v}
        onChange={setV}
        query={q}
        onQuery={setQ}
        countLabel={(n) => `${n} نتيجة`}
        offlineText="بلا اتصال — نتائج محلية فقط"
      />
    );
  },
};

export const Timeline: StoryObj = {
  render: () => (
    <TimeList
      label="سجل الحركات"
      onOpen={() => {}}
      entries={[
        {
          id: "3",
          at: "2026-09-15T10:31:00Z",
          atLabel: "10:31",
          title: "سداد 40.00 نقداً",
          actor: "المالك — تجريبي",
          badge: <Status state="synced" />,
        },
        {
          id: "2",
          at: "2026-09-15T10:30:00Z",
          atLabel: "10:30",
          title: "فاتورة 1043 — 60.00 آجل",
          actor: "الكاشير — تجريبي",
          badge: <Status state="pending_sync" />,
        },
        {
          id: "1",
          at: "2026-09-15T09:00:00Z",
          atLabel: "09:00",
          title: "فتح وردية — افتتاح 50.00",
          actor: "الكاشير — تجريبي",
        },
      ]}
    />
  ),
};
export const TimelineLoading: StoryObj = {
  render: () => <TimeList label="سجل" entries={[]} loading={3} />,
};

export const UploadStates: StoryObj = {
  render: () => (
    <Upload
      label="صورة إيصال التحويل"
      accept="image/*,application/pdf"
      constraintsText="صورة أو PDF حتى 5 م.ب."
      camera
      onFiles={() => {}}
      onRemove={() => {}}
      items={[
        { id: "a", name: "receipt-1043.jpg", sizeLabel: "1.2 MB", progress: 40 },
        { id: "b", name: "بيان.pdf", sizeLabel: "0.8 MB", queued: true },
        {
          id: "c",
          name: "big.png",
          sizeLabel: "9.1 MB",
          error: "الحجم يتجاوز 5 م.ب. — المسموح: صورة أو PDF حتى 5 م.ب.",
        },
      ]}
    />
  ),
};

export const DocPreviewReceipt: StoryObj = {
  render: function Demo() {
    const [p, setP] = useState(1);
    return (
      <DocPreview
        title="كشف حساب — أحمد الطيب"
        textAlternative="كشف حساب من 1 سبتمبر إلى 15 سبتمبر، الرصيد 180.00"
        downloadHref="#"
        pageCount={3}
        page={p}
        onPage={setP}
      >
        <pre style={{ fontFamily: "var(--font-mono)", margin: 0 }}>
          {
            "INV-KRT-A2-26-000001   100.00\nPAY                    -40.00\n-----------------------------\n                        60.00"
          }
        </pre>
      </DocPreview>
    );
  },
};
export const DocPreviewDenied: StoryObj = {
  render: () => (
    <DocPreview
      title="كشف حساب"
      textAlternative="غير متاح"
      notice={
        <Notice kind="locked" title="لا صلاحية لعرض كشف الحساب في هذا النطاق">
          اطلب الصلاحية من المالك — لا تُكشف البيانات.
        </Notice>
      }
    />
  ),
};
