import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.17 — LINK-01…05 (M3) + GROW-01…03 (M4) بحالة `phase_locked` وحدها (§١٤.٦): المحتوى مرئي
 * ومعطَّل خلف وسم المرحلة، صيغة القفل بلا عدّاد ولا وعد بتاريخ، والبديل الحاضر معلَن.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function login(page: Page, next: string, urlRe: RegExp) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(urlRe);
}

const SCREENS: { id: string; path: string; texts: string[]; alt: string }[] = [
  {
    id: "LINK-01",
    path: "/market/link/parties",
    texts: [
      "ربط الطرف المحلي بمنشأة — موافقة وهوية، لا دمج بالاسم",
      "«مخزن البركة» في دفترك اسم كتبته أنت. ربطه بمنشأة حقيقية في السوق يحتاج موافقتها — التشابه في الاسم ليس هوية.",
      "صيغة القفل",
      "«ربط الأطراف بالسوق يُفتح في مرحلة لاحقة. حتى ذلك الحين يعمل دفترك كاملاً وأطرافك المحلية كما هي — لا ينقصك شيء اليوم.» بلا عدّاد تنازلي ولا وعد بتاريخ.",
      "الطرف في دفترك",
      "المنشأة في السوق",
      "موافقة المنشأة على الربط",
      "دفترك كما هو",
      "قناة مستندات بين الطرفين",
    ],
    alt: "الأطراف في دفترك (PTY-01)",
  },
  {
    id: "LINK-02",
    path: "/market/link/items",
    texts: [
      "مطابقة الأصناف والوحدات — التحويل مؤكَّد أو لا يكون",
      "الملكية تبقى داخلية.",
      "تعديل المورد لاسم صنفه أو تغليفه لا يعيد كتابة صنفك ولا اسمه في دفترك. تظهر لك ملاحظة «تغيّر تعريف صنف المورد — راجع المطابقة» ويبقى القرار لك.",
    ],
    alt: "الكتالوج (CAT-01)",
  },
  {
    id: "LINK-03",
    path: "/market/link/receipts",
    texts: [
      "تحويل استلام إلى مستند — معاينة الأثر ومصدر واحد لا تكرار",
      "معاينة الأثر قبل التحويل",
      "لا شيء من هذا يحدث قبل ضغطك. المعاينة هي العقد: تقرأ الأثر كاملاً ثم تُقرّه.",
      "هذه الشحنة سُجِّلت يدوياً بالفعل",
    ],
    alt: "استلام بضاعة يدوي (INV-04)",
  },
  {
    id: "LINK-04",
    path: "/market/link/documents",
    texts: [
      "روابط المستندات وتسوية الفرق — دفتران مستقلّان لا دفتر مشترك",
      "نعرض رقمك ورقمه والفرق بينهما. لا نُصدر «الرقم الصحيح» — التسوية إجراء مخوَّل يكتبه أحد الطرفين في دفتره وحده.",
      "التسوية تكتب رقماً في دفترك المالي، فهي صلاحية من له حدّ مالي. لمن دونه: «الفرق مسجَّل — أُرسل للمالك للمراجعة» ومعه نسخة من المستندين.",
    ],
    alt: "الخلافات على الطلب (ORD-12)",
  },
  {
    id: "LINK-05",
    path: "/market/link/returns",
    texts: [
      "المستند العكسي يُكتب بالكمية المتفَق عليها فقط. ما لم يوافق عليه المورد لا يُكتب ولا يُلغى — يظل بنداً معلّقاً بسببه، لأن طيّه صامتاً يعني تنازلاً لم تقرّه.",
      "الأثر السابق محفوظ",
      "الجزء المتبقّي يبقى مطلباً مفتوحاً.",
    ],
    alt: "طلب مرتجع تجاري (ORD-11)",
  },
  {
    id: "GROW-01",
    path: "/grow/replenish",
    texts: [
      "اقتراح إعادة التوريد — رأيٌ يُعرَض بسببه",
      "النظام لا يشتري نيابةً عنك. يقترح كمية ويقول من أين جاءت: متوسط بيع، ومهلة توريد، ورصيد أمان. كل رقم في الاقتراح قابل للفتح على حسابه.",
      "مرحلة M4 لم تُفتح",
      "«اقتراح التوريد ضمن مرحلة النموّ — لم تُفتح بعد». بلا «قريباً» وبلا عدّاد تنازلي.",
      "البديل الحاضر",
      "تقرير الأصناف تحت حدّ الأمان موجود اليوم في INV. نحيل إليه بدل أن نترك المستخدم أمام باب مغلق.",
      "اقتراح التوريد — 9 أصناف",
      "لا شيء يُطلب حتى تختار",
    ],
    alt: "الأصناف تحت حدّ الأمان (INV)",
  },
  {
    id: "GROW-02",
    path: "/grow/suppliers",
    texts: [
      "تحليلات المورد — يُحاسَب على ما وعد به لا على ما نتمنّاه",
      "مؤسسة الرياض — 14 مستنداً · 6 أشهر",
      "آخر خمسة مستندات",
      "مثل GROW-01: قفل مرحلة. والبديل الحاضر اليوم هو كشف حساب المورد وسجل مستنداته في PTY.",
    ],
    alt: "كشف حساب المورد (PTY-04)",
  },
  {
    id: "GROW-03",
    path: "/grow/promote",
    texts: [
      "طلب عرض ممول ومعاينته",
      "M4 لم تُفتح والتسعير غير معتمد",
      "قفلان لا واحد: المرحلة لم تُفتح، والتسعير نفسه قرار مفتوح.",
      "لا واجهة دفع",
      "نقول القفلين",
      "الطلب للمالك",
    ],
    alt: "عروضي في السوق (MP-10)",
  },
];

for (const s of SCREENS) {
  test(`${s.id} phase_locked: المحتوى مرئي ومعطَّل خلف الوسم، والبديل الحاضر معلَن`, async ({
    page,
  }, info) => {
    await login(page, s.path, new RegExp(`${s.path.replace(/\//g, "\\/")}$`));
    await expectFrame(page, info, {
      screenId: s.id,
      state: "phase_locked",
      texts: fromFrame(s.id, "phase_locked", s.texts),
    });
    const root = page.locator(`[data-screen="${s.id}"]`);
    await expect(root.locator(".c-phase__locked")).toHaveAttribute("data-state", "phase_locked");
    await expect(root.locator(".c-phase__content")).toHaveAttribute("inert", "");
    await expect(root).toContainText("مثال");
    await expect(
      page.getByRole("button", {
        name: `يُفتح مع المرحلة ${s.id.startsWith("LINK") ? "M3" : "M4"} — لا مفتاح هنا`,
      }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: s.alt })).toBeVisible();
  });
}
