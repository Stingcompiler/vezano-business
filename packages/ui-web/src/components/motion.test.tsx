import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoA11yViolations } from "../test/axe";
import { ProgressRing } from "./Motion";
import { Notice } from "./Notice";

describe("الحركة (0005 §١٣٧)", () => {
  it("ProgressRing: شريط تقدّم بقيمته مقصوصة إلى 0–100 ومكتمل عند 100", async () => {
    const { container, rerender } = render(<ProgressRing value={42.4} label="تجهيز الجهاز" />);
    const bar = screen.getByRole("progressbar", { name: "تجهيز الجهاز" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveTextContent("42%");
    expect(bar).not.toHaveAttribute("data-complete");
    await expectNoA11yViolations(container);
    rerender(<ProgressRing value={140} label="تجهيز الجهاز" />);
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("data-complete");
    rerender(<ProgressRing value={-5} label="تجهيز الجهاز" />);
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("ProgressRing: المركز يقبل محتوى غير النسبة (3/6 خطوات)", () => {
    render(
      <ProgressRing value={50} label="المعالج">
        3/6
      </ProgressRing>,
    );
    expect(screen.getByRole("progressbar")).toHaveTextContent("3/6");
  });

  it("إشعار النجاح يرسم علامة ✓ المتحرّكة ولا نصّ فيها يُقرأ", async () => {
    const { container } = render(<Notice kind="success" title="حُفظ البيع" />);
    const mark = container.querySelector(".c-success-mark");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark?.querySelector(".c-success-mark__check")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("حُفظ البيع");
    await expectNoA11yViolations(container);
  });
});
