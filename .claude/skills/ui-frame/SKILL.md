---
name: ui-frame
description: قواعد الواجهة الموحَّدة في فيزانو — شريط الأدوات/التنقل الموحَّد لكل إطار (العام، المتجر، المشغّل)، التصميم المتجاوب 390/834/1440، وألوان الرموز الدلالية فاتحاً وداكناً. يُستدعى عند بناء شاشة جديدة أو تحسين تصميم شاشة أو حين يقول المالك «وحّد الشريط/الألوان» أو «ناسب الهاتف والحاسوب».
---

# /ui-frame — إطار موحَّد: شريط، تجاوب، ألوان

المالك يطلب الشيء نفسه في كل جولة تصميم: «وحّد شريط الأدوات»، «ناسب الهاتف والحاسوب»، «وحّد الألوان».
هذه المهارة تجعل ذلك افتراضاً لا تصحيحاً لاحقاً. القواعد غير القابلة للتفاوض (النصوص الحرفية، الحالات
الـ17، الأرقام اللاتينية داخل `.sting-mono`، أهداف اللمس ≥ 44px، `phase_locked`) تبقى فوق كل ما هنا.

## 1 · ثلاثة إطارات — ثلاثة أشرطة، لا رابع

| الإطار | المكوّن | متى |
|---|---|---|
| **العام** (الهبوط، الباقات، الشروط، الحالة، الدخول، التسجيل، السوق للزائر) | `PublicHeader` من `features/public/public-header.tsx` عبر `Frame chrome={<PublicHeader cta=… />} back={false}` | كل صفحة بلا جلسة |
| **المتجر** (كل شاشات المستأجر) | `AppNav` من `features/home/app-nav.tsx` عبر `Frame nav={<AppNav currentId=… />}` (جانبي ≥ 834، **درج** بزرّ ☰ < 834 — §١١٣) | كل شاشة بجلسة مستأجر |
| **المشغّل** (`/platform/*`) | `PlatformFrame` من `features/platform/platform-nav.tsx` (ترويسة + `PlatformNav` جانبية/درج) | كل شاشة مشغّل |

- لا تبنِ شريطاً محلياً داخل شاشة (لا أزرار `Button variant="quiet"` مصفوفة كتنقّل). أضف القسم إلى
  مصفوفة الشريط الموحَّد (`LINKS` / `GROUPS`) وأعطه `current`/`currentId`.
- عناصر الشريط **أزرار** (`<button>`) لا روابط — المواصفات تنقرها بـ`getByRole("button", { name })`،
  والجلسة في الذاكرة فتحميل رابط يعيد إلى الدخول.
- على الهاتف القائمة **درج** ينزلق من جانب البداية بزرّ ☰ في الترويسة، يُغلق بالستارة/Esc/اختيار قسم؛
  الروابط تبقى في DOM (الإغلاق بالإزاحة لا `display: none`). في المواصفات: `openDrawerIfPhone`/`navTo`
  (المتجر) و`goSection` (المشغّل) قبل أي نقر على < 834.
- العنوان والتلميح المرسومان في رأس الشريط يبقيان حاضرين في كل مقاس (لا `display: none` على نصّ
  إطار — المواصفة تفحص `innerText`). ما يُخفى على الهاتف: اسم المشغّل ونحوه من غير نصوص الإطار.
- ترتيب الهاتف بـ`order` لا بتغيير DOM (العنوان ← الفعل ← التلميح سطراً كاملاً).

## 2 · التجاوب: ثلاثة مقاسات، حدّ واحد

- الحدّ الوحيد: `834px` (`@media (max-width: 833px)` للهاتف، `(min-width: 834px)` لما فوقه). المقاسات
  المختبَرة 390 · 834 · 1440 — كل مواصفة تعمل على الثلاثة.
- عرض المحتوى: الصفحات العامة `1080px` (`.pub.pb` / `.lp__wrap`)، شاشات المتجر والمشغّل
  `--layout-contentMax`؛ بطاقة مفردة (دخول) `≤ 480px` متوسّطة.
