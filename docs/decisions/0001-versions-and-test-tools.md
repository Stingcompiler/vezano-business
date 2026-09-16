# 0001 — أرقام الإصدارات وأدوات الاختبار والبناء

**التاريخ:** 2026-09-15
**الحالة:** مقترح — ينتظر موافقة صاحب المشروع مع `docs/PLAN.md`
**المصدر:** القسم ١ من `CLAUDE_CODE_PROMPT.md`. الوثيقة v21 (§١٢.١، §٤.٤، §٤.٥) تسمّي الأدوات والطبقات ولا تذكر أرقام إصدارات ولا أدوات اختبار؛ ما يلي قرار هذا المستودع لا نصّ الوثيقة، وكل بند قابل للنقض بقرار لاحق مرقّم.

## القاعدة العامة

- يُثبَّت **أحدث إصدار ثابت من السلسلة المذكورة** عند إنشاء ملف القفل، ويُسجَّل الرقم الفعلي في ملفات القفل (`pnpm-lock.yaml`، `uv.lock`) لا هنا. هذا الملف يثبّت السلسلة والسبب.
- لا تُرفع سلسلة رئيسية (major) دون قرار جديد في هذا المجلد.
- Expo SDK لا يُثبَّت الآن؛ يُختار أحدث مستقر عند بدء المرحلة ٤ ويُسجَّل حينها (§١٣.٧ تربط الترقية بتوافق runtime والمخطط).

## الخلفية

| البند | القرار | السبب |
|---|---|---|
| Python | 3.12 | آخر سلسلة مدعومة بالكامل من Django 5 ومكتبات DRF المعتمدة؛ 3.13 لا يضيف ما يحتاجه المشروع |
| Django | 5.x (أحدث LTS/ثابت في السلسلة) | §١٢.١ |
| Django REST Framework | 3.15+ | §١٢.١ |
| مصادقة | `djangorestframework-simplejwt` مثبّت الإصدار | §٩.٤ تسمّيه مثالاً متوافقاً؛ يُختبر التجديد المتزامن (معيار §١٨ ACC-98) |
| OpenAPI | `drf-spectacular` → OpenAPI 3.1 | القسم ١ من الأمر: العقود تُولَّد من DRF |
| PostgreSQL | 16 | RLS وقيود مؤجلة و`REPEATABLE READ` (§٥.٤، §٨.٧)؛ 16 مستقر ومدعوم طويلاً |
| المهام | Celery 5 · Redis 7 · Celery Beat | §١١.٧؛ صحة البيع لا تعتمد عليها |
| إدارة البيئة | `uv` (قفل وتشغيل) | قفل حتمي وسرعة؛ بديل `pip-tools` مقبول إن تعذّر |
| الجودة | `ruff` (lint+format) · `mypy` على `backend/` | فحص آلي في CI |
| الاختبار | `pytest` · `pytest-django` · `pytest-postgresql` أو حاوية Postgres في CI | اختبارات العزل والذرّية تحتاج Postgres حقيقياً لا SQLite (§٥.٤، §٨.٣ قاعدة ٨) |

## الواجهات والحزم المشتركة

| البند | القرار | السبب |
|---|---|---|
| Node | 22 LTS · pnpm 10 · pnpm workspaces | مساحة عمل واحدة لـ`apps/*` و`packages/*` (§٤.٤) |
| TypeScript | 5.x · `strict` | `packages/domain` بلا DOM (§٤.٦) |
| الويب | Next.js 15 (App Router) · React 19 | §١٢.١؛ React 19 هو ما يتطلبه Next 15، ويُشارك نفسه في Vite/Tauri |
| CSS | Tailwind CSS 4 مع `@theme` مولَّد من `handoff/tokens.json` | القسم ١ من الأمر يطلب توليد الرموز من الملف؛ Tailwind 4 يقبل الرموز كمتغيرات CSS مباشرة. **ملاحظة:** README الحزمة يصف tokens.json «مرجعاً للقيم لا مولِّداً»؛ التوليد قرار هذا المستودع، وأي خلاف بين الملف و`02-Design-System` يحكمه الأخير ويُصحَّح في الملف |
| حالة الخادم | TanStack Query 5 | §٤.٥ |
| التخزين المحلي (ويب) | Dexie 4 | §١٢.١، §٨.١٣ |
| الأيقونات | `lucide-react` · `lucide-react-native` | §١٢.١ |
| العقود | `openapi-typescript` + `openapi-fetch` | أنواع وعميل من OpenAPI (§٤.٤) |
| الديسكتوب | Tauri 2 · Vite 6 · React 19 | §١٢.٤: مدخل عميل محلي يستورد `ui-web`، لا تغليف خادم Next |
| الخطوط | Cairo 600/700 · IBM Plex Sans Arabic 400–700 · IBM Plex Mono 400–600 — ملفات محلية (OFL) | القسم ١ من الأمر؛ `02-Design-System`؛ tokens.json DS-1.2 |

## الاختبار والمعرض والفحوص

| البند | القرار | السبب |
|---|---|---|
| وحدات TS | Vitest 2 | خفيف ومتوافق مع Vite وNext |
| عقد التخزين | نفس مجموعة اختبارات العقد تُشغَّل على المحوّل الذاكري ثم Dexie (fake-indexeddb في Vitest **و**IndexedDB حقيقي في Playwright) | §٤.٦ بند ٦: نجاح محول الذاكرة لا يغني عن التخزين الحقيقي |
| متجهات مشتركة | ملفات JSON في `packages/domain/vectors/` تُشغَّل من pytest وVitest | §٤.٤ و§٦.٢: نفس نتيجة الحساب على الطرفين |
| طرف إلى طرف | Playwright 1.4x؛ مساعد «مطابقة الإطار»: نصّ حرفي في كل مقاس + أنماط محسوبة مقابل الرموز عند المقاس الأساسي + لقطات يعتمدها صاحب المشروع | القسم ٣ من الأمر (معيار القبول لكل شاشة) |
| معرض المكوّنات | Storybook 8 (Vite builder) لـ`packages/ui-web` | القسم ٤، المرحلة ٠ بند ٦: «Storybook أو صفحة معرض» |
| إمكانية الوصول | `eslint-plugin-jsx-a11y` + `axe-core` داخل Playwright | قواعد `23-Handoff` §٥ |
| حدود الاستيراد | `dependency-cruiser` بقواعد: `packages/domain` و`sync-core` لا تستورد React/DOM/Next/Expo/Tauri/Dexie/SQLite | §٤.٦ بند ١ و٧ (معيار §١٨ ACC-115) |
| Lint/Format | ESLint 9 (flat) + typescript-eslint · Prettier | فحص آلي في CI |
| CI | ملف workflow واحد يشغّل: ruff · mypy · pytest (مع Postgres) · eslint · tsc · vitest · playwright · dependency-cruiser | القسم ٤، المرحلة ٠ بند ١. **مضيف CI غير محسوم** — انظر `0002` سؤال ٦ |

## ما لا يُضاف

Redux، GraphQL، مكتبات UI جاهزة (MUI/Ant/Chakra)، Turborepo/Nx (لا حاجة مثبتة الآن؛ pnpm workspaces يكفي)، أي محرك بحث خارجي (§٤.٧: البحث الأول في PostgreSQL).
