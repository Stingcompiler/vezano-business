import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations } from "../test/axe";
import { Button } from "./Button";
import { DocPreview } from "./DocPreview";
import { FilterBar, Pagination } from "./Filter";
import { Notice } from "./Notice";
import { Pick } from "./Pick";
import { Table, type Column } from "./Table";
import { TimeList } from "./TimeList";
import { Upload } from "./Upload";

interface Row {
  id: string;
  name: string;
  price: string;
}
const rows: Row[] = [
  { id: "1", name: "سكر", price: "100.00" },
  { id: "2", name: "زيت", price: "780.00" },
];
const columns: Column<Row>[] = [
  { key: "name", header: "الصنف", render: (r) => r.name, sortable: true },
  { key: "price", header: "السعر", render: (r) => r.price, mono: true },
];

describe("C-TABLE", () => {
  it("table دلالي بـ scope وaria-sort، أعمدة المال mono، وEnter يفتح الصف، والأسهم تنقل", async () => {
    const onOpen = vi.fn();
    const onSort = vi.fn();
    const { container } = render(
      <Table
        caption="الأصناف"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: "name", dir: "ascending" }}
        onSort={onSort}
        onOpenRow={onOpen}
      />,
    );
    expect(screen.getByRole("grid", { name: "الأصناف" })).toBeInTheDocument();
    const nameHeader = screen.getByRole("columnheader", { name: /الصنف/ });
    expect(nameHeader).toHaveAttribute("scope", "col");
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(nameHeader).getByRole("button"));
    expect(onSort).toHaveBeenCalledWith("name");
    const priceCells = container.querySelectorAll("td.c-table__num");
    expect(priceCells).toHaveLength(2);
    // mono على القيمة لا الخلية — تسمية البطاقة (::before) عربية تبقى خارج mono
    expect(priceCells[0]).not.toHaveClass("sting-mono");
    expect(priceCells[0]!.querySelector(".sting-mono")).not.toBeNull();
    const first = container.querySelector<HTMLElement>("tbody td")!;
    first.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(priceCells[0]);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(priceCells[1]);
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
    await expectNoA11yViolations(container);
  });

  it("loading هياكل صفوف بعددها مع status؛ empty يعرض C-NOTICE بفعله؛ البطاقات تحمل data-label بنفس التسميات", () => {
    const { container, rerender } = render(
      <Table caption="أ" columns={columns} rows={[]} rowKey={(r: Row) => r.id} loading={3} />,
    );
    expect(container.querySelectorAll("tr.c-table__skeleton")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ الجلب");
    rerender(
      <Table
        caption="أ"
        columns={columns}
        rows={[]}
        rowKey={(r: Row) => r.id}
        empty={<Notice kind="empty" title="لا أصناف بعد" action={<Button>أضف صنفاً</Button>} />}
      />,
    );
    expect(screen.getByText("لا أصناف بعد")).toBeInTheDocument();
    rerender(<Table caption="أ" columns={columns} rows={rows} rowKey={(r) => r.id} forceCards />);
    expect(container.querySelector("td[data-label='السعر']")).toBeInTheDocument();
    expect(container.querySelector(".c-table--cards")).toBeInTheDocument();
  });
});

describe("C-FILTER", () => {
  it("الوسوم تُزال بالنقر وBackspace، والعدّ يُعلن مع ما أخفاه الفلتر، ومسح الكل", async () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const { container } = render(
      <FilterBar
        chips={[{ key: "b", label: "الفرع: الرئيسي" }]}
        onRemove={onRemove}
        onClearAll={onClear}
        resultCount={12}
        hiddenCount={38}
        countLabel={(n, h) => (h ? `${n} نتيجة — الفلتر أخفى ${h}` : `${n} نتيجة`)}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("12 نتيجة — الفلتر أخفى 38");
    const chip = screen.getByRole("button", { name: "إزالة المرشّح الفرع: الرئيسي" });
    chip.focus();
    await userEvent.keyboard("{Backspace}");
    expect(onRemove).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getByRole("button", { name: "مسح الكل" }));
    expect(onClear).toHaveBeenCalled();
    await expectNoA11yViolations(container);
  });

  it("الترقيم navigation بعربية، والأطراف معطّلة بسبب", async () => {
    const { container } = render(<Pagination page={1} pageCount={3} onPage={() => {}} />);
    expect(screen.getByRole("navigation", { name: "ترقيم الصفحات" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "السابقة" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "التالية" })).toBeEnabled();
    await expectNoA11yViolations(container);
  });
});