- الشبكات `repeat(auto-fill, minmax(240–280px, 1fr))` لا أعمدة ثابتة؛ الجداول الكثيفة تتحوّل إلى
  بطاقات < 834 بتسميات الأعمدة (`data-label` + `::before`) — كما في `C-TABLE` و`.pl-table`.
- كل عنصر تفاعلي ≥ 44px؛ الحقول 52px والأزرار الأساسية 48–54px في النماذج المفردة.
- الأعمدة الجانبية اللاصقة (`position: sticky; top: 90px`) ≥ 834 فقط.
- `min-inline-size: 0` على أبناء الشبكة والمرن؛ `overflow-x: clip` على الأقسام لا على الجذر (يكسر
  اللصق).

## 3 · الألوان: رموز دلالية فقط

- لا قيم ست عشرية في CSS الميزات. الرموز: `--color-ink-strong|muted|faint`،
  `--color-surface-page|card|sunken`، `--color-border`، `--color-brand-primary|strong|tint|line`،
  `--color-accent`، `--color-ok|warn|danger`، `--color-sidebar|sidebar-text`، وألوان الحالات
  `--color-state-<حالة>-bg|fg|border` (لها نسخة داكنة من `darkStateColor`).
- الهيكل (الترويسة والقائمة الجانبية) على `--color-sidebar` الفاتح بخطّ `--color-border`؛ لوحات الهوية الكحلية (الختام، الدعوة، جانب الدخول) على `--color-navy` بوهج
  `radial-gradient(… rgb(14 124 134 / .35) …)`؛ اللوحات العلوية على `--color-surface-card` بوهج
  `rgb(14 124 134 / .12)`. الدرجات بالنبرة: `ok`/`warn`/`danger`/`info(brand-primary)` كشريط 4px على
  حافة البداية (`border-inline-start`).
- مساحة المشغّل تحمل شارة `ADMIN` بلون `--color-warn` وشريطاً علوياً `4px solid var(--color-warn)`.
- المظهر الداكن يأتي مجاناً حين تُستعمل الرموز؛ الشارة والتنبيه يقرآن `var(--color-state-…)`. جرّب
  الداكن يدوياً: `localStorage.setItem("vz-theme","dark")`.
- الأرقام داخل `.sting-mono` فقط (Inter بأرقام جدولية)، ولا حرف عربي داخله (يفحصه `expectFrame`).
- الخط Tajawal للواجهة والعناوين (400/500/700/800 — لا 600)، عنوان الصفحة 800 والباقي 700؛ ظلّ البطاقات `--shadow-card` وزوايا `--radius-card` 18 / `--radius-panelSm` 10.

## 4 · حلقة العمل لكل شاشة

1. اختر الإطار من الجدول أعلاه وأضف القسم إلى شريطه الموحَّد إن كان جديداً.
2. ابنِ من `@sting/ui-web` فقط، بجذر `data-screen`/`data-state`، وأنماط الميزة في `features/<x>/<x>.css`
   بالرموز.
3. افحص المقاسات الثلاثة والداكن في المتصفح، ثم Playwright بـ`expectFrame` (نصوص، mono، لمس، axe):
   `PLAYWRIGHT_PORT=3011 NODE_OPTIONS=--max-old-space-size=6144 pnpm exec playwright test e2e/<spec> --workers=3`
4. غيّرت مكوّناً مشتركاً (Frame، Nav، PlatformNav، Status، Notice)؟ شغّل كل مواصفات ذلك الإطار
   (`e2e/platform-*.spec.ts` للمشغّل، `e2e/public-pages.spec.ts` + `e2e/probe.spec.ts` للعام).
5. غيّرت `tokens.json`؟ `node scripts/generate.ts` في `packages/design` ثم Vitest؛ غيّرت DRF؟
   `pnpm --filter @sting/contracts generate` ثم `prettier --write packages/contracts/openapi.json`.
6. سجّل ما خرج عن الإطار المرسوم في ملحق 0005 مرقّم.
