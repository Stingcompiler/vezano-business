import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createContractsClient } from "./index";
import type { paths } from "./generated/schema";

const pkgDir = resolve(import.meta.dirname, "..");
const backend = resolve(pkgDir, "../../backend");

describe("توليد العقود (T0.9) — المخرجات مطابقة للخادم الحالي", () => {
  it("openapi.json المُلتزَم يطابق ما يولّده drf-spectacular الآن (لا انحراف)", () => {
    const generated = execFileSync(
      "uv",
      ["run", "python", "manage.py", "spectacular", "--format", "openapi-json"],
      { cwd: backend, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const committed = readFileSync(resolve(pkgDir, "openapi.json"), "utf8");
    expect(JSON.parse(committed)).toEqual(JSON.parse(generated));
  }, 30_000);

  it("المخطط 3.1 ويحمل مسارات المصادقة والمزامنة", () => {
    const schema = JSON.parse(readFileSync(resolve(pkgDir, "openapi.json"), "utf8")) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(schema.openapi).toBe("3.1.0");
    for (const p of [
      "/api/auth/login",
      "/api/auth/refresh",
      "/api/auth/logout",
      "/api/auth/me",
      "/api/sync/push",
      "/api/sync/pull",
    ]) {
      expect(schema.paths).toHaveProperty(p);
    }
  });

  it("العميل يحقن رمز الوصول ولا يرسله عند غيابه", async () => {
    const seen: { auth: string | null; url: string }[] = [];
    const fakeFetch: typeof fetch = (input) => {
      const req = input as Request;
      seen.push({ auth: req.headers.get("Authorization"), url: req.url });
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    };
    let token: string | null = null;
    const client = createContractsClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => token,
      fetch: fakeFetch,
    });
    await client.GET("/api/auth/me");
    token = "abc";
    await client.GET("/api/auth/me");
    expect(seen[0]!.auth).toBeNull();
    expect(seen[1]!.auth).toBe("Bearer abc");
    expect(seen[0]!.url).toBe("https://api.example.test/api/auth/me");
  });

  it("أنواع المسارات تُصدَّر (فحص تصريف)", () => {
    type LoginBody = paths["/api/auth/login"]["post"]["requestBody"] extends { content: infer C }
      ? C
      : never;
    const ok: LoginBody extends never ? false : true = true;
    expect(ok).toBe(true);
  });
});
