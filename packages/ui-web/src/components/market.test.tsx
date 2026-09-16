import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations } from "../test/axe";
import { Audience } from "./Audience";
import { Campaign, renderPreview } from "./Campaign";
import { Compare, Listing } from "./Listing";
import { OrderTimeline } from "./OrderTimeline";
import { PhaseLocked, PhaseTag } from "./Phase";
import { Quote } from "./Quote";

function expectNoArabicInMono(root: HTMLElement) {
  for (const el of root.querySelectorAll(".sting-mono")) {
    expect(el.textContent ?? "", `mono: ${el.textContent}`).not.toMatch(/[\u0600-\u06FF]/);
  }
}

describe("C-PHASE", () => {
  it("الوسم زر يفتح التفسير، والواجهة المقفلة مرئية ومعطّلة لا مخفية، وزر التفعيل بسبب (القاعدة 11)", async () => {
    const { container } = render(
      <PhaseLocked kind="M3" explanation="مصمَّمة وتُفعَّل في M3" includes={["ربط الأطراف"]}>
        <input aria-label="ربط الصنف" defaultValue="x" />
      </PhaseLocked>,
    );
    expect(container.querySelector("[data-state='phase_locked']")).toBeInTheDocument();
    expect(container.querySelector("[inert]")).toContainElement(screen.getByLabelText("ربط الصنف"));
    const activate = screen.getByRole("button", { name: "تفعيل" });
    expect(activate).toBeDisabled();
    expect(activate).toHaveAccessibleDescription("مصمَّمة وتُفعَّل في M3");
    await userEvent.click(screen.getByRole("button", { name: /مرحلة غير مفعّلة/ }));
    expect(screen.getByRole("dialog", { name: "مرحلة غير مفعّلة" })).toHaveTextContent(
      "ربط الأطراف",
    );
    await expectNoA11yViolations(container);
  });
  it("PhaseTag يصف نفسه بالتفسير", () => {
    render(<PhaseTag kind="M4" explanation="M4 لاحقاً" />);
    expect(screen.getByRole("button")).toHaveAccessibleDescription("M4 لاحقاً");
  });
});

