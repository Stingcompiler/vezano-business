# تسليم الجلسة — من يقرأ هذا يبدأ من هنا لا من الصفر

آخر تحديث: 2026-09-17 · `main` يحوي T0.1–T0.20 وT1.1–T1.13 (PRs #1–#34 مدمجة) · **PR #35 (T1.14: POS-01/02، فرع `phase1/t1.14-pos-01-02`) مفتوح — يُدمج بعد خضرة CI إن لم يكن دُمج** · التالي: T1.15

هذه الوثيقة مكتوبة لمنفّذ (Claude Code) يبدأ دردشة جديدة. اقرأها كاملة، ثم اقرأ الملفات المذكورة في §1 بالترتيب، ثم نفّذ §5 حرفياً قبل أي سطر كود.

---

## 0 · الرسالة الأولى المقترحة للدردشة الجديدة

انسخ هذا للمنفّذ الجديد (كاملاً — هو كل ما يحتاجه ليبدأ من حيث توقفنا):

> أنت تواصل تنفيذ مشروع Sting Systems في `/Users/macbookairm1/Documents/vezona-business` من حيث توقفت جلسة سابقة امتلأت ذاكرتها. ابدأ حرفياً هكذا:
> 1. اقرأ `docs/HANDOFF.md` كاملاً (ترتيب القراءة في §1، الحالة في §2، الأوامر في §3، الفخاخ في §3، خطوات البدء في §5) ثم `docs/decisions/0005-acc-01-02-frame-conflicts-and-identity.md` §١–§١٥ (القرارات والافتراضات المسجّلة).
> 2. `git fetch --all` ثم تحقق من `gh pr list`: إن كان PR #35 (T1.14: POS-01/02، فرع `phase1/t1.14-pos-01-02`) ما زال مفتوحاً وCI أخضر (`gh pr checks 35`) فادمجه بـ`gh pr merge 35 --merge --delete-branch` (المالك أذن بالدمج بعد خضرة CI منذ T1.9)؛ ثم `git checkout -b phase1/t1.15-pos-03-04 origin/main`.
> 3. في worktree جديد: `pnpm install` ثم `cd backend && uv sync && STING_ENV=development STING_FAULTS_ENABLED=1 uv run python manage.py migrate` ثم `cd apps/web && pnpm exec playwright install chromium`.
> 4. تحقق: `pnpm check` (Vitest 322) · `cd backend && STING_ENV=test STING_FAULTS_ENABLED=1 uv run pytest -p no:warnings` (328) · `cd apps/web && pnpm exec playwright test --workers=3` (393؛ في الخلفية؛ وحده لا مع غيره). فشلٌ يُبلَّغ ولا يُرقَّع.
> 5. نفّذ **T1.15** = POS-03 خصم وتجاوز سعر (3 حالات) + POS-04 اختيار عميل وإنشاء سريع (5 حالات) وفق `docs/PLAN.md` §٣ (الصف T1.15: `03-D2#POS-03/04`؛ §٧.٤–٧.٥؛ معيار ACC-12: سقوف الدور القابلة للتحرير G-09 منسوبة للكاشير بلا اتصال، التجاوز يولّد حدث تجاوز يُراجع عند الاتصال، العميل بالاسم فقط إنشاءً سريعاً) على أساس `features/pos/pos-client.tsx` وسلة `sync-core/pos-local.ts` (سطر السلة يحمل السعر المثبَّت — الخصم والتجاوز يُضافان إلى `CartDraftLine`) وHANDOFF §5، بالحلقة: `frameTextsAll` من `tools/frame-text` ← البناء من `@sting/ui-web` فقط بجذر `data-screen`/`data-state` ← Playwright بـ`expectFrame`/`fromFrame` على 390/834/1440 ← commit ← `gh pr create --base main` ← دمج بعد خضرة CI ← التالي بترتيب PLAN.md.
> 6. عند أي غموض أو تعارض بين الإطارات: سجّله ملحقاً جديداً في `docs/decisions/0005` بافتراض معلن واستمر؛ لا تخترع شاشة غير مرسومة.
> 7. قبل أن تمتلئ ذاكرتك: نفّذ `/handoff` (مهارة في `.claude/skills/handoff`) لتحديث هذه الوثيقة والذاكرة وطباعة الرسالة الأولى للدردشة التالية.
>
> القواعد غير القابلة للتفاوض: نصوص حرفية من الإطار بما فيها التشكيل؛ 17 حالة فقط وما هو مرسوم للشاشة في `states-matrix.csv`؛ أرقام لاتينية في `.sting-mono` ولا حرف عربي داخله؛ RTL بخصائص منطقية؛ لمس ≥44px؛ لا تقريب في الواجهة؛ الجلسة في الذاكرة فقط؛ التقرير بعد كل تسليم: ما بُني/ما اختُبر/ما بقي بلا تقديرات زمنية.

---

## 1 · ما يحكم ماذا (اقرأ بالترتيب)

| # | الملف | لماذا |
|---|---|---|
| 1 | `CLAUDE_CODE_PROMPT.md` (الجذر) — **القسم ٣ (القواعد غير القابلة للتفاوض) والقسم ٤ (بوابة الخروج)** | الأمر الحاكم. لا يُتجاوَز بند فيه |
| 2 | `docs/PLAN.md` — **§٣ المرحلة ١** | جدول المهام T1.1–T1.43 بمراجعها ومعايير إنجازها |
| 3 | `docs/decisions/0002-open-questions-from-reading.md` | **س٤ ما زالت مفتوحة** (انظر §4 أدناه) |
| 3b | `docs/decisions/0005-acc-01-02-frame-conflicts-and-identity.md` | قاعدة تطبيق «بطاقات الحالة» D26، تعارضات D2/D8/D26، نموذج الهوية (Account بعدة عضويات)، وملاحق كل مهمة T1.x (§٥–§١٧) بافتراضاتها |
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
#22–#32 phase1/t1.1 … t1.11              → main (كل واحد دُمج بعد خضرة CI)
#33 phase1/t1.12-shift-03-04              → main (مدمج)
#34 phase1/t1.13-shift-05                 → main (مدمج)
#35 phase1/t1.14-pos-01-02                → main (مفتوح عند التسليم — **ادمجه أولاً بعد خضرة CI**)
```

**كل ما سبق مدمج في `main` عدا #35.** فرع البداية للمهمة التالية هو `main` بعد دمج #35؛ الفروع القديمة محذوفة. الدمج من المنفّذ مأذون به بعد خضرة CI (منذ T1.9).

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

المجاميع بعد T1.14: **pytest 328 · Vitest 322 (+1 todo) · Playwright 393 (131 × 3 مقاسات)**.

### ما اكتمل من المرحلة ١

| المهمة | المسارات | الخادم | الاختبار |
|---|---|---|---|
| T1.1 ACC-01 (3) + ACC-02 (7) | `/welcome`، `/login` (خطوات login/verify/manual) | `Account` + `auth/account/login` + `auth/verify/*` + `api/health` + عطل `verify_send_fail` | `apps/web/e2e/acc.spec.ts` بمحاكاة الشبكة؛ `e2e/frame-provenance.ts` يثبت أن كل نص متوقَّع في الإطار |
| T1.2 ACC-03 (6) + ACC-04 (5) | `/select-org`، `/create-org` | `Unit`/`PaymentMethod`/`TenantCreation`، وصفة البقالة، `account/memberships|select`، `tenants` (متكرّر الأثر) | `e2e/acc-org.spec.ts` |
| T1.3 ACC-05 (6) | `/setup-device` | `BootstrapImage/Page` (نسخة مادية بصفحات مجمّدة)، `devices/register|renew`، `bootstrap/*` | `sync-core/bootstrap.ts`؛ `e2e/acc-setup.spec.ts` (IndexedDB حقيقي) |
| T1.4 ACC-06 (5) + ACC-07 (4) | `/invite/[token]`، `/lock` | `Invitation`، `invites/*`، `devices/verifiers` | `sync-core/pin.ts` (PBKDF2 عبر WebCrypto، قفل 5/15)؛ `e2e/acc-invite-lock.spec.ts` |
| T1.5 ACC-08 (5) + ACC-09 (6) | `/session-expired`، `/account/sessions` | `Session.reported_pending/revoke_after_upload`، `account/sessions[/{id}/revoke]`، `pending_after` في PUSH | حارس 401 في Providers؛ `e2e/acc-session.spec.ts` |
| T1.6 ACC-10 (6) | `/onboarding` | `tenants/onboarding` (GET/PATCH؛ الشعار ≤2MB) | `e2e/acc-onboarding.spec.ts` |
| T1.7 HOME-01 (6) + HOME-02 (5) + HOME-03 (5) | `/` (مالك/موظف)، `/search` | `core/home.py` سجلّ مزوّدين (`HOME_PROVIDERS`/`SEARCH_PROVIDERS`)، `home|search|notices` | `platform.listProjections`؛ `e2e/home.spec.ts` |
| T1.8 CAT-01 (5) + CAT-06 (4) | `/catalog`، `/catalog/groups` | تطبيق `catalog` (Item/ItemGroup/ItemUnit/ItemAlias)، `sync/reference.py` (مرجعيات خادمية في sync_log/PULL/النسخة) | `domain/search.ts` + مرآة Python بمتجهات؛ `sync-core/catalog-local.ts`؛ `e2e/catalog.spec.ts` |
| T1.14 POS-01 (6) + POS-02 (3) | `/pos` | `GET catalog/balances` من `catalog.services.BALANCE_PROVIDERS` (INV يسجّله) | `sync-core/pos-local.ts` (أرصدة `entity:inventory.Balance:*` بآخر مطابقة، صفوف صنف × وحدة، مسودّة السلة `pos.cart`/`pos.held`، `checkQty`)؛ `ui-web.Cart` بـ`onStep`/`summary`؛ `frame-text` يضمّ أسطح D37/D38؛ `features/pos/{pos-client,unit-sheet,empty-search,pos-nav}.tsx` + `lib/use-media.ts`؛ `e2e/pos.spec.ts` |
| T1.13 SHIFT-05 (5) | `/shifts/review` | `CashAdjustment` (§١٠.٣) + `ShiftCashMovement.received_at`؛ نوع PUSH `cash_adjustment` (نطاق الفرع) ومُطبِّقه؛ `LATE_DOCUMENT_PROVIDERS` (POS يسجّل البيع النقدي المتأخر)؛ `GET shifts/review` (المالك كل الفروع/غيره فرعه؛ ترتيب بالقيمة خادمي؛ مدى أسبوع؛ المهجورة ≥24س) و`POST shifts/{id}/review` (403 لغير المالك؛ السبب إلزامي مع فارق؛ `shift_open` للمفتوحة) | `sync-core.readPendingClosedShifts`؛ `tools/frame-text` يكتشف الرسمة الثانية للزوج (15-D10 لـSHIFT-05/conflict)؛ `features/shifts/review-client.tsx`؛ `e2e/shifts-review.spec.ts` |
| T1.12 SHIFT-03 (4) + SHIFT-04 (5) | `/shifts/movements`، `/shifts/close` | `sync/kinds.py`: `cash_movement` بثلاثة أنواع وعكس بالإشارة المضادّة وسبب إلزامي؛ `shift_close` (ShiftClosed + CashCounted بالفئات)؛ مُطبِّقات الإسقاط للعدّ والإقفال (اللقطة ثابتة؛ حركة متأخرة لا تعدّلها)؛ `shifts/{id}/requests` «اطلب من المالك»؛ `can_withdraw`/`owner_name` في `shifts/current` | `sync-core/shift-local.ts`: `saveCashMovement` (رقم محلي مثبَّت في الحدث، عكس)، `closeShiftLocally` (اللقطة + المعدود + إغلاق `shift.open`)؛ `features/shifts/movements-client.tsx`، `close-client.tsx` (المتوقَّع لا يُحسب ولا يُطلب قبل تأكيد العدّ)؛ `e2e/shifts-cash.spec.ts` |
| T1.11 SHIFT-01 (5) + SHIFT-02 (5) | `/shifts/open`، `/shifts/current` | تطبيق `shifts` (إسقاط `Shift`/`ShiftCashMovement` يُبنى داخل قبول PUSH عبر `sync/appliers.py`)، `shifts/current` و`shifts/{id}`، مزوّد الرئيسية `shift`، `CASH_EFFECT_PROVIDERS` لـPOS/PTY | `sync-core/shift-local.ts` (فتح محلي = عملية `shift_open` + إسقاط + meta `shift.open`؛ صفوف الوردية والمتوقَّع من المجال) + اختبار Dexie؛ `lib/sync.ts` ناقل الرفع المشترك؛ `features/shifts/*`؛ `e2e/shifts.spec.ts` (IndexedDB حقيقي) |
| T1.10 CAT-04 (4) + CAT-05 (6) | `/catalog/[id]/price`، `/catalog/import` | `catalog/prices.py`: `ItemPrice` (سلسلة تواريخ؛ هجرة سطر أول لكل صنف)، `PriceChangeRequest`، `PriceImportBatch` (بصمة الملف = هوية؛ تطبيق على دفعات واستئناف وتراجع 24س)؛ نقاط `items/{id}/price`، `price-request`، `prices/import/preview|{b}|apply|revert|rejected.csv`؛ سجلّات `COST_PROVIDERS`/`PRICE_USAGE_PROVIDERS`/`BULK_PRICING_BLOCKERS` | `features/catalog/price-client.tsx` + `import-client.tsx`؛ `e2e/catalog-prices.spec.ts` |
| T1.9 CAT-02 (4) + CAT-03 (3) | `/catalog/new`، `/catalog/[id]`، `/catalog/[id]/units` | `catalog/limits.py` (ACC-25: رفض بكل الأخطاء معاً)، `Unit.decimal_places`، `Item.image_data_url`، `ItemUnit.barcode`، `ItemUnitFactorChange` (ACC-19)، نقاط `catalog/units|barcode|items/{id}[/image|/units[/{iu}]]`، سجلّا مزوّدين `FACTOR_USAGE_PROVIDERS`/`ITEM_MOVEMENT_PROVIDERS` | `domain.fromBaseQtyMilliForDisplay` بمتجه؛ `features/catalog/item-form.tsx` + `item-errors.ts` + `units-client.tsx`؛ `e2e/catalog-item.spec.ts` |

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
- **بطاقات الحالة (34-D26 وأمثالها)**: عنوان البطاقة = عنوان الحالة، العبارات بين «…» = نصوص واجهة، المبرِّرات لا تُعرض (0005 §١). `fromFrame()` يقبل النص من أي إطار مرسوم للشاشة نفسها.
- **الجلسة في الذاكرة فقط**: اختبارات e2e تنتقل عميلياً (`AppNav`، `?next=` في الدخول) — `page.goto` بعد الدخول يفقد الجلسة. `devIndicators` معطّل في next.config (الزر العائم كان يعترض النقر في 390).
- **مزوّدو الرئيسية والبحث**: كل وحدة جديدة (POS/PTY/INV) تسجّل مزوّدها في `core/home.py` ومحلّل مرجعياتها في `sync/reference.py` (انظر `catalog/providers.py` نموذجاً).
- **المرجعيات الخادمية** (كتالوج/أطراف): كل كتابة تمرّ بـ`log_reference()` داخل معاملة وإلا لا تصل الأجهزة.
- **الرفض المضبوط (ACC-25)**: أخطاء النماذج الخادمية `400 {detail:"validation_error", errors:[{field,code,limit,actual}]}` بكل الأخطاء معاً؛ الواجهة تصوغ النص من `features/catalog/item-errors.ts` (نصوص الحدود مؤقتة حتى تُرسم — 0005 §١٢).
- **مزوّدو الاستعمال**: POS تسجّل `catalog.services.FACTOR_USAGE_PROVIDERS` (سطور البيع بمعامل وحدة) و`catalog.prices.PRICE_USAGE_PROVIDERS` (بيع بسعر — يمنع تراجع الدفعة)؛ INV/POS `ITEM_MOVEMENT_PROVIDERS` (قفل الوحدة الأساسية)؛ INV/PUR `catalog.prices.COST_PROVIDERS` (متوسط التكلفة — «سعر دون التكلفة»)؛ ORG `BULK_PRICING_BLOCKERS` (§١١.٢) — حتى ذلك الحين صفر/فارغ.
- **إسقاطات الخادم من PUSH**: كل وحدة تسجّل `sync.appliers.register_applier(entity, fn)` — يُستدعى داخل معاملة القبول؛ متكرّر الأثر. الحفظ المحلي: مُسقِط `saveOperation` لا يستدعي دالة async مساعدة تحت Dexie (PrematureCommitError) — كل await على المعاملة مباشرةً.
- **الرفع من الشاشات**: `lib/sync.ts::pushPending()` (ناقل مشترك) بعد كل حفظ محلي حين يوجد اتصال.
- **كل كتابة سعر** تمرّ بـ`catalog.services.record_price` (سطر في `ItemPrice` + إغلاق الساري) — لا تكتب `Item.sale_price_minor` مباشرة.
- **pytest `testpaths`** في `backend/pyproject.toml` يجب أن يضم كل تطبيق جديد (كانت `catalog` خارجه).
- **مجموعة الفحص الكاملة تتجاوز 10 دقائق**: شغّل Playwright في الخلفية أو ملفاً ملفاً.
- **رسمة ثانية للزوج نفسه** (قسم `id="SCREEN"` في ملف آخر يحمل سطر المرجع `P/SCREEN/VP/state`): `frameTextsAll` يكتشفها تلقائياً فتدخل نصوصها في `fromFrame` (15-D10 لـSHIFT-05). سجّلها في 0005 حين تعتمد عليها.
- **الأرقام في بيانات السكربت** (`'22,440.00'`) لا يستخرجها `frame-text` — تُفحص بـ`toContainText` خارج `fromFrame`.
- **فتح صف الجدول** (`Table.onOpenRow`) نقر مزدوج/Enter فقط — للّمس ضع زرّاً في الخلية (`Button variant="quiet"`).
- **`responses={200: None}`** في DRF يولّد `content?: never` فيصير `data` من `openapi-fetch` من نوع `never`: اكتب `const body: Shape | undefined = data` (لا `as` — eslint يرفضه) للـGET، و`as unknown as` للـPOST.
- **نوع PUSH جديد** يحتاج ثلاثة مواضع: `sync/kinds.py` (register)، `sync/scopes.py` (`ENTITY_SCOPES`)، ومُطبِّقه في `providers.py` للوحدة — نسيان النطاق يرمي `has no scope mapping`.
- **إسقاطات بتوقيت متساوٍ** (`occurred_at` نفسه) ترتيبها بالـuuid4 عشوائي — الاختبارات تعطي أوقاتاً مختلفة.
- **أسطح D37/D38** (تابلت POS 834…) غير موسومة في المصفوفة: `frameTextsAll` يضمّ قسم S-nn الذي يذكر الشاشة، فتُقبل نصوصه في `fromFrame`؛ نصوص `renderVals()` في 03-D2 (بيانات الأصناف) لا تُستخرج — تُفحص بـ`toContainText`.
- **`page.reload()` يُفقد الجلسة** (في الذاكرة فقط) — للتحقق من المسودّات اقرأ IndexedDB بـ`page.evaluate`.
- **axe**: رأس جدول فارغ مرفوض (`empty-table-header`)، ومستوى العناوين يجب ألا يقفز (h2 قبل h3).
- **POS على التابلت**: `useMedia("(max-width: 1199px)")` يبدّل الجدول إلى بلاطات؛ الاختبار يفرّع على `page.viewportSize()`.

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
| 3 | **قرار 0005 §٣**: أين تُجمع بيانات الحساب (identifier + كلمة مرور) عند «إنشاء منشأة جديدة»؟ وما شاشة كلمة المرور الجديدة بعد رمز الاستعادة؟ | ACC-04 ومسار الاستعادة (مطبَّقان بافتراض) |
| 3b | **تعارضات مسجّلة تنتظر حسمك** في 0005: عمر رمز التحقق 5/10 دقائق (§٢)، قفل PIN 5/10 محاولات (§٧)، قائمة خطوات المعالج D2/D26 (§٩)، الأدوار المؤقتة حتى G-09 (§١٠) | لا يوقف شيئاً — القيم في مكان واحد لكل منها |
| 4 | **جواب س٤** في `0002`: تعارض ترقيم G-17 — نظام التصميم يقول G-17 = حد الائتمان، وخطة المعالجة تقول G-17 = تشفير النسخة المحلية. التوصية المسجّلة: اتباع ترقيم نظام التصميم + نص المواصفة §13.3 للتشفير + توزيع صريح لردّ المرتجع | **T1.37 (SYS-05/06)** فقط |
| 5 | Expo/Tauri (المرحلة ٤) | لا تبدأ إلا بموافقة كتابية بعد التجربة الميدانية (§١٥.١ مرحلة د) |

مؤجَّلات اختيارية مسجّلة في أجسام الطلبات: `default_transaction_isolation=repeatable read` لاتصال PULL في الإنتاج؛ تفعيل Tailwind في `apps/web`؛ صياغة MK-3؛ قيم `23-Handoff` القديمة في الحزمة لم تُعدَّل (لم يُلمَس في الحزمة سوى `tokens.json` و`README.md`).

---

## 5 · خطوات البدء الفعلية للمنفّذ الجديد

1. **تحقق من الحالة**: `git status` نظيف؛ `gh pr list` يطابق الجدول في §2 — PR #35 إن كان مفتوحاً وأخضر فادمجه. إن اختلف الوضع، أبلغ المالك قبل المتابعة.
2. **شغّل الفحوص الثلاثة في §3** وتأكد من المجاميع (pytest 328 / Vitest 322 / Playwright 393 — شغّل Playwright وحده وبـ`--workers=3` على هذا الجهاز؛ تشغيله مع pytest/Vitest يجوّعه فتسقط اختبارات بمهلات). فشلٌ هنا يُبلَّغ ولا يُرقَّع.
3. **اقرأ §1 بالترتيب** (القسم ٣ من الأمر إلزامي كاملاً).
4. **أنشئ الفرع**: `git checkout -b phase1/t1.15-pos-03-04` من `main`.
5. **نفّذ T1.15** = POS-03 خصم وتجاوز سعر (3) + POS-04 اختيار عميل وإنشاء سريع (5) وفق PLAN.md §٣ (`03-D2#POS-03/04`؛ §٧.٤–٧.٥؛ معيار ACC-12): سقوف الخصم من الدور (G-09 مؤقتاً في `core/home.py`) قابلة للتحرير؛ التجاوز حدث `price_override` يُنسب للكاشير ويُراجع عند الاتصال؛ الخصم على `CartDraftLine`/السلة في `pos-local.ts`؛ العميل طرف محلي (`entity:parties.Party:*` — تطبيق `parties` الخادمي يبدأ هنا أو مع PTY-01) بإنشاء سريع بالاسم فقط. بعده T1.16 خط حفظ البيع (`sale` بأعضائه في معاملة محلية واحدة، رقم الفاتورة، يسجّل `CASH_EFFECT_PROVIDERS`/`LATE_DOCUMENT_PROVIDERS`/`FACTOR_USAGE_PROVIDERS`/`PRICE_USAGE_PROVIDERS`/`ITEM_MOVEMENT_PROVIDERS` ومزوّدي الرئيسية والبحث، وسطور البيع في `readShiftCash` عبر `extraRows`) — السيناريو الموحَّد ١٠٠ = ٤٠ نقداً + ٦٠ آجلاً (ACC-08) يظهر في POS-07 وSHIFT-02 وPTY-05.
6. بعدها T1.16 … بترتيب PLAN.md: ACC → HOME → CAT → SHIFT → POS → PTY → INV → SYS → WEB → بوابة T1.43. عند أي غموض: توقّف، سجّل في `docs/decisions/000N-*.md`، اسأل.

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
