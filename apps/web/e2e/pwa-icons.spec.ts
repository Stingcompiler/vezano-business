import { expect, test } from "@playwright/test";

/**
 * أيقونات التطبيق (0005 §١٢٤ — WEB-01، التثبيت على Android يشترط 192 و512): المانيفست يعلنها،
 * وكل ملف موجود بمقاسه المعلن ونوعه، وبينها «maskable» للقصّ الدائري، والصفحة تعلن أيقونتها.
 */
function pngSize(buf: Buffer): [number, number] {
  // ترويسة PNG: العرض والارتفاع في IHDR عند البايت 16 و20
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test("المانيفست يعلن 192 و512 وmaskable، والملفات موجودة بمقاساتها", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as {
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  const sizes = new Set(m.icons.map((i) => `${i.sizes}:${i.purpose}`));
  for (const want of ["192x192:any", "512x512:any", "512x512:maskable"]) {
    expect(sizes.has(want), want).toBe(true);
  }
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toContain(icon.type.split("+")[0]);
    if (icon.type === "image/png") {
      const [w, h] = pngSize(await r.body());
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
  }
});

test("الصفحة تعلن أيقونتها وأيقونة Apple", async ({ page }) => {
  await page.goto("/welcome");
  await expect(page.locator('link[rel="icon"][href="/icons/icon.svg"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/icon-192.png",
  );
});