describe("C-LISTING", () => {
  it("البطاقة هدف واحد باسم يضم «إعلان ممول» والموثّق؛ السعر الخاص لا يُكشف؛ المنتهي موسوم", async () => {
    const { container } = render(
      <>
        <Listing
          title="سكر"
          seller="البركة"
          verified
          sponsored
          priceMinor="4500000"
          currency="ج.س"
          unitLabel="كيس"
          freshnessLabel="أُكد اليوم"
          href="#a"
        />
        <Listing
          title="خاص"
          seller="النخيل"
          priceMinor="1"
          currency="ج.س"
          unitLabel="كرتونة"
          freshnessLabel="أُكد اليوم"
          privatePrice
          href="#b"
        />
        <Listing
          title="زيت"
          seller="الأمان"
          priceMinor={null}
          currency="ج.س"
          unitLabel="كرتونة"
          freshnessLabel="1 سبتمبر"
          expired
          href="#c"
        />
      </>,
    );
    expect(
      screen.getByRole("link", { name: "إعلان ممول: سكر من البركة — منشأة موثّقة الهوية" }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("0.01");
    expect(screen.getByText("سعر خاص — يتطلب تسجيل الدخول")).toBeInTheDocument();
    expect(screen.getByText("يحتاج تأكيد السعر والتوفر")).toBeInTheDocument();
    expect(screen.getByText("اطلب السعر")).toBeInTheDocument();
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });

  it("المقارنة تسمّي «الأقل سعراً» بوحدة واحدة ورسوم مشمولة فقط (ACC-122)", () => {
    const { rerender, container } = render(
      <Compare
        unitLabel="حبة"
        currency="ج.س"
        rows={[
          { seller: "أ", unitPriceMinor: "9000", feesIncluded: true },
          { seller: "ب", unitPriceMinor: "8500", feesIncluded: true },
        ]}
      />,
    );
    expect(container.querySelector("[data-cheapest]")).toHaveTextContent("ب");
    rerender(
      <Compare
        unitLabel="حبة"
        currency="ج.س"
        rows={[
          { seller: "أ", unitPriceMinor: "9000", feesIncluded: true },
          { seller: "ب", unitPriceMinor: null, feesIncluded: false },
        ]}
      />,
    );
    expect(container.querySelector("[data-cheapest]")).toBeNull();
    expect(screen.getByText(/لا تُعرض «الأقل سعراً»/)).toBeInTheDocument();
    expect(screen.getByText("لا يمكن التوحيد — الوحدة مختلفة")).toBeInTheDocument();
  });
});

describe("C-QUOTE", () => {
  const lines = [
    {
      id: "1",
      item: "سكر",
      unitLabel: "كيس",
      qtyLabel: "10",
      unitPriceMinor: "4500000",
      lineTotalMinor: "45000000",
    },
  ];
  it("الإرسال يطلب تأكيداً؛ الصلاحية نص كامل؛ المنتهي للقراءة فقط بلا إرسال؛ الشروط ظاهرة", async () => {
    const onSend = vi.fn();
    const { container, rerender } = render(
      <Quote
        revision={2}
        lines={lines}
        totalMinor="45000000"
        currency="ج.س"
        validUntilLabel="2026-09-20"
        onPrice={() => {}}
        onSend={onSend}
        sendConfirmText="سيصل للمشتري"
        terms={["التوصيل: البائع"]}
      />,
    );
    expect(screen.getByText(/صالح حتى/)).toHaveTextContent("2026-09-20");
    expect(screen.getByRole("list", { name: "الشروط" })).toHaveTextContent("التوصيل: البائع");
    await userEvent.click(screen.getByRole("button", { name: "أرسل العرض" }));
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "أرسل" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
    rerender(
      <Quote
        revision={1}
        lines={lines}
        totalMinor="45000000"
        currency="ج.س"
        validUntilLabel="2026-09-10"
        expired
        readOnly
        sendConfirmText=""
        terms={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: "أرسل العرض" })).not.toBeInTheDocument();
    expect(screen.getByText(/انتهت صلاحية العرض/)).toBeInTheDocument();
  });
});

describe("C-ORDTL", () => {
  it("المرحلة الحالية aria-current=step، المستقبلية «غير مكتملة» لا معطّلة، والأسهم تنقل وEnter يفتح", async () => {
    const onOpen = vi.fn();
    const stages = [
      { id: "a", label: "أُرسل", state: "done" as const, atLabel: "09-12" },
      { id: "b", label: "مؤكد", state: "current" as const },
      { id: "c", label: "مستلم", state: "upcoming" as const },
    ];
    const { container } = render(<OrderTimeline label="المسار" stages={stages} onOpen={onOpen} />);
    expect(container.querySelector("[aria-current='step']")).toHaveTextContent("مؤكد");
    const upcoming = screen.getByRole("button", { name: "مستلم — غير مكتملة بعد" });
    expect(upcoming).toBeEnabled();
    const first = screen.getByRole("button", { name: /أُرسل/ });
    first.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("button", { name: /مؤكد/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(stages[1]);
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });
});

describe("C-AUD", () => {
  it("حجم الجمهور يُعلن عند التغيير، والنطاق مذكور، والراديو يبدّل النوع", async () => {
    const onKind = vi.fn();
    const { container, rerender } = render(
      <Audience
        kind="all"
        onKind={onKind}
        size={128}
        sizeLabel={(n) => `${n} مشتركاً`}
        scopeNote="من مشتركي هذا المحل فقط"
      />,
    );
    expect(container.querySelector("[aria-live=polite]")).toHaveTextContent("128 مشتركاً");
    await userEvent.click(screen.getByRole("radio", { name: /شريحة/ }));
    expect(onKind).toHaveBeenCalledWith("segment");
    rerender(
      <Audience
        kind="segment"
        onKind={onKind}
        size={null}
        loading
        sizeLabel={(n) => `${n}`}
        scopeNote="x"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ حساب الجمهور");
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });
});

describe("C-CAMP", () => {
  it("المعاينة تعوّض المتغيرات ولا ترسل؛ Ctrl+Enter يحفظ؛ نتيجة التسليم تفصل مقبول/وصل/قُرئ", async () => {
    expect(renderPreview("مرحباً {name} في {shop}", { name: "أحمد", shop: "النيل" })).toBe(
      "مرحباً أحمد في النيل",
    );
    expect(renderPreview("{missing}", {})).toBe("{missing}");
    const onSave = vi.fn();
    const { container, rerender } = render(
      <Campaign
        stage="draft"
        title="عرض"
        body="مرحباً {name}"
        onTitle={() => {}}
        onBody={() => {}}
        onSave={onSave}
        variables={{ name: "أحمد" }}
      />,
    );
    expect(screen.getByRole("complementary", { name: "معاينة" })).toHaveTextContent("مرحباً أحمد");
    expect(screen.getByText(/لا إرسال فعلياً/)).toBeInTheDocument();
    screen.getByLabelText("عنوان الرسالة").focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender(
      <Campaign
        stage="completed"
        title="عرض"
        body="x"
        onTitle={() => {}}
        onBody={() => {}}
        variables={{}}
        readOnly
        delivery={{ accepted: 128, delivered: 97, read: null, failed: 3 }}
      />,
    );
    const dl = screen.getByRole("region", { name: "نتيجة التسليم" });
    expect(dl).toHaveTextContent("مقبول من المزود");
    expect(dl).toHaveTextContent("قُرئ");
    expect(dl.textContent).toContain("—");
    expect(dl).toHaveTextContent("ليس «وصل» ولا «قُرئ»");
    expectNoArabicInMono(container);
    await expectNoA11yViolations(container);
  });
});
