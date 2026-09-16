import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./Button";
import { Notice } from "./Notice";

const meta = { title: "C-NOTICE إشعار وحالة فارغة", component: Notice } satisfies Meta<
  typeof Notice
>;
export default meta;
type S = StoryObj<typeof meta>;

export const SaveFailed: S = {
  args: {
    kind: "error",
    title: "لم يُحفظ البيع",
    children:
      "امتلأ تخزين الجهاز. صدّر نسخة محلية أو احذف نسخاً قديمة ثم أعد المحاولة. لا تعتبر هذه الفاتورة مُسجَّلة.",
  },
};
export const SavedNotPrinted: S = {
  args: {
    kind: "warning",
    title: "حُفظ البيع محلياً — لم تتم الطباعة",
    children:
      "الفاتورة 1043 مسجَّلة. الطابعة غير متصلة؛ أعد طباعة نسخة بنفس الرقم دون تسجيل بيع جديد.",
    action: <Button variant="secondary">أعد الطباعة (نسخة)</Button>,
  },
};
export const Empty: S = {
  args: {
    kind: "empty",
    title: "لا عملاء بعد",
    children: "يُنشأ العميل عند أول بيع آجل، أو أضفه الآن.",
    action: <Button>إضافة عميل</Button>,
  },
};
export const Success: S = {
  args: { kind: "success", title: "تم تسجيل السداد", children: "40.00 نقداً — دخل الصندوق." },
};
export const OfflineBar: S = {
  args: { kind: "offline", title: "بلا اتصال — البيع والوردية يعملان محلياً", bar: true },
};
export const Locked: S = {
  args: {
    kind: "locked",
    title: "مرحلة غير مفعّلة",
    children:
      "هذه الوظيفة مصمَّمة وتُفعَّل في المرحلة M3 أو بعد اعتماد عقدها. ليست نقص صلاحية ولا عطلاً.",
  },
};
