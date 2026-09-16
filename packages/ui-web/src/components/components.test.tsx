import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { STATE_CODES, stateLabel } from "@sting/design";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations } from "../test/axe";
import { Button } from "./Button";
import { Frame } from "./Frame";
import { Nav } from "./Nav";
import { OrgSwitcher } from "./OrgSwitcher";
import { Status } from "./Status";

describe("C-BTN", () => {
  it("المعطّل يحمل سبباً مربوطاً بـ aria-describedby — لا زر معطّل صامت (R-02)", async () => {
    const { container } = render(<Button disabledReason="افتح وردية أولاً">احفظ البيع</Button>);
    const btn = screen.getByRole("button", { name: "احفظ البيع" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription("افتح وردية أولاً");
    await expectNoA11yViolations(container);
  });

  it("loading يضيف aria-busy ولا يزيل النص", () => {
    render(<Button loading>جارٍ الحفظ</Button>);
    const btn = screen.getByRole("button", { name: "جارٍ الحفظ" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
  });

  it("أيقونة فقط تشترط تسمية عربية", () => {
    expect(() => render(<Button variant="icon" icon={<span />} />)).toThrow(/iconLabel/);
    render(<Button variant="icon" icon={<span />} iconLabel="طباعة" />);
    expect(screen.getByRole("button", { name: "طباعة" })).toBeInTheDocument();
  });

  it("Enter وSpace يفعّلان، والنوع الافتراضي button لا submit", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>موافق</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("type", "button");
    btn.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("الفعل المالي وPOS يحملان وسميهما لقواعد 56/46px", () => {
    render(
      <Button financial pos>
        احفظ
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-financial", "true");
    expect(btn).toHaveAttribute("data-pos", "true");
  });
});

describe("C-STATUS", () => {
  it("الحالات الـ17 كلها بنصها العربي من tokens وبألوانها كمتغيرات — لا لون وحده", async () => {
    const { container } = render(
      <div>
        {STATE_CODES.map((s) => (
          <Status key={s} state={s} />
        ))}
      </div>,
    );
    for (const s of STATE_CODES) {
      const el = screen.getByText(stateLabel[s]);
      expect(el.closest("[data-state]")).toHaveAttribute("data-state", s);
    }
    expect(container.querySelectorAll("[role=status]")).toHaveLength(17);
    await expectNoA11yViolations(container);
  });

  it("مع سبب تصبح زراً باسم يجمع الحالة والسبب", () => {
    render(<Status state="conflict" reason="نسختان متعارضتان" />);
    expect(screen.getByRole("button", { name: "تعارض — نسختان متعارضتان" })).toBeInTheDocument();
  });
});

describe("C-NAV", () => {
  const items = [
    { id: "home", label: "الرئيسية", href: "/" },
    { id: "pos", label: "البيع", href: "/pos" },
    { id: "pur", label: "المشتريات", href: "/pur", restrictedReason: "مرحلة غير مفعّلة · M3" },
  ];

  it("aria-current على النشط، والمقيد يعلن سببه ولا يُخفى ولا ينتقل", async () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <Nav items={items} currentId="pos" label="التنقل" onNavigate={onNavigate} />,
    );
    expect(screen.getByRole("link", { name: "البيع" })).toHaveAttribute("aria-current", "page");
    const restricted = screen.getByRole("link", { name: /المشتريات/ });
    expect(restricted).toHaveAttribute("aria-disabled", "true");
    expect(restricted).toHaveTextContent("مرحلة غير مفعّلة · M3");
    await userEvent.click(restricted);
    expect(onNavigate).not.toHaveBeenCalled();
    await expectNoA11yViolations(container);
  });

  it("الأسهم وHome/End تنقل التركيز داخل القائمة", async () => {
    render(<Nav items={items} currentId="home" label="التنقل" />);
    const [first, second, third] = screen.getAllByRole("link");
    first!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(third).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(first).toHaveFocus();
  });

  it("السفلي يرفض أكثر من 5 عناصر", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: `ع${i}`, href: "/" }));
    expect(() => render(<Nav items={six} currentId="0" label="x" variant="bottom" />)).toThrow(/5/);
  });
});

describe("C-FRAME", () => {
  it("landmarks الأربعة وSkip link أول عنصر قابل للتركيز، وF6 ينقل بين المناطق", async () => {
    const { container } = render(
      <Frame
        title="بقالة النيل — تجريبي"
        nav={<Nav items={[{ id: "a", label: "أ", href: "/" }]} currentId="a" label="التنقل" />}
        footer="الجهاز A2"
      >
        <p>المحتوى</p>
      </Frame>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    const skip = screen.getByRole("link", { name: "تخطٍّ إلى المحتوى" });
    expect(container.querySelector("a,button,[tabindex='0']")).toBe(skip);
    await userEvent.tab();
    expect(skip).toHaveFocus();
    await userEvent.keyboard("{F6}");
    expect(screen.getByRole("banner")).toHaveFocus();
    await userEvent.keyboard("{F6}");
    expect(container.querySelector(".c-frame__nav")).toHaveFocus();
    await userEvent.keyboard("{F6}");
    expect(screen.getByRole("main")).toHaveFocus();
    await expectNoA11yViolations(container);
  });

  it("offline يظهر كشريط حالة في الترويسة", () => {
    render(
      <Frame
        title="x"
        notice={<Status state="offline" label="بلا اتصال — البيع والوردية يعملان محلياً" />}
      >
        <p />
      </Frame>,
    );
    expect(
      within(screen.getByRole("banner")).getByText("بلا اتصال — البيع والوردية يعملان محلياً"),
    ).toBeInTheDocument();
  });
});

describe("C-ORGSW", () => {
  const options = [
    { id: "a", name: "بقالة النيل — تجريبي", branch: "الرئيسي" },
    { id: "b", name: "مخزن البركة — تجريبي" },
  ];

  it("combobox يفتح بالأسهم، ويختار بـ Enter، ويعلن التغيير في live region، وEsc يعيد التركيز للزر", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <OrgSwitcher options={options} selectedId="a" onChange={onChange} />,
    );
    const trigger = screen.getByRole("button", { name: "المنشأة والفرع" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith(options[1]);
    expect(container.querySelector("[aria-live=polite]")).toHaveTextContent(
      "تم الانتقال إلى مخزن البركة — تجريبي",
    );
    expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await expectNoA11yViolations(container);
  });

  it("منشأة واحدة → قراءة فقط بلا قائمة", async () => {
    render(<OrgSwitcher options={options.slice(1)} selectedId="b" onChange={() => {}} />);
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("قواعد عامة", () => {
  it("لا left/right في الأنماط — خصائص منطقية فقط (القاعدة 1)", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../styles.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(/\b(margin|padding|border|inset)-(left|right)\b/);
    expect(css).not.toMatch(/^\s*(left|right)\s*:/m);
    expect(css).not.toMatch(/outline\s*:\s*none/);
    expect(css).toMatch(/outline: 3px solid var\(--color-accent\)/);
    expect(css).toMatch(/min-block-size: var\(--layout-touchTarget\)/);
  });
});
