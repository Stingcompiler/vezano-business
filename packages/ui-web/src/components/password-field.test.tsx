import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoA11yViolations } from "../test/axe";
import { TextField } from "./Field";

describe("حقل كلمة المرور (0005 §١٤١)", () => {
  it("زرّ يُظهر الحروف ويخفيها، ولا يطابق تسمية الحقل", async () => {
    const { container } = render(
      <TextField label="كلمة المرور" kind="password" defaultValue="x" />,
    );
    const input = screen.getByLabelText("كلمة المرور");
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "إظهار الحروف" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "إخفاء الحروف" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "password");
    await expectNoA11yViolations(container);
  });

  it("الحقول الأخرى بلا زرّ", () => {
    render(<TextField label="البريد" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
