import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations } from "../test/axe";
import { Cart } from "./Cart";
import { formatMinor, formatQty, parseMoneyInput } from "./format";
import { LedgerLines } from "./LedgerLine";
import { Money, MoneyInput, Settlement } from "./Money";
import { Notice } from "./Notice";
import { PrintControls, Receipt } from "./Print";
import { QtyUnit } from "./QtyUnit";
import { ReceiveLine } from "./Receive";
import { SyncIndicator, coverageText } from "./Sync";

/** لا حرف عربي داخل عنصر mono — أبداً (القاعدة 2). */
function expectNoArabicInMono(root: HTMLElement) {
  for (const el of root.querySelectorAll(".sting-mono")) {
    expect(el.textContent ?? "", `mono: ${el.textContent}`).not.toMatch(/[\u0600-\u06FF]/);
  }
}

describe("التنسيق (لا حساب ولا تقريب)", () => {
  it("formatMinor يعرض المنازل والسالب صراحة ولا يقرّب", () => {
    expect(formatMinor("10000")).toBe("100.00");
    expect(formatMinor("-4000")).toBe("−40.00");
    expect(formatMinor("1")).toBe("0.01");
    expect(formatMinor("9223372036854775807", 2, false)).toBe("92233720368547758.07");
    expect(formatMinor("126000")).toBe("1,260.00");
    expect(formatQty("123", 3)).toBe("0.123");
    expect(formatQty("12500", 1)).toBe("12.5");
  });
  it("parseMoneyInput يقبل الأرقام العربية والفاصلة العربية ويرفض منازل زائدة (لا تقريب)", () => {
    expect(parseMoneyInput("40")).toBe("4000");
    expect(parseMoneyInput("٤٠٫٥")).toBe("4050");
    expect(parseMoneyInput("1,260.00")).toBe("126000");
    expect(parseMoneyInput("40.005")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("-0")).toBe("0");
  });
});

describe("C-MONEY", () => {
  it("الرقم mono بلا عربية، العملة في span مجاور، السالب/الدائن نصاً لا لوناً", async () => {
    const { container } = render(
      <>
        <Money minor="-4000" currency="ج.س" />
        <Money minor="-4000" currency="ج.س" ledger />
      </>,
    );
    expectNoArabicInMono(container);
    expect(screen.getByText("دائن")).toBeInTheDocument();
    expect(container.querySelector("[data-negative='true']")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("MoneyInput: الأسهم تزيد بخطوة، الخطأ نص كامل، الحد الأقصى، والقيمة الخارجة تُرسل null", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MoneyInput label="نقداً" value="4000" onChange={onChange} currency="ج.س" max="10000" />,
    );
    const input = screen.getByRole("textbox", { name: "نقداً بـج.س" });
    expect(input).toHaveClass("sting-mono");
    input.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("4100", "41.00");
    await userEvent.clear(input);
    await userEvent.type(input, "40.005");
    expect(onChange).toHaveBeenLastCalledWith(null, "40.005");
    expect(screen.getByRole("alert")).toHaveTextContent("منزلتين");
    await userEvent.clear(input);
    await userEvent.type(input, "200");
    expect(screen.getByRole("alert")).toHaveTextContent("يتجاوز الحدّ 100.00");
    await expectNoA11yViolations(container);
  });

  it("التسوية: سطر المطابقة إلزامي؛ 40+60+0=100 مطابق؛ 40+70 يقول يتجاوز؛ الآجل بلا طرف معطّل بسبب", async () => {
    const { container, rerender } = render(
      <Settlement
        totalMinor="10000"
        cashMinor="4000"
        creditMinor="6000"
        bankMinor="0"
        currency="ج.س"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-matched", "true");
    expect(screen.getByRole("status")).toHaveTextContent("مطابق");
    expectNoArabicInMono(container);
    rerender(
      <Settlement
        totalMinor="10000"
        cashMinor="4000"
        creditMinor="7000"
        bankMinor="0"
        currency="ج.س"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-matched", "false");
    expect(screen.getByRole("status")).toHaveTextContent(/110\.00.*يتجاوز.*100\.00/);
    rerender(
      <Settlement
        totalMinor="10000"
        cashMinor="10000"
        creditMinor="0"
        bankMinor="0"
        currency="ج.س"
        onChange={() => {}}
        creditDisabledReason="اختر عميلاً أولاً"
      />,
    );
    expect(screen.getByRole("textbox", { name: "آجل بـج.س" })).toBeDisabled();
    await expectNoA11yViolations(container);
  });
});

describe("C-QTYUNIT", () => {
  const units = [
    { id: "pc", label: "حبة", decimalPlaces: 0 as const, factorNum: "1" },
    { id: "ctn", label: "كرتونة", decimalPlaces: 0 as const, factorNum: "24" },
    { id: "kg", label: "كغ", decimalPlaces: 3 as const, factorNum: "1" },
  ];
  it("التحويل صريح «= 48 حبة»، تغيير الوحدة يُعلن، والوزن يقبل 3 منازل والحبة لا تقبل كسراً", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <QtyUnit
        label="الكمية"
        qtyMilli="2000"
        unitId="ctn"
        units={units}
        baseUnitLabel="حبة"
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/= 48/)).toBeInTheDocument();
    expectNoArabicInMono(container);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "الوحدة" }), "kg");
    expect(container.querySelector("[aria-live=polite]")).toHaveTextContent("الوحدة الآن كغ");
    expect(onChange).toHaveBeenLastCalledWith({ qtyMilli: "2000", unitId: "kg" });
    const input = container.querySelector<HTMLInputElement>("input.c-qtyunit__input")!;
    await userEvent.clear(input);
    await userEvent.type(input, "0.123");
    expect(onChange).toHaveBeenLastCalledWith({ qtyMilli: "123", unitId: "kg" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "الوحدة" }), "pc");
    expect(onChange).toHaveBeenLastCalledWith({ qtyMilli: null, unitId: "pc" });
    expect(screen.getByRole("alert")).toHaveTextContent("0 منازل");
    await expectNoA11yViolations(container);
  });
});

