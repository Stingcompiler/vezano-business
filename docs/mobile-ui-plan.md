# خطة واجهة الجوال — المرحلة ١: مراجعة المشروع

> **الحالة**: تقرير المرحلة ١ — **بانتظار مراجعة المالك**. المرحلة ٢ (الخطة) لم تبدأ، ولا تنفيذ.
> **المصدر الوحيد للحقيقة**: كود الويب في `main` بتاريخ 2026-10-17 (بعد #180). الخطة القديمة والإطارات مرجع للمقارنة فقط.
> **المهمة**: `mobile-ui-plan-prompt.md` من المالك.

## اتجاه التصميم (موجز — يُفصَّل في المرحلة ٢)

- **تطابق وظيفي إلزامي، لا تطابق شكلي**: كل شاشة وحقل وقاعدة وحالة وصلاحية ومصطلح في الويب موجود على الجوال. التخطيط والتفاعل يتكيّفان مع الهاتف (الجداول قوائم بطاقات، الحوارات أوراق سفلية)، وكل انحراف عن تخطيط الويب يُكتب سببه.
- **المرجع البصري**: إرشادات Apple HIG (عناوين كبيرة، شريط تبويب سفلي، أوراق، إجراءات السحب، لمس ≥ 44pt، حركة هادئة)، بمظهر واحد على iOS وAndroid مع احترام أعراف كل منصة (زر الرجوع في Android، المناطق الآمنة، الاهتزاز اللمسي).
- **الهوية من الويب لا من جديد**: الرموز من `packages/design` (الكحلي والتركوازي، Tajawal وIBM Plex Mono، شعار «فيزانو بلص» بخط Reem Kufi)، والمصطلحات والنصوص من الويب كما هي.
- **ممنوع القالب المولَّد** (قاعدة المالك §١٥٨–§١٥٩): لا شريط ملوّن على البطاقات، لا أيقونة في دائرة مصبوغة، لا كرت لكل رقم، لا تدرّجات، لا حركة مستمرة.
- **ثوابت المشروع تبقى**: عربية من اليمين بخصائص منطقية، أرقام لاتينية بخط mono معزول الاتجاه، الحالات الـ17 المسجَّلة فقط، والبيع يعمل بلا اتصال.

---

## ⚠️ ما يجب أن تعرفه قبل القراءة — ثلاث حقائق تغيّر فرضية المهمة

1. **لا يوجد تطبيق جوال في المستودع.** لا `apps/mobile`، ولا اعتماد على Expo أو React Native في أي `package.json`، ولا فرع ولا مستودع آخر يحويه (بحثت في كل الفروع وفي `~/Documents`؛ `vezano-pro` منتجك الآخر ولا جوال فيه). كذلك **تطبيق الحاسوب (Tauri) غير موجود**. فالقائمة ٢ أدناه كلها من الصنف (د) «غير موجود على الجوال»، ولا «شاشات قديمة تُستبدل».
2. **«الخطة القديمة» للجوال موجودة كخطة فقط**: صفوف المنصة `M` في `design_handoff_sting_systems/handoff/states-matrix.csv` (135 شاشة × 645 حالة بمقاس 390، منها 594 **غير مرسومة**)، وشاشات NAT-01…04، ومرحلة «د» في `docs/PLAN.md`، وقسم الموبايل في `CLAUDE_CODE_PROMPT.md` و`docs/ARCHITECTURE.md` (Expo + expo-sqlite + expo-secure-store).
3. **بوابة قائمة**: `CLAUDE_CODE_PROMPT.md` و`docs/PLAN.md` (§١٥.١ مرحلة د) يشترطان **موافقتك الكتابية بعد التجربة الميدانية** قبل بدء Expo، والتجربة الميدانية مؤجّلة بأمرك (0005 §١٥٦). هذه المهمة تنتهي بخطة فلا تخالف البوابة، لكن التنفيذ لاحقاً يحتاج قراراً صريحاً منك (السؤال ١ في الخاتمة).

---

## القائمة ١ — كل مسارات الويب (176 مساراً، 161 شاشة)

**الأرقام**: 176 صفحة `page.tsx` في `apps/web/src/app`، تعرض 161 معرّف شاشة (`data-screen`)، وتستدعي **281 نقطة API مختلفة** (من أصل 269 مساراً خادمياً — الفرق طرق متعددة على المسار نفسه). نقاط المصادقة والمزامنة (`/api/auth/*`، `/api/sync/*`) تُستدعى من `apps/web/src/lib` لا من الشاشات، فلا تظهر في الجدول.

| الجمهور | عدد المسارات | الأمثلة |
|---|---|---|
| مستخدم منشأة (مالك/مدير/كاشير/أمين مخزن/دور مخصّص) | 127 | البيع، الوردية، الذمم، الكتالوج، المخزون، الشراء، التقارير، السوق، الإشعارات، المنشأة، الأجهزة والمزامنة |
| عام بلا جلسة (والرئيسية `/` للزائر) | 15 | الهبوط، الباقات، الشروط، الحالة، تصفّح السوق، طلب الجولة ومتابعته، صفحات الخطأ |
| حساب/جهاز (قبل دخول منشأة) | 10 | الترحيب، الدخول، التسجيل، الدعوة، اختيار/إنشاء منشأة، الإعداد الأول، تجهيز الجهاز، قفل PIN، الجلسات |
| مشغّل المنصة (فريق فيزانو) | 18 | `/platform/*`: النظرة العامة، المستأجرون، الاشتراكات، الباقات، طلبات الجولة، التحقق، البلاغات، الصحة، النسخ |
| زبون المحل (رابط/QR بلا حساب) | 5 | `/portal/*`: صفحة المحل، الاشتراك بالتنبيهات، الرسائل، التفضيلات |
| تطوير فقط | 1 | `/dev/probe` |

### نموذج الأدوار والصلاحيات (كما في الكود)

- **أربعة أدوار نظامية** (`backend/core/org.py::ROLE_ORDER`): مالك، مدير، كاشير، أمين مخزن — وأدوار مخصّصة تُنشأ من ORG-03.
- **مصفوفة ORG-02 (13 صلاحية قابلة للتحرير)**: البيع، الخصم (حدّ للعملية)، المرتجع (حدّ)، رؤية الذمم (كل/فرع/عملاؤه)، تسجيل السداد (كل/نقد فقط)، إغلاق وردية بعجز (حدّ)، تسوية جرد (نعم/فرع/اقتراح)، إنشاء حملة، اعتماد حملة، اعتماد مستند شراء (حدّ)، نشر في السوق، رؤية التكلفة والهامش، مراجعة التعارض.
- **المصادقة على مستوى العرض** (271 مساراً خادمياً فُحصت آلياً): `tenant_session_required` (138)، `is_owner`/`owner_required` (≈80 موضع)، `operator_required` (31)، `AllowAny` (35)، `device_session_required` (11)، `can_see_finance` (12).
- **الواجهة لا تُخفي عناصر التنقل حسب الدور**: كل البنود ظاهرة في `features/home/app-nav.tsx`، والخادم يقرر، والشاشة تعرض حالة `permission_denied` بنصّها (117 شاشة تتعامل معها) أو سبب تعطيل الزر. **على الجوال أن يحاكي هذا بالضبط** أو يُتّخذ قرار بإخفاء المحجوب (السؤال ٤).

> الجدول الكامل لكل مسار (المسار، الشاشة، الغرض، من يصل، المكوّن، النقاط) في **الملحق أ** آخر الوثيقة. عمود «من يصل» مستخرج من فحوص العروض الخادمية؛ الصلاحيات الدقيقة لكل إجراء تُفحص داخل الخدمات وتصل الواجهة كـ`permission_denied`.

---

## القائمة ٢ — شاشات الجوال الحالية ومقابلها في الويب

| الصنف | العدد | التفصيل |
|---|---|---|
| (أ) يطابق الويب | **0** | لا شاشات جوال |
| (ب) قديم — يُستبدل | **0** | لا شاشات جوال |
| (ج) بلا مقابل في الويب — قرار | **4 مخطَّطة** | NAT-01 أذونات الكاميرا والباركود، NAT-02 الطابعة وBluetooth، NAT-03 الإشعارات والرابط العميق، NAT-04 التحديث والأسرار والنسخة الاحتياطية. شاشات أصلية بحتة في الخطة القديمة لا وجود لها في الويب (الويب يعتمد كاميرا المتصفح والطباعة عبر المتصفح وWeb Push وService Worker) |
| (د) غير موجود على الجوال | **176 مساراً / 161 شاشة** | كل مسارات الويب. **تحتاج قراراً في النطاق** قبل الخطة: |

**مقترحات نطاق تحتاج قرارك** (لا أحسمها):
- **لوحة المشغّل** `/platform/*` (18): أداة فريق فيزانو على الحاسوب غالباً. اقتراحي: تبقى ويباً.
- **بوابة زبون المحل** `/portal/*` (5): زبون المحل يفتحها برابط أو QR بلا تثبيت تطبيق. اقتراحي: تبقى ويباً (ليست لصاحب المحل).
- **الصفحات العامة التسويقية** (الهبوط، الباقات، الشروط، الحالة، طلب الجولة): موقع لا تطبيق. اقتراحي: تبقى ويباً، والتطبيق يفتحها بمتصفح داخلي عند الحاجة.
- **شاشات مرتبطة بالمتصفح**: `/install` (تثبيت PWA)، `/print` (طباعة المتصفح)، `/sync/update` (Service Worker)، `/sync/storage` (حصة IndexedDB) — تُستبدل على الجوال بمقابلات NAT-01…04 لا تُنسخ.
- **الباقي — تطبيق صاحب المحل وموظفيه (≈138 مساراً: 127 للمنشأة + 10 للحساب والجهاز + الرئيسية)** هو النطاق الطبيعي للجوال.

---

## القائمة ٣ — المنطق المشترك: ما يُشارَك وما ينقص

| المجال | أين في الويب | قابل للمشاركة مع الجوال؟ | حالته للجوال |
|---|---|---|---|
| **عميل API** | `packages/contracts` (openapi-fetch مولَّد من OpenAPI) + `apps/web/src/lib/api.ts` (العنوان والرموز والتجديد) | الحزمة نعم (لا DOM). `lib/api.ts` لا (يعتمد Cookie والمتصفح) | الحزمة جاهزة؛ الغلاف يُكتب للجوال |
| **الأنواع** | `packages/contracts/src/generated/schema.ts` | نعم | ⚠️ **ناقصة فعلياً**: 287 تحويل `as unknown as` في الويب و367 واجهة TypeScript محلية داخل الشاشات، لأن ردود كثيرة غير موصوفة في العقد (`responses={200: None}` وأشباهها). الجوال سيكرر هذه الواجهات ما لم تُوصف الردود في الخادم أولاً |
| **التحقق** | الخادم مصدر الحقيقة (رموز خطأ مثل `whatsapp_invalid`)؛ تحقق محلي مكتوب داخل كل شاشة؛ المال والكميات في `packages/domain` | `packages/domain` نعم؛ تحقق الشاشات لا (مدمج في JSX) | لا مكتبة مخطّطات مشتركة (لا zod أو ما شابه) — كل قاعدة تحقق في الواجهة يجب نقلها يدوياً أو استخراجها |
| **التنسيق** | `packages/domain` (المال والتقريب والكميات والبحث)؛ مساعدات محلية: `features/home/format.ts`، `features/public/money.ts`، `plan-lines.tsx`، `ui-web/components/format.ts` | الحزمة نعم؛ المحلية تحتاج نقلاً إلى حزمة | جزئي |
| **النصوص والمصطلحات** | مكتوبة حرفياً داخل JSX في كل شاشة (قاعدة «النص الحرفي من الإطار»)؛ لا ملف ترجمة ولا فهرس نصوص | لا | ⚠️ **أكبر فجوة**: التطابق في المصطلحات يتطلب استخراج النصوص إلى حزمة مشتركة، وإلا كُتبت مرتين وتباعدت |
| **إدارة الحالة** | React state محلي + `lib/app-context.tsx` (الجلسة والرموز في الذاكرة) — لا مكتبة حالة | النمط نعم، الكود لا | يُكتب للجوال |
| **التخزين المحلي** | `packages/platform` (عقود التخزين + محوّل Dexie/IndexedDB + محوّل الذاكرة + اختبارات عقد) | العقود والاختبارات نعم | ينقص محوّل SQLite (expo-sqlite) — مخطَّط في ARCHITECTURE |
| **المزامنة** | `packages/sync-core` (بروتوكول PUSH/PULL، الحفظ المحلي، الأرصدة، النسخ — بلا DOM) + `lib/sync.ts` (غلاف الويب) | الحزمة نعم | الحزمة جاهزة؛ الغلاف يُكتب |
| **المصادقة والجلسة** | الجلسة في الذاكرة، والتجديد بـCookie `HttpOnly` (`/api/auth/remember` و`/resume`)، قفل PIN، القفل بعد الخمول (`lib/idle-lock.tsx`)، تسجيل الجهاز | لا | ⚠️ **يحتاج تغييراً خادمياً**: التطبيق الأصلي لا يعتمد Cookie المتصفح؛ يلزم مسار تجديد برمز في `expo-secure-store` (السؤال ٥) |
| **الرموز والخطوط** | `packages/design` (tokens.json → CSS مولَّد، الحالات الـ17 بنصوصها) | الرموز نعم (توليد ملف RN من tokens.json) | ينقص مولّد للجوال |
| **المكوّنات** | `packages/ui-web` — 30 مكوّناً React DOM | لا (DOM) | تُبنى بمقابلات React Native |
| **الطباعة والكاميرا والإشعارات** | طباعة المتصفح، كاميرا المتصفح للباركود، Web Push (VAPID)، Service Worker | لا | NAT-01…04 |

---

## القائمة ٤ — الفروق بين الخطة القديمة والويب الحالي

### أ. شاشات في الويب لم تكن في الخطة القديمة للجوال
- **غير موجودة في مصفوفة الحالات إطلاقاً** (أُضيفت بأمرك أثناء البناء): PLT-00 النظرة العامة للمشغّل، PLT-14 طلبات الجولة، PLT-15 حسابات المشغّلين، PLT-16 كتالوج الباقات، PLT-17 تغيير كلمة مرور المشغّل، PUB-05 صفحة الباقات والمقارنة، PUB-06 متابعة طلب الجولة.
- **في المصفوفة لكن بلا صفوف جوال**: CUS-01…05 (بوابة الزبون)، PLT-01…12 (المشغّل)، PUB-01…04 (العامة)، WEB-01…03 (تثبيت/إشعار/طباعة الويب) — أي أن الخطة القديمة كانت تفترض الجوال لتطبيق المحل وحده.

### ب. شاشات في الخطة القديمة ليست في الويب
- NAT-01…04 (أصلية فقط — انظر القائمة ٢ (ج)).

### ج. تغييرات سلوك وتصميم بعد الإطارات (0005 §٩٢–§١٦٠ — كلها بأمرك، ولم تنعكس في صفوف `M`)
- **الهوية**: الاسم «فيزانو بلص» (§١٣١)، خط الشعار Reem Kufi (§١٣٢)، الشعار «ف» (§١٣٣)، نظام تصميم موحّد فاتح/داكن وهوية vezano-site (§٩٣، §١٠٧، §١٠٩)، ألوان الحالات في الداكن (§١٠٣).
- **التنقل**: شريط أفقي على الهاتف (§٩٤)، درج جانبي (§١١٣)، مجموعات قابلة للطي بترتيب الاستعمال (§١٣٤).
- **الحساب والدخول**: التسجيل بالبريد وحده (§١٤٩) مع واتساب إلزامي (§١٥٠)، خانات رمز التحقق (§١٤٦)، إظهار كلمة المرور (§١٤١)، بقاء الجلسة بعد إعادة التحميل وبلا اتصال (§١٢١)، منطق القفل (§١٢٠)، زر الخروج (§١٢٢)، إلغاء التحقق الثنائي للمشغّل (§١٠٨).
- **الاشتراك والفوترة** (لم تكن في الإطارات): كتالوج الباقات والدورات (§١١٠)، الإيصال المرقّم (§١١١)، الترقية والتخفيض (§١١٢)، حدود الأجهزة والمستخدمين والفروع (§١١٤)، تنبيهات الاشتراك (§١١٥)، الإضافات المدفوعة (§١١٦).
- **السوق**: مراحل M1…M4 خلف أعلام يقرؤها الواجهة بدل نص ثابت (§٩٦).
- **البطاقات والحركة**: البطاقة الحديثة C-CARD ثم الاتجاه B «الأولوية أولاً» (§١٥٨، §١٥٩)، والحركة (§١٣٧).
- **العامة**: الهبوط (§٩٢، §١٢٧، §١٦٠)، الشروط بمسودة السودان (§٩٨)، الحالة (§١٣٦، §١٥٧)، طلب الجولة ومتابعته (§٩٥، §١٤٧)، مراجعة الهاتف (§١٦٠).
- **حالات مسجَّلة غير مرسومة صارت مبنية**: مثل `server_error` في MP-01 (§١٦٠).

### د. ما تفترضه الخطة القديمة ويحتاج تحديثاً
- مقاس واحد 390 للجوال؛ والويب اليوم مختبَر على 390/834/1440 بتخطيطات متجاوبة.
- التقنية المختارة (Expo + expo-sqlite + expo-secure-store + lucide-react-native) ما زالت معقولة، لكن إصدار Expo لم يُثبَّت (`docs/decisions/0001`: «يُختار أحدث مستقر عند البدء»).

---

## سلوكيات غامضة أو متعارضة في الويب — للعلم لا للتخمين

1. **الأدوار مزدوجة المصدر**: 6 فقط من صلاحيات ORG-02 الـ13 تُقرأ من المصفوفة في الخادم (الخصم، إنشاء واعتماد الحملة، اعتماد الشراء، النشر في السوق، التكلفة والهامش). البقية تحكمها مجموعات أدوار ثابتة في الكود (`SELL_ROLES`، `FINANCE_ROLES`، `MANAGE_ROLES`، `role_code == "manager"`). فتحرير المصفوفة لا يغيّر كل ما تعرضه. الجوال سيرث هذا السلوك كما هو ما لم يُصلح.
2. **الأنواع غير الموصوفة**: كثير من الردود بلا مخطط في العقد، والويب يعرّف شكلها محلياً — مصدر محتمل لاختلاف الجوال عن الويب.
3. **النصوص داخل الكود**: تطابق المصطلحات يعتمد على نسخ النصوص يدوياً اليوم.
4. **الجلسة بـCookie**: تصميم صحيح للمتصفح، غير قابل للنقل إلى تطبيق أصلي كما هو.

---

## ⏸ توقّف — قرارات مطلوبة قبل المرحلة ٢

1. **البوابة**: هل تأذن كتابياً ببدء التخطيط التفصيلي (المرحلة ٢) رغم أن التجربة الميدانية مؤجّلة؟ (التنفيذ نفسه قرار لاحق.)
2. **النطاق**: تطبيق المحل وموظفيه وحده (≈138 مساراً: 127 للمنشأة + 10 للحساب والجهاز + الرئيسية)، أم يشمل المشغّل والبوابة والصفحات العامة؟
3. **NAT-01…04**: هل تبقى شاشات أصلية مستقلة كما في الخطة القديمة؟
4. **المحجوب حسب الدور**: يُعرض كالويب (حالة «لا صلاحية») أم يُخفى من تبويبات الجوال؟
5. **مسار تجديد الجلسة للجوال**: موافقتك على إضافة مسار خادمي برمز تجديد يُحفظ في `expo-secure-store` بدل Cookie.
6. **قبل البناء أم معه**: وصف ردود العقد واستخراج النصوص إلى حزمة مشتركة — شرطان مسبقان أم جزء من المعالم؟

---

## الملحق أ — جدول المسارات الكامل (مولَّد من الكود)

الأعمدة: المسار · الشاشة (`data-screen`) · الغرض (اسم الشاشة من مصفوفة الحالات أو تعليق الكود) · من يصل · المكوّن الرئيسي · النقاط (حتى 6؛ تُستثنى `POST /api/auth/logout` المشتركة في كل الشاشات).

#### `/account` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/account/sessions` | ACC-09 | الحساب والأمان والجلسات | حساب/جهاز (قبل المنشأة أو أثناء الدخول) — مصفوفة ORG-02 | `app/account/sessions/sessions-client.tsx` | `GET /api/account/sessions`<br>`POST /api/account/sessions/{session_id}/revoke` |

#### `/catalog` (7)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/catalog/[id]` | CAT-02 | إنشاء صنف وبطاقته | مستخدم منشأة | `catalog/item-page-client.tsx` | `GET /api/catalog/barcode`<br>`GET /api/catalog/groups`<br>`GET /api/catalog/items/{item_id}`<br>`GET /api/catalog/units`<br>`PATCH /api/catalog/items/{item_id}`<br>`POST /api/catalog/items` |
| `/catalog/[id]/price` | CAT-04 | سعر صنف وتاريخ تغييره | مستخدم منشأة | `catalog/price-client.tsx` | `GET /api/catalog/items/{item_id}/price`<br>`POST /api/catalog/items/{item_id}/price`<br>`POST /api/catalog/items/{item_id}/price-request` |
| `/catalog/[id]/units` | CAT-03 | وحدات وتحويلات وباركود | مستخدم منشأة | `catalog/units-client.tsx` | `GET /api/catalog/items/{item_id}`<br>`GET /api/catalog/units`<br>`PATCH /api/catalog/items/{item_id}/units/{item_unit_id}`<br>`POST /api/catalog/items/{item_id}/units` |
| `/catalog/groups` | CAT-06 | مجموعات الأصناف والأسماء البديلة | مستخدم منشأة | `app/catalog/groups/groups-client.tsx` | `GET /api/catalog/groups`<br>`GET /api/catalog/items`<br>`POST /api/catalog/groups`<br>`POST /api/catalog/items/{item_id}/aliases` |
| `/catalog/import` | CAT-05 | استيراد أو تعديل أسعار متعدد | مستخدم منشأة | `catalog/import-client.tsx` | `GET /api/catalog/prices/import/{batch_id}`<br>`POST /api/catalog/prices/import/preview`<br>`POST /api/catalog/prices/import/{batch_id}/apply`<br>`POST /api/catalog/prices/import/{batch_id}/revert` |
| `/catalog/new` | CAT-02 | إنشاء صنف وبطاقته | مستخدم منشأة | `catalog/item-page-client.tsx` | `GET /api/catalog/barcode`<br>`GET /api/catalog/groups`<br>`GET /api/catalog/items/{item_id}`<br>`GET /api/catalog/units`<br>`PATCH /api/catalog/items/{item_id}`<br>`POST /api/catalog/items` |
| `/catalog` | CAT-01 | قائمة الأصناف والبحث | مستخدم منشأة | `app/catalog/catalog-client.tsx` | `GET /api/catalog/items` |

#### `/create-org` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/create-org` | ACC-04 | إنشاء المنشأة ووصفة القطاع | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/create-org/create-org-client.tsx` | `GET /api/tenants/creation/{client_request_id}`<br>`GET /api/tenants/sectors`<br>`POST /api/tenants` |

#### `/demo` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/demo/track` | — | متابعة طلب الجولة (0005 §١٤٧) — ثلاث خطوات: 1. find: البريد أو رقم الهاتف أو الاسم. | عام بلا جلسة | `public/demo-track-client.tsx` | — |

#### `/dev` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/dev/probe` | — | صفحة فحص المرحلة ٠: تثبت الرموز والمكوّنات والتخزين الحقيقي وحالات C-NOTICE — مرجع لمساعد  | تطوير فقط | `app/dev/probe/probe-client.tsx` | — |

#### `/forbidden` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/forbidden` | PUB-04 | صفحة غير موجودة أو رابط منتهٍ | عام بلا جلسة | `public/pub-404.tsx` | — |

#### `/grow` (3)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/grow/promote` | GROW-01, GROW-02, GROW-03 | GROW-03 — طلب عرض ممول ومعاينته (21-D16 ready · 38-D30 validation_error/permission_denied) | مستخدم منشأة | `market/grow-promote-client.tsx` | `GET /api/grow/promote`<br>`POST /api/grow/promote` |
| `/grow/replenish` | GROW-01, GROW-02, GROW-03 | GROW-01 — اقتراح إعادة التوريد (32-D24 ready/empty/permission_denied): رأيٌ يُعرَض بسببه؛  | مستخدم منشأة — مصفوفة ORG-02 | `market/grow-replenish-client.tsx` | `GET /api/grow/replenish`<br>`POST /api/grow/replenish` |
| `/grow/suppliers` | GROW-01, GROW-02, GROW-03 | GROW-02 — تحليلات المورد (32-D24 ready/loading/empty/stale): يُحاسَب على ما وعد به لا على  | مستخدم منشأة — مصفوفة ORG-02 | `market/grow-suppliers-client.tsx` | `GET /api/grow/suppliers` |

#### `/install` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/install` | WEB-01 | تثبيت PWA أو عدم دعم التثبيت | مستخدم منشأة | `web/install-client.tsx` | — |

#### `/inventory` (10)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/inventory/count/[id]/review` | INV-06 | مراجعة فروق الجرد وتسوية | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `inventory/review-client.tsx` | `GET /api/inventory/count-sessions/{session_id}`<br>`POST /api/inventory/count-sessions/{session_id}` |
| `/inventory/count` | INV-05 | جلسة جرد | مستخدم منشأة | `inventory/count-client.tsx` | — |
| `/inventory/items/[id]/damage` | INV-07 | هالك وحجر تالف | مستخدم منشأة — إجراءات للمالك | `inventory/damage-client.tsx` | `POST /api/inventory/items/{item_id}/damage` |
| `/inventory/items/[id]` | INV-02 | سجل حركة الصنف | مستخدم منشأة | `inventory/movements-client.tsx` | `GET /api/inventory/items/{item_id}/movements` |
| `/inventory/openings` | INV-03 | افتتاحيات المخزون | مستخدم منشأة — إجراءات للمالك | `inventory/openings-client.tsx` | `GET /api/inventory/openings`<br>`POST /api/inventory/openings`<br>`POST /api/inventory/openings/{opening_id}/approve` |
| `/inventory` | INV-01, POS-09 | صف الشاشة: خادمي + معلّق هذا الجهاز (للفرع الحالي) — يُعرضان مركَّبين لا مجموعاً وحده. / | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `inventory/stock-client.tsx` | `GET /api/inventory/balances`<br>`GET /api/sales` |
| `/inventory/receive` | INV-04 | استلام بضاعة | مستخدم منشأة | `inventory/receive-client.tsx` | — |
| `/inventory/transfers/[id]/receive` | INV-10, POS-09 | «الثلاثة الباقية» كما في الإطار — كلمةً حتى العشرة، وإلا رقمٌ داخل mono. / | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `inventory/transfer-receive-client.tsx` | `GET /api/inventory/transfers/{transfer_id}`<br>`GET /api/sales` |
| `/inventory/transfers/new` | INV-09, POS-09 | INV-09 — إنشاء وإرسال تحويل (28-D21 ready/validation_error/success · 40-D32 saving/saved_l | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `inventory/transfer-new-client.tsx` | `GET /api/inventory/transfers`<br>`GET /api/inventory/transfers/{transfer_id}`<br>`GET /api/sales` |
| `/inventory/transfers` | INV-08, POS-09 | INV-08 — قائمة التحويلات (40-D32 ready/loading/empty/partial · 14-D9 pending_sync): كل تحو | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `inventory/transfers-client.tsx` | `GET /api/inventory/transfers`<br>`GET /api/sales`<br>`POST /api/inventory/transfers/{transfer_id}/cancel` |

#### `/invite` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/invite/[token]` | ACC-06 | قبول دعوة موظف أو منشأة سوق | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/invite/[token]/invite-client.tsx` | `GET /api/invites/{token}`<br>`POST /api/invites/{token}/accept` |

#### `/legal` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/legal` | PUB-02 | الخصوصية وشروط السوق والمساعدة | عام بلا جلسة | `public/legal-client.tsx` | `GET /api/public/legal` |

#### `/link-expired` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/link-expired` | PUB-04 | صفحة غير موجودة أو رابط منتهٍ | عام بلا جلسة | `public/pub-404.tsx` | — |

#### `/lock` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/lock` | ACC-07 | قفل محلي وفتح PIN | حساب/جهاز (قبل المنشأة أو أثناء الدخول) — إجراءات للمالك | `app/lock/lock-client.tsx` | `GET /api/devices/verifiers` |

#### `/login` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/login` | ACC-02 | تسجيل ودخول واستعادة الوصول | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/login/login-client.tsx` | `POST /api/auth/account/login`<br>`POST /api/auth/verify/confirm`<br>`POST /api/auth/verify/manual`<br>`POST /api/auth/verify/request` |

#### `/market` (41)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/market/cart` | MP-01, MP-05, ORD-01 | «6 كراتين» (3–10 بالجمع) و«12 كرتونة» (11+ بالمفرد) و«كرتونتان» — كما يقولها التاجر. / | مستخدم منشأة | `market/cart-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/public/market`<br>`POST /api/market/orders/verify` |
| `/market/checkout` | MP-01, MP-05, ORD-01 | ORD-02 — مراجعة وإرسال طلب أو طلب سعر (41-D33 ready/validation_error/saving/success/server | مستخدم منشأة | `market/checkout-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify` |
| `/market/directory` | MP-01, MP-02 | MP-02 — دليل المخازن والمتاجر: تصفية بالخدمة لا بالعنوان الخاص (29-D22 ready/stale · 43-D3 | عام بلا جلسة (ومستخدم منشأة بمزايا أوسع) | `market/directory-client.tsx` | `GET /api/public/market`<br>`GET /api/public/market/directory` |
| `/market/following` | MP-06 | متابعة مورد وقائمة المتابعين الخاصة | مستخدم منشأة | `market/following-client.tsx` | `GET /api/market/following`<br>`POST /api/market/following`<br>`POST /api/market/following/{follow_id}/unfollow` |
| `/market/i/[token]` | MP-07 | مشاركة رابط ودعوة منشأة | عام بلا جلسة (ومستخدم منشأة بمزايا أوسع) | `market/share-client.tsx` | `GET /api/market/invites`<br>`GET /api/market/share/preview`<br>`GET /api/public/market/invite/{token}`<br>`POST /api/market/invite/{token}/accept`<br>`POST /api/market/invites`<br>`POST /api/market/invites/{invite_id}/revoke` |
| `/market/link/documents` | GROW-01, GROW-02, GROW-03 | LINK-04 — روابط المستندات وتسوية الفرق (29-D22 ready/conflict/permission_denied · 38-D30 e | مستخدم منشأة | `market/link-documents-client.tsx` | `GET /api/market/link/documents`<br>`POST /api/market/link/documents/{link_id}/{action}` |
| `/market/link/items` | GROW-01, GROW-02, GROW-03 | جمع وحدتك مضافاً إليك كما يكتبه الإطار («أكياسك») — لأشهر الوحدات، وإلا «وحداتك (…)». / | مستخدم منشأة | `market/link-items-client.tsx` | `GET /api/market/link/items`<br>`POST /api/market/link/items`<br>`POST /api/market/link/items/{mapping_id}/{action}` |
| `/market/link/parties` | GROW-01, GROW-02, GROW-03 | LINK-01 — ربط الطرف المحلي بمنشأة (29-D22 ready/validation_error · 38-D30 permission_denie | مستخدم منشأة | `market/link-parties-client.tsx` | `GET /api/market/link/parties`<br>`POST /api/market/link/parties/{party_id}/{action}` |
| `/market/link/receipts` | GROW-01, GROW-02, GROW-03 | LINK-03 — تحويل استلام إلى مستند (29-D22 ready/conflict · 38-D30 validation_error/success) | مستخدم منشأة | `market/link-receipts-client.tsx` | `GET /api/market/link/receipts`<br>`GET /api/market/link/receipts/{shipment_id}/{action}`<br>`POST /api/market/link/receipts/{shipment_id}/{action}` |
| `/market/link/returns` | GROW-01, GROW-02, GROW-03 | LINK-05 — تحويل المرتجع لمستند عكسي (29-D22 ready/partial/success · 38-D30 validation_erro | مستخدم منشأة | `market/link-returns-client.tsx` | `GET /api/market/link/returns`<br>`POST /api/market/link/returns/{return_id}/{action}` |
| `/market/lists/[id]` | MP-12 | أسعار شرائح وقوائم خاصة | مستخدم منشأة — مصفوفة ORG-02 | `market/lists-client.tsx` | `GET /api/market/lists`<br>`GET /api/market/lists/{list_id}`<br>`POST /api/market/lists`<br>`POST /api/market/lists/{list_id}/members`<br>`POST /api/market/lists/{list_id}/members/{member_id}/{action}`<br>`PUT /api/market/lists/{list_id}` |
| `/market/lists/new` | MP-12 | أسعار شرائح وقوائم خاصة | مستخدم منشأة — مصفوفة ORG-02 | `market/lists-client.tsx` | `GET /api/market/lists`<br>`GET /api/market/lists/{list_id}`<br>`POST /api/market/lists`<br>`POST /api/market/lists/{list_id}/members`<br>`POST /api/market/lists/{list_id}/members/{member_id}/{action}`<br>`PUT /api/market/lists/{list_id}` |
| `/market/lists` | MP-12 | أسعار شرائح وقوائم خاصة | مستخدم منشأة — مصفوفة ORG-02 | `market/lists-client.tsx` | `GET /api/market/lists`<br>`GET /api/market/lists/{list_id}`<br>`POST /api/market/lists`<br>`POST /api/market/lists/{list_id}/members`<br>`POST /api/market/lists/{list_id}/members/{member_id}/{action}`<br>`PUT /api/market/lists/{list_id}` |
| `/market/offers/[id]` | MP-10, MP-11 | MP-11 — إنشاء عرض ونشره (08-D4 validation_error · 43-D35 ready/saving/permission_denied/su | مستخدم منشأة — مصفوفة ORG-02 | `market/offer-edit-client.tsx` | `GET /api/catalog/items`<br>`GET /api/market/offers`<br>`GET /api/market/offers/{offer_id}`<br>`POST /api/market/offers`<br>`POST /api/market/offers/preview`<br>`PUT /api/market/offers/{offer_id}` |
| `/market/offers/new` | MP-10, MP-11 | MP-11 — إنشاء عرض ونشره (08-D4 validation_error · 43-D35 ready/saving/permission_denied/su | مستخدم منشأة — مصفوفة ORG-02 | `market/offer-edit-client.tsx` | `GET /api/catalog/items`<br>`GET /api/market/offers`<br>`GET /api/market/offers/{offer_id}`<br>`POST /api/market/offers`<br>`POST /api/market/offers/preview`<br>`PUT /api/market/offers/{offer_id}` |
| `/market/offers` | MP-10 | قائمة العروض الداخلية للبائع | مستخدم منشأة — مصفوفة ORG-02 | `market/offers-client.tsx` | `GET /api/market/offers` |
| `/market/offers/public/[id]` | MP-01, MP-05 | سطر في السلة المحلية — تُقرأ في ORD-01 (T3.10)؛ لا تُثبَّت إلا بعد تأكيد خادمي. / | عام بلا جلسة (ومستخدم منشأة بمزايا أوسع) | `market/offer-detail-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/public/market` |
| `/market/orders/[id]/cancel-remaining` | MP-01, MP-05, ORD-01 | ORD-10 — إلغاء المتبقّي (27-D20 partial/permission_denied/success · 10-D6 validation_error | مستخدم منشأة | `market/cancel-remaining-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/cancel-remaining`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +2 |
| `/market/orders/[id]/compare` | MP-01, MP-05, ORD-01 | ORD-07 — مقارنة العرض وقبوله أو رفضه (41-D33 ready/validation_error/expired/success · 08-D | مستخدم منشأة | `market/compare-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/market/orders/{order_id}/compare`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +5 |
| `/market/orders/[id]/disputes` | MP-01, MP-05, ORD-01 | ORD-12 — خلاف وأدلته وتطور حالته (10-D6 partial · 41-D33 ready/empty/permission_denied/suc | مستخدم منشأة | `market/disputes-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/disputes`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +2 |
| `/market/orders/[id]` | MP-01, MP-05, ORD-01 | ORD-05 — تفاصيل الطلب وسجل الإصدارات (41-D33 ready/loading/conflict/permission_denied · 10 | مستخدم منشأة | `market/order-detail-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +2 |
| `/market/orders/[id]/payment` | MP-01, MP-05, ORD-01 | ORD-13 — إثبات دفع ومتابعة المطابقة (10-D6 stale · 41-D33 ready/validation_error/partial/s | مستخدم منشأة | `market/payment-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/payments`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +3 |
| `/market/orders/[id]/quote` | MP-01, MP-05, ORD-01 | ORD-06 — إعداد عرض سعر من المورد (41-D33 ready/validation_error/saving/expired/success · 1 | مستخدم منشأة | `market/quote-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/market/orders/{order_id}/quote`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +5 |
| `/market/orders/[id]/receive` | MP-01, MP-05, ORD-01 | ORD-09 — استلام جزئي ورفض كمية (08-D4 partial · 41-D33 ready/validation_error/conflict/suc | مستخدم منشأة | `market/receive-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/market/orders/{order_id}/receive`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +4 |
| `/market/orders/[id]/restore` | MP-01, MP-05, ORD-01 | ORD-15 — استعادة طلب بعد فقد خادمي (10-D6 conflict · 41-D33 stale/permission_denied/succes | مستخدم منشأة | `market/restore-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/restore`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +2 |
| `/market/orders/[id]/return` | MP-01, MP-05, ORD-01 | ORD-11 — طلب مرتجع تجاري (27-D20 ready/validation_error/partial/success): موافقة ثم تنفيذ، | مستخدم منشأة | `market/return-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/returns`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +3 |
| `/market/orders/[id]/ship` | MP-01, MP-05, ORD-01 | ORD-08 — تجهيز وتسليم جزئي (27-D20 validation_error/partial/success · 12-D7 ready): التراك | مستخدم منشأة | `market/ship-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/shipments`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +2 |
| `/market/orders/incoming` | MP-01, MP-05, ORD-01 | ORD-04 — طلبات المورد (27-D20 ready/expired · 41-D33 loading · 12-D7 empty): المهلة تنقضي، | مستخدم منشأة | `market/incoming-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/incoming`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +1 |
| `/market/orders` | MP-01, MP-05, ORD-01 | ORD-03 — طلبات المشتري (41-D33 loading/empty/stale · 12-D7 ready/pending_sync): الفلتر يُع | مستخدم منشأة | `market/orders-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>`POST /api/market/orders/{order_id}/resend` |
| `/market/orders/recover` | MP-01, MP-05, ORD-01 | ORD-14 — تعارض نسخة أو ردٌّ مفقود (08-D4 server_error · 41-D33 ready/conflict/success): اس | مستخدم منشأة | `market/recover-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/probe`<br>`POST /api/market/orders/verify`<br>… +1 |
| `/market` | MP-01 | رئيسية السوق | عام بلا جلسة (ومستخدم منشأة بمزايا أوسع) | `market/home-client.tsx` | `GET /api/public/market` |
| `/market/profile` | MP-09 | إدارة صفحة المنشأة | مستخدم منشأة | `market/profile-client.tsx` | `GET /api/market/profile`<br>`PUT /api/market/profile` |
| `/market/renewals` | MP-10, MP-13 | MP-13 — تجديد تأكيد سعر وتوفر (43-D35 ready/saving/permission_denied/success · 10-D6 expir | مستخدم منشأة — مصفوفة ORG-02 | `market/renewals-client.tsx` | `GET /api/market/offers`<br>`GET /api/market/renewals`<br>`POST /api/market/offers/{offer_id}/renew` |
| `/market/report` | MP-07, MP-15 | MP-15 — بلاغ عن عرض أو انتحال (29-D22 ready/validation_error/success · 43-D35 permission_d | مستخدم منشأة | `market/report-client.tsx` | `GET /api/market/invites`<br>`GET /api/market/reports`<br>`GET /api/market/reports/{report_id}`<br>`GET /api/market/share/preview`<br>`GET /api/public/market/invite/{token}`<br>`POST /api/market/invite/{token}/accept`<br>… +3 |
| `/market/reports/[id]` | MP-07, MP-15 | MP-15 — بلاغ عن عرض أو انتحال (29-D22 ready/validation_error/success · 43-D35 permission_d | مستخدم منشأة | `market/report-client.tsx` | `GET /api/market/invites`<br>`GET /api/market/reports`<br>`GET /api/market/reports/{report_id}`<br>`GET /api/market/share/preview`<br>`GET /api/public/market/invite/{token}`<br>`POST /api/market/invite/{token}/accept`<br>… +3 |
| `/market/reports` | MP-07, MP-15 | MP-15 — بلاغ عن عرض أو انتحال (29-D22 ready/validation_error/success · 43-D35 permission_d | مستخدم منشأة | `market/report-client.tsx` | `GET /api/market/invites`<br>`GET /api/market/reports`<br>`GET /api/market/reports/{report_id}`<br>`GET /api/market/share/preview`<br>`GET /api/public/market/invite/{token}`<br>`POST /api/market/invite/{token}/accept`<br>… +3 |
| `/market/search` | MP-01, MP-04 | MP-04 — نتائج بحث المنتجات والمقارنة (43-D35 ready/loading/empty/stale · 08-D4 partial): ب | عام بلا جلسة (ومستخدم منشأة بمزايا أوسع) | `market/search-client.tsx` | `GET /api/public/market`<br>`GET /api/public/market/search` |
| `/market/seller` | MP-08 | تهيئة بائع وتحقق الهوية | مستخدم منشأة | `market/seller-client.tsx` | `GET /api/market/account`<br>`POST /api/market/account/verification/submit`<br>`PUT /api/market/account` |
| `/market/share` | MP-07 | مشاركة رابط ودعوة منشأة | مستخدم منشأة | `market/share-client.tsx` | `GET /api/market/invites`<br>`GET /api/market/share/preview`<br>`GET /api/public/market/invite/{token}`<br>`POST /api/market/invite/{token}/accept`<br>`POST /api/market/invites`<br>`POST /api/market/invites/{invite_id}/revoke` |
| `/market/suppliers/[id]` | MP-01, MP-03 | MP-03 — ملف منشأة منشور (12-D7 + 47-D38 ready · 43-D35 loading/permission_denied/expired). | عام بلا جلسة (ومستخدم منشأة بمزايا أوسع) | `market/supplier-client.tsx` | `GET /api/market/lists/{list_id}`<br>`GET /api/public/market`<br>`GET /api/public/market/suppliers/{tenant_id}` |
| `/market/unavailable` | MP-01, MP-05, MP-14 | MP-14 — عرض منتهٍ أو منشأة معلَّقة (29-D22 expired/permission_denied · 43-D35 ready): منع  | عام بلا جلسة (ومستخدم منشأة بمزايا أوسع) | `market/unavailable-client.tsx` | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/public/market`<br>`GET /api/public/market/suppliers/{tenant_id}/status` |

#### `/notify` (8)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/notify/campaigns/[id]/approve` | NOT-05 | معاينة واعتماد وجدولة | مستخدم منشأة — مالك/مدير، مصفوفة ORG-02 | `notify/campaign-approve-client.tsx` | `GET /api/campaigns/{campaign_id}`<br>`POST /api/campaigns/{campaign_id}/{action}` |
| `/notify/campaigns/[id]` | NOT-06 | نتائج حملة وإلغاؤها | مستخدم منشأة — مالك/مدير، مصفوفة ORG-02 | `notify/campaign-results-client.tsx` | `GET /api/campaigns/{campaign_id}`<br>`POST /api/campaigns/{campaign_id}/{action}` |
| `/notify/campaigns/new` | NOT-04 | إنشاء حملة واختيار الجمهور | مستخدم منشأة — مالك/مدير، مصفوفة ORG-02 | `notify/campaign-new-client.tsx` | `POST /api/campaigns`<br>`POST /api/campaigns/preview` |
| `/notify/campaigns` | NOT-03 | قائمة الحملات | مستخدم منشأة — مالك/مدير، مصفوفة ORG-02 | `notify/campaigns-client.tsx` | `GET /api/campaigns` |
| `/notify/inbox/[id]` | NOT-01 | صندوق الوارد والتفاصيل | مستخدم منشأة — إجراءات للمالك، مصفوفة ORG-02 | `notify/inbox-client.tsx` | `GET /api/notifications`<br>`POST /api/notifications/{notification_id}/{action}`<br>`PUT /api/notifications/preferences` |
| `/notify/inbox` | NOT-01 | صندوق الوارد والتفاصيل | مستخدم منشأة — إجراءات للمالك، مصفوفة ORG-02 | `notify/inbox-client.tsx` | `GET /api/notifications`<br>`POST /api/notifications/{notification_id}/{action}`<br>`PUT /api/notifications/preferences` |
| `/notify` | WEB-02 | إذن Web Push وحالاته | مستخدم منشأة — جهاز مسجَّل | `web/notify-client.tsx` | `GET /api/push/status`<br>`POST /api/push/subscribe`<br>`POST /api/push/test`<br>`POST /api/push/unsubscribe` |
| `/notify/preferences` | NOT-02 | تفضيلات التنبيه | مستخدم منشأة | `notify/preferences-client.tsx` | `GET /api/notifications/preferences`<br>`PUT /api/notifications/preferences` |

#### `/onboarding` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/onboarding` | ACC-10 | معالج بدء الاستخدام | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/onboarding/onboarding-client.tsx` | `GET /api/tenants/onboarding`<br>`PATCH /api/tenants/onboarding` |

#### `/org` (11)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/org/audit` | ORG-10 | سجل تدقيق | مستخدم منشأة — إجراءات للمالك، مالك/مدير | `org/audit-client.tsx` | `GET /api/org/audit` |
| `/org/branches` | ORG-03, ORG-04 | ORG-03 — الفروع وتفاصيلها (39-D31 ready/empty/permission_denied · 15-D10 validation_error) | مستخدم منشأة — إجراءات للمالك، مالك/مدير | `org/branches-client.tsx` | `GET /api/org/branches`<br>`GET /api/org/devices`<br>`POST /api/org/branches`<br>`POST /api/org/branches/{branch_id}/{action}` |
| `/org/devices` | ORG-04 | قائمة الأجهزة وتفاصيلها | مستخدم منشأة — إجراءات للمالك | `org/devices-client.tsx` | `GET /api/org/devices` |
| `/org/roles` | ORG-02 | مصفوفة الأدوار والصلاحيات | مستخدم منشأة — إجراءات للمالك | `org/roles-client.tsx` | `GET /api/org/roles`<br>`PUT /api/org/roles` |
| `/org/settings` | ORG-09 | إعدادات المنشأة واللغة والقوالب | مستخدم منشأة — إجراءات للمالك | `org/settings-client.tsx` | `GET /api/org/ownership`<br>`GET /api/org/settings`<br>`POST /api/org/ownership`<br>`POST /api/org/ownership/{transfer_id}/{action}`<br>`PUT /api/org/settings` |
| `/org/subscription/expiry` | ORG-08 | انتهاء الاشتراك | مستخدم منشأة — إجراءات للمالك | `org/expiry-client.tsx` | `GET /api/org/subscription/expiry` |
| `/org/subscription` | ORG-06 | الاشتراك والباقات | مستخدم منشأة — إجراءات للمالك | `org/subscription-client.tsx` | `GET /api/org/subscription`<br>`GET /api/org/subscription/addon`<br>`GET /api/org/subscription/change`<br>`POST /api/org/subscription/addon`<br>`POST /api/org/subscription/change` |
| `/org/subscription/receipts/[id]` | ORG-07 | إثبات تحويل الاشتراك ومراجعته | مستخدم منشأة — إجراءات للمالك | `org/receipt-client.tsx` | `GET /api/org/subscription/receipts/{receipt_id}` |
| `/org/subscription/renew` | ORG-07 | إثبات تحويل الاشتراك ومراجعته | مستخدم منشأة — إجراءات للمالك | `org/renew-client.tsx` | `GET /api/org/subscription/addon`<br>`GET /api/org/subscription/change`<br>`GET /api/org/subscription/proofs`<br>`POST /api/org/subscription/proofs`<br>`POST /api/org/subscription/proofs/{proof_id}/image` |
| `/org/users/[id]/revoke` | ORG-05 | سحب مستخدم أو نطاق أو جهاز | مستخدم منشأة — إجراءات للمالك | `org/revoke-client.tsx` | `GET /api/org/users/{user_id}/revocation`<br>`POST /api/org/users/{user_id}/revocation` |
| `/org/users` | ORG-01 | المستخدمون والدعوات | مستخدم منشأة — إجراءات للمالك، مالك/مدير | `org/users-client.tsx` | `GET /api/org/users`<br>`POST /api/org/invitations`<br>`POST /api/org/invitations/{invitation_id}/{action}` |

#### `/(الجذر)` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/` | HOME-01, HOME-02, PUB-01 | الجذر: الرئيسية (HOME-01/02) لمن له جلسة داخل منشأة؛ وإلا PUB-01 تعريف Sting والباقات. / | عام (الهبوط) أو مستخدم منشأة (الرئيسية HOME-01/02) | `app/root-client.tsx` | `GET /api/home`<br>`GET /api/public/plans` |

#### `/parties` (9)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/parties/[id]/merge` | PTY-07 | دمج أطراف | مستخدم منشأة — إجراءات للمالك، مالك/مدير | `parties/merge-client.tsx` | `GET /api/parties/{party_id}/merge`<br>`POST /api/parties/{party_id}/distinct`<br>`POST /api/parties/{party_id}/merge` |
| `/parties/[id]/opening` | POS-09, PTY-03, PTY-04 | PTY-04 — رصيد افتتاحي (04-D2 ready · 40-D32 validation_error/permission_denied/success): ج | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك، مالك/مدير | `parties/opening-client.tsx` | `GET /api/parties/{party_id}`<br>`GET /api/sales`<br>`PATCH /api/parties/{party_id}`<br>`POST /api/parties/{party_id}/distinct`<br>`POST /api/parties/{party_id}/opening-balance` |
| `/parties/[id]` | POS-09, PTY-03 | PTY-03 — بطاقة طرف (04-D2 ready · 40-D32 validation_error/saving/success/permission_denied | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك، مالك/مدير | `parties/party-card-client.tsx` | `GET /api/parties/{party_id}`<br>`GET /api/sales`<br>`PATCH /api/parties/{party_id}`<br>`POST /api/parties/{party_id}/distinct` |
| `/parties/[id]/payment` | PTY-06 | تسجيل سداد أو رد مبلغ | مستخدم منشأة | `parties/payment-client.tsx` | — |
| `/parties/[id]/statement` | POS-09, PTY-05 | الطرف الأصلي بعد الدمج — يُوسم بمصدره (ACC-78) / | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `parties/statement-client.tsx` | `GET /api/parties/{party_id}/statement`<br>`GET /api/sales` |
| `/parties/[id]/statement/share` | PTY-08 | طباعة وتصدير ومشاركة الكشف | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `parties/share-client.tsx` | `GET /api/parties/statement-exports/{export_id}`<br>`GET /api/parties/{party_id}/statement`<br>`POST /api/parties/{party_id}/statement/export` |
| `/parties` | POS-09, PTY-01 | صف الشاشة: الرصيد المركّب «خادمي X + معلّق على جهازك Y = Z» (ACC-02). / | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `parties/customers-client.tsx` | `GET /api/parties/list`<br>`GET /api/sales` |
| `/parties/receipts/[receiptId]/correct` | PTY-09 | تصحيح تاريخ الأعمال | مستخدم منشأة — إجراءات للمالك | `parties/correction-client.tsx` | `GET /api/parties/receipts/{receipt_id}/correct`<br>`POST /api/parties/receipts/{receipt_id}/correct` |
| `/parties/suppliers` | PTY-02 | قائمة الموردين | مستخدم منشأة — المالية: مالك/مدير | `parties/suppliers-client.tsx` | `GET /api/parties/list` |

#### `/plans` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/plans` | — | PUB-05 — الباقات والمقارنة: الأسعار كاملة، الحدود رقماً، وكل خاصية نعم/لا لكل باقة. / | عام بلا جلسة | `public/plans-client.tsx` | `GET /api/public/plans` |

#### `/platform` (18)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/platform/announcements` | PLT-04 | إعلانات المنصة وصيانة | مشغّل المنصة | `platform/announcements-client.tsx` | `GET /api/platform/announcements`<br>`POST /api/platform/announcements`<br>`POST /api/platform/announcements/preview`<br>`POST /api/platform/announcements/{announcement_id}/{action}` |
| `/platform/backups` | PLT-10 | نسخ خادمية وتجربة استعادة | مشغّل المنصة | `platform/backups-client.tsx` | `GET /api/platform/backups`<br>`POST /api/platform/backups/{backup_id}/{action}` |
| `/platform/demo-requests` | — | PLT-14 — طلبات «اطلب الجولة» من الهبوط بحالتها؛ التواصل بشري على القناة المختارة (G-02). / | مشغّل المنصة | `platform/demo-requests-client.tsx` | `GET /api/platform/demo-requests`<br>`POST /api/platform/demo-requests/{request_id}` |
| `/platform/disputes` | PLT-08 | متابعة الخلافات | مشغّل المنصة | `platform/disputes-ops-client.tsx` | `GET /api/platform/disputes`<br>`POST /api/platform/disputes/{tenant_id}/{dispute_id}/{action}` |
| `/platform/entitlements` | PLT-12 | إدارة استحقاقات وإعدادات تشغيل | مشغّل المنصة | `platform/entitlements-client.tsx` | `GET /api/platform/entitlements`<br>`POST /api/platform/entitlements`<br>`POST /api/platform/flags` |
| `/platform/health` | PLT-09 | صحة المزامنة والخادم | مشغّل المنصة | `platform/health-client.tsx` | `GET /api/platform/health` |
| `/platform/login` | PLT-01 | دخول الإدارة ومساحة المشغل | مشغّل المنصة | `platform/operator-login-client.tsx` | `POST /api/platform/login` |
| `/platform/m0` | PLT-11 | لوحة اكتساب وقياس M0 | مشغّل المنصة | `platform/m0-client.tsx` | `GET /api/platform/m0`<br>`POST /api/platform/m0` |
| `/platform/operators` | — | PLT-15 — حسابات المشغّلين: إنشاء، تعطيل يُسقط الجلسات، وإعادة تعيين كلمة المرور (بلا تحقّق | مشغّل المنصة | `platform/operators-client.tsx` | `GET /api/platform/operators`<br>`POST /api/platform/operators`<br>`POST /api/platform/operators/{operator_id}/{action}` |
| `/platform/outbound` | PLT-05 | تشغيل الإرسال والإخفاقات | مشغّل المنصة | `platform/outbound-client.tsx` | `GET /api/platform/outbound`<br>`POST /api/platform/outbound/channels/{key}` |
| `/platform` | — | PLT-00 — النظرة العامة: عدّادات ما ينتظر فعلاً، كل بطاقة تفتح شاشتها؛ أرقام من السجل بختم  | مشغّل المنصة | `platform/overview-client.tsx` | `GET /api/platform/overview` |
| `/platform/password` | — | تغيير كلمة مرور المشغّل (0005 §١٣٨): من أنشأ حسابك أو أعاد تعيين كلمتك يعرفها، فتُغيَّر قب | مشغّل المنصة | `platform/password-client.tsx` | `POST /api/platform/me/password` |
| `/platform/plans` | — | PLT-16 — كتالوج الباقات والتسعير: ما تراه الصفحة العامة وORG-06 يُحرَّر هنا بسبب وسجل. / | مشغّل المنصة | `platform/plans-catalog-client.tsx` | `GET /api/platform/plans`<br>`POST /api/platform/plans`<br>`POST /api/platform/plans/{code}/{action}` |
| `/platform/proofs` | PLT-03 | مراجعة دفع الاشتراك | مشغّل المنصة | `platform/proofs-client.tsx` | `GET /api/platform/proofs`<br>`POST /api/platform/proofs/{tenant_id}/{proof_id}/{action}` |
| `/platform/reports` | PLT-07 | مراجعة بلاغ وتعليق نشر واعتراض | مشغّل المنصة | `platform/reports-client.tsx` | `GET /api/platform/reports`<br>`POST /api/platform/appeals/{tenant_id}/{offer_id}/decide`<br>`POST /api/platform/reports/{tenant_id}/{report_id}/decide` |
| `/platform/tenants/[id]` | PLT-02 | قائمة المستأجرين وتفاصيل الاستحقاق | مشغّل المنصة | `platform/tenant-detail-client.tsx` | `GET /api/platform/tenants`<br>`GET /api/platform/tenants/{tenant_id}`<br>`POST /api/platform/tenants/{tenant_id}/subscription` |
| `/platform/tenants` | PLT-02 | قائمة المستأجرين وتفاصيل الاستحقاق | مشغّل المنصة | `platform/tenants-client.tsx` | `GET /api/platform/tenants` |
| `/platform/verifications` | PLT-06 | طلبات تحقق منشآت السوق | مشغّل المنصة | `platform/verifications-client.tsx` | `GET /api/platform/verifications`<br>`POST /api/platform/verifications/{tenant_id}/{action}` |

#### `/portal` (5)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/portal/[slug]/inbox` | CUS-01, CUS-03 | CUS-03 — قائمة رسائل المحل وتفاصيل (21-D16 ready · 37-D29 loading/empty/expired/permission | زبون المحل (رابط/QR، بلا حساب) | `portal/inbox-client.tsx` | `GET /api/portal/{slug}`<br>`GET /api/portal/{slug}/messages`<br>`POST /api/portal/{slug}/messages/{message_id}/read` |
| `/portal/[slug]` | CUS-01 | صفحة محل عبر رابط أو QR | زبون المحل (رابط/QR، بلا حساب) | `portal/shop-client.tsx` | `GET /api/portal/{slug}` |
| `/portal/[slug]/status` | CUS-05 | إذن مرفوض أو اشتراك منتهٍ | زبون المحل (رابط/QR، بلا حساب) | `portal/status-client.tsx` | `GET /api/portal/{slug}/me` |
| `/portal/[slug]/subscribe` | CUS-01, CUS-02 | CUS-02 — اشتراك وإذن تنبيه (08-D4 ready/permission_denied · 37-D29 validation_error/succes | زبون المحل (رابط/QR، بلا حساب) | `portal/subscribe-client.tsx` | `GET /api/portal/{slug}`<br>`POST /api/portal/{slug}/subscribe` |
| `/portal/prefs` | CUS-04 | تفضيلات وإلغاء الاشتراك | زبون المحل (رابط/QR، بلا حساب) | `portal/prefs-client.tsx` | `DELETE /api/portal/{slug}/me`<br>`GET /api/portal/{slug}/me`<br>`POST /api/portal/{slug}/resubscribe`<br>`PUT /api/portal/{slug}/me` |

#### `/pos` (12)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/pos/customer` | POS-04 | اختيار عميل وإنشاء سريع | مستخدم منشأة | `pos/customer-client.tsx` | — |
| `/pos/discount` | POS-03 | خصم وتجاوز سعر | مستخدم منشأة | `pos/discount-client.tsx` | — |
| `/pos/duplicates` | POS-12 | مراجعة تكرار تجاري أو تصحيح | مستخدم منشأة — إجراءات للمالك، مالك/مدير | `pos/duplicates-client.tsx` | `GET /api/sales/duplicates`<br>`POST /api/sales/duplicates/decide` |
| `/pos/invoices/[id]` | POS-09 | قائمة الفواتير وتفاصيلها | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `pos/invoice-detail-client.tsx` | `GET /api/sales`<br>`GET /api/sales/{sale_id}`<br>`POST /api/sales/{sale_id}/duplicate-report` |
| `/pos/invoices/[id]/return` | POS-10 | مرتجع كلي أو جزئي | مستخدم منشأة | `pos/return-client.tsx` | `GET /api/sales/{sale_id}` |
| `/pos/invoices` | POS-09 | قائمة الفواتير وتفاصيلها | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `pos/invoices-client.tsx` | `GET /api/sales` |
| `/pos` | POS-01, POS-02 | عدد بصيغته: «3 عمليات معلقة من هذا الجهاز». / | مستخدم منشأة | `pos/pos-client.tsx` | `GET /api/catalog/balances` |
| `/pos/pay/credit` | POS-06 | الدفع الآجل | مستخدم منشأة | `pos/credit-client.tsx` | — |
| `/pos/pay/mixed` | POS-07 | الدفع المختلط والتحويل | مستخدم منشأة | `pos/mixed-client.tsx` | — |
| `/pos/pay` | POS-05 | الدفع النقدي | مستخدم منشأة | `pos/pay-client.tsx` | `POST /api/catalog/items/{item_id}/price` |
| `/pos/receipt/[id]` | POS-08 | نجاح البيع والإيصال | مستخدم منشأة | `pos/receipt-client.tsx` | — |
| `/pos/receipt/[id]/problem` | POS-11 | فشل الحفظ أو الطباعة | مستخدم منشأة | `pos/problem-client.tsx` | — |

#### `/print` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/print` | WEB-03 | ربط طابعة ويب وتجربة عربية | مستخدم منشأة | `web/print-client.tsx` | — |

#### `/purchasing` (8)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/purchasing/cost-margin` | PUR-05 | التكلفة والهامش | مستخدم منشأة | `purchasing/cost-margin-client.tsx` | `GET /api/inventory/purchasing/cost-margin`<br>`POST /api/inventory/purchasing/cost-margin` |
| `/purchasing/documents/[id]` | PUR-03 | مستند شراء واعتماده | مستخدم منشأة — مصفوفة ORG-02 | `purchasing/document-client.tsx` | `GET /api/inventory/purchasing/documents/{document_id}`<br>`PATCH /api/inventory/purchasing/documents/{document_id}`<br>`POST /api/inventory/purchasing/documents/{document_id}/{action}`<br>`POST /api/inventory/purchasing/orders/{order_id}/document` |
| `/purchasing/documents/[id]/return` | PUR-03, PUR-04 | «8 كراتين» · «6 كراتين» / | مستخدم منشأة — مصفوفة ORG-02 | `purchasing/return-client.tsx` | `GET /api/inventory/purchasing/documents/{document_id}`<br>`GET /api/inventory/purchasing/returns/{return_id}`<br>`PATCH /api/inventory/purchasing/documents/{document_id}`<br>`POST /api/inventory/purchasing/documents/{document_id}/{action}`<br>`POST /api/inventory/purchasing/orders/{order_id}/document`<br>`POST /api/inventory/purchasing/returns/{return_id}` |
| `/purchasing/orders/[id]/document` | PUR-03 | مستند شراء واعتماده | مستخدم منشأة — مصفوفة ORG-02 | `purchasing/document-client.tsx` | `GET /api/inventory/purchasing/documents/{document_id}`<br>`PATCH /api/inventory/purchasing/documents/{document_id}`<br>`POST /api/inventory/purchasing/documents/{document_id}/{action}`<br>`POST /api/inventory/purchasing/orders/{order_id}/document` |
| `/purchasing/orders/[id]` | PUR-01 | قائمة أوامر شراء داخلية وتفاصيل | مستخدم منشأة — مصفوفة ORG-02 | `purchasing/orders-client.tsx` | `GET /api/inventory/purchasing/orders` |
| `/purchasing/orders/new` | PUR-02 | إنشاء أمر شراء داخلي | مستخدم منشأة — مالك/مدير، مصفوفة ORG-02 | `purchasing/order-new-client.tsx` | `GET /api/catalog/items`<br>`GET /api/inventory/purchasing/orders`<br>`POST /api/inventory/purchasing/orders`<br>`POST /api/inventory/purchasing/orders/preview`<br>`POST /api/inventory/purchasing/orders/{order_id}/{action}` |
| `/purchasing/orders` | PUR-01 | قائمة أوامر شراء داخلية وتفاصيل | مستخدم منشأة — مصفوفة ORG-02 | `purchasing/orders-client.tsx` | `GET /api/inventory/purchasing/orders` |
| `/purchasing/returns/[id]` | PUR-03, PUR-04 | «8 كراتين» · «6 كراتين» / | مستخدم منشأة — مصفوفة ORG-02 | `purchasing/return-client.tsx` | `GET /api/inventory/purchasing/documents/{document_id}`<br>`GET /api/inventory/purchasing/returns/{return_id}`<br>`PATCH /api/inventory/purchasing/documents/{document_id}`<br>`POST /api/inventory/purchasing/documents/{document_id}/{action}`<br>`POST /api/inventory/purchasing/orders/{order_id}/document`<br>`POST /api/inventory/purchasing/returns/{return_id}` |

#### `/register` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/register` | ACC-02 | تسجيل ودخول واستعادة الوصول | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/register/register-client.tsx` | `POST /api/auth/account/register`<br>`POST /api/auth/verify/confirm`<br>`POST /api/auth/verify/request` |

#### `/reports` (6)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/reports/cash` | REP-04 | تقرير الصندوق والورديات | مستخدم منشأة — المالية: مالك/مدير، مصفوفة ORG-02 | `reports/cash-report-client.tsx` | `GET /api/reports/cash` |
| `/reports/export` | REP-06 | تصدير تقرير ومعاينته | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك، مصفوفة ORG-02 | `reports/export-client.tsx` | `GET /api/reports/export/preview`<br>`GET /api/reports/exports`<br>`POST /api/reports/exports`<br>`POST /api/reports/exports/limit-request` |
| `/reports/margin` | REP-05 | الهامش والمقارنة بين الفروع | مستخدم منشأة — إجراءات للمالك، مصفوفة ORG-02 | `reports/margin-report-client.tsx` | `GET /api/reports/margin` |
| `/reports` | REP-01 | تقرير المبيعات | مستخدم منشأة — المالية: مالك/مدير، مصفوفة ORG-02 | `reports/sales-report-client.tsx` | `GET /api/reports/sales` |
| `/reports/receivables` | REP-02 | تقرير الذمم | مستخدم منشأة — المالية: مالك/مدير، مصفوفة ORG-02 | `reports/receivables-report-client.tsx` | `GET /api/reports/receivables` |
| `/reports/stock` | REP-03 | تقرير المخزون والحركات | مستخدم منشأة — المالية: مالك/مدير، مصفوفة ORG-02 | `reports/stock-report-client.tsx` | `GET /api/reports/stock` |

#### `/search` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/search` | HOME-03 | بحث عام وإشعارات سريعة | مستخدم منشأة | `app/search/search-client.tsx` | `GET /api/notices`<br>`GET /api/search` |

#### `/select-org` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/select-org` | ACC-03 | اختيار المنشأة والفرع | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/select-org/select-org-client.tsx` | `GET /api/account/memberships`<br>`POST /api/account/select` |

#### `/session-expired` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/session-expired` | ACC-08 | انتهاء جلسة وإعادة مصادقة | عام بلا جلسة | `app/session-expired/session-expired-client.tsx` | — |

#### `/setup-device` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/setup-device` | ACC-05 | تجهيز الجهاز والتنزيل الأول | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/setup-device/setup-device-client.tsx` | `GET /api/bootstrap/{image_id}/page`<br>`POST /api/bootstrap/start`<br>`POST /api/bootstrap/{image_id}/complete`<br>`POST /api/devices/register`<br>`POST /api/devices/renew` |

#### `/shifts` (5)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/shifts/close` | SHIFT-04 | إغلاق وعد صندوق | مستخدم منشأة | `shifts/close-client.tsx` | — |
| `/shifts/current` | SHIFT-02 | الوردية الحالية | مستخدم منشأة | `shifts/current-client.tsx` | `GET /api/shifts/{shift_id}` |
| `/shifts/movements` | SHIFT-03 | حركة صندوق وتسوية | مستخدم منشأة — إجراءات للمالك | `shifts/movements-client.tsx` | `GET /api/shifts/current`<br>`POST /api/shifts/{shift_id}/requests` |
| `/shifts/open` | SHIFT-01 | فتح وردية | مستخدم منشأة — إجراءات للمالك | `shifts/open-client.tsx` | `GET /api/shifts/current` |
| `/shifts/review` | SHIFT-05 | مراجعة فروق وعمليات متأخرة | مستخدم منشأة — إجراءات للمالك | `shifts/review-client.tsx` | `GET /api/shifts/review`<br>`POST /api/shifts/{shift_id}/review` |

#### `/status` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/status` | PUB-03 | حالة الخدمة والصيانة | عام بلا جلسة | `public/status-client.tsx` | — |

#### `/support` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/support` | POS-09, SYS-11 | SYS-11 — الدعم والتشخيص (19-D14 ready/empty/permission_denied/success): ما يُرسل معروض قبل | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك، جهاز مسجَّل | `sys/support-client.tsx` | `GET /api/sales`<br>`POST /api/support/reports` |

#### `/sync` (10)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/sync/backup` | SYS-05 | تصدير نسخة محلية | مستخدم منشأة — جهاز مسجَّل | `sys/backup-client.tsx` | `POST /api/support/backups` |
| `/sync/epoch` | POS-09, SYS-08 | «G-17» — آخر مقطع مقروء من معرّف الجيل للعرض داخل mono. / | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `sys/epoch-client.tsx` | `GET /api/sales` |
| `/sync/import` | SYS-10 | استيراد بيانات | مستخدم منشأة | `sys/import-client.tsx` | `POST /api/imports/preview`<br>`POST /api/imports/{batch_id}/apply`<br>`POST /api/imports/{batch_id}/decide`<br>`POST /api/imports/{batch_id}/revert` |
| `/sync/operations/[id]` | POS-09, SYS-02 | السبب بلغة مفهومة والفعل الواحد لكل رمز رفض من الخادم (§٨.٣: دائم → حجر بلا سدّ الطابور).  | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `sys/operation-client.tsx` | `GET /api/sales` |
| `/sync` | POS-09, SYS-01 | آخر مطابقة ناجحة أقدم من هذا = «قديمة» وإن كان الطابور فارغاً والاتصال قائماً (07-D3 stale | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `sys/sync-center-client.tsx` | `GET /api/sales` |
| `/sync/recovery` | POS-09, SYS-07 | SYS-07 — استرداد جهاز مسحوب (19-D14 ready/permission_denied/conflict/success · 16-D11 pend | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `sys/recovery-client.tsx` | `GET /api/sales`<br>`GET /api/sync/recovery`<br>`POST /api/sync/recovery/{device_id}/{action}` |
| `/sync/restore` | SYS-06 | استعادة نسخة ومعاينتها | مستخدم منشأة | `sys/restore-client.tsx` | — |
| `/sync/review` | POS-09, SYS-03 | يُشكَّل من أعضاء النسخة ليوصف بلغة المحل كما في SYS-01/02. / | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `sys/review-client.tsx` | `GET /api/sales`<br>`GET /api/sync/quarantine`<br>`GET /api/sync/quarantine/{item_id}`<br>`POST /api/sync/quarantine/{item_id}/decide` |
| `/sync/storage` | SYS-04 | انخفاض التخزين أو فشل استدامته | مستخدم منشأة | `sys/storage-client.tsx` | — |
| `/sync/update` | POS-09, SYS-09 | SYS-09 — تحديث التطبيق مع عمليات معلّقة (19-D14 ready/pending_sync/success/server_error ·  | مستخدم منشأة — المالية: مالك/مدير، إجراءات للمالك | `sys/update-client.tsx` | `GET /api/app/update`<br>`GET /api/sales` |

#### `/welcome` (1)

| المسار | الشاشة | الغرض | من يصل | المكوّن | النقاط (API) |
|---|---|---|---|---|---|
| `/welcome` | ACC-01 | ترحيب واختيار الدخول أو إنشاء منشأة | حساب/جهاز (قبل المنشأة أو أثناء الدخول) | `app/welcome/welcome-client.tsx` | `GET /api/health` |