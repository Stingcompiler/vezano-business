import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations } from "../test/axe";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { RadioGroupField, SelectField, SwitchField, TextField } from "./Field";
import { Notice } from "./Notice";
import { Panel } from "./Panel";
import { Sheet } from "./Sheet";

describe("C-FIELD", () => {
  it("الخطأ نص كامل مرتبط بـ aria-describedby وaria-invalid وrole=alert", async () => {
    const { container } = render(
      <TextField
        label="المبلغ الآجل"
        mono
        defaultValue="70.00"
        error="مجموع التسوية 110.00 يتجاوز الإجمالي 100.00 — عدّل أحد المبلغين."
      />,
    );
    const input = screen.getByLabelText("المبلغ الآجل");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "مجموع التسوية 110.00 يتجاوز الإجمالي 100.00 — عدّل أحد المبلغين.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("عدّل أحد المبلغين");
    expect(input).toHaveClass("sting-mono");
    await expectNoA11yViolations(container);
  });

  it("التلميح يُربط حين لا خطأ، والمعطّل يحمل سبباً، وsaving يعطّل مع status", () => {
    render(<TextField label="أ" hint="تلميح" />);
    expect(screen.getByLabelText("أ")).toHaveAccessibleDescription("تلميح");
    render(<TextField label="ب" disabledReason="يحتاج اتصالاً" />);
    const b = screen.getByLabelText("ب");
    expect(b).toBeDisabled();
    expect(b).toHaveAccessibleDescription("يحتاج اتصالاً");
    render(<TextField label="ج" saving />);
    expect(screen.getByLabelText("ج")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ الحفظ");
  });

  it("switch وradio وselect لهم أدوار صحيحة وتغييرات", async () => {
    const onSwitch = vi.fn();
    const onRadio = vi.fn();
    const { container } = render(
      <>
        <SwitchField label="طباعة تلقائية" checked={false} onChange={onSwitch} />
        <RadioGroupField
          label="وسيلة الدفع"
          name="pm"
          value="cash"
          onChange={onRadio}
          options={[
            { value: "cash", label: "نقداً" },
            { value: "bank", label: "تحويل" },
          ]}
        />
        <SelectField label="الوحدة" options={[{ value: "pc", label: "حبة" }]} />
      </>,
    );
    await userEvent.click(screen.getByRole("switch", { name: "طباعة تلقائية" }));
    expect(onSwitch).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("radio", { name: "تحويل" }));
    expect(onRadio).toHaveBeenCalledWith("bank");
    expect(screen.getByRole("combobox", { name: "الوحدة" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});

describe("C-NOTICE", () => {
  it("الخطأ role=alert والمعلومة role=status، والحالة الفارغة تشترط فعلاً أو سبباً (R-10)", async () => {
    const { container } = render(
      <>
        <Notice kind="error" title="لم يُحفظ البيع">
          امتلأ تخزين الجهاز.
        </Notice>
        <Notice kind="success" title="تم" />
        <Notice kind="empty" title="لا عملاء بعد" action={<Button>إضافة عميل</Button>} />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("لم يُحفظ البيع");
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(() => render(<Notice kind="empty" title="فارغ" />)).toThrow(/R-10/);
    await expectNoA11yViolations(container);
  });
});

describe("C-DIALOG", () => {
  it("التركيز ينتقل للعنوان ويُحصر ويعود للمصدر؛ Esc يغلق العادي لا الخطر", async () => {
    const onClose = vi.fn();
    function Host({ kind }: { kind: "confirm" | "danger" }) {
      return (
        <>
          <button type="button">المصدر</button>
          <Dialog open kind={kind} title="تأكيد" onClose={onClose} primaryLabel="نعم">
            نص
          </Dialog>
        </>
      );
    }
    const { unmount, container } = render(<Host kind="confirm" />);
    expect(screen.getByRole("dialog", { name: "تأكيد" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "تأكيد" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
    unmount();

    render(<Host kind="danger" />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("حوار الخطر بكلمة تأكيد: الزر معطّل بسبب حتى تُكتب حرفياً (R-03)", async () => {
    const onPrimary = vi.fn();
    render(
      <Dialog
        open
        kind="danger"
        title="إلغاء الجهاز"
        onClose={() => {}}
        primaryLabel="ألغِ"
        onPrimary={onPrimary}
        confirmWord="A2"
      >
        معاينة الأثر
      </Dialog>,
    );
    const btn = screen.getByRole("button", { name: "ألغِ" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription("اكتب كلمة التأكيد أولاً");
    await userEvent.type(screen.getByLabelText(/اكتب «A2»/), "A2");
    expect(screen.getByRole("button", { name: "ألغِ" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "ألغِ" }));
    expect(onPrimary).toHaveBeenCalled();
  });

  it("saving يعطّل الإلغاء بسبب، وerror يظهر alert", () => {
    render(
      <Dialog
        open
        kind="form"
        title="ح"
        onClose={() => {}}
        primaryLabel="احفظ"
        saving
        error="تعذّر الوصول — معرّف الدعم SUP-1"
      >
        x
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "إلغاء" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "احفظ" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("SUP-1");
  });
});

describe("C-SHEET وC-PANEL", () => {
  it("الورقة: dialog معياري، زر إغلاق مرئي يأخذ التركيز أولاً، Esc يغلق", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open title="اختيار الوحدة" onClose={onClose}>
        <button type="button">حبة</button>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "اختيار الوحدة" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByRole("button", { name: "إغلاق" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    await expectNoA11yViolations(container);
  });

  it("اللوحة المرافقة complementary بلا حصر، والمعيارية dialog محصورة", async () => {
    const { container, rerender } = render(
      <Panel open title="بطاقة الطرف" onClose={() => {}}>
        <input aria-label="الاسم" />
      </Panel>,
    );
    expect(screen.getByRole("complementary", { name: "بطاقة الطرف" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
    rerender(
      <Panel open modal title="المرشّحات" onClose={() => {}}>
        <input aria-label="من" />
      </Panel>,
    );
    expect(screen.getByRole("dialog", { name: "المرشّحات" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "المرشّحات" })).toHaveFocus();
  });
});
