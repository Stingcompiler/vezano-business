import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { RadioGroupField, SelectField, SwitchField, TextAreaField, TextField } from "./Field";

const meta = { title: "C-FIELD حقل ونموذج", component: TextField } satisfies Meta<typeof TextField>;
export default meta;
type S = StoryObj<typeof meta>;

export const Text: S = { args: { label: "اسم العميل", hint: "الاسم كما يظهر في الكشف" } };
export const Money: S = {
  args: { label: "المبلغ النقدي", mono: true, defaultValue: "40.00", hint: "بالجنيه — منزلتان" },
};
export const ValidationError: S = {
  args: {
    label: "المبلغ الآجل",
    mono: true,
    defaultValue: "70.00",
    error: "مجموع التسوية 110.00 يتجاوز الإجمالي 100.00 — عدّل أحد المبلغين.",
  },
};
export const Saving: S = {
  args: { label: "اسم العميل", defaultValue: "أحمد الطيب — تجريبي", saving: true },
};
export const DisabledWithReason: S = {
  args: {
    label: "سعر الصنف",
    mono: true,
    defaultValue: "780.00",
    disabledReason: "تعديل السعر يحتاج اتصالاً — يُعدَّل من الإدارة (§٨.١).",
  },
};
export const ReadOnly: S = {
  args: { label: "رقم الفاتورة", mono: true, defaultValue: "INV-KRT-A2-26-000001", readOnly: true },
};
export const TextArea: StoryObj = {
  render: () => <TextAreaField label="سبب التسوية" hint="إلزامي — يظهر في سجل المراجعة" rows={3} />,
};
export const Select: StoryObj = {
  render: () => (
    <SelectField
      label="الوحدة"
      options={[
        { value: "pc", label: "حبة" },
        { value: "ctn", label: "كرتونة" },
        { value: "kg", label: "كغ" },
      ]}
    />
  ),
};
export const Switch: StoryObj = {
  render: function SwitchDemo() {
    const [on, setOn] = useState(true);
    return (
      <SwitchField
        label="طباعة الإيصال تلقائياً"
        checked={on}
        onChange={setOn}
        hint="فشل الطابعة لا يلغي البيع"
      />
    );
  },
};
export const Radio: StoryObj = {
  render: function RadioDemo() {
    const [v, setV] = useState("cash");
    return (
      <RadioGroupField
        label="وسيلة الدفع"
        name="pm"
        value={v}
        onChange={setV}
        options={[
          { value: "cash", label: "نقداً", hint: "يدخل الصندوق" },
          { value: "bank", label: "تحويل", hint: "مسجَّل — غير مطابق" },
          { value: "credit", label: "آجل" },
        ]}
      />
    );
  },
};