describe("C-SYNC", () => {
  const pendingLabel = (n: number) => `${n} عمليات معلقة من هذا الجهاز`;
  it("الصيغة الموحدة للتغطية، والإعلان لا يقول «تم» للمحفوظ محلياً، وبلا اتصال المزامنة معطّلة بسبب", async () => {
    expect(coverageText("10:30", 3, pendingLabel)).toBe(
      "آخر تحديث خادمي 10:30 — يشمل 3 عمليات معلقة من هذا الجهاز",
    );
    expect(coverageText(null, 0, pendingLabel)).toBe("لم يتأكد شيء خادمياً بعد");
    const { container, rerender } = render(
      <SyncIndicator
        state="saved_local"
        lastServerAt="10:30"
        pendingCount={1}
        pendingLabel={pendingLabel}
        onOpen={() => {}}
        onSyncNow={() => {}}
      />,
    );
    expect(container.querySelector("[aria-live=polite]")).toHaveTextContent(
      "محفوظ محلياً — لم يصل الخادم بعد",
    );
    expect(container.querySelector("[aria-live=polite]")).not.toHaveTextContent("تم");
    rerender(
      <SyncIndicator
        state="offline"
        lastServerAt="10:30"
        pendingCount={1}
        pendingLabel={pendingLabel}
        onSyncNow={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "مزامنة الآن" })).toBeDisabled();
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });
});

describe("C-LEDLINE", () => {
  it("المدين والدائن عمودان ثابتان، المعلّق يظهر في الرصيد ويُوسَم، والرصيد الجاري مُعلن، وEnter يفتح", async () => {
    const onOpen = vi.fn();
    const rows = [
      {
        id: "1",
        dateLabel: "10 سبتمبر",
        document: "فاتورة 1042",
        direction: "debit" as const,
        amountMinor: "12000",
        runningBalanceMinor: "12000",
        state: "synced" as const,
      },
      {
        id: "2",
        dateLabel: "11 سبتمبر",
        document: "فاتورة 1043",
        direction: "debit" as const,
        amountMinor: "6000",
        runningBalanceMinor: "18000",
        state: "pending_sync" as const,
      },
    ];
    const { container } = render(
      <LedgerLines caption="كشف" currency="ج.س" rows={rows} onOpen={onOpen} />,
    );
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["التاريخ والمستند", "مدين", "دائن", "الرصيد"]);
    expect(screen.getByText("معلّق المزامنة")).toBeInTheDocument();
    expect(
      screen.getByRole("rowheader", { name: "الرصيد الحالي" }).parentElement,
    ).toHaveTextContent("180.00");
    const row = screen.getAllByRole("row")[2]!;
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });
});

