import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { TextField } from "./Field";
import { Panel } from "./Panel";
import { Sheet } from "./Sheet";

const meta = { title: "C-DIALOG · C-SHEET · C-PANEL" } satisfies Meta;
export default meta;

export const ConfirmDialog: StoryObj = {
  render: function Demo() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>افتح</Button>
        <Dialog
          open={open}
          title="إغلاق الوردية؟"
          onClose={() => setOpen(false)}
          primaryLabel="أغلق الوردية"
          onPrimary={() => setOpen(false)}
        >
          المتوقَّع محجوب حتى تُدخل العدّ. بعد الإغلاق لا تُعدَّل الوردية؛ الفروق تُراجَع من المالك.
        </Dialog>
      </>
    );
  },
};
export const DangerDialog: StoryObj = {
  render: function Demo() {
    const [open, setOpen] = useState(true);
    return (
      <Dialog
        open={open}
        kind="danger"
        title="إلغاء اعتماد الجهاز A2"
        onClose={() => setOpen(false)}
        primaryLabel="ألغِ الجهاز"
        onPrimary={() => setOpen(false)}
        confirmWord="A2"
      >
        سيُرفض PUSH المعتاد من هذا الجهاز وتُلغى جلساته. 3 عمليات معلّقة عليه ستنتظر الاسترداد
        المقيَّد إلى الحجر.
      </Dialog>
    );
  },
};
export const FormDialogSaving: StoryObj = {
  render: () => (
    <Dialog open kind="form" title="حركة صندوق" onClose={() => {}} primaryLabel="احفظ" saving>
      <TextField label="المبلغ" mono defaultValue="200.00" />
    </Dialog>
  ),
};
export const ServerError: StoryObj = {
  render: () => (
    <Dialog
      open
      kind="form"
      title="دمج أطراف"
      onClose={() => {}}
      primaryLabel="ادمج"
      error="تعذّر الوصول إلى الخادم — معرّف الدعم SUP-4F21. أعد المحاولة عند عودة الاتصال؛ الدمج يحتاج اتصالاً."
    >
      <p>المعاينة: رصيدان 120.00 و60.00 → 180.00 على «أحمد الطيب».</p>
    </Dialog>
  ),
};
export const BottomSheet: StoryObj = {
  render: function Demo() {
    const [open, setOpen] = useState(true);
    return (
      <Sheet open={open} title="اختيار الوحدة" onClose={() => setOpen(false)}>
        <Button variant="secondary">حبة</Button>{" "}
        <Button variant="secondary">كرتونة = 24 حبة</Button>
      </Sheet>
    );
  },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
export const SidePanel: StoryObj = {
  render: function Demo() {
    const [open, setOpen] = useState(true);
    return (
      <div style={{ display: "flex", minHeight: 400 }}>
        <div style={{ flex: 1 }}>
          <Button onClick={() => setOpen(true)}>التفاصيل</Button>
        </div>
        <Panel
          open={open}
          title="بطاقة الطرف"
          onClose={() => setOpen(false)}
          footer={<Button>احفظ</Button>}
        >
          <TextField label="الاسم" defaultValue="أحمد الطيب — تجريبي" />
        </Panel>
      </div>
    );
  },
};
export const ModalPanel: StoryObj = {
  render: () => (
    <Panel open modal title="المرشّحات" onClose={() => {}}>
      <TextField label="من تاريخ" kind="date" mono />
    </Panel>
  ),
};
