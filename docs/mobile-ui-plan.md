# خطة واجهة الجوال — المصدر المعتمد للتصميم والتنفيذ

> **الحالة**: المرحلة ١ (المراجعة) روجعت، والمرحلة ٢ (الخطة) مكتوبة — **بانتظار اعتماد المالك**. لا تنفيذ قبل الاعتماد وقبل الإذن الكتابي ببدء Expo (بوابة §١٥.١ مرحلة د).
> **المصدر الوحيد للحقيقة**: كود الويب في `main` بتاريخ 2026-10-17 (بعد #180). الإطارات والخطة القديمة (صفوف `M`) مرجع مقارنة فقط.
> **قرارات المالك (2026-10-17)**: خطة فقط بلا بناء؛ النطاق تطبيق المحل وموظفيه (المشغّل والبوابة والعامة تبقى ويباً)؛ NAT-01…04 شاشات أصلية؛ المحجوب يُعرض كالويب (`permission_denied`)؛ مسار تجديد برمز للجوال؛ وصف ردود العقد واستخراج النصوص هما المعلم 0.

## اتجاه التصميم

- **تطابق وظيفي إلزامي، لا تطابق شكلي.** كل شاشة وحقل وقاعدة تحقق وحالة وصلاحية ومصطلح في الويب موجود على الجوال بالسلوك نفسه والنقاط نفسها. التخطيط والتفاعل يتكيّفان مع الهاتف، وكل انحراف عن تخطيط الويب مكتوب سببه في جدول الشاشات (§٢.٣).
- **المرجع البصري: Apple HIG.** عناوين كبيرة تنكمش عند التمرير، شريط تبويب سفلي، مكدّسات تنقّل، أوراق سفلية للاختيار والتأكيد، إجراءات السحب على الصفوف، قوائم مجمّعة بنمط الإعدادات، لمس ≥ 44pt (56pt للأزرار المالية كقاعدة الويب)، حركة قصيرة وظيفية. مظهر واحد على iOS وAndroid مع احترام أعراف المنصة: زر الرجوع وإيماءته في Android، المناطق الآمنة، الاهتزاز اللمسي عند النجاح والخطأ، خط النظام للأرقام غير المالية.
- **الهوية من الويب لا من جديد.** الألوان من `packages/design` (الكحلي `#12253B` والتركوازي `#0E7C86`، والوضع الداكن المعتمد)، Tajawal للعربية وIBM Plex Mono للأرقام، شعار «فيزانو بلص» بخط Reem Kufi، والنصوص والمصطلحات حرفياً من الويب (من حزمة النصوص المشتركة — §٢.١).
- **ممنوع القالب المولَّد** (قاعدة المالك §١٥٨–§١٥٩): لا شريط ملوّن على البطاقات، لا أيقونة في دائرة مصبوغة، لا بطاقة لكل رقم، لا تدرّجات ولا لوحات بنفسجية، لا بطاقات ضخمة بأيقونة لكل شيء، لا لوحة «داشبورد» منسوخة. كل شاشة تُصمَّم من محتواها ومهمّة المستخدم فيها، والأولوية وحدها تُميَّز.
- **مكوّنات بإحساس المنصة** قبل المخصّص: القوائم والأوراق والمفاتيح ومنتقي التاريخ أصلية؛ المخصّص فقط حيث لا مقابل أصلي (لوحة PIN، لوحة النقد، الرصيد المركّب).
- **ثوابت المشروع**: عربية من اليمين بخصائص منطقية (`start`/`end`)، أرقام لاتينية بخط mono معزولة الاتجاه ولا حرف عربي داخلها، الحالات الـ17 المسجَّلة فقط، والبيع يعمل بلا اتصال.

---

# الجزء ١ — تقرير المراجعة (المرحلة ١)

## ⚠️ ما يجب أن تعرفه قبل القراءة — ثلاث حقائق تغيّر فرضية المهمة

1. **لا يوجد تطبيق جوال في المستودع.** لا `apps/mobile`، ولا اعتماد على Expo أو React Native في أي `package.json`، ولا فرع ولا مستودع آخر يحويه (بحثت في كل الفروع وفي `~/Documents`؛ `vezano-pro` منتجك الآخر ولا جوال فيه). كذلك **تطبيق الحاسوب (Tauri) غير موجود**. فالقائمة ٢ أدناه كلها من الصنف (د) «غير موجود على الجوال»، ولا «شاشات قديمة تُستبدل».
2. **«الخطة القديمة» للجوال موجودة كخطة فقط**: صفوف المنصة `M` في `design_handoff_sting_systems/handoff/states-matrix.csv` (135 شاشة × 645 حالة بمقاس 390، منها 594 **غير مرسومة**)، وشاشات NAT-01…04، ومرحلة «د» في `docs/PLAN.md`، وقسم الموبايل في `CLAUDE_CODE_PROMPT.md` و`docs/ARCHITECTURE.md` (Expo + expo-sqlite + expo-secure-store).
3. **بوابة قائمة**: `CLAUDE_CODE_PROMPT.md` و`docs/PLAN.md` (§١٥.١ مرحلة د) يشترطان **موافقتك الكتابية بعد التجربة الميدانية** قبل بدء Expo، والتجربة الميدانية مؤجّلة بأمرك (0005 §١٥٦). هذه المهمة تنتهي بخطة فلا تخالف البوابة، لكن التنفيذ لاحقاً يحتاج قراراً صريحاً منك (حُسم: خطة فقط — انظر «قرارات المالك» آخر الجزء ١).

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
- **الواجهة لا تُخفي عناصر التنقل حسب الدور**: كل البنود ظاهرة في `features/home/app-nav.tsx`، والخادم يقرر، والشاشة تعرض حالة `permission_denied` بنصّها (117 شاشة تتعامل معها) أو سبب تعطيل الزر. **على الجوال أن يحاكي هذا بالضبط** (حُسم: يُعرض كالويب).

> الجدول الكامل لكل مسار (المسار، الشاشة، الغرض، من يصل، المكوّن، النقاط) في **الملحق أ** آخر الوثيقة. عمود «من يصل» مستخرج من فحوص العروض الخادمية؛ الصلاحيات الدقيقة لكل إجراء تُفحص داخل الخدمات وتصل الواجهة كـ`permission_denied`.

---

## القائمة ٢ — شاشات الجوال الحالية ومقابلها في الويب

| الصنف | العدد | التفصيل |
|---|---|---|
| (أ) يطابق الويب | **0** | لا شاشات جوال |
| (ب) قديم — يُستبدل | **0** | لا شاشات جوال |
| (ج) بلا مقابل في الويب — قرار | **4 مخطَّطة** | NAT-01 أذونات الكاميرا والباركود، NAT-02 الطابعة وBluetooth، NAT-03 الإشعارات والرابط العميق، NAT-04 التحديث والأسرار والنسخة الاحتياطية. شاشات أصلية بحتة في الخطة القديمة لا وجود لها في الويب (الويب يعتمد كاميرا المتصفح والطباعة عبر المتصفح وWeb Push وService Worker) |
| (د) غير موجود على الجوال | **176 مساراً / 161 شاشة** | كل مسارات الويب. حُسم النطاق بقرار المالك (آخر الجزء ١)، والمقترحات أدناه هي ما اعتُمد: |

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

## قرارات المالك على تقرير المرحلة ١ (2026-10-17)

1. **البوابة**: خطة فقط، بلا بناء.
2. **النطاق**: تطبيق المحل وموظفيه وحده؛ المشغّل `/platform/*` والبوابة `/portal/*` والصفحات العامة تبقى ويباً.
3. **NAT-01…04**: شاشات أصلية مستقلة.
4. **المحجوب حسب الدور**: يُعرض كالويب (`permission_denied`) ولا يُخفى.
5. **الجلسة**: مسار تجديد برمز للجوال في `expo-secure-store`.
6. **وصف العقد واستخراج النصوص**: المعلم 0 قبل أي شاشة.

---

# الجزء ٢ — خطة التنفيذ (المرحلة ٢)

## ٢.١ استراتيجية الكود المشترك

**التوصية: حزم مشتركة داخل المستودع الأحادي نفسه** (pnpm workspace القائم)، والتطبيق في `apps/mobile` (Expo، كما في `docs/ARCHITECTURE.md`). لا نسخ للكود بين الويب والجوال.

| الحزمة | الحال | ما يتغيّر |
|---|---|---|
| `@sting/contracts` | قائمة (openapi-fetch + أنواع مولَّدة) | **M0**: وصف كل الردود في الخادم (إزالة `responses={200: None}` وأشباهها) حتى تختفي الواجهات المحلية (367) والتحويلات (287) من الويب والجوال معاً. فحص انحراف قائم يمنع العودة |
| `@sting/domain` | قائمة (المال، الكميات، التقريب، البحث، الوردية، الدفتر) | لا شيء — تُستورد كما هي |
| `@sting/sync-core` | قائمة (بروتوكول PUSH/PULL والحفظ المحلي والأرصدة والنسخ) | لا شيء في المنطق؛ الغلاف الخاص بالويب (`lib/sync.ts`) يُفصل منه ما ليس DOM إلى `app-core` |
| `@sting/platform` | قائمة (عقود التخزين + Dexie + الذاكرة + اختبارات عقد) | **محوّل SQLite جديد** (expo-sqlite) يمرّ بنفس اختبارات العقد الحالية |
| `@sting/design` | قائمة (tokens.json → CSS) | **مولّد ثانٍ** يخرج `tokens.native.ts` (ألوان فاتح/داكن، أحجام الخط، المسافات، الزوايا، ألوان الحالات الـ17) من المصدر نفسه |
| `@sting/texts` | **جديدة — M0** | كل نصوص الواجهة العربية مفتاحاً مفتاحاً لكل شاشة، مستخرجة من JSX الويب؛ الويب يستوردها بدل النص المضمَّن (اختبارات Playwright الحرفية القائمة تحرس عدم تغيّر أي حرف) |
| `@sting/app-core` | **جديدة — M0** | ما يتشاركه الويب والجوال بلا واجهة: غلاف API بمخزن رموز قابل للتبديل، آلة حالات الجلسة والقفل، فهرس رموز أخطاء الخادم ← نصوصها، قواعد التحقق المستخرجة من الشاشات، المنسّقات المحلية (`format.ts`، `money.ts`، `plan-lines`) |
| `@sting/ui-web` | قائمة (30 مكوّناً DOM) | لا تُشارَك — للويب والحاسوب |
| `@sting/ui-native` | **جديدة — M1** | مكوّنات الجوال الـ12 (§٢.٢) فوق `tokens.native.ts` |

**المفاضلة**:
- *حزم مشتركة (الموصى بها)*: مصدر واحد للأنواع والنصوص والتحقق، فلا يتباعد الجوال عن الويب، وقواعد حدود الاستيراد (`dependency-cruiser`) تمنع DOM من دخول الحزم. **الكلفة**: المعلم 0 يلمس شاشات الويب كلها لاستخراج النصوص والتحقق، وهو عمل كبير قبل أول شاشة جوال.
- *نسخ الكود إلى الجوال*: أسرع في البداية، لكنه يكرّر 367 واجهة وكل النصوص وقواعد التحقق، ويضمن التباعد عند أول تعديل على الويب. مرفوض لأنه يناقض «التطابق الوظيفي» نفسه.
- *مستودع منفصل للجوال*: يفقد الحزم واختبارات العقد وفحص الانحراف. مرفوض.

**المصادقة على الجوال (قرار المالك)**: مسار خادمي جديد لتجديد الجلسة برمز تجديد يُحفظ في `expo-secure-store` ويُدوَّر عند كل استعمال، بدل Cookie `HttpOnly` (`/api/auth/remember` و`/resume`). يبقى الويب على الـCookie. الـPIN والقفل بعد الخمول والجهاز المسجَّل كما في الويب حرفياً.

## ٢.٢ نظام تصميم الجوال

**الرموز** — مشتقّة آلياً من `packages/design` (لا قيمة تُكتب يدوياً):

| الفئة | الفاتح | الداكن | ملاحظة |
|---|---|---|---|
| الحبر | `#12253B` / خافت `#5B6B7F` | `#E8EDF3` / `#9EABBA` | كما الويب |
| الأرضية / البطاقة | `#F6F8FB` / `#FFFFFF` | `#0C141F` / `#131E2D` | الأرضية = لون `systemGroupedBackground` بنمط HIG |
| العلامة (الإجراء الأساسي) | `#0E7C86` (قوي `#0B5A61`) | `#37B0B8` | التركوازي للإجراء الأساسي وحده |
| الحدّ | `#E0E7EE` | `#243246` | فواصل القوائم بسماكة شعرة |
| الحالات الـ17 | من `--color-state-*` (خلفية/نص/حدّ) | من قسم الداكن | ألوان الحالة فقط على شارة الحالة والإشعار، لا على البطاقة |
| النجاح / التحذير / الخطر | `#15803D` / `#B45309` / `#B91C1C` | `#4ADE80` / `#FBBF24` / `#F87171` | |

**سلّم الخط** (Tajawal للعربية، IBM Plex Mono للأرقام؛ مقاسات HIG مكيَّفة لأن Tajawal أصغر بصرياً من SF):

| الدور | المقاس/السطر | الوزن | يقابل في الويب |
|---|---|---|---|
| عنوان كبير (Large Title) | 32/40 | 700 | `--text-pageTitle` 28 |
| عنوان | 22/28 | 700 | `--text-sectionTitle` 20 |
| عنوان قسم القائمة | 15/20 | 600 | — |
| متن | 17/26 | 400 | `--text-body` 15 (أكبر على الهاتف — مراجعة §١٦٠) |
| متن ثانوي | 15/22 | 400 | `--text-bodyDense` 14 |
| ملاحظة | 13/18 | 400 | `--text-note` 13 (الحدّ الأدنى؛ لا 12.5 على الجوال) |
| رقم مالي كبير | 28/34 mono | 600 | — |
| رقم في صف | 17/22 mono | 500 | — |

يدعم تكبير خط النظام (Dynamic Type / Font scale) حتى 200% دون قصّ.

**المسافات والزوايا**: شبكة 4pt (4، 8، 12، 16، 20، 24، 32)؛ حاشية الشاشة 16pt؛ ارتفاع الصف 52pt أدنى (64 لصفوف بسطرين)؛ زاوية البطاقة 12، الورقة 16، الزر 12.

**التنقل حسب الدور** — شريط تبويب بأربعة تبويبات أساسية + «المزيد» (يحوي كل الشاشات الأخرى بمجموعات الويب نفسها من `app-nav.tsx`). **الدور يحدد ترتيب التبويبات الأساسية فقط ولا يُخفي شيئاً** (قرار المالك: المحجوب يُعرض كالويب ويقرّر الخادم):

| الدور | التبويبات الأساسية | لماذا |
|---|---|---|
| المالك | الرئيسية · البيع · العملاء والذمم · التقارير · المزيد | يراقب ويقرّر أكثر مما يبيع |
| المدير | الرئيسية · البيع · المخزون · العملاء والذمم · المزيد | يدير الفرع |
| الكاشير | البيع · الوردية · الفواتير · العملاء · المزيد | مهامّه كل ساعة |
| أمين المخزن | المخزون · الاستلام · التحويلات · الجرد · المزيد | لا يبيع (`sell: no`) |
| دور مخصّص | يُشتق من صلاحياته في ORG-02 بالقاعدة نفسها | |

البحث العام (HOME-03) متاح من رأس كل تبويب، ومركز المزامنة من شارة الحالة في الرأس.

**المكوّنات الأساسية الاثنا عشر** (كل الشاشات تُبنى منها؛ لا تنسيق خاص لشاشة):

| # | المكوّن | الدور | يقابل في الويب |
|---|---|---|---|
| 1 | `Screen` | الإطار: عنوان كبير ينكمش، المناطق الآمنة، سحب للتحديث، الحالة الكاملة للشاشة | C-FRAME |
| 2 | `StateView` | الحالات الـ17 بنصوصها من `@sting/design` (إشعار داخل الشاشة أو ملء الشاشة) | C-NOTICE / Status |
| 3 | `ListRow` + `GroupedList` | الصف: عنوان، وصف، قيمة على الطرف بخط mono، إجراءات سحب | الجداول والقوائم |
| 4 | `Field` | نص/رقم/مال/هاتف/بريد بتسمية ظاهرة فوقه وخطأ تحته (aria مكافئ) | C-FIELD |
| 5 | `Money` / `Qty` | رقم mono معزول الاتجاه، والرصيد المركّب «خادمي + معلّق = إجمالي» | Money / LedgerLine |
| 6 | `Button` | أساسي/ثانوي/هادئ/خطر، تحميل، `disabledReason` مرئي (لا زر معطّل صامت) | C-BTN |
| 7 | `Sheet` | ورقة سفلية للاختيار والتأكيد والإدخال القصير | Dialog / Sheet |
| 8 | `Segmented` / `Chips` | المدى، الفلتر، الوسيلة | الفلاتر وأزرار الشرائح |
| 9 | `SyncBadge` | محفوظ عندك / بانتظار المزامنة / مؤكَّد / تعارض | Sync |
| 10 | `SearchBar` + `Scanner` | البحث مع زر مسح الباركود (NAT-01) | البحث |
| 11 | `Timeline` | سجل الطلب والمستند والحالة | OrderTimeline / TimeList |
| 12 | `Card` | بطاقة مسطّحة: عادية / انتباه (الأولوية وحدها) / رئيسية (واحدة في الصفحة) | c-card plain/attention/hero |

**كيف يختلف عن الويب ولماذا**: الجداول تصير قوائم صفوف (عرض الهاتف)؛ الحوارات تصير أوراقاً سفلية (منطقة الإبهام)؛ القائمة الجانبية تصير شريط تبويب + «المزيد» (عرف المنصة)؛ المتن 17 بدل 15 (القراءة على الهاتف — مراجعة §١٦٠)؛ إجراءات السحب إضافة إلى الأزرار لا بدلاً منها. **لا يتغيّر**: الألوان، النصوص، الحالات، قواعد الأرقام، الصلاحيات.

## ٢.٣ الشاشات شاشةً شاشة — بترتيب الاعتماد

النطاق: **132 شاشة** = 128 شاشة ويب لتطبيق المحل + 4 أصلية (NAT-01…04). WEB-02 (إذن Web Push) يُستبدل بـNAT-03، و`/install` و`/print` و`/sync/update` و`/sync/storage` تُستبدل بـNAT-01…04.

**معيار قبول عام لكل شاشة** (إضافة إلى الخاص في الجدول):
1. كل حالة في عمود «الحالات» تُعرض بنصّها الحرفي من `@sting/texts` (اختبار آلي على المحاكي يقارن النص بمصدر الويب).
2. النقاط نفسها بالحمولة نفسها؛ رموز أخطاء الخادم تُعرض بنصوص الويب نفسها.
3. `permission_denied` يأتي من الخادم ويُعرض كالويب؛ لا إخفاء محلي حسب الدور.
4. RTL كامل، الأرقام mono معزولة، لمس ≥ 44pt (56 للمالي)، تكبير الخط 200% بلا قصّ، VoiceOver/TalkBack يقرأ التسميات.
5. ما يعمل بلا اتصال في الويب يعمل بلا اتصال على الجوال، بالحالات `saved_local`/`pending_sync` نفسها.
6. فاتح وداكن، iOS وAndroid، ومقاسا 375 و430 بلا تجاوز.

### M1 — الأساس — الدخول والجهاز والقشرة (14 شاشة)

| الشاشة | مرجع الويب | التكيّف للجوال (وسبب أي انحراف) | النقاط | الحالات | معيار القبول الخاص |
|---|---|---|---|---|---|
| **ACC-01** ترحيب واختيار الدخول أو إنشاء منشأة | `/welcome`<br>`app/welcome/welcome-client.tsx` | شاشة ترحيب بزرّين كبيرين أسفل الشاشة (منطقة الإبهام) بدل عمودي الويب. | `GET /api/health` | ready offline server_error | الزرّان يقودان إلى ACC-02 وACC-04؛ بلا اتصال تظهر حالة offline بنصّ الويب. |
| **ACC-02** تسجيل ودخول واستعادة الوصول | `/login`<br>`/register`<br>`app/login/login-client.tsx`, `app/register/register-client.tsx` | الدخول والتسجيل في مكدّس واحد بخطوات (المعرّف ← الرمز ← كلمة المرور) بشريط خطوات أعلى الشاشة؛ لوحة المفاتيح المناسبة لكل حقل (email/tel/numeric) وملء الرمز تلقائياً من البريد غير ممكن — خانات OTP كالويب. | `POST /api/auth/account/login`<br>`POST /api/auth/account/register`<br>`POST /api/auth/verify/confirm`<br>`POST /api/auth/verify/manual`<br>`POST /api/auth/verify/request` | ready loading validation_error offline expired server_error success | التسجيل بالبريد وحده وواتساب إلزامي (§١٤٩–§١٥٠)؛ رسائل الخطأ برموز الخادم نفسها. |
| **ACC-03** اختيار المنشأة والفرع | `/select-org`<br>`app/select-org/select-org-client.tsx` | قائمة منشآت بنمط grouped list؛ اختيار الفرع ورقة سفلية. | `GET /api/account/memberships`<br>`POST /api/account/select` | ready loading empty permission_denied offline stale | منشأة واحدة = تخطٍّ آلي كما في الويب. |
| **ACC-04** إنشاء المنشأة ووصفة القطاع | `/create-org`<br>`app/create-org/create-org-client.tsx` | نموذج بأقسام مجمّعة؛ وصفة القطاع قائمة اختيار بعلامة ✓. | `GET /api/tenants/creation/{client_request_id}`<br>`GET /api/tenants/sectors`<br>`POST /api/tenants` | ready validation_error saving success server_error | إعادة المحاولة بنفس client_request_id لا تنشئ منشأتين. |
| **ACC-05** تجهيز الجهاز والتنزيل الأول | `/setup-device`<br>`app/setup-device/setup-device-client.tsx` | شاشة تقدّم بملء الشاشة بخطوات التنزيل الأول (بدل بطاقة الويب) — المستخدم ينتظر ولا يفعل شيئاً آخر. | `GET /api/bootstrap/{image_id}/page`<br>`POST /api/bootstrap/start`<br>`POST /api/bootstrap/{image_id}/complete`<br>`POST /api/devices/register`<br>`POST /api/devices/renew` | loading offline partial stale server_error success | التنزيل يُستأنف بعد انقطاع؛ partial يذكر ما نُزّل وما بقي. |
| **ACC-06** قبول دعوة موظف أو منشأة سوق | `/invite/[token]`<br>`app/invite/[token]/invite-client.tsx` | شاشة تُفتح من رابط عميق (NAT-03) لا من المتصفح. | `GET /api/invites/{token}`<br>`POST /api/invites/{token}/accept` | ready expired permission_denied success server_error | الرابط المنتهي يعطي expired بنصّ الويب. |
| **ACC-07** قفل محلي وفتح PIN | `/lock`<br>`app/lock/lock-client.tsx` | لوحة أرقام PIN أصلية كبيرة (لمس 56pt) مع Face ID/بصمة اختيارياً بعد أول PIN — **انحراف**: الويب بلا قياس حيوي؛ يُضاف لأنه عرف المنصة ولا يغيّر القاعدة (الـPIN يبقى المرجع). | `GET /api/devices/verifiers` | ready validation_error permission_denied offline | منطق القفل بعد الخمول مطابق لـ§١٢٠؛ لا يُخزَّن الـPIN خاماً. |
| **ACC-08** انتهاء جلسة وإعادة مصادقة | `/session-expired`<br>`app/session-expired/session-expired-client.tsx` | ورقة سفلية فوق الشاشة الحالية بدل صفحة — العمل غير المحفوظ يبقى تحتها. | محلي (sync-core) ثم PUSH | expired offline saved_local pending_sync success | العمليات المحفوظة محلياً لا تُفقد (saved_local/pending_sync بالأرقام). |
| **ACC-10** معالج بدء الاستخدام | `/onboarding`<br>`app/onboarding/onboarding-client.tsx` | معالج بخطوات بشاشة لكل خطوة وتقدّم أعلى. | `GET /api/tenants/onboarding`<br>`PATCH /api/tenants/onboarding` | ready empty partial validation_error offline success | التخطّي والاستئناف كما في الويب. |
| **HOME-01** رئيسية المالك | `/`<br>`app/root-client.tsx` | عنوان كبير (اسم المحل) ثم قائمة «يحتاج قرارك» ثم الأرقام كصفوف لا بطاقات — بطاقة لكل رقم ممنوعة (§١٥٩). سحب للتحديث. | `GET /api/home`<br>`GET /api/public/plans` | ready loading empty stale offline pending_sync | كل رقم بمصدره ووقته؛ المعلّق من هذا الجهاز ظاهر بالتركيب المعلن. |
| **HOME-02** رئيسية الموظف | `/`<br>`app/root-client.tsx` | رئيسية الموظف: اختصارات عمله (البيع، الوردية) أعلى، والمحجوب ماليّاً غير ظاهر كما في الويب. | `GET /api/home`<br>`GET /api/public/plans` | ready empty permission_denied offline stale | permission_denied للأرقام المالية بنصّ الويب. |
| **HOME-03** بحث عام وإشعارات سريعة | `/search`<br>`app/search/search-client.tsx` | شريط بحث أعلى الشاشة بنمط iOS مع نتائج مجمّعة (أصناف، أطراف، مستندات)؛ زرّ مسح الباركود داخل الشريط (NAT-01). | `GET /api/notices`<br>`GET /api/search` | ready loading empty permission_denied offline | النتائج والمجموعات نفسها؛ بلا اتصال يبحث محلياً كالويب. |
| **SYS-01** مركز الاتصال والمزامنة | `/sync`<br>`sys/sync-center-client.tsx` | مركز المزامنة: حالة الاتصال والمعلّق والمؤكد صفوف واضحة؛ «زامن الآن» زرّ أساسي. | `GET /api/sales` | ready offline pending_sync synced stale server_error | الأرقام تطابق ما في التخزين المحلي. |
| **NAT-04** التحديث والأسرار والنسخة الاحتياطية | — (أصلية؛ قرار المالك 2026-10-17) | يستبدل `/sync/update` و`/sync/storage`: تحديثات OTA (EAS Update) مع منع التحديث فوق عمليات معلّقة كثيرة (§١٣ من الوثيقة)، وحفظ الأسرار في expo-secure-store. | `/api/devices/*` و`/api/notify/*` حسب الوظيفة — تُحدَّد في M0 | pending_sync ready server_error success validation_error | لا يُطبَّق تحديث مخطط على جهاز بعمليات غير مرفوعة بلا نسخة استرداد. |

### M2 — البيع اليومي (18 شاشة)

| الشاشة | مرجع الويب | التكيّف للجوال (وسبب أي انحراف) | النقاط | الحالات | معيار القبول الخاص |
|---|---|---|---|---|---|
| **POS-01** نقطة البيع والسلة | `/pos`<br>`pos/pos-client.tsx` | شاشة البيع: بحث + مسح باركود أعلى، السلة قائمة، والإجمالي وزرّ «ادفع» مثبّتان أسفل الشاشة (56pt مالي). **انحراف**: الويب يعرض الأصناف والسلة جنباً إلى جنب على الحاسوب؛ على الهاتف السلة أولاً وإضافة الصنف بورقة. | `GET /api/catalog/balances` | ready loading empty offline stale permission_denied | يعمل بلا اتصال؛ رقم الفاتورة المحلي بالصيغة نفسها؛ لمس ≥ 56 للمالي. |
| **POS-03** خصم وتجاوز سعر | `/pos/discount`<br>`pos/discount-client.tsx` | ورقة سفلية بلوحة أرقام للخصم/تجاوز السعر. | محلي (sync-core) ثم PUSH | ready validation_error permission_denied | حدّ الخصم من مصفوفة ORG-02 مطبَّق مع سببه المعلن. |
| **POS-04** اختيار عميل وإنشاء سريع | `/pos/customer`<br>`pos/customer-client.tsx` | ورقة بحث عملاء مع «إنشاء سريع» في أسفلها. | محلي (sync-core) ثم PUSH | ready empty validation_error permission_denied offline | إنشاء العميل بلا اتصال يُحفظ محلياً كالويب. |
| **POS-05** الدفع النقدي | `/pos/pay`<br>`pos/pay-client.tsx` | لوحة نقد: المستلم بأزرار الفئات (100/200/500) ولوحة أرقام، والباقي كبير بخط mono. | `POST /api/catalog/items/{item_id}/price` | ready validation_error saving saved_local success | النجاح بعد الحفظ المحلي لا بعد الطباعة؛ saved_local بلا اتصال. |
| **POS-06** الدفع الآجل | `/pos/pay/credit`<br>`pos/credit-client.tsx` | الدفع الآجل: اختيار طرف إلزامي أعلى، وحدّ الائتمان والرصيد المركّب صفّاً واضحاً. | محلي (sync-core) ثم PUSH | ready validation_error permission_denied stale saved_local | تجاوز الحدّ يطلب السبب داخل الشاشة نفسها. |
| **POS-07** الدفع المختلط والتحويل | `/pos/pay/mixed`<br>`pos/mixed-client.tsx` | المختلط: صفوف وسائل الدفع مع مجموع متبقٍّ مثبّت. | محلي (sync-core) ثم PUSH | ready validation_error saving saved_local success server_error partial | مجموع الدفعات = الإجمالي قبل تفعيل الزر. |
| **POS-08** نجاح البيع والإيصال | `/pos/receipt/[id]`<br>`pos/receipt-client.tsx` | شاشة نجاح بعلامة واضحة وأزرار «طباعة» (NAT-02) و«مشاركة» (ورقة المشاركة الأصلية — **إضافة**: بديل الطباعة على الهاتف) و«بيع جديد». | محلي (sync-core) ثم PUSH | saved_local pending_sync synced success server_error | حالة المزامنة (محفوظ عندك/مؤكد) ظاهرة؛ الإيصال العربي نفسه. |
| **POS-09** قائمة الفواتير وتفاصيلها | `/pos/invoices/[id]`<br>`/pos/invoices`<br>`pos/invoice-detail-client.tsx`, `pos/invoices-client.tsx` | قائمة فواتير بأقسام حسب اليوم؛ التفاصيل شاشة مكدّسة. | `GET /api/sales`<br>`GET /api/sales/{sale_id}`<br>`POST /api/sales/{sale_id}/duplicate-report` | ready loading empty offline stale pending_sync permission_denied | المعلّق من هذا الجهاز موسوم كالويب. |
| **POS-10** مرتجع كلي أو جزئي | `/pos/invoices/[id]/return`<br>`pos/return-client.tsx` | المرتجع: اختيار السطور بخانات ✓ وكمية بمحدّد (stepper). | `GET /api/sales/{sale_id}` | ready validation_error permission_denied partial saved_local success | حدّ المرتجع من الصلاحية؛ partial مسموح كالويب. |
| **POS-11** فشل الحفظ أو الطباعة | `/pos/receipt/[id]/problem`<br>`pos/problem-client.tsx` | ورقة مشكلة الحفظ/الطباعة مع إجراءات «أعد المحاولة» و«اطبع لاحقاً». | محلي (sync-core) ثم PUSH | offline saved_local validation_error server_error | لا تُفقد الفاتورة المحفوظة محلياً. |
| **POS-12** مراجعة تكرار تجاري أو تصحيح | `/pos/duplicates`<br>`pos/duplicates-client.tsx` | قائمة أزواج التكرار؛ القرار ورقة بخيارين وسبب. | `GET /api/sales/duplicates`<br>`POST /api/sales/duplicates/decide` | ready empty conflict permission_denied | القرار للمدير/المالك فقط (manager_required). |
| **SHIFT-01** فتح وردية | `/shifts/open`<br>`shifts/open-client.tsx` | فتح الوردية: حقل رصيد افتتاحي كبير بلوحة أرقام. | `GET /api/shifts/current` | ready validation_error offline saved_local success | يعمل بلا اتصال (saved_local). |
| **SHIFT-02** الوردية الحالية | `/shifts/current`<br>`shifts/current-client.tsx` | الوردية الحالية: صفّ الصندوق المتوقَّع بارز، والحركات قائمة. | `GET /api/shifts/{shift_id}` | ready loading offline pending_sync stale | النقد في الدرج والآجل/التحويل «خارج الصندوق» كالويب. |
| **SHIFT-03** حركة صندوق وتسوية | `/shifts/movements`<br>`shifts/movements-client.tsx` | حركة صندوق: ورقة بنوع الحركة ومبلغ وسبب. | `GET /api/shifts/current`<br>`POST /api/shifts/{shift_id}/requests` | ready validation_error permission_denied success | حدود الصلاحية مطبّقة. |
| **SHIFT-04** إغلاق وعد صندوق | `/shifts/close`<br>`shifts/close-client.tsx` | الإغلاق والعدّ: عدّ الفئات بمحدّدات، والعجز/الزيادة بلون الحالة. | محلي (sync-core) ثم PUSH | ready validation_error partial saved_local success | إغلاق بعجز يحترم حدّ close_short ويطلب السبب. |
| **SHIFT-05** مراجعة فروق وعمليات متأخرة | `/shifts/review`<br>`shifts/review-client.tsx` | مراجعة الفروق: قائمة مرتّبة بالقيمة كالويب؛ «إقرار المراجعة» ورقة. | `GET /api/shifts/review`<br>`POST /api/shifts/{shift_id}/review` | ready empty conflict permission_denied stale | المتأخرات بعد الإقفال بنود مستقلة لا تعدّل اللقطة. |
| **NAT-01** أذونات الكاميرا والباركود | — (أصلية؛ قرار المالك 2026-10-17) | يُستدعى من POS-01 وCAT-01/02 وINV-04/05/09 وHOME-03 وORG-07 وORD-12/13 وMP-08/11. يطلب الإذن في لحظة الحاجة لا عند التشغيل؛ الرفض يشرح الطريق إلى إعدادات النظام ويُبقي الإدخال اليدوي. | `/api/devices/*` و`/api/notify/*` حسب الوظيفة — تُحدَّد في M0 | permission_denied ready success validation_error | مسح EAN-13/Code128 بلا اتصال؛ الإدخال اليدوي متاح دائماً. |
| **NAT-02** الطابعة وأذونات Bluetooth | — (أصلية؛ قرار المالك 2026-10-17) | يستبدل `/print` (WEB-03): اكتشاف طابعات ESC/POS عبر Bluetooth واختيار الافتراضية واختبار طباعة الإيصال العربي. | `/api/devices/*` و`/api/notify/*` حسب الوظيفة — تُحدَّد في M0 | loading permission_denied ready server_error success | الإيصال يطابق قالب الويب حرفاً؛ فشل الطباعة لا يلغي البيع (POS-11). |

### M3 — العملاء والكتالوج والمخزون (25 شاشة)

| الشاشة | مرجع الويب | التكيّف للجوال (وسبب أي انحراف) | النقاط | الحالات | معيار القبول الخاص |
|---|---|---|---|---|---|
| **PTY-01** قائمة العملاء | `/parties`<br>`parties/customers-client.tsx` | قائمة عملاء ببحث أعلى وفلتر أقسام (segmented)، والرصيد على يمين الصف بخط mono. | `GET /api/parties/list`<br>`GET /api/sales` | ready loading empty permission_denied offline stale | الرصيد المركّب «خادمي + معلّق = إجمالي» كالويب. |
| **PTY-02** قائمة الموردين | `/parties/suppliers`<br>`parties/suppliers-client.tsx` | قائمة الموردين بالنمط نفسه. | `GET /api/parties/list` | ready loading empty permission_denied | — |
| **PTY-03** بطاقة طرف وإنشاء وتعديل | `/parties/[id]`<br>`parties/party-card-client.tsx` | بطاقة الطرف: رأس بالاسم والرصيد ثم أقسام (معلومات، آخر الحركات، إجراءات) بدل أعمدة الويب. | `GET /api/parties/{party_id}`<br>`GET /api/sales`<br>`PATCH /api/parties/{party_id}`<br>`POST /api/parties/{party_id}/distinct` | ready validation_error saving success permission_denied conflict | التعديل المتزامن يعطي conflict بنصّ الويب. |
| **PTY-04** رصيد افتتاحي | `/parties/[id]/opening`<br>`parties/opening-client.tsx` | نموذج رصيد افتتاحي قصير. | `GET /api/parties/{party_id}`<br>`GET /api/sales`<br>`PATCH /api/parties/{party_id}`<br>`POST /api/parties/{party_id}/distinct`<br>`POST /api/parties/{party_id}/opening-balance` | ready validation_error permission_denied success | مرة واحدة لكل طرف كالويب. |
| **PTY-05** كشف حساب | `/parties/[id]/statement`<br>`parties/statement-client.tsx` | كشف الحساب: قائمة سطور زمنية برصيد جارٍ، والمعلّق من الجهاز موسوم في آخرها؛ المدى بأزرار مقطعية. | `GET /api/parties/{party_id}/statement`<br>`GET /api/sales` | ready loading empty stale pending_sync offline permission_denied | «لا رصيد جزئي» قبل وصول الخادمي. |
| **PTY-06** تسجيل سداد أو رد مبلغ | `/parties/[id]/payment`<br>`parties/payment-client.tsx` | تسجيل سداد: مبلغ كبير بلوحة أرقام والوسيلة مقطعية. | محلي (sync-core) ثم PUSH | ready validation_error saving saved_local success permission_denied | cash_only للكاشير مطبَّق؛ saved_local بلا اتصال. |
| **PTY-07** دمج أطراف | `/parties/[id]/merge`<br>`parties/merge-client.tsx` | الدمج: اختيار الطرف الآخر ثم معاينة مقارنة صفّاً صفّاً. | `GET /api/parties/{party_id}/merge`<br>`POST /api/parties/{party_id}/distinct`<br>`POST /api/parties/{party_id}/merge` | ready validation_error permission_denied conflict success | التراجع عن الدمج متاح كالويب. |
| **PTY-08** طباعة وتصدير ومشاركة الكشف | `/parties/[id]/statement/share`<br>`parties/share-client.tsx` | المشاركة: ورقة المشاركة الأصلية (واتساب أولاً) والطباعة عبر NAT-02. | `GET /api/parties/statement-exports/{export_id}`<br>`GET /api/parties/{party_id}/statement`<br>`POST /api/parties/{party_id}/statement/export` | ready loading permission_denied success server_error | الرابط المؤقت والتصدير كالويب. |
| **PTY-09** تصحيح تاريخ الأعمال | `/parties/receipts/[receiptId]/correct`<br>`parties/correction-client.tsx` | تصحيح السند: مستند مستقل بسبب إلزامي. | `GET /api/parties/receipts/{receipt_id}/correct`<br>`POST /api/parties/receipts/{receipt_id}/correct` | ready validation_error permission_denied success | تاريخ داخل فترة مقفلة يُمنع برمز period_locked. |
| **CAT-01** قائمة الأصناف والبحث | `/catalog`<br>`app/catalog/catalog-client.tsx` | قائمة الأصناف ببحث ومسح باركود؛ الصورة المصغّرة إن وُجدت. | `GET /api/catalog/items` | ready loading empty offline stale | البحث المحلي بلا اتصال. |
| **CAT-02** إنشاء صنف وبطاقته | `/catalog/[id]`<br>`/catalog/new`<br>`catalog/item-page-client.tsx` | إنشاء صنف بأقسام مجمّعة؛ الباركود يُمسح بالكاميرا (NAT-01) أو يُكتب. | `GET /api/catalog/barcode`<br>`GET /api/catalog/groups`<br>`GET /api/catalog/items/{item_id}`<br>`GET /api/catalog/units`<br>`PATCH /api/catalog/items/{item_id}`<br>… +1 | ready validation_error saving success | التحقق نفسه (اسم، وحدة أساسية). |
| **CAT-03** وحدات وتحويلات وباركود | `/catalog/[id]/units`<br>`catalog/units-client.tsx` | الوحدات والتحويلات قائمة قابلة للتحرير بورقة لكل وحدة. | `GET /api/catalog/items/{item_id}`<br>`GET /api/catalog/units`<br>`PATCH /api/catalog/items/{item_id}/units/{item_unit_id}`<br>`POST /api/catalog/items/{item_id}/units` | ready validation_error success | المعامل والباركود الفريد كالويب. |
| **CAT-04** سعر صنف وتاريخ تغييره | `/catalog/[id]/price`<br>`catalog/price-client.tsx` | السعر وتاريخه: السعر الحالي بارز وتاريخ التغييرات قائمة. | `GET /api/catalog/items/{item_id}/price`<br>`POST /api/catalog/items/{item_id}/price`<br>`POST /api/catalog/items/{item_id}/price-request` | ready validation_error permission_denied success | can_change/can_see_cost من الخادم. |
| **CAT-05** استيراد أو تعديل أسعار متعدد | `/catalog/import`<br>`catalog/import-client.tsx` | الاستيراد: اختيار ملف من مستعرض الملفات الأصلي؛ المعاينة قائمة بالمرفوض وأسبابه. **انحراف محتمل**: الاستيراد الجماعي أنسب للحاسوب — يبقى متاحاً على الهاتف للتطابق. | `GET /api/catalog/prices/import/{batch_id}`<br>`POST /api/catalog/prices/import/preview`<br>`POST /api/catalog/prices/import/{batch_id}/apply`<br>`POST /api/catalog/prices/import/{batch_id}/revert` | ready loading validation_error partial success server_error | التطبيق والتراجع كالويب. |
| **CAT-06** مجموعات الأصناف والأسماء البديلة | `/catalog/groups`<br>`app/catalog/groups/groups-client.tsx` | المجموعات قائمة مع إعادة الترتيب بالسحب. | `GET /api/catalog/groups`<br>`GET /api/catalog/items`<br>`POST /api/catalog/groups`<br>`POST /api/catalog/items/{item_id}/aliases` | ready empty validation_error success | — |
| **INV-01** أرصدة المخزون | `/inventory`<br>`inventory/stock-client.tsx` | أرصدة المخزون قائمة بفلتر الفرع والحالة (تحت الحدّ). | `GET /api/inventory/balances`<br>`GET /api/sales` | ready loading empty stale offline pending_sync partial | المعلّق والجزئي موسومان. |
| **INV-02** سجل حركة الصنف | `/inventory/items/[id]`<br>`inventory/movements-client.tsx` | سجل حركة الصنف قائمة زمنية بأسبابها. | `GET /api/inventory/items/{item_id}/movements` | ready loading empty pending_sync stale | كل كمية لها مستند. |
| **INV-03** افتتاحيات المخزون | `/inventory/openings`<br>`inventory/openings-client.tsx` | الافتتاحيات: قائمة أصناف بكميات قابلة للتحرير. | `GET /api/inventory/openings`<br>`POST /api/inventory/openings`<br>`POST /api/inventory/openings/{opening_id}/approve` | ready validation_error permission_denied success | — |
| **INV-04** استلام بضاعة | `/inventory/receive`<br>`inventory/receive-client.tsx` | الاستلام: مسح الأصناف بالكاميرا تتابعياً، والتكلفة اختيارية كالويب. | محلي (sync-core) ثم PUSH | ready validation_error saving saved_local success | saved_local بلا اتصال. |
| **INV-05** جلسة جرد | `/inventory/count`<br>`inventory/count-client.tsx` | جلسة الجرد: وضع مسح متتابع بملء الشاشة (الكاميرا مفتوحة والعدد يزيد) — **انحراف**: الويب جدول؛ على الهاتف الجرد يتم بالمسح أثناء المشي بين الرفوف. | محلي (sync-core) ثم PUSH | ready saving saved_local partial offline success | جرد أعمى كالويب؛ يعمل بلا اتصال. |
| **INV-06** مراجعة فروق الجرد وتسوية | `/inventory/count/[id]/review`<br>`inventory/review-client.tsx` | مراجعة الفروق قائمة بقيمة الفرق؛ التسوية ورقة. | `GET /api/inventory/count-sessions/{session_id}`<br>`POST /api/inventory/count-sessions/{session_id}` | ready validation_error permission_denied success | stock_adjust (نعم/فرع/اقتراح) مطبَّق. |
| **INV-07** هالك وحجر تالف | `/inventory/items/[id]/damage`<br>`inventory/damage-client.tsx` | الهالك ورقة بالكمية والسبب. | `POST /api/inventory/items/{item_id}/damage` | ready validation_error permission_denied success | — |
| **INV-08** قائمة التحويلات | `/inventory/transfers`<br>`inventory/transfers-client.tsx` | قائمة التحويلات بأقسام (صادر/وارد/في الطريق). | `GET /api/inventory/transfers`<br>`GET /api/sales`<br>`POST /api/inventory/transfers/{transfer_id}/cancel` | ready loading empty partial pending_sync | — |
| **INV-09** إنشاء وإرسال تحويل | `/inventory/transfers/new`<br>`inventory/transfer-new-client.tsx` | إنشاء تحويل: الفرع الوجهة ثم الأصناف بالمسح. | `GET /api/inventory/transfers`<br>`GET /api/inventory/transfers/{transfer_id}`<br>`GET /api/sales` | ready validation_error saving saved_local success partial | saved_local بلا اتصال. |
| **INV-10** استلام تحويل جزئي ومراجعة فرق | `/inventory/transfers/[id]/receive`<br>`inventory/transfer-receive-client.tsx` | استلام التحويل: سطور بكمية مستلمة ومحدّد، والفرق بارز. | `GET /api/inventory/transfers/{transfer_id}`<br>`GET /api/sales` | ready partial validation_error conflict success | partial وconflict بنصوص الويب. |

### M4 — المشتريات والتقارير (11 شاشة)

| الشاشة | مرجع الويب | التكيّف للجوال (وسبب أي انحراف) | النقاط | الحالات | معيار القبول الخاص |
|---|---|---|---|---|---|
| **PUR-01** قائمة أوامر شراء داخلية وتفاصيل | `/purchasing/orders/[id]`<br>`/purchasing/orders`<br>`purchasing/orders-client.tsx` | قائمة أوامر الشراء بحالتها. | `GET /api/inventory/purchasing/orders` | ready loading empty permission_denied | — |
| **PUR-02** إنشاء أمر شراء داخلي | `/purchasing/orders/new`<br>`purchasing/order-new-client.tsx` | إنشاء أمر شراء: مورد ثم سطور. | `GET /api/catalog/items`<br>`GET /api/inventory/purchasing/orders`<br>`POST /api/inventory/purchasing/orders`<br>`POST /api/inventory/purchasing/orders/preview`<br>`POST /api/inventory/purchasing/orders/{order_id}/{action}` | ready validation_error saving success | — |
| **PUR-03** مستند شراء واعتماده | `/purchasing/documents/[id]`<br>`/purchasing/orders/[id]/document`<br>`purchasing/document-client.tsx` | مستند الشراء والاعتماد: الاعتماد زرّ مثبّت أسفل الشاشة مع المبلغ. | `GET /api/inventory/purchasing/documents/{document_id}`<br>`PATCH /api/inventory/purchasing/documents/{document_id}`<br>`POST /api/inventory/purchasing/documents/{document_id}/{action}`<br>`POST /api/inventory/purchasing/orders/{order_id}/document` | ready validation_error permission_denied success | حدّ purchase_approve مطبَّق. |
| **PUR-04** مرتجع مشتريات | `/purchasing/documents/[id]/return`<br>`/purchasing/returns/[id]`<br>`purchasing/return-client.tsx` | مرتجع المشتريات بسطور مختارة. | `GET /api/inventory/purchasing/documents/{document_id}`<br>`GET /api/inventory/purchasing/returns/{return_id}`<br>`PATCH /api/inventory/purchasing/documents/{document_id}`<br>`POST /api/inventory/purchasing/documents/{document_id}/{action}`<br>`POST /api/inventory/purchasing/orders/{order_id}/document`<br>… +1 | ready validation_error partial success | — |
| **PUR-05** التكلفة والهامش | `/purchasing/cost-margin`<br>`purchasing/cost-margin-client.tsx` | التكلفة والهامش قائمة بالأعمدة الأساسية (الصنف، التكلفة، الهامش) وتفاصيل الطريقة بالضغط — **انحراف**: جدول الويب الواسع لا يتّسع. | `GET /api/inventory/purchasing/cost-margin`<br>`POST /api/inventory/purchasing/cost-margin` | ready empty permission_denied phase_locked | الشاشة كلها محجوبة بلا cost_margin_view؛ phase_locked كما هو. |
| **REP-01** تقرير المبيعات | `/reports`<br>`reports/sales-report-client.tsx` | تقرير المبيعات: المدى مقطعي أعلى، الأرقام صفوف، والرسم البياني مبسّط بعرض الشاشة. | `GET /api/reports/sales` | ready loading empty stale pending_sync permission_denied | يطابق رقم الرئيسية؛ عدم الاكتمال معلن. |
| **REP-02** تقرير الذمم | `/reports/receivables`<br>`reports/receivables-report-client.tsx` | تقرير الذمم قائمة أطراف مرتّبة. | `GET /api/reports/receivables` | ready loading empty stale permission_denied | بلا أعمار ديون كالويب. |
| **REP-03** تقرير المخزون والحركات | `/reports/stock`<br>`reports/stock-report-client.tsx` | تقرير المخزون والحركات. | `GET /api/reports/stock` | ready loading empty stale pending_sync | — |
| **REP-04** تقرير الصندوق والورديات | `/reports/cash`<br>`reports/cash-report-client.tsx` | تقرير الصندوق والورديات. | `GET /api/reports/cash` | ready loading empty conflict stale | الوردية المكررة محجورة خارج المجموع. |
| **REP-05** الهامش والمقارنة بين الفروع | `/reports/margin`<br>`reports/margin-report-client.tsx` | الهامش ومقارنة الفروع. | `GET /api/reports/margin` | ready empty permission_denied phase_locked | phase_locked قبل السياسة كالويب. |
| **REP-06** تصدير تقرير ومعاينته | `/reports/export`<br>`reports/export-client.tsx` | التصدير: المعاينة في عارض أصلي، والملف عبر ورقة المشاركة. | `GET /api/reports/export/preview`<br>`GET /api/reports/exports`<br>`POST /api/reports/exports`<br>`POST /api/reports/exports/limit-request` | ready loading validation_error success server_error | حدّ الصفحات والعدد كالويب. |

### M5 — السوق — شراءً وبيعاً (38 شاشة)

| الشاشة | مرجع الويب | التكيّف للجوال (وسبب أي انحراف) | النقاط | الحالات | معيار القبول الخاص |
|---|---|---|---|---|---|
| **MP-01** رئيسية السوق | `/market`<br>`market/home-client.tsx` | رئيسية السوق: بحث أعلى، المنطقة رقاقة، والموردون والعروض قوائم. | `GET /api/public/market` | ready loading empty offline stale | server_error بإعادة محاولة (§١٦٠)؛ الفارغ بلا منطقة صادق. |
| **MP-02** دليل المخازن والمتاجر | `/market/directory`<br>`market/directory-client.tsx` | الدليل قائمة منشآت بفلاتر في ورقة. | `GET /api/public/market`<br>`GET /api/public/market/directory` | ready loading empty stale | — |
| **MP-03** ملف منشأة منشور | `/market/suppliers/[id]`<br>`market/supplier-client.tsx` | ملف المنشأة: رأس ثم أقسام. | `GET /api/market/lists/{list_id}`<br>`GET /api/public/market`<br>`GET /api/public/market/suppliers/{tenant_id}` | ready loading permission_denied expired | — |
| **MP-04** نتائج بحث المنتجات والمقارنة | `/market/search`<br>`market/search-client.tsx` | نتائج البحث مجمّعة بالوحدة كالويب (لا «الأرخص» عبر وحدات). | `GET /api/public/market`<br>`GET /api/public/market/search` | ready loading empty stale partial | — |
| **MP-05** تفاصيل عرض | `/market/offers/public/[id]`<br>`market/offer-detail-client.tsx` | تفاصيل العرض: السعر والوحدة بارزان، «أضف إلى السلة» مثبّت أسفل. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/public/market` | ready empty expired permission_denied stale | انتهاء الصلاحية يُسقط السعر. |
| **MP-06** متابعة مورد وقائمة المتابعين الخاصة | `/market/following`<br>`market/following-client.tsx` | المتابعة قائمة مع سحب لإلغاء المتابعة. | `GET /api/market/following`<br>`POST /api/market/following`<br>`POST /api/market/following/{follow_id}/unfollow` | ready empty permission_denied success | — |
| **MP-07** مشاركة رابط ودعوة منشأة | `/market/i/[token]`<br>`/market/share`<br>`market/share-client.tsx` | المشاركة والدعوة: ورقة المشاركة الأصلية + رمز QR يُعرض. | `GET /api/market/invites`<br>`GET /api/market/share/preview`<br>`GET /api/public/market/invite/{token}`<br>`POST /api/market/invite/{token}/accept`<br>`POST /api/market/invites`<br>… +1 | ready expired permission_denied success | — |
| **MP-08** تهيئة بائع وتحقق الهوية | `/market/seller`<br>`market/seller-client.tsx` | تهيئة البائع: خطوات، والمستندات من الكاميرا. | `GET /api/market/account`<br>`POST /api/market/account/verification/submit`<br>`PUT /api/market/account` | ready loading validation_error permission_denied success | التحقق قيد تحقّق لا قيد باقة. |
| **MP-09** إدارة صفحة المنشأة | `/market/profile`<br>`market/profile-client.tsx` | صفحة المنشأة: نموذج بأقسام. | `GET /api/market/profile`<br>`PUT /api/market/profile` | ready validation_error saving permission_denied success | — |
| **MP-10** قائمة العروض الداخلية للبائع | `/market/offers`<br>`market/offers-client.tsx` | عروضي قائمة بحالة التأكيد. | `GET /api/market/offers` | ready loading empty expired | — |
| **MP-11** إنشاء عرض ونشره | `/market/offers/[id]`<br>`/market/offers/new`<br>`market/offer-edit-client.tsx` | إنشاء عرض ونشره: خطوات؛ الصور من الكاميرا. | `GET /api/catalog/items`<br>`GET /api/market/offers`<br>`GET /api/market/offers/{offer_id}`<br>`POST /api/market/offers`<br>`POST /api/market/offers/preview`<br>… +1 | ready validation_error saving permission_denied success | market_publish للمالك. |
| **MP-12** أسعار شرائح وقوائم خاصة | `/market/lists/[id]`<br>`/market/lists/new`<br>`/market/lists`<br>`market/lists-client.tsx` | القوائم الخاصة وأسعار الشرائح: قائمة؛ الشرائح صفوف قابلة للتحرير. | `GET /api/market/lists`<br>`GET /api/market/lists/{list_id}`<br>`POST /api/market/lists`<br>`POST /api/market/lists/{list_id}/members`<br>`POST /api/market/lists/{list_id}/members/{member_id}/{action}`<br>… +1 | ready empty validation_error permission_denied | — |
| **MP-13** تجديد تأكيد سعر وتوفر | `/market/renewals`<br>`market/renewals-client.tsx` | تجديد التأكيد: قائمة بإجراء سحب «جدّد». | `GET /api/market/offers`<br>`GET /api/market/renewals`<br>`POST /api/market/offers/{offer_id}/renew` | ready expired saving permission_denied success | — |
| **MP-14** عرض منتهٍ أو منشأة معلقة | `/market/unavailable`<br>`market/unavailable-client.tsx` | عرض منتهٍ أو منشأة معلّقة. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/public/market`<br>`GET /api/public/market/suppliers/{tenant_id}/status` | ready expired permission_denied | — |
| **MP-15** بلاغ عن عرض أو انتحال | `/market/report`<br>`/market/reports/[id]`<br>`/market/reports`<br>`market/report-client.tsx` | البلاغ: نموذج بسبب مصنّف. | `GET /api/market/invites`<br>`GET /api/market/reports`<br>`GET /api/market/reports/{report_id}`<br>`GET /api/market/share/preview`<br>`GET /api/public/market/invite/{token}`<br>… +4 | ready validation_error permission_denied success | — |
| **ORD-01** سلة ومسودة طلب | `/market/cart`<br>`market/cart-client.tsx` | السلة: سطور بمحدّد كمية، والمجموع وزرّ المتابعة مثبّتان. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/public/market`<br>`POST /api/market/orders/verify` | ready empty offline validation_error stale | مسودة السلة تبقى بلا اتصال. |
| **ORD-02** مراجعة وإرسال طلب أو طلب سعر | `/market/checkout`<br>`market/checkout-client.tsx` | المراجعة والإرسال. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify` | ready validation_error saving expired success server_error | — |
| **ORD-03** طلبات المشتري | `/market/orders`<br>`market/orders-client.tsx` | طلباتي قائمة بالحالة والخطوة التالية. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/verify`<br>… +1 | ready loading empty stale pending_sync | — |
| **ORD-04** طلبات المورد | `/market/orders/incoming`<br>`market/incoming-client.tsx` | طلبات العملاء (للمورد). | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/incoming`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +2 | ready loading empty expired | انقضاء المهلة «لم يُرد عليه» لا رفض. |
| **ORD-05** تفاصيل الطلب وسجل الإصدارات | `/market/orders/[id]`<br>`market/order-detail-client.tsx` | تفاصيل الطلب: الخط الزمني للإصدارات (Timeline) ثم السطور. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +3 | ready loading partial conflict permission_denied | — |
| **ORD-06** إعداد عرض سعر من المورد | `/market/orders/[id]/quote`<br>`market/quote-client.tsx` | عرض السعر من المورد: سطور بأسعار قابلة للتحرير. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/market/orders/{order_id}/quote`<br>`GET /api/public/market`<br>… +6 | ready validation_error saving expired success partial | — |
| **ORD-07** مقارنة العرض وقبوله أو رفضه | `/market/orders/[id]/compare`<br>`market/compare-client.tsx` | المقارنة والقبول: فرق السطور واضح، القبول/الرفض أزرار مثبّتة. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/market/orders/{order_id}/compare`<br>`GET /api/public/market`<br>… +6 | ready validation_error expired conflict success | — |
| **ORD-08** تجهيز وتسليم جزئي | `/market/orders/[id]/ship`<br>`market/ship-client.tsx` | الشحن الجزئي: كميات بمحدّدات. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/shipments`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +3 | ready validation_error partial success | — |
| **ORD-09** استلام جزئي ورفض كمية | `/market/orders/[id]/receive`<br>`market/receive-client.tsx` | الاستلام الجزئي: كميات ورفض بسبب. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}`<br>`GET /api/market/orders/{order_id}/receive`<br>`GET /api/public/market`<br>… +5 | ready validation_error partial conflict success | ما يُستلم يدخل المخزون ودفتر المورد. |
| **ORD-10** إلغاء المتبقي | `/market/orders/[id]/cancel-remaining`<br>`market/cancel-remaining-client.tsx` | إلغاء المتبقي. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/cancel-remaining`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +3 | ready validation_error partial permission_denied success | — |
| **ORD-11** طلب مرتجع تجاري | `/market/orders/[id]/return`<br>`market/return-client.tsx` | طلب مرتجع تجاري. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/returns`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +4 | ready validation_error partial success | — |
| **ORD-12** خلاف وأدلته وتطور حالته | `/market/orders/[id]/disputes`<br>`market/disputes-client.tsx` | الخلاف: الأدلة من الكاميرا والخط الزمني للحالة. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/disputes`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +3 | ready empty partial permission_denied success | لا تحريك رصيد. |
| **ORD-13** إثبات دفع ومتابعة المطابقة | `/market/orders/[id]/payment`<br>`market/payment-client.tsx` | إثبات الدفع: صورة الإيصال من الكاميرا. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/payments`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +4 | ready validation_error partial stale success | المرجع مرة واحدة؛ التوزيع صريح. |
| **ORD-14** تعارض نسخة أو رد مفقود | `/market/orders/recover`<br>`market/recover-client.tsx` | التعارض/الرد المفقود. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>`POST /api/market/orders/probe`<br>… +2 | ready conflict server_error success | — |
| **ORD-15** استعادة طلب بعد فقد خادمي | `/market/orders/[id]/restore`<br>`market/restore-client.tsx` | الاستعادة بعد فقد خادمي. | `GET /api/market/offers/public/{offer_id}`<br>`GET /api/market/orders`<br>`GET /api/market/orders/{order_id}/restore`<br>`GET /api/public/market`<br>`POST /api/market/orders`<br>… +3 | conflict stale permission_denied success | — |
| **LINK-01** ربط الطرف المحلي بالمنشأة | `/market/link/parties`<br>`market/link-parties-client.tsx` | ربط الطرف — phase_locked بنصّه حتى يرفعه المشغّل. | `GET /api/market/link/parties`<br>`POST /api/market/link/parties/{party_id}/{action}` | ready validation_error permission_denied success phase_locked | phase_locked كما في الويب. |
| **LINK-02** مطابقة أصناف ووحدات الطرفين | `/market/link/items`<br>`market/link-items-client.tsx` | مطابقة الأصناف — phase_locked. | `GET /api/market/link/items`<br>`POST /api/market/link/items`<br>`POST /api/market/link/items/{mapping_id}/{action}` | ready validation_error conflict success phase_locked | — |
| **LINK-03** تحويل استلام أو بيع إلى مستند | `/market/link/receipts`<br>`market/link-receipts-client.tsx` | تحويل الاستلام لمستند — phase_locked. | `GET /api/market/link/receipts`<br>`GET /api/market/link/receipts/{shipment_id}/{action}`<br>`POST /api/market/link/receipts/{shipment_id}/{action}` | ready validation_error conflict success phase_locked | — |
| **LINK-04** روابط مستندات وتسوية فرق | `/market/link/documents`<br>`market/link-documents-client.tsx` | روابط المستندات — phase_locked. | `GET /api/market/link/documents`<br>`POST /api/market/link/documents/{link_id}/{action}` | ready empty conflict permission_denied phase_locked | — |
| **LINK-05** تحويل المرتجع لمستند عكسي | `/market/link/returns`<br>`market/link-returns-client.tsx` | المرتجع العكسي — phase_locked. | `GET /api/market/link/returns`<br>`POST /api/market/link/returns/{return_id}/{action}` | ready partial validation_error success phase_locked | — |
| **GROW-01** اقتراح إعادة التوريد | `/grow/replenish`<br>`market/grow-replenish-client.tsx` | اقتراح التوريد — phase_locked. | `GET /api/grow/replenish`<br>`POST /api/grow/replenish` | ready empty permission_denied phase_locked | — |
| **GROW-02** تحليلات المورد | `/grow/suppliers`<br>`market/grow-suppliers-client.tsx` | تحليلات المورد — phase_locked. | `GET /api/grow/suppliers` | ready loading empty stale phase_locked | — |
| **GROW-03** طلب عرض ممول ومعاينته | `/grow/promote`<br>`market/grow-promote-client.tsx` | العرض الممول — phase_locked. | `GET /api/grow/promote`<br>`POST /api/grow/promote` | ready validation_error permission_denied phase_locked | — |

### M6 — المنشأة والتواصل وأدوات البيانات (26 شاشة)

| الشاشة | مرجع الويب | التكيّف للجوال (وسبب أي انحراف) | النقاط | الحالات | معيار القبول الخاص |
|---|---|---|---|---|---|
| **ORG-01** المستخدمون والدعوات | `/org/users`<br>`org/users-client.tsx` | المستخدمون والدعوات قائمة؛ الدعوة بورقة المشاركة الأصلية. | `GET /api/org/users`<br>`POST /api/org/invitations`<br>`POST /api/org/invitations/{invitation_id}/{action}` | ready loading empty validation_error expired success | حدّ المستخدمين من الباقة مطبَّق. |
| **ORG-02** مصفوفة الأدوار والصلاحيات | `/org/roles`<br>`org/roles-client.tsx` | مصفوفة الأدوار: **انحراف** — جدول 13×4 لا يتّسع؛ تُعرض الصلاحيات دوراً دوراً (اختر الدور ← قائمة الصلاحيات بقيمها) مع نفس القيم والحدود. | `GET /api/org/roles`<br>`PUT /api/org/roles` | ready validation_error permission_denied success | كل خلية قابلة للتحرير كما في الويب؛ الحفظ يطابق الحمولة. |
| **ORG-03** الفروع وتفاصيلها | `/org/branches`<br>`org/branches-client.tsx` | الفروع قائمة وتفاصيل. | `GET /api/org/branches`<br>`GET /api/org/devices`<br>`POST /api/org/branches`<br>`POST /api/org/branches/{branch_id}/{action}` | ready empty validation_error permission_denied | حدّ الفروع من الباقة. |
| **ORG-04** قائمة الأجهزة وتفاصيلها | `/org/devices`<br>`org/devices-client.tsx` | الأجهزة قائمة بحالة كل جهاز. | `GET /api/org/devices` | ready loading empty offline stale | — |
| **ORG-05** سحب مستخدم أو نطاق أو جهاز | `/org/users/[id]/revoke`<br>`org/revoke-client.tsx` | السحب: ورقة بنطاق السحب وتأكيد مزدوج. | `GET /api/org/users/{user_id}/revocation`<br>`POST /api/org/users/{user_id}/revocation` | ready validation_error permission_denied pending_sync success | pending_sync للجهاز المسحوب غير المتصل. |
| **ORG-06** الاشتراك والباقات | `/org/subscription`<br>`org/subscription-client.tsx` | الاشتراك: الباقة الحالية والاستحقاقات قائمة، والترقية بورقة. | `GET /api/org/subscription`<br>`GET /api/org/subscription/addon`<br>`GET /api/org/subscription/change`<br>`POST /api/org/subscription/addon`<br>`POST /api/org/subscription/change` | ready loading permission_denied expired | المبالغ للمالك وحده (can_see_amounts). |
| **ORG-07** إثبات تحويل الاشتراك ومراجعته | `/org/subscription/receipts/[id]`<br>`/org/subscription/renew`<br>`org/receipt-client.tsx`, `org/renew-client.tsx` | إثبات التحويل: صورة الإيصال من الكاميرا أو المعرض (NAT-01) بدل رفع ملف. | `GET /api/org/subscription/addon`<br>`GET /api/org/subscription/change`<br>`GET /api/org/subscription/proofs`<br>`GET /api/org/subscription/receipts/{receipt_id}`<br>`POST /api/org/subscription/proofs`<br>… +1 | ready validation_error saving success server_error | حدّ الحجم 2 ميغابايت ورقم الإيصال كالويب. |
| **ORG-08** انتهاء الاشتراك | `/org/subscription/expiry`<br>`org/expiry-client.tsx` | انتهاء الاشتراك: ما يستمر وما يتوقف قائمتان. | `GET /api/org/subscription/expiry` | ready expired permission_denied | مصدر واحد مع الويب (STOPS/CONTINUES). |
| **ORG-09** إعدادات المنشأة واللغة والقوالب | `/org/settings`<br>`org/settings-client.tsx` | الإعدادات أقسام مجمّعة بنمط إعدادات النظام. | `GET /api/org/ownership`<br>`GET /api/org/settings`<br>`POST /api/org/ownership`<br>`POST /api/org/ownership/{transfer_id}/{action}`<br>`PUT /api/org/settings` | ready validation_error success conflict | conflict عند التعديل المتزامن. |
| **ORG-10** سجل تدقيق | `/org/audit`<br>`org/audit-client.tsx` | سجل التدقيق قائمة زمنية بفلتر. | `GET /api/org/audit` | ready loading empty permission_denied | — |
| **NOT-01** صندوق الوارد والتفاصيل | `/notify/inbox/[id]`<br>`/notify/inbox`<br>`notify/inbox-client.tsx` | الوارد قائمة؛ التفاصيل شاشة مكدّسة. | `GET /api/notifications`<br>`POST /api/notifications/{notification_id}/{action}`<br>`PUT /api/notifications/preferences` | ready loading empty expired permission_denied | — |
| **NOT-02** تفضيلات التنبيه | `/notify/preferences`<br>`notify/preferences-client.tsx` | التفضيلات قائمة مفاتيح (switch) أصلية. | `GET /api/notifications/preferences`<br>`PUT /api/notifications/preferences` | ready validation_error offline success | — |
| **NOT-03** قائمة الحملات | `/notify/campaigns`<br>`notify/campaigns-client.tsx` | قائمة الحملات بحالتها. | `GET /api/campaigns` | ready loading empty permission_denied | — |
| **NOT-04** إنشاء حملة واختيار الجمهور | `/notify/campaigns/new`<br>`notify/campaign-new-client.tsx` | إنشاء حملة: خطوات (الجمهور ← النص ← المعاينة). | `POST /api/campaigns`<br>`POST /api/campaigns/preview` | ready empty validation_error permission_denied | campaign_create مطبَّق. |
| **NOT-05** معاينة واعتماد وجدولة | `/notify/campaigns/[id]/approve`<br>`notify/campaign-approve-client.tsx` | المعاينة والاعتماد والجدولة: منتقي تاريخ ووقت أصلي. | `GET /api/campaigns/{campaign_id}`<br>`POST /api/campaigns/{campaign_id}/{action}` | ready validation_error saving expired success | campaign_approve منفصل عن الإنشاء؛ إرسال ليلي يتطلب التأكيد. |
| **NOT-06** نتائج حملة وإلغاؤها | `/notify/campaigns/[id]`<br>`notify/campaign-results-client.tsx` | نتائج الحملة وإلغاؤها. | `GET /api/campaigns/{campaign_id}`<br>`POST /api/campaigns/{campaign_id}/{action}` | ready empty partial server_error success | — |
| **NAT-03** الإشعارات والرابط العميق | — (أصلية؛ قرار المالك 2026-10-17) | يستبدل `/notify` (WEB-02): إذن الإشعارات الأصلي، تسجيل رمز الجهاز للخادم، وفتح الروابط العميقة (دعوة ACC-06، طلب سوق، كشف حساب). | `/api/devices/*` و`/api/notify/*` حسب الوظيفة — تُحدَّد في M0 | expired permission_denied ready success | الرابط المنتهي expired؛ الرابط لمنشأة أخرى permission_denied بلا تفاصيل (كـPUB-04). |
| **ACC-09** الحساب والأمان والجلسات | `/account/sessions`<br>`app/account/sessions/sessions-client.tsx` | قائمة جلسات مع سحب لإنهاء جلسة (swipe action) إضافة إلى الزر. | `GET /api/account/sessions`<br>`POST /api/account/sessions/{session_id}/revoke` | ready loading permission_denied pending_sync success server_error | إنهاء جلسة يطلب تأكيداً كما في الويب. |
| **SYS-02** تفاصيل عملية متعثرة | `/sync/operations/[id]`<br>`sys/operation-client.tsx` | تفاصيل عملية متعثرة. | `GET /api/sales` | ready empty server_error conflict pending_sync | — |
| **SYS-03** تعارض وحجر ومراجعة مالك | `/sync/review`<br>`sys/review-client.tsx` | التعارض والحجر: قائمة؛ القرار ورقة. | `GET /api/sales`<br>`GET /api/sync/quarantine`<br>`GET /api/sync/quarantine/{item_id}`<br>`POST /api/sync/quarantine/{item_id}/decide` | ready conflict permission_denied success | conflict_review للمالك. |
| **SYS-05** تصدير نسخة محلية | `/sync/backup`<br>`sys/backup-client.tsx` | النسخة المحلية: تُحفظ بملف عبر ورقة المشاركة/الملفات (expo-file-system) بكلمة حماية وAES-GCM كالويب. | `POST /api/support/backups` | ready saving validation_error success server_error | الملف قابل للاستعادة على الويب والعكس. |
| **SYS-06** استعادة نسخة ومعاينتها | `/sync/restore`<br>`sys/restore-client.tsx` | الاستعادة: اختيار الملف من مستعرض الملفات. | محلي (sync-core) ثم PUSH | ready validation_error conflict partial success server_error | المعاينة قبل الاستعادة كالويب. |
| **SYS-07** استرداد جهاز مسحوب | `/sync/recovery`<br>`sys/recovery-client.tsx` | استرداد جهاز مسحوب. | `GET /api/sales`<br>`GET /api/sync/recovery`<br>`POST /api/sync/recovery/{device_id}/{action}` | ready permission_denied pending_sync conflict success | — |
| **SYS-08** تغير جيل الخادم والمصالحة | `/sync/epoch`<br>`sys/epoch-client.tsx` | تغيّر جيل الخادم والمصالحة. | `GET /api/sales` | conflict stale pending_sync success | — |
| **SYS-10** استيراد بيانات | `/sync/import`<br>`sys/import-client.tsx` | استيراد البيانات من ملف. | `POST /api/imports/preview`<br>`POST /api/imports/{batch_id}/apply`<br>`POST /api/imports/{batch_id}/decide`<br>`POST /api/imports/{batch_id}/revert` | ready loading validation_error partial success server_error | — |
| **SYS-11** الدعم والتشخيص | `/support`<br>`sys/support-client.tsx` | الدعم والتشخيص: إرسال التشخيص عبر ورقة المشاركة. | `GET /api/sales`<br>`POST /api/support/reports` | ready empty permission_denied success | لا بيانات حسّاسة في التشخيص. |

## ٢.٤ استراتيجية الترحيل

لا توجد شاشات جوال قديمة تُزال، فالترحيل هنا **إطلاق تدريجي بجانب الويب** لا استبدال:

- **الفروع**: `apps/mobile` يدخل `main` من المعلم 1 بوظيفة CI خاصة (lint، tsc، Jest، اختبارات العقد على محوّل SQLite، واختبارات شاشات على المحاكي بـMaestro). كل وحدة في PR مستقل بالحلقة نفسها المتّبعة في الويب. لا فرع طويل العمر.
- **أعلام الإصدار**: الخادم يعيد `mobile_min_version` و`mobile_modules` (من إعدادات المشغّل PLT-12 القائمة) فتُفتح الوحدات على الجوال وحدةً وحدة؛ وحدة لم تكتمل تفتح الشاشة المقابلة في متصفح داخلي على الويب بدل شاشة ناقصة.
- **قنوات التوزيع**: EAS Build إلى TestFlight وGoogle Play Internal Testing أولاً، ثم متجر محدود لمتاجر التجربة الميدانية، ثم عام.
- **التحديث**: EAS Update للتعديلات غير الأصلية، مع منع تطبيق تحديث يغيّر المخطط فوق عمليات معلّقة (NAT-04).
- **التطابق مضمون آلياً**: جدول الملحق أ يصير قائمة تحقق مولّدة؛ كل PR يحدّث عمود «على الجوال» فلا تُنسى شاشة، وأي شاشة ويب جديدة تفشل فحص التطابق حتى تُضاف إلى الجوال أو تُستثنى بقرار مكتوب.
- **الويب يبقى المرجع**: أي تعديل سلوك على الويب يُكتب مرة في الحزم المشتركة (النصوص، التحقق، الأنواع) فيصل الجوال تلقائياً.

## ٢.٥ المخاطر والأسئلة المفتوحة (تحتاج قرارك)

| # | الخطر/السؤال | الأثر | اقتراحي |
|---|---|---|---|
| 1 | **بوابة التجربة الميدانية** مؤجّلة، وبدء Expo مشروط بها وبموافقتك الكتابية | لا تنفيذ قبل القرار | إمّا رفع البوابة كتابياً، أو تنفيذ المعلم 0 وحده الآن (يفيد الويب أيضاً) |
| 2 | **حسابا المطوّر** Apple ($99/سنة) وGoogle Play ($25 مرة) باسم الكيان القانوني، وتوفّر برنامج Apple في السودان يحتاج تحقّقاً | قد يمنع النشر على iOS | التحقق قبل المعلم 1؛ Android أولاً إن تعذّر |
| 3 | **الطابعات**: لا قائمة عتاد معتمدة (قرار سابق: لا قائمة قبل تجربة فعلية) | NAT-02 قد لا يعمل مع طابعات المتاجر | جمع موديلات طابعات متاجر التجربة قبل M2 |
| 4 | **ازدواج مصدر الأدوار** (6 من 13 صلاحية فقط من المصفوفة) | الجوال يرث تعارضاً قائماً | إصلاحه في الخادم ضمن M0 أو قبول السلوك الحالي صراحةً |
| 5 | **استخراج النصوص** يلمس كل شاشات الويب | خطر انحدار بصري/نصّي في الويب | يحرسه Playwright الحرفي القائم؛ يُنفَّذ وحدةً وحدة |
| 6 | **رمز التجديد على الجوال** تغيير أمني | يحتاج مراجعة | تدوير عند كل استعمال، ربط بالجهاز، إبطال عند سحب الجهاز (ORG-05) |
| 7 | **الإشعارات الأصلية**: الويب على Web Push (VAPID)؛ الجوال يحتاج APNs/FCM عبر Expo Push | عمل خادمي إضافي | مزوّد إرسال ثانٍ خلف واجهة الإشعارات القائمة |
| 8 | **العربية من اليمين في React Native** تتطلب `forceRTL` وإعادة تشغيل أولى، ومكتبات قد لا تحترم RTL | عيوب تخطيط | اختبار كل مكوّن من الاثني عشر بـRTL قبل أي شاشة |
| 9 | **أداء الأجهزة الضعيفة** (هواتف 2–3 غيغابايت ذاكرة شائعة في السودان) مع SQLite محلي كبير | بطء البيع | معيار أداء في M2: فتح البيع < 1 ث وإضافة صنف < 100 مللي ث على جهاز مرجعي متوسط |
| 10 | **الاستيراد الجماعي والمصفوفات الكبيرة** (CAT-05، ORG-02، SYS-10) أنسب للحاسوب | تجربة ضعيفة على الهاتف | تبقى للتطابق بتكيّف موثّق؛ يمكنك استثناؤها بقرار |

## ٢.٦ المعالم والجهد التقريبي

> التقدير **تقريبي وغير مقيس** (بطلبك)، بافتراض مطوّر React Native متمرّس واحد بمساعدة المنفّذ، وعلى أن المعلم 0 يسبق الباقي. يُعاد تقديره بعد المعلم 1 من سرعة فعلية.

| المعلم | المحتوى | الشاشات | الجهد التقريبي |
|---|---|---|---|
| **M0 — المتطلبات المشتركة** | وصف ردود العقد؛ `@sting/texts` (استخراج النصوص من الويب)؛ `@sting/app-core` (التحقق، رموز الأخطاء، المنسّقات، غلاف API)؛ مسار تجديد الجلسة للجوال؛ مولّد `tokens.native.ts`؛ قرار ازدواج الأدوار | 0 (يلمس الويب كله) | 4–6 أسابيع |
| **M1 — الأساس** | `apps/mobile`، `@sting/ui-native` (12 مكوّناً)، القشرة والتبويبات، محوّل SQLite، الدخول والجهاز والقفل، الرئيسية والبحث، مركز المزامنة، NAT-04 | 14 | 5–7 أسابيع |
| **M2 — البيع اليومي** | نقطة البيع كاملة، الورديات، الماسح NAT-01، الطابعة NAT-02 | 18 | 5–7 أسابيع |
| **M3 — العملاء والكتالوج والمخزون** | الأطراف، الكتالوج، المخزون والجرد والتحويلات | 25 | 5–6 أسابيع |
| **M4 — المشتريات والتقارير** | أوامر الشراء والمستندات، التقارير الستة | 11 | 2–3 أسابيع |
| **M5 — السوق** | المشتري والبائع والطلبات (LINK وGROW بحالة phase_locked كالويب) | 38 | 6–8 أسابيع |
| **M6 — المنشأة والتواصل والبيانات** | المستخدمون والأدوار والفروع والاشتراك، الإشعارات والحملات وNAT-03، النسخ والاستعادة والدعم | 26 | 4–5 أسابيع |
| **M7 — التصليب والنشر** | إمكانية الوصول، الأداء، الداكن، تجربة على أجهزة حقيقية، رفع المتجرين | — | 2–3 أسابيع |

**الترتيب ملزم** لأن كل معلم يعتمد على سابقه: البيع (M2) يحتاج القشرة والتخزين والجلسة (M1)، والسوق (M5) يحتاج المخزون والأطراف (M3) ليدخل المستلَم الدفتر. M4 وM6 يمكن تبديل ترتيبهما.

---

## الملحق أ — جدول مسارات الويب الكامل (مولَّد من الكود)

الأعمدة: المسار · الشاشة (`data-screen`) · الغرض (اسم الشاشة من مصفوفة الحالات أو تعليق الكود) · من يصل · المكوّن الرئيسي · النقاط (حتى 6؛ تُستثنى `POST /api/auth/logout` المشتركة في كل الشاشات). المسارات خارج نطاق الجوال (المشغّل، البوابة، العامة، `/dev`) باقية في الجدول للمرجع.

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