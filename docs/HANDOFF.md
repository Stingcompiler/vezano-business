# تسليم الجلسة — من يقرأ هذا يبدأ من هنا لا من الصفر

آخر تحديث: 2026-09-16 · آخر فرع: `phase1/t1.1-acc-01-02` (PR #22 على #21) · المرحلة ١ بدأت: T1.1 مُسلَّم

هذه الوثيقة مكتوبة لمنفّذ (Claude Code) يبدأ دردشة جديدة. اقرأها كاملة، ثم اقرأ الملفات المذكورة في §1 بالترتيب، ثم نفّذ §5 حرفياً قبل أي سطر كود.

---

## 0 · الرسالة الأولى المقترحة للدردشة الجديدة

انسخ هذا للمنفّذ الجديد:

> اقرأ `docs/HANDOFF.md` ثم نفّذ ما فيه. لا تعد تصميم شيء؛ كل شاشة من إطارها المرسوم. ابدأ T1.2 بعد اجتياز فحوص §5.

---

## 1 · ما يحكم ماذا (اقرأ بالترتيب)

| # | الملف | لماذا |
|---|---|---|
| 1 | `CLAUDE_CODE_PROMPT.md` (الجذر) — **القسم ٣ (القواعد غير القابلة للتفاوض) والقسم ٤ (بوابة الخروج)** | الأمر الحاكم. لا يُتجاوَز بند فيه |
| 2 | `docs/PLAN.md` — **§٣ المرحلة ١** | جدول المهام T1.1–T1.43 بمراجعها ومعايير إنجازها |
| 3 | `docs/decisions/0002-open-questions-from-reading.md` | **س٤ ما زالت مفتوحة** (انظر §4 أدناه) |
| 3b | `docs/decisions/0005-acc-01-02-frame-conflicts-and-identity.md` | قاعدة تطبيق «بطاقات الحالة» D26، تعارضات D2/D8/D26، نموذج الهوية (Account بعدة عضويات)، وما لم يُرسم في ACC-02 |
| 4 | `docs/decisions/0004-ui-rules-follow-design-system.md` | حلقة التركيز، ارتفاعات اللمس، أحجام النص — محسومة باتباع نظام التصميم |
| 5 | `docs/ARCHITECTURE.md` | البنية المشتقة من v21 (§8 المزامنة، §9 المصادقة، §13 النسخ) |
| 6 | `design_handoff_sting_systems/README.md` + `handoff/states-matrix.csv` | 164 شاشة / 754 زوج شاشة×حالة مرسوم. **الإطار مصدر الحقيقة الوحيد** |
| 7 | `design_handoff_sting_systems/Sting-Systems-v21-Complete.md` | مواصفة الأعمال؛ يُرجَع إليها بالقسم (§) المذكور في PLAN.md |

لا تقرأ المستودع كله؛ اقرأ ما تحتاجه لمهمتك من §3.

---

## 2 · حالة المستودع لحظة التسليم

### الفروع والطلبات

`main` يحوي `.gitignore` الأساسي فقط. كل العمل في **سلسلة طلبات مكدّسة** كل واحد مبني على سابقه:

```
#1  docs/plan-and-design-handoff          → main
#2  phase0/t0.1-repo-skeleton             → main
#3  phase0/t0.2-design-tokens             → #2
#4  phase0/t0.3-domain-money              → #3
#5  phase0/t0.4-domain-qty-effects        → #4
#6  phase0/t0.5-backend-core-isolation    → #5
#7  phase0/t0.6-auth-devices-pin          → #6
#8  phase0/t0.7-sync-push                 → #7
#9  phase0/t0.8-sync-pull-snapshots       → #8
#10 phase0/t0.9-contracts                 → #9
#11 phase0/t0.10-platform-contracts       → #10
#12 phase0/t0.11-dexie-adapter            → #11
#13 phase0/t0.12-sync-core-queue          → #12
#14 phase0/t0.13-sync-core-balance        → #13
#15 phase0/t0.14-ui-web-foundation        → #14
#16 phase0/t0.15-ui-web-input-dialog      → #15
#17 phase0/t0.16-ui-web-tables-lists      → #16
#18 phase0/t0.17-ui-web-financial         → #17
#19 phase0/t0.18-ui-web-market-campaign   → #18
#20 phase0/t0.19-web-bootstrap            → #19
#21 phase0/t0.20-scenario-seed            → #20
#22 phase1/t1.1-acc-01-02                 → #21   ← الرأس الحالي (T1.1: ACC-01 + ACC-02)
```

CI أخضر على كل الطلبات #2–#21 (وظائف `python`/`node`، و`e2e` من #20).

**الدمج مسؤولية المالك** (صنّف الأذونات منع `gh pr merge` من المنفّذ). الترتيب: #1 ثم #2 ثم #3 … #21. بعد كل دمج يعيد GitHub توجيه قاعدة الطلب التالي إلى `main` تلقائياً. إن دُمج الكل: فرع البداية للمرحلة ١ هو `main`؛ وإلا فهو `phase0/t0.20-scenario-seed`.

### ما اكتمل (المرحلة ٠ — 20 مهمة)

| الطبقة | المحتوى | الاختبارات |
|---|---|---|
| `packages/domain` | نقود BigInt (minor) + تقريب half-away، كميات milli + معاملات وحدات، دفتر، آثار، وردية. **مرايا Python** في `backend/core/{money,quantities,ledger,effects,shift}.py` ومتجهات JSON مشتركة في `packages/domain/vectors/` | Vitest + pytest على نفس المتجهات |
| `backend/core` | Tenant/Branch/Device/User/Role/UserBranchAccess/TenantSettings/Session/PinVerifier؛ عزل ثلاثي (RLS بدور `sting_app` + `tenant_context()` fail-closed + FKs مركبة)؛ JWT (تدوير + قائمة سوداء)؛ PIN؛ تسجيل الأجهزة | isolation 21، auth 14 |
| `backend/sync` | PUSH بقواعد القبول العشر (§8)، عدّاد المستأجر (قفل قبل فحص التكرار)، `sync_log`؛ PULL في REPEATABLE READ بمؤشرات (scope, group)؛ AccessManifest؛ Snapshots؛ عدم تطابق epoch → 409 | push 23، pull 14 |
| `packages/contracts` | `openapi.json` + `openapi-typescript` + `openapi-fetch` + اختبار انحراف | drift test |
| `packages/platform` | StoragePort ذرّي، MemoryStorage، DexieStorage، Web Locks، طلب التخزين المستديم، اختبارات عقد مشتركة | contract tests |
| `packages/sync-core` | saveOperation، ترقيم `INV-KRT-A2-26-000001`، إعادة محاولة بتذبذب، pushOnce/applyResults، معادلة الرصيد ①②③، مرشح النسخة وتفعيلها بـ`local_frontier`، applyPullPage، adoptEpoch، pruneVerdict | ✓ |
| `packages/design` | مولّد `tokens.json` → `theme.css` (`@theme{}` + نسخة `:root{}`)، `tokens.ts`، `states.ts` (17 حالة بنصوصها الحرفية)، `fonts.css` + `fonts.faces.css` اختياري | ✓ |
| `packages/ui-web` | **29 مكوّناً** كاملة (Frame, Nav, OrgSwitcher, Button, Status, Field×5, Notice, Dialog, Sheet, Panel, Table, Filter, Pick, TimeList, Upload, DocPreview, Money/MoneyInput/Settlement, QtyUnit, Sync, LedgerLine, Cart, Receive, Print, Phase, Listing/Compare, Quote, OrderTimeline, Audience, Campaign) + Storybook 10 + addon-a11y؛ كل مكوّن له قصة واختبار `expectNoA11yViolations` + `expectNoArabicInMono` | 264 Vitest |
| `apps/web` | Next.js 15.5 App Router، React 19، TanStack Query (بيانات الخادم فقط)، Context للغة/الجلسة/الفرع، `/dev/probe`، Playwright بثلاثة مقاسات 390/834/1440، `e2e/frame-match.ts` | 15 Playwright |
| `tools/frame-text` | مستخرج النصوص الحرفية من الإطارات؛ يثبت اختباره أن **754/754** زوجاً قابل للاستخراج | ✓ |
| `tools/boundaries` | اختبارات سلبية لقواعد dependency-cruiser | ✓ |
| السيناريو | `manage.py scenario reset|wipe`؛ `/api/scenario/{reset,faults}` فقط حين `STING_FAULTS_ENABLED=1` و`STING_ENV∈{development,test,ci}`؛ مفاتيح الأعطال drop_ack / freeze_reconciliation / network_cut / printer_fail | scenario 7 |

المجاميع بعد T1.1: **pytest 237 · Vitest 264 (+1 todo) · Playwright 54 (18 × 3 مقاسات)**.

### ما اكتمل من المرحلة ١

| المهمة | المسارات | الخادم | الاختبار |
|---|---|---|---|
| T1.1 ACC-01 (3) + ACC-02 (7) | `/welcome`، `/login` (خطوات login/verify/manual) | `Account` + `auth/account/login` + `auth/verify/*` + `api/health` + عطل `verify_send_fail` | `apps/web/e2e/acc.spec.ts` بمحاكاة الشبكة؛ `e2e/frame-provenance.ts` يثبت أن كل نص متوقَّع في الإطار |

---

## 3 · الأدوات والأوامر التي تعمل

### التثبيت

```bash
cd /Users/macbookairm1/Documents/vezona-business
git fetch --all && git checkout phase0/t0.20-scenario-seed   # أو main إن دُمجت السلسلة
pnpm install
cd backend && uv sync && uv run python manage.py migrate
STING_ENV=development STING_FAULTS_ENABLED=1 uv run python manage.py scenario reset
cd ../apps/web && pnpm exec playwright install chromium   # مرة واحدة
```

المتطلبات الموجودة على الجهاز: Node 26 (`.nvmrc`=24، engines ≥24)، pnpm 12، Python 3.12 عبر uv 0.12، PostgreSQL 16 (Homebrew، يعمل؛ قاعدة التطوير `sting_dev`).

### الفحص الكامل (يجب أن يخضرّ قبل أي PR)

```bash
pnpm check                      # lint + typecheck + test + boundaries
```
```bash
cd backend && STING_ENV=test STING_FAULTS_ENABLED=1 uv run pytest -q && uv run ruff check . && uv run mypy .
```
```bash
cd apps/web && pnpm exec playwright test
```

### أوامر يُنسى أنها مطلوبة

- **بعد أي تغيير في DRF view/serializer**: `pnpm --filter @sting/contracts generate` — وإلا يفشل اختبار الانحراف.
- **بعد أي تغيير في `tokens.json`**: `cd packages/design && node scripts/generate.ts`.
- **Storybook**: `pnpm --filter @sting/ui-web storybook` / `build-storybook`.
- **استخراج نصوص إطار**: من `tools/frame-text` — `frameTexts("ACC-01","ready")`، `frameTextsAll()` (كل إطارات الزوج)، `drawnStates("ACC-01")`.
- **e2e بلا Django**: الخادم يُحاكى بـ`page.route("**/api/…")` وفق أشكال `@sting/contracts`؛ منطق الخادم في pytest. البوابة T1.43 تشغّل خادماً حقيقياً.
- **بطاقات الحالة (34-D26 وأمثالها)**: عنوان البطاقة = عنوان الحالة، العبارات بين «…» = نصوص واجهة، المبرِّرات لا تُعرض (0005 §١).

### حلقة بناء الشاشة (تُكرَّر لكل شاشة في المرحلة ١)

1. `drawnStates(screenId)` → قائمة الحالات المرسومة وملفاتها.
2. لكل حالة: `frameTexts(screenId, state)` → النصوص الحرفية (`staticTexts` + `scriptTexts`)؛ افتح ملف `dc.html` المذكور واقرأ الإطار نفسه لتعرف التخطيط والمكوّنات.
3. ابنِ الصفحة في `apps/web/src/app/…` من مكوّنات `@sting/ui-web` فقط؛ الجذر يحمل `data-screen="ACC-01" data-state="…"`.
4. اختبار `apps/web/e2e/<screen>.spec.ts` على نمط `probe.spec.ts`: `expectFrame(page, info, {screenId, state, texts, styles})` يمرّ على المقاسات الثلاثة.
5. نقاط نهاية DRF + اختباراتها + تجديد العقود.
6. commit + PR مكدّس على الفرع السابق (`gh pr create --base <previous-branch>`)، ثم تقرير: ما بُني / ما اختُبر / ما بقي — **بلا تقديرات زمنية غير مقاسة**.

### أعطال معروفة وحلولها

| العطل | الحل |
|---|---|
| Prettier يعيد تشكيل النص فتفشل التعديلات النصية الدقيقة | شغّل `pnpm format` قبل أي تعديل مبرمج، أو اكتب الملف كاملاً |
| صنّف الأذونات يمنع `git add -A && git commit` المتسلسلة و`gh pr merge` | قسّم الأوامر؛ الدمج للمالك |
| `timeout` غير موجود على macOS | لا تستخدمه |
| `@theme{}` يُهمَل بلا Tailwind | المولّد يصدر نسخة `:root{}`؛ Tailwind غير مفعّل في `apps/web` بعد (قرار مؤجَّل) |
| `next build` يفشل لغياب ملفات الخطوط | `apps/web/scripts/prepare-fonts.mjs` يولّد `fonts.generated.css` فقط إن وُجدت الملفات |
| `exactOptionalPropertyTypes` | الخصائص الاختيارية تُعلن `?: T \| undefined` |
| jsx-a11y يرفض مستمعي لوحة المفاتيح على عناصر ثابتة | الاختصارات (F6/Escape) على `document` |
| قاعدة «لا عربية داخل mono» | التواريخ والإعلانات المخفية خارج خلايا mono |

---

## 4 · ما ينتظر المالك (لا يستطيع المنفّذ فعله)

| # | البند | يوقف ماذا |
|---|---|---|
| 1 | **دمج السلسلة #1 → #21 بالترتيب** | لا يوقف البدء (يمكن التكديس فوق #21) لكنه يُبسّط كل ما بعده |
| 2 | **إذن تنزيل 8 ملفات خطوط OFL** إلى `packages/design/fonts/` (القائمة في `packages/design/fonts/README.md`: Cairo[slnt,wght].ttf، IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.ttf، IBMPlexMono-{Regular,Medium,SemiBold}.ttf) | مطابقة الأنماط المحسوبة للخط في Playwright؛ حتى ذلك الحين يعمل التطبيق بخط النظام |
| 3 | **قرار 0005 §٣**: أين تُجمع بيانات الحساب (identifier + كلمة مرور) عند «إنشاء منشأة جديدة»؟ وما شاشة كلمة المرور الجديدة بعد رمز الاستعادة؟ | T1.2 (ACC-04) ومسار الاستعادة |
| 4 | **جواب س٤** في `0002`: تعارض ترقيم G-17 — نظام التصميم يقول G-17 = حد الائتمان، وخطة المعالجة تقول G-17 = تشفير النسخة المحلية. التوصية المسجّلة: اتباع ترقيم نظام التصميم + نص المواصفة §13.3 للتشفير + توزيع صريح لردّ المرتجع | **T1.37 (SYS-05/06)** فقط |
| 5 | Expo/Tauri (المرحلة ٤) | لا تبدأ إلا بموافقة كتابية بعد التجربة الميدانية (§١٥.١ مرحلة د) |

مؤجَّلات اختيارية مسجّلة في أجسام الطلبات: `default_transaction_isolation=repeatable read` لاتصال PULL في الإنتاج؛ تفعيل Tailwind في `apps/web`؛ صياغة MK-3؛ قيم `23-Handoff` القديمة في الحزمة لم تُعدَّل (لم يُلمَس في الحزمة سوى `tokens.json` و`README.md`).

---

## 5 · خطوات البدء الفعلية للمنفّذ الجديد

1. **تحقق من الحالة**: `git status` نظيف؛ `gh pr list` يطابق الجدول في §2 (أو دُمجت السلسلة). إن اختلف الوضع، أبلغ المالك قبل المتابعة.
2. **شغّل الفحوص الثلاثة في §3** وتأكد من المجاميع (222 / 264 / 15). فشلٌ هنا يُبلَّغ ولا يُرقَّع.
3. **اقرأ §1 بالترتيب** (القسم ٣ من الأمر إلزامي كاملاً).
4. **أنشئ الفرع**: `git checkout -b phase1/t1.2-acc-03-04` من `phase1/t1.1-acc-01-02` (أو من `main` إن دُمجت السلسلة كلها).
5. **نفّذ T1.2** = ACC-03 (6 حالات: اختيار المنشأة والفرع، يستهلك `select_ticket` و`memberships` من `AppContext.selection`) + ACC-04 (5 حالات: إنشاء المنشأة بوصفة القطاع، العملة نهائية). انتبه: نموذج إنشاء الحساب غير مرسوم (0005 §٣ بند ١) — اسأل قبل اختراعه.
6. بعدها T1.3 … بترتيب PLAN.md: ACC → HOME → CAT → SHIFT → POS → PTY → INV → SYS → WEB → بوابة T1.43. عند أي غموض: توقّف، سجّل في `docs/decisions/000N-*.md`، اسأل.

### القواعد التي تُخالَف عادةً بغير قصد (ذكّر نفسك بها كل مهمة)

- النصوص الحرفية تُنسخ **حرفاً بحرف** من الإطار بما فيها التشكيل وعلامات الترقيم؛ لا تُصاغ ولا «تُحسَّن».
- الحالات: فقط الـ17 المسجّلة، وفقط ما هو مرسوم للشاشة في `states-matrix.csv`. لا تخترع حالة.
- النماذج → `saved_local`؛ القوائم → `pending_sync`. النجاح بعد **الحفظ المحلي** لا بعد الطباعة.
- الأرقام لاتينية في IBM Plex Mono مع `direction:ltr; unicode-bidi:isolate`؛ **لا حرف عربي داخل عنصر mono أبداً**.
- الرصيد المركّب: «خادمي X + معلّق هذا الجهاز Y = Z».
- RTL أولاً بخصائص منطقية فقط (لا `left/right`، لا `outline:none`).
- اللمس ≥44px؛ 46px لأزرار POS على اللوحي (`data-pos`)؛ 56px للفعل المالي على الهاتف (`data-financial`).
- لا تقريب في الواجهة؛ التقريب في `packages/domain` فقط. لا حذف أصول؛ المتوقع مخفي حتى إدخال المعدود؛ النقد فقط في الدرج؛ الدفع المختلط بثلاث وجهات مصرّح بها.
- ميزات M3/M4/عقود التكلفة → `phase_locked` (ظاهرة، معطّلة، بسبب).
- لا Noto/Inter/Roboto؛ الخطوط محلية لا CDN.
- القبول = Playwright مطابقة نصية حرفية على المقاسات الثلاثة + أنماط محسوبة مقابل الرموز عند المقاس الأساسي.
