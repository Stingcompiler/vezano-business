import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createApiClient,
  formatMinor,
  formatMinorShort,
  isEmailLike,
  isValidDemoWhatsapp,
  normalizeContactPhone,
  parseMoneyInput,
  planLines,
  pounds,
} from "./index";

const pkg = resolve(import.meta.dirname, "..");

describe("التنسيق", () => {
  it("المال بلا تقريب وبعلامة سالب صريحة", () => {
    expect(formatMinor("123456")).toBe("1,234.56");
    expect(formatMinor("-5")).toBe("−0.05");
    expect(formatMinorShort("4500000")).toBe("45,000");
    expect(pounds("4500000")).toBe("45,000");
  });
  it("الإدخال بأرقام عربية وفاصلة عربية", () => {
    expect(parseMoneyInput("١٬٢٣٤٫٥")).toBeNull(); // الفاصل «٬» ليس مقبولاً
    expect(parseMoneyInput("١،٢٣٤٫٥")).toBe("123450");
    expect(parseMoneyInput("1.234")).toBeNull(); // لا تقريب
  });
  it("سطور الباقة: الفروع ثم بنود الوصف", () => {
    expect(planLines({ max_branches: 1, max_devices: 3, blurb: "3 أجهزة · تقارير كاملة" })).toEqual(
      ["1 فرع", "3 أجهزة", "تقارير كاملة"],
    );
  });
});

describe("التحقق مطابق للخادم", () => {
  const vectors = JSON.parse(readFileSync(resolve(pkg, "vectors/contact-phone.json"), "utf8")) as {
    cases: [string, string | null][];
  };
  it.each(vectors.cases)("رقم التواصل %s ← %s", (raw, expected) => {
    expect(normalizeContactPhone(raw)).toBe(expected);
  });
  it("واتساب الجولة ثمانية أرقام على الأقل، والعربية مقبولة", () => {
    expect(isValidDemoWhatsapp("٠٩١٢٣٤٥٦")).toBe(true);
    expect(isValidDemoWhatsapp("+1234567")).toBe(false);
    expect(isEmailLike(" a@b ")).toBe(true);
  });
});

describe("عميل الـAPI", () => {
  it("401 على مسار مُصادَق: يستأنف مرة ويعيد الطلب بالرمز الجديد", async () => {
    let token = "old";
    const seen: string[] = [];
    const fakeFetch: typeof fetch = (input) => {
      const req = input as Request;
      const auth = req.headers.get("Authorization") ?? "";
      seen.push(auth);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: auth === "Bearer new" }), {
          status: auth === "Bearer new" ? 200 : 401,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };
    let unauthorized = 0;
    const api = createApiClient({
      baseUrl: "http://x",
      getAccessToken: () => token,
      resume: () => {
        token = "new";
        return Promise.resolve({ access: "new" });
      },
      onUnauthorized: () => unauthorized++,
      fetch: fakeFetch,
    });
    const { response } = await api.GET("/api/auth/me");
    // مسار عام: 401 يمرّ كما هو بلا استئناف
    expect(response.status).toBe(401);
    expect(unauthorized).toBe(0);
    token = "old";
    const r2 = await api.GET("/api/org/audit", { params: { query: {} } });
    expect(r2.response.status).toBe(200);
    expect(seen.slice(-2)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("فشل الاستئناف يستدعي onUnauthorized", async () => {
    const paths: string[] = [];
    const api = createApiClient({
      baseUrl: "http://x",
      getAccessToken: () => "t",
      resume: () => Promise.resolve(null),
      onUnauthorized: (p) => paths.push(p),
      fetch: () => Promise.resolve(new Response("{}", { status: 401 })),
    });
    await api.GET("/api/org/audit", { params: { query: {} } });
    expect(paths).toEqual(["/api/org/audit"]);
  });
});

describe("رموز الأخطاء المولّدة", () => {
  it("errors.generated.ts يطابق ما يولّده العقد الآن (لا انحراف)", () => {
    const before = readFileSync(resolve(pkg, "src/errors.generated.ts"), "utf8");
    execFileSync("node", ["scripts/generate-errors.mjs"], { cwd: pkg, stdio: "ignore" });
    execFileSync("pnpm", ["exec", "prettier", "--write", "src/errors.generated.ts"], {
      cwd: pkg,
      stdio: "ignore",
    });
    expect(readFileSync(resolve(pkg, "src/errors.generated.ts"), "utf8")).toBe(before);
  }, 30_000);
});
