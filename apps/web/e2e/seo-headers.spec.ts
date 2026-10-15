import { expect, test } from "@playwright/test";

/**
 * الموقع العام أمام محرّكات البحث والمشاركة والمتصفح (0005 §١٥٤): robots وsitemap، وعنوان لكل
 * صفحة عامة، ومعاينة المشاركة بصورتها، وترويسات الأمان، وأيقونة المتصفح، وsecurity.txt.
 */
test.describe("SEO والمعاينة والأمان", () => {
  test("robots يمنع التطبيق ولوحة المشغّل ويدلّ على sitemap بالصفحات العامة وحدها", async ({
    request,
  }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /platform");
    expect(robots).toContain("Disallow: /pos");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Allow: /market/offers/public/");
    expect(robots).toContain("Sitemap: https://plus.vezano.app/sitemap.xml");
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://plus.vezano.app/plans</loc>");
    expect(sitemap).toContain("<loc>https://plus.vezano.app/register</loc>");
    expect(sitemap).not.toContain("/platform");
    expect(sitemap).not.toContain("/pos");
  });

  test("عنوان لكل صفحة عامة، ومعاينة المشاركة بصورتها", async ({ page }) => {
    await page.goto("/plans");
    await expect(page).toHaveTitle("الباقات والأسعار · فيزانو بلص");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "https://plus.vezano.app/og.png",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://plus.vezano.app/plans",
    );
    await page.goto("/legal");
    await expect(page).toHaveTitle("الشروط وسياسة الخصوصية · فيزانو بلص");
    await page.goto("/");
    await expect(page).toHaveTitle("فيزانو بلص — نقطة بيع ومخزون وذمم تعمل بلا اتصال");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "فيزانو بلص — نقطة بيع ومخزون وذمم تعمل بلا اتصال",
    );
  });

  test("ترويسات الأمان، والأيقونة، وصورة المعاينة، وsecurity.txt", async ({ request }) => {
    const res = await request.get("/plans");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=31536000");
    // الطباعة عبر البلوتوث لا تُمنع
    expect(h["permissions-policy"]).not.toContain("bluetooth");
    for (const path of ["/favicon.ico", "/og.png"]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
    expect(await (await request.get("/.well-known/security.txt")).text()).toContain(
      "Contact: mailto:plus@vezano.app",
    );
  });
});