describe("C-CART", () => {
  it("الإجمالي يُعلن عند التغيير، Delete يحذف مع تراجع، والأسهم تنقل بين البنود", async () => {
    const onRemove = vi.fn();
    const onUndo = vi.fn();
    const lines = [
      {
        id: "a",
        name: "سكر",
        qtyLabel: "1",
        unitLabel: "حبة",
        unitPriceMinor: "10000",
        lineTotalMinor: "10000",
      },
      {
        id: "b",
        name: "زيت",
        qtyLabel: "2",
        unitLabel: "حبة",
        unitPriceMinor: "78000",
        lineTotalMinor: "156000",
      },
    ];
    const { container } = render(
      <Cart
        lines={lines}
        totalMinor="166000"
        currency="ج.س"
        onRemove={onRemove}
        onUndoRemove={onUndo}
        empty={<Notice kind="empty" title="فارغة" children="اختر صنفاً" />}
      />,
    );
    expect(container.querySelector("[aria-live=polite]")).toHaveTextContent(
      "إجمالي السلة 1,660.00 ج.س",
    );
    const [first, second] = screen.getAllByRole("button", { name: /—/ });
    first!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await userEvent.keyboard("{Delete}");
    expect(onRemove).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getByRole("button", { name: "تراجع" }));
    expect(onUndo).toHaveBeenCalledWith("b");
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });
});

describe("C-RECV", () => {
  it("أربع كميات مستقلة لا تُدمج؛ الفرق يُعلن رقماً واتجاهاً؛ المستلم يتحول إلى أجزاء الألف", async () => {
    const onReceived = vi.fn();
    const { container } = render(
      <ReceiveLine
        item="سكر"
        unitLabel="كيس"
        decimalPlaces={0}
        requestedMilli="10000"
        confirmedMilli="8000"
        shippedMilli="8000"
        receivedMilli="7000"
        onReceived={onReceived}
      />,
    );
    expect(screen.getByText("مطلوب").nextElementSibling).toHaveTextContent("10");
    expect(screen.getByText("مؤكد").nextElementSibling).toHaveTextContent("8");
    expect(screen.getByText("متبقٍ").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByRole("status")).toHaveTextContent("ناقص 1 كيس");
    const input = screen.getByRole("textbox", { name: "مستلم" });
    await userEvent.clear(input);
    await userEvent.type(input, "٨");
    expect(onReceived).toHaveBeenLastCalledWith("8000");
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });
});

describe("C-PRINT", () => {
  it("إعادة الطباعة موسومة «نسخة» في المخرج والاسم؛ فشل الطابعة يقول إن البيع مسجَّل؛ لا زر طباعة يعد بقدرة غائبة", async () => {
    const { container, rerender } = render(
      <Receipt
        shopName="بقالة"
        title="فاتورة"
        number="1043"
        dateLabel="2026-09-15"
        copy
        lines={[{ label: "الإجمالي", value: "100.00", mono: true, strong: true }]}
      />,
    );
    expect(screen.getByRole("article", { name: "فاتورة 1043 نسخة" })).toBeInTheDocument();
    expect(screen.getByText("نسخة")).toBeInTheDocument();
    expectNoArabicInMono(container);
    rerender(
      <PrintControls
        outcome="failed"
        printerAvailable
        onPrint={() => {}}
        onReprint={() => {}}
        number="1043"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("لم تتأكد الطباعة");
    expect(screen.getByRole("status")).toHaveTextContent("مسجَّلة");
    expect(screen.getByRole("button", { name: "أعد الطباعة (نسخة)" })).toBeEnabled();
    rerender(
      <PrintControls outcome="idle" printerAvailable={false} onPrint={() => {}} number="1043" />,
    );
    const print = screen.getByRole("button", { name: "اطبع" });
    expect(print).toBeDisabled();
    expect(print).toHaveAccessibleDescription(/لا طابعة مربوطة/);
    await expectNoA11yViolations(container);
  });
});