describe("C-PICK", () => {
  const opts = [
    { id: "1", label: "أحمد الطيب" },
    { id: "2", label: "أحمد محمد" },
  ];
  it("combobox بالأسهم وEnter، والعدّ يُعلن، وBackspace في المتعدد يحذف آخر وسم", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Pick
        label="العميل"
        options={opts}
        value={[]}
        onChange={onChange}
        query="أح"
        onQuery={() => {}}
        countLabel={(n) => `${n} نتيجة`}
      />,
    );
    const input = screen.getByRole("combobox", { name: "العميل" });
    expect(container.querySelector("[aria-live=polite]")).toHaveTextContent("2 نتيجة");
    input.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith(["2"]);
    await expectNoA11yViolations(container);
    const onChange2 = vi.fn();
    render(
      <Pick
        label="الأصناف"
        multiple
        options={opts}
        value={["1", "2"]}
        onChange={onChange2}
        query=""
        onQuery={() => {}}
        countLabel={(n) => `${n}`}
      />,
    );
    screen.getByRole("combobox", { name: "الأصناف" }).focus();
    await userEvent.keyboard("{Backspace}");
    expect(onChange2).toHaveBeenCalledWith(["1"]);
  });

  it("فراغ النتائج يعرض نص الإطار وoffline يعلن نتائج محلية", async () => {
    render(
      <Pick
        label="ع"
        options={[]}
        value={[]}
        onChange={() => {}}
        query="x"
        onQuery={() => {}}
        countLabel={(n) => `${n}`}
        emptyText="لا عميل بهذا الاسم"
        offlineText="بلا اتصال — نتائج محلية فقط"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText("لا عميل بهذا الاسم")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("نتائج محلية");
  });
});

describe("C-TIMELIST", () => {
  it("قائمة دلالية بوقت كامل في العنوان، الفاعل باسمه، وEnter يفتح", async () => {
    const onOpen = vi.fn();
    const entries = [
      {
        id: "1",
        at: "2026-09-15T10:31:00Z",
        atLabel: "10:31",
        title: "سداد 40.00 نقداً",
        actor: "المالك",
      },
    ];
    const { container } = render(<TimeList label="سجل" entries={entries} onOpen={onOpen} />);
    expect(screen.getByRole("list", { name: "سجل" })).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveAttribute("title", "2026-09-15T10:31:00Z");
    expect(screen.getByText("المالك")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /سداد/ }));
    expect(onOpen).toHaveBeenCalledWith(entries[0]);
    await expectNoA11yViolations(container);
  });
});

describe("C-UPLOAD وC-DOCPRV", () => {
  it("زر الرفع قابل للتركيز دائماً، القيود معلنة، الخطأ يذكر المسموح، وDelete يحذف", async () => {
    const onRemove = vi.fn();
    const { container } = render(
      <Upload
        label="إيصال"
        accept="image/*"
        constraintsText="صورة حتى 5 م.ب."
        onFiles={() => {}}
        onRemove={onRemove}
        items={[
          {
            id: "a",
            name: "x.png",
            sizeLabel: "9 MB",
            error: "الحجم يتجاوز 5 م.ب. — المسموح: صورة حتى 5 م.ب.",
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "اختر ملفاً" })).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toHaveAccessibleDescription(
      "صورة حتى 5 م.ب.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("المسموح");
    screen.getByRole("button", { name: "حذف x.png" }).focus();
    await userEvent.keyboard("{Delete}");
    expect(onRemove).toHaveBeenCalledWith("a");
    expect(onRemove.mock.calls.every((c) => c[0] === "a")).toBe(true);
    await expectNoA11yViolations(container);
  });

  it("المعاينة لها بديل نصي وتنزيل دائم، والصفحات بالأسهم، وEsc يخرج من ملء الشاشة", async () => {
    const onPage = vi.fn();
    const { container } = render(
      <DocPreview
        title="كشف"
        textAlternative="نص الكشف"
        downloadHref="/x.pdf"
        pageCount={3}
        page={2}
        onPage={onPage}
      >
        <p>محتوى</p>
      </DocPreview>,
    );
    expect(screen.getByText("نص الكشف")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /تنزيل/ })).toHaveAttribute("download");
    await userEvent.click(screen.getByRole("button", { name: "ملء الشاشة" }));
    expect(container.querySelector(".c-docprv--full")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(container.querySelector(".c-docprv--full")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "التالية" }));
    expect(onPage).toHaveBeenCalledWith(3);
    await expectNoA11yViolations(container);
  });
});
