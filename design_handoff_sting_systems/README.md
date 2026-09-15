# Handoff: Sting Systems — نظام إدارة المحلات والسوق B2B

> **اللغة والاتجاه:** المنتج عربي أولاً، `dir="rtl"` على مستوى الجذر. كل نص واجهة في هذه الحزمة هو النص النهائي المعتمد — لا تترجمه ولا تعد صياغته.

## Overview
حزمة تسليم لنظام Sting: تطبيق إدارة محل (نقاط بيع، مخزون، أطراف وذمم، ورديات، تقارير)، سوق B2B للاكتشاف والطلبات بين المنشآت، بوابة زبون، ولوحة مشغّل خدمة (إدارة Sting). التصميم يغطي **164 معرف شاشة** في **22 مجموعة**، **4069 إطاراً مطلوباً** (منصة × مقاس × حالة)، **17 رحلة تفاعلية** (F01–F17)، و**150 معيار قبول** (ACC-01–150).

الحالة: كل الـ 164 شاشة **owner_approved**، و**كلها مرسومة** — لكل شاشة إطارٌ حقيقي لكل حالة في سجلها، ولا شاشة بلا إطار ولا إطار بلا نسبة. آخر تحديث للحزمة 2026-09-14.

**ما يعنيه «مرسوم» هنا:** 788 إطاراً من 4069 مرسومة فعلاً ومنسوبة صفاً بصفٍ إلى المصفوفة — كل حالة عند `W/1440` وإطارا تكيّف عند `M/390` و`D/1920` لكل شاشة. باقي تركيبات المنصّة×المقاس **موصوفة** في لوحة «ما يتغيّر» داخل كل شاشة ولم تُوسم مرسومة: وصفُ التكيّف ليس إطاراً، والمصفوفة تقول الحقيقة لا الرقم المريح. التفصيل في `handoff/not-drawn.md`.

## About the Design Files
الملفات في هذه الحزمة هي **مراجع تصميم مكتوبة بـ HTML** — نماذج تُظهر الشكل والسلوك المقصودين، وليست كوداً إنتاجياً يُنسخ كما هو. المطلوب هو **إعادة بناء هذه التصاميم داخل بيئة الكود المستهدفة** (React / Vue / SwiftUI / React Native / أي بيئة قائمة) باستخدام أنماطها ومكتباتها المعتمدة. إن لم توجد بيئة بعد، اختر الإطار الأنسب للمشروع ونفّذ التصاميم فيه.

هذه الملفات تستخدم منظومة عرض داخلية (`support.js`, `x-dc`) — تجاهل هذه الطبقة تماماً؛ ما يهم هو الماركب والأنماط المضمّنة داخل كل شاشة.

## Fidelity
**High-fidelity (hifi).** الألوان والخطوط والمسافات والنصوص نهائية. أعد بناء الواجهة بدقة بصرية عالية باستخدام مكتبات وأنماط الكودبيس القائم. الاستثناء الوحيد: الصور — لا توجد أصول صور حقيقية في الحزمة، وأماكنها معلّمة كمواضع placeholder.

## المرجع الملزم للسلوك
`22-Rules-Register.dc.html` هو **سجل القواعد** (R-01 وما بعدها) ويحكم كل سلوك مختلف عليه: من يرى ماذا، ما يُسمح تعديله، ما لا يُوعد به. عند أي تعارض بين الشاشة والسجل، **السجل يفوز**. ملاحظة تنفيذية مهمة: R-04 (ظهور السجلات) محصور على **قراءة المالك فقط**، ولغير المالك يظهر «أثر الإجراء» لا السجل.

## Screens / Views
الوصف الكامل لكل شاشة — الغرض، التخطيط، المكونات، النصوص، الحالات — موجود بصرياً في ملفات الشاشات المرفقة. الجدول التالي هو السجل المرجعي؛ ابنِ كل شاشة من ملفها المقابل في قسم Files.

معنى الأعمدة: **المنصات** W=ويب، M=موبايل، D=ديسكتوب، A=إدارة Sting، C=بوابة الزبون. **المرحلة** أساسي = الإصدار الأول، M1–M4 = مراحل لاحقة، «مشروط» = يتطلب قراراً تجارياً.

### ACC — الدخول والتهيئة  (10 شاشة)

**الأدوار:** زائر، مالك، كاشير، أمين مخزن، مدعو  
**مرجع الوثيقة:** §٣،٩،١٣،١٤

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `ACC-01` | ترحيب واختيار الدخول أو إنشاء منشأة | ACC | W/M/D | أساسي | ready, offline, server_error | C-FRAME, C-BTN, C-NOTICE |
| `ACC-02` | تسجيل ودخول واستعادة الوصول | ACC | W/M/D | أساسي | ready, loading, validation_error, offline, expired, server_error, success | C-FIELD, C-BTN, C-NOTICE |
| `ACC-03` | اختيار المنشأة والفرع | ACC | W/M/D | أساسي | ready, loading, empty, permission_denied, offline, stale | C-ORGSW, C-PICK, C-NOTICE |
| `ACC-04` | إنشاء المنشأة ووصفة القطاع | ACC | W/M/D | أساسي | ready, validation_error, saving, success, server_error | C-FIELD, C-DIALOG, C-NOTICE |
| `ACC-05` | تجهيز الجهاز والتنزيل الأول | ACC | W/M/D | أساسي | loading, offline, partial, stale, server_error, success | C-NOTICE, C-SYNC, C-BTN |
| `ACC-06` | قبول دعوة موظف أو منشأة سوق | ACC | W/M/D | أساسي | ready, expired, permission_denied, success, server_error | C-NOTICE, C-BTN, C-FIELD |
| `ACC-07` | قفل محلي وفتح PIN | ACC | W/M/D | أساسي | ready, validation_error, permission_denied, offline | C-FIELD, C-DIALOG |
| `ACC-08` | انتهاء جلسة وإعادة مصادقة | ACC | W/M/D | أساسي | expired, offline, saved_local, pending_sync, success | C-DIALOG, C-SYNC, C-NOTICE |
| `ACC-09` | الحساب والأمان والجلسات | ACC | W/M/D | أساسي | ready, loading, permission_denied, pending_sync, success, server_error | C-TABLE, C-DIALOG, C-SYNC |
| `ACC-10` | معالج بدء الاستخدام | ACC | W/M/D | أساسي | ready, empty, partial, validation_error, offline, success | C-NOTICE, C-UPLOAD, C-PRINT, C-BTN |

> **ACC-02 — قرار مطبق:** G-02 وسيلة تحقق الحساب

### HOME — مساحة العمل  (3 شاشة)

**الأدوار:** مالك، مدير فرع، كاشير، أمين مخزن  
**مرجع الوثيقة:** §٣،١٤

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `HOME-01` | رئيسية المالك | HOME | W/M/D | أساسي | ready, loading, empty, stale, offline, pending_sync | C-FRAME, C-TABLE, C-SYNC, C-FILTER |
| `HOME-02` | رئيسية الموظف حسب الصلاحية | HOME | W/M/D | أساسي | ready, empty, permission_denied, offline, stale | C-FRAME, C-NAV, C-NOTICE |
| `HOME-03` | بحث عام وإشعارات سريعة | HOME | W/M/D | أساسي | ready, loading, empty, permission_denied, offline | C-PICK, C-TIMELIST, C-NOTICE |


### POS — البيع والفواتير  (12 شاشة)

**الأدوار:** كاشير، مدير فرع، مالك  
**مرجع الوثيقة:** §٦،٧،١٠،١٢

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `POS-01` | نقطة البيع والسلة | POS | W/M/D | أساسي | ready, loading, empty, offline, stale, permission_denied | C-CART, C-PICK, C-QTYUNIT, C-SYNC |
| `POS-02` | اختيار وحدة أو وزن | POS | W/M/D | أساسي | ready, validation_error, empty | C-QTYUNIT, C-SHEET, C-DIALOG |
| `POS-03` | خصم وتجاوز سعر | POS | W/M/D | أساسي | ready, validation_error, permission_denied | C-MONEY, C-DIALOG, C-FIELD |
| `POS-04` | اختيار عميل وإنشاء سريع | POS | W/M/D | أساسي | ready, empty, validation_error, permission_denied, offline | C-PICK, C-FIELD, C-NOTICE |
| `POS-05` | الدفع النقدي | POS | W/M/D | أساسي | ready, validation_error, saving, saved_local, success | C-MONEY, C-CART, C-BTN |
| `POS-06` | الدفع الآجل | POS | W/M/D | أساسي | ready, validation_error, permission_denied, stale, saved_local | C-MONEY, C-LEDLINE, C-SYNC |
| `POS-07` | الدفع المختلط والتحويل | POS | W/M/D | أساسي | ready, validation_error, saving, saved_local, success, server_error, partial | C-MONEY, C-CART, C-NOTICE |
| `POS-08` | نجاح البيع والإيصال | POS | W/M/D | أساسي | saved_local, pending_sync, synced, success, server_error | C-PRINT, C-DOCPRV, C-SYNC |
| `POS-09` | قائمة الفواتير وتفاصيلها | POS | W/M/D | أساسي | ready, loading, empty, offline, stale, pending_sync, permission_denied | C-TABLE, C-FILTER, C-SYNC |
| `POS-10` | مرتجع كلي أو جزئي | POS | W/M/D | أساسي | ready, validation_error, permission_denied, partial, saved_local, success | C-QTYUNIT, C-MONEY, C-DIALOG |
| `POS-11` | فشل الحفظ أو الطباعة | POS | W/M/D | أساسي | offline, saved_local, validation_error, server_error | C-NOTICE, C-PRINT, C-SYNC |
| `POS-12` | مراجعة تكرار تجاري أو تصحيح | POS | W/M/D | أساسي | ready, empty, conflict, permission_denied | C-TABLE, C-DOCPRV, C-DIALOG |

> **POS-03 — قرار مطبق:** G-09 سقوف التفويض المالي

### PTY — الأطراف والذمم  (9 شاشة)

**الأدوار:** مالك، مدير فرع، كاشير (محدود)  
**مرجع الوثيقة:** §٥،٦،٧

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `PTY-01` | قائمة العملاء | PTY | W/M/D | أساسي | ready, loading, empty, permission_denied, offline, stale | C-TABLE, C-FILTER, C-PICK |
| `PTY-02` | قائمة الموردين | PTY | W/M/D | أساسي | ready, loading, empty, permission_denied | C-TABLE, C-FILTER, C-NOTICE |
| `PTY-03` | بطاقة طرف وإنشاء وتعديل | PTY | W/M/D | أساسي | ready, validation_error, saving, success, permission_denied, conflict | C-FIELD, C-PANEL, C-STATUS |
| `PTY-04` | رصيد افتتاحي | PTY | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-MONEY, C-DOCPRV, C-DIALOG |
| `PTY-05` | كشف حساب | PTY | W/M/D | أساسي | ready, loading, empty, stale, pending_sync, offline, permission_denied | C-LEDLINE, C-FILTER, C-SYNC |
| `PTY-06` | تسجيل سداد أو رد مبلغ | PTY | W/M/D | أساسي | ready, validation_error, saving, saved_local, success, permission_denied | C-MONEY, C-PRINT, C-FIELD |
| `PTY-07` | دمج أطراف | PTY | W/M/D | أساسي | ready, validation_error, permission_denied, conflict, success | C-DIALOG, C-DOCPRV, C-NOTICE |
| `PTY-08` | طباعة وتصدير ومشاركة الكشف | PTY | W/M/D | أساسي | ready, loading, permission_denied, success, server_error | C-DOCPRV, C-PRINT, C-AUD |
| `PTY-09` | تصحيح تاريخ الأعمال | PTY | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-FIELD, C-DIALOG, C-NOTICE |


### CAT — الكتالوج الداخلي  (6 شاشة)

**الأدوار:** مالك، مدير فرع  
**مرجع الوثيقة:** §٦،٧،١١

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `CAT-01` | قائمة الأصناف والبحث | CAT | W/M/D | أساسي | ready, loading, empty, offline, stale | C-TABLE, C-FILTER, C-PICK |
| `CAT-02` | إنشاء صنف وبطاقته | CAT | W/M/D | أساسي | ready, validation_error, saving, success | C-FIELD, C-UPLOAD, C-PANEL |
| `CAT-03` | وحدات وتحويلات وباركود | CAT | W/M/D | أساسي | ready, validation_error, success | C-QTYUNIT, C-TABLE, C-DIALOG |
| `CAT-04` | سعر صنف وتاريخ تغييره | CAT | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-MONEY, C-TIMELIST |
| `CAT-05` | استيراد أو تعديل أسعار متعدد | CAT | W/M/D | أساسي | ready, loading, validation_error, partial, success, server_error | C-UPLOAD, C-TABLE, C-DOCPRV |
| `CAT-06` | مجموعات الأصناف والأسماء البديلة | CAT | W/M/D | أساسي | ready, empty, validation_error, success | C-TABLE, C-FIELD, C-PICK |


### INV — المخزون  (10 شاشة)

**الأدوار:** أمين مخزن، مالك، مدير فرع  
**مرجع الوثيقة:** §٧،١٠

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `INV-01` | أرصدة المخزون | INV | W/M/D | أساسي | ready, loading, empty, stale, offline, pending_sync, partial | C-TABLE, C-FILTER, C-SYNC, C-STATUS |
| `INV-02` | سجل حركة الصنف | INV | W/M/D | أساسي | ready, loading, empty, pending_sync, stale | C-TIMELIST, C-TABLE, C-SYNC |
| `INV-03` | افتتاحيات المخزون | INV | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-QTYUNIT, C-DOCPRV, C-TABLE |
| `INV-04` | استلام بضاعة | INV | W/M/D | أساسي | ready, validation_error, saving, saved_local, success | C-QTYUNIT, C-PICK, C-FIELD |
| `INV-05` | جلسة جرد | INV | W/M/D | أساسي | ready, saving, saved_local, partial, offline, success | C-QTYUNIT, C-TABLE, C-SYNC |
| `INV-06` | مراجعة فروق الجرد وتسوية | INV | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-TABLE, C-DIALOG, C-DOCPRV |
| `INV-07` | هالك وحجر تالف | INV | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-QTYUNIT, C-STATUS, C-FIELD |
| `INV-08` | قائمة التحويلات | INV | W/M/D | أساسي | ready, loading, empty, partial, pending_sync | C-TABLE, C-STATUS, C-FILTER |
| `INV-09` | إنشاء وإرسال تحويل | INV | W/M/D | أساسي | ready, validation_error, saving, saved_local, success, partial | C-PICK, C-QTYUNIT, C-DOCPRV |
| `INV-10` | استلام تحويل جزئي ومراجعة فرق | INV | W/M/D | أساسي | ready, partial, validation_error, conflict, success | C-RECV, C-QTYUNIT, C-NOTICE |


### PUR — المشتريات والتكلفة  (5 شاشة)

**الأدوار:** مالك، مسؤول مشتريات  
**مرجع الوثيقة:** §٧،١٦،١٩

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `PUR-01` | قائمة أوامر شراء داخلية وتفاصيل | PUR | W/M/D | مشروط | ready, loading, empty, permission_denied | C-TABLE, C-FILTER, C-PHASE |
| `PUR-02` | إنشاء أمر شراء داخلي | PUR | W/M/D | مشروط | ready, validation_error, saving, success | C-QTYUNIT, C-MONEY, C-PHASE |
| `PUR-03` | مستند شراء واعتماده | PUR | W/M/D | مشروط | ready, validation_error, permission_denied, success | C-DOCPRV, C-DIALOG, C-PHASE |
| `PUR-04` | مرتجع مشتريات | PUR | W/M/D | مشروط | ready, validation_error, partial, success | C-QTYUNIT, C-DOCPRV, C-PHASE |
| `PUR-05` | التكلفة والهامش | PUR | W/M/D | مشروط | ready, empty, permission_denied, phase_locked | C-TABLE, C-PHASE, C-NOTICE |

> **PUR-01 — قرار مطبق:** G-03 عقد التكلفة
> **PUR-02 — قرار مطبق:** G-03 عقد التكلفة
> **PUR-03 — قرار مطبق:** G-03 عقد التكلفة
> **PUR-04 — قرار مطبق:** G-03 عقد التكلفة
> **PUR-05 — قرار مطبق:** G-03 عقد التكلفة

### SHIFT — الورديات والصندوق  (5 شاشة)

**الأدوار:** كاشير، مدير فرع، مالك  
**مرجع الوثيقة:** §١٠

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `SHIFT-01` | فتح وردية | SHIFT | W/M/D | أساسي | ready, validation_error, offline, saved_local, success | C-MONEY, C-FIELD, C-SYNC |
| `SHIFT-02` | الوردية الحالية | SHIFT | W/M/D | أساسي | ready, loading, offline, pending_sync, stale | C-TABLE, C-MONEY, C-SYNC |
| `SHIFT-03` | حركة صندوق وتسوية | SHIFT | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-MONEY, C-FIELD, C-DIALOG |
| `SHIFT-04` | إغلاق وعد صندوق | SHIFT | W/M/D | أساسي | ready, validation_error, partial, saved_local, success | C-MONEY, C-DOCPRV, C-NOTICE |
| `SHIFT-05` | مراجعة فروق وعمليات متأخرة | SHIFT | W/M/D | أساسي | ready, empty, conflict, permission_denied, stale | C-TABLE, C-STATUS, C-NOTICE |


### ORG — إدارة المنشأة  (10 شاشة)

**الأدوار:** مالك  
**مرجع الوثيقة:** §٩،١٠،١١،١٦

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `ORG-01` | المستخدمون والدعوات | ORG | W/M/D | أساسي | ready, loading, empty, validation_error, expired, success | C-TABLE, C-STATUS, C-DIALOG |
| `ORG-02` | مصفوفة الأدوار والصلاحيات | ORG | W/M/D | أساسي | ready, validation_error, permission_denied, success | C-TABLE, C-FIELD, C-MONEY |
| `ORG-03` | الفروع وتفاصيلها | ORG | W/M/D | أساسي | ready, empty, validation_error, permission_denied | C-TABLE, C-FIELD, C-STATUS |
| `ORG-04` | قائمة الأجهزة وتفاصيلها | ORG | W/M/D | أساسي | ready, loading, empty, offline, stale | C-TABLE, C-SYNC, C-STATUS |
| `ORG-05` | سحب مستخدم أو نطاق أو جهاز | ORG | W/M/D | أساسي | ready, validation_error, permission_denied, pending_sync, success | C-DIALOG, C-NOTICE, C-SYNC |
| `ORG-06` | الاشتراك والباقات | ORG | W/M/D | أساسي | ready, loading, permission_denied, expired | C-TABLE, C-STATUS, C-PHASE |
| `ORG-07` | إثبات تحويل الاشتراك ومراجعته | ORG | W/M/D | أساسي | ready, validation_error, saving, success, server_error | C-UPLOAD, C-STATUS, C-DOCPRV |
| `ORG-08` | انتهاء الاشتراك | ORG | W/M/D | أساسي | ready, expired, permission_denied | C-NOTICE, C-PHASE, C-STATUS |
| `ORG-09` | إعدادات المنشأة واللغة والقوالب | ORG | W/M/D | أساسي | ready, validation_error, success, conflict | C-FIELD, C-DOCPRV, C-PICK |
| `ORG-10` | سجل تدقيق | ORG | W/M/D | أساسي | ready, loading, empty, permission_denied | C-TABLE, C-FILTER, C-TIMELIST |

> **ORG-02 — قرار مطبق:** G-09 سقوف التفويض المالي
> **ORG-08 — قرار مطبق:** G-08 قائمة وظائف POS المستمرة
> **ORG-09 — قرار مطبق:** G-01 نمط الأرقام

### REP — التقارير  (6 شاشة)

**الأدوار:** مالك، مدير فرع  
**مرجع الوثيقة:** §٧،١٠،١٦

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `REP-01` | تقرير المبيعات | REP | W/M/D | أساسي | ready, loading, empty, stale, pending_sync, permission_denied | C-TABLE, C-FILTER, C-SYNC |
| `REP-02` | تقرير الذمم | REP | W/M/D | أساسي | ready, loading, empty, stale, permission_denied | C-TABLE, C-FILTER, C-LEDLINE |
| `REP-03` | تقرير المخزون والحركات | REP | W/M/D | أساسي | ready, loading, empty, stale, pending_sync | C-TABLE, C-FILTER, C-QTYUNIT |
| `REP-04` | تقرير الصندوق والورديات | REP | W/M/D | أساسي | ready, loading, empty, conflict, stale | C-TABLE, C-MONEY, C-STATUS |
| `REP-05` | الهامش والمقارنة بين الفروع | REP | W/M/D | مشروط | ready, empty, permission_denied, phase_locked | C-TABLE, C-PHASE, C-NOTICE |
| `REP-06` | تصدير تقرير ومعاينته | REP | W/M/D | أساسي | ready, loading, validation_error, success, server_error | C-DOCPRV, C-UPLOAD, C-FIELD |

> **REP-02 — قرار مطبق:** G-15 توقع تقادم الديون
> **REP-05 — قرار مطبق:** G-03 عقد التكلفة

### SYS — المزامنة والاستعادة  (11 شاشة)

**الأدوار:** مالك، مشغّل الخدمة (دعم مقيد)  
**مرجع الوثيقة:** §٨،٩،١٣

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `SYS-01` | مركز الاتصال والمزامنة | SYS | W/M/D | أساسي | ready, offline, pending_sync, synced, stale, server_error | C-SYNC, C-TABLE, C-NOTICE |
| `SYS-02` | تفاصيل عملية متعثرة | SYS | W/M/D | أساسي | ready, empty, server_error, conflict, pending_sync | C-TIMELIST, C-NOTICE, C-STATUS |
| `SYS-03` | تعارض وحجر ومراجعة مالك | SYS | W/M/D | أساسي | ready, conflict, permission_denied, success | C-DOCPRV, C-DIALOG, C-STATUS |
| `SYS-04` | انخفاض التخزين أو فشل استدامته | SYS | W/M/D | أساسي | ready, validation_error, server_error | C-NOTICE, C-BTN, C-SYNC |
| `SYS-05` | تصدير نسخة محلية | SYS | W/M/D | أساسي | ready, saving, validation_error, success, server_error | C-DOCPRV, C-NOTICE, C-BTN |
| `SYS-06` | استعادة نسخة ومعاينتها | SYS | W/M/D | أساسي | ready, validation_error, conflict, partial, success, server_error | C-UPLOAD, C-DOCPRV, C-DIALOG |
| `SYS-07` | استرداد جهاز مسحوب | SYS | W/M/D | أساسي | ready, permission_denied, pending_sync, conflict, success | C-DIALOG, C-SYNC, C-STATUS |
| `SYS-08` | تغير جيل الخادم والمصالحة | SYS | W/M/D | أساسي | conflict, stale, pending_sync, success | C-NOTICE, C-SYNC, C-TIMELIST |
| `SYS-09` | تحديث التطبيق مع عمليات معلقة | SYS | W/M/D | أساسي | ready, pending_sync, validation_error, success, server_error | C-DIALOG, C-SYNC, C-NOTICE |
| `SYS-10` | استيراد بيانات | SYS | W/M/D | أساسي | ready, loading, validation_error, partial, success, server_error | C-UPLOAD, C-TABLE, C-DOCPRV |
| `SYS-11` | الدعم والتشخيص | SYS | W/M/D | أساسي | ready, empty, permission_denied, success | C-DOCPRV, C-NOTICE, C-BTN |


### NOT — الإشعارات والحملات  (6 شاشة)

**الأدوار:** مسؤول حملات المحل، مالك  
**مرجع الوثيقة:** §١١

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `NOT-01` | صندوق الوارد والتفاصيل | NOT | W/M/D | أساسي | ready, loading, empty, expired, permission_denied | C-TIMELIST, C-STATUS, C-NOTICE |
| `NOT-02` | تفضيلات التنبيه | NOT | W/M/D | أساسي | ready, validation_error, offline, success | C-FIELD, C-STATUS, C-NOTICE |
| `NOT-03` | قائمة الحملات | NOT | W/M/D | أساسي | ready, loading, empty, permission_denied | C-TABLE, C-STATUS, C-FILTER |
| `NOT-04` | إنشاء حملة واختيار الجمهور | NOT | W/M/D | أساسي | ready, empty, validation_error, permission_denied | C-CAMP, C-AUD, C-FIELD |
| `NOT-05` | معاينة واعتماد وجدولة | NOT | W/M/D | أساسي | ready, validation_error, saving, expired, success | C-DOCPRV, C-CAMP, C-DIALOG |
| `NOT-06` | نتائج حملة وإلغاؤها | NOT | W/M/D | أساسي | ready, empty, partial, server_error, success | C-TABLE, C-STATUS, C-NOTICE |


### MP — السوق والاكتشاف  (15 شاشة)

**الأدوار:** مدير ملف المنشأة، ناشر الكتالوج، مسؤول مشتريات  
**مرجع الوثيقة:** §١،٥،٦،٩،١٢،١٤

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `MP-01` | رئيسية السوق | MP | W/M/D | M1 | ready, loading, empty, offline, stale | C-LISTING, C-FILTER, C-PICK |
| `MP-02` | دليل المخازن والمتاجر | MP | W/M/D | M1 | ready, loading, empty, stale | C-TABLE, C-FILTER, C-STATUS |
| `MP-03` | ملف منشأة منشور | MP | W/M/D | M1 | ready, loading, permission_denied, expired | C-LISTING, C-STATUS, C-NOTICE |
| `MP-04` | نتائج بحث المنتجات والمقارنة | MP | W/M/D | M1 | ready, loading, empty, stale, partial | C-LISTING, C-FILTER, C-QTYUNIT |
| `MP-05` | تفاصيل عرض | MP | W/M/D | M1 | ready, empty, expired, permission_denied, stale | C-LISTING, C-QTYUNIT, C-STATUS |
| `MP-06` | متابعة مورد وقائمة المتابعين الخاصة | MP | W/M/D | M1 | ready, empty, permission_denied, success | C-TABLE, C-STATUS, C-BTN |
| `MP-07` | مشاركة رابط ودعوة منشأة | MP | W/M/D | M1 | ready, expired, permission_denied, success | C-DOCPRV, C-DIALOG, C-NOTICE |
| `MP-08` | تهيئة بائع وتحقق الهوية | MP | W/M/D | M1 | ready, loading, validation_error, permission_denied, success | C-FIELD, C-UPLOAD, C-STATUS |
| `MP-09` | إدارة صفحة المنشأة | MP | W/M/D | M1 | ready, validation_error, saving, permission_denied, success | C-FIELD, C-DOCPRV, C-PANEL |
| `MP-10` | قائمة العروض الداخلية للبائع | MP | W/M/D | M1 | ready, loading, empty, expired | C-TABLE, C-STATUS, C-FILTER |
| `MP-11` | إنشاء عرض ونشره | MP | W/M/D | M1 | ready, validation_error, saving, permission_denied, success | C-PICK, C-AUD, C-DOCPRV |
| `MP-12` | أسعار شرائح وقوائم خاصة | MP | W/M/D | M1 | ready, empty, validation_error, permission_denied | C-TABLE, C-MONEY, C-AUD |
| `MP-13` | تجديد تأكيد سعر وتوفر | MP | W/M/D | M1 | ready, expired, saving, permission_denied, success | C-STATUS, C-DIALOG, C-NOTICE |
| `MP-14` | عرض منتهٍ أو منشأة معلقة | MP | W/M/D | M1 | ready, expired, permission_denied | C-NOTICE, C-STATUS, C-BTN |
| `MP-15` | بلاغ عن عرض أو انتحال | MP | W/M/D | M1 | ready, validation_error, permission_denied, success | C-FIELD, C-UPLOAD, C-STATUS |

> **MP-08 — قرار مطبق:** G-06 تفعيل دور البائع

### ORD — طلبات السوق والتنفيذ  (15 شاشة)

**الأدوار:** مسؤول مشتريات، مسؤول مبيعات المورد، مسؤول الاستلام  
**مرجع الوثيقة:** §٧،٨،٩،١٧

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `ORD-01` | سلة ومسودة طلب | ORD | W/M/D | M2 | ready, empty, offline, validation_error, stale | C-CART, C-QTYUNIT, C-SYNC |
| `ORD-02` | مراجعة وإرسال طلب أو طلب سعر | ORD | W/M/D | M2 | ready, validation_error, saving, expired, success, server_error | C-DOCPRV, C-MONEY, C-NOTICE |
| `ORD-03` | طلبات المشتري | ORD | W/M/D | M2 | ready, loading, empty, stale, pending_sync | C-TABLE, C-STATUS, C-FILTER |
| `ORD-04` | طلبات المورد | ORD | W/M/D | M2 | ready, loading, empty, expired | C-TABLE, C-STATUS, C-FILTER |
| `ORD-05` | تفاصيل الطلب وسجل الإصدارات | ORD | W/M/D | M2 | ready, loading, partial, conflict, permission_denied | C-ORDTL, C-DOCPRV, C-STATUS |
| `ORD-06` | إعداد عرض سعر من المورد | ORD | W/M/D | M2 | ready, validation_error, saving, expired, success, partial | C-QUOTE, C-MONEY, C-QTYUNIT |
| `ORD-07` | مقارنة العرض وقبوله أو رفضه | ORD | W/M/D | M2 | ready, validation_error, expired, conflict, success | C-QUOTE, C-DIALOG, C-NOTICE |
| `ORD-08` | تجهيز وتسليم جزئي | ORD | W/M/D | M2 | ready, validation_error, partial, success | C-RECV, C-QTYUNIT, C-ORDTL |
| `ORD-09` | استلام جزئي ورفض كمية | ORD | W/M/D | M2 | ready, validation_error, partial, conflict, success | C-RECV, C-QTYUNIT, C-STATUS |
| `ORD-10` | إلغاء المتبقي | ORD | W/M/D | M2 | ready, validation_error, partial, permission_denied, success | C-DIALOG, C-ORDTL, C-NOTICE |
| `ORD-11` | طلب مرتجع تجاري | ORD | W/M/D | M2 | ready, validation_error, partial, success | C-QTYUNIT, C-DOCPRV, C-STATUS |
| `ORD-12` | خلاف وأدلته وتطور حالته | ORD | W/M/D | M2 | ready, empty, partial, permission_denied, success | C-TIMELIST, C-UPLOAD, C-STATUS |
| `ORD-13` | إثبات دفع ومتابعة المطابقة | ORD | W/M/D | M2 | ready, validation_error, partial, stale, success | C-UPLOAD, C-MONEY, C-NOTICE |
| `ORD-14` | تعارض نسخة أو رد مفقود | ORD | W/M/D | M2 | ready, conflict, server_error, success | C-NOTICE, C-ORDTL, C-DIALOG |
| `ORD-15` | استعادة طلب بعد فقد خادمي | ORD | W/M/D | M2 | conflict, stale, permission_denied, success | C-NOTICE, C-ORDTL, C-STATUS |


### LINK — التكامل المالي للسوق  (5 شاشة)

**الأدوار:** مالك، مسؤول مشتريات  
**مرجع الوثيقة:** §٥،٧،١٥

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `LINK-01` | ربط الطرف المحلي بالمنشأة | LINK | W/M/D | M3 | ready, validation_error, permission_denied, success, phase_locked | C-PICK, C-DIALOG, C-PHASE |
| `LINK-02` | مطابقة أصناف ووحدات الطرفين | LINK | W/M/D | M3 | ready, validation_error, conflict, success, phase_locked | C-TABLE, C-QTYUNIT, C-PHASE |
| `LINK-03` | تحويل استلام أو بيع إلى مستند | LINK | W/M/D | M3 | ready, validation_error, conflict, success, phase_locked | C-DOCPRV, C-DIALOG, C-PHASE |
| `LINK-04` | روابط مستندات وتسوية فرق | LINK | W/M/D | M3 | ready, empty, conflict, permission_denied, phase_locked | C-TABLE, C-MONEY, C-PHASE |
| `LINK-05` | تحويل المرتجع لمستند عكسي | LINK | W/M/D | M3 | ready, partial, validation_error, success, phase_locked | C-DOCPRV, C-QTYUNIT, C-PHASE |

> **LINK-01 — قرار مطبق:** G-13 حالة «مرحلة غير مفعّلة»
> **LINK-02 — قرار مطبق:** G-13 حالة «مرحلة غير مفعّلة»
> **LINK-03 — قرار مطبق:** G-13 حالة «مرحلة غير مفعّلة»
> **LINK-04 — قرار مطبق:** G-13 حالة «مرحلة غير مفعّلة»
> **LINK-05 — قرار مطبق:** G-13 حالة «مرحلة غير مفعّلة»

### GROW — تحسينات السوق اللاحقة  (3 شاشة)

**الأدوار:** مالك، مسؤول مبيعات المورد  
**مرجع الوثيقة:** §١٤،١٥،١٦

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `GROW-01` | اقتراح إعادة التوريد | GROW | W/M/D | M4 | ready, empty, permission_denied, phase_locked | C-TABLE, C-BTN, C-PHASE |
| `GROW-02` | تحليلات المورد | GROW | W/M/D | M4 | ready, loading, empty, stale, phase_locked | C-TABLE, C-FILTER, C-PHASE |
| `GROW-03` | طلب عرض ممول ومعاينته | GROW | W/M/D | M4 | ready, validation_error, permission_denied, phase_locked | C-DOCPRV, C-AUD, C-PHASE |

> **GROW-01 — قرار مطبق:** G-13 حالة «مرحلة غير مفعّلة»
> **GROW-03 — قرار مطبق:** G-04 تسعير العرض الممول

### CUS — بوابة زبون المحل  (5 شاشة)

**الأدوار:** زبون المحل  
**مرجع الوثيقة:** §١١،١٤

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `CUS-01` | صفحة محل عبر رابط أو QR | CUS | C | أساسي | ready, loading, empty, expired | C-FRAME, C-TIMELIST, C-NOTICE |
| `CUS-02` | اشتراك وإذن تنبيه | CUS | C | أساسي | ready, validation_error, permission_denied, success | C-BTN, C-NOTICE, C-FIELD |
| `CUS-03` | قائمة رسائل المحل وتفاصيل | CUS | C | أساسي | ready, loading, empty, expired, permission_denied | C-TIMELIST, C-STATUS, C-NOTICE |
| `CUS-04` | تفضيلات وإلغاء الاشتراك | CUS | C | أساسي | ready, validation_error, success | C-FIELD, C-DIALOG, C-STATUS |
| `CUS-05` | إذن مرفوض أو اشتراك منتهٍ | CUS | C | أساسي | ready, permission_denied, expired | C-NOTICE, C-BTN, C-STATUS |


### PLT — إدارة Sting  (12 شاشة)

**الأدوار:** مشغّل الخدمة، مشرف السوق، ناشر إعلانات Sting  
**مرجع الوثيقة:** §٩،١١،١٣،١٦،١٧

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `PLT-01` | دخول الإدارة ومساحة المشغل | PLT | A | أساسي | ready, validation_error, permission_denied | C-FRAME, C-NAV, C-FIELD |
| `PLT-02` | قائمة المستأجرين وتفاصيل الاستحقاق | PLT | A | أساسي | ready, loading, empty, permission_denied | C-TABLE, C-FILTER, C-STATUS |
| `PLT-03` | مراجعة دفع الاشتراك | PLT | A | أساسي | ready, validation_error, conflict, success | C-DOCPRV, C-DIALOG, C-STATUS |
| `PLT-04` | إعلانات المنصة وصيانة | PLT | A | أساسي | ready, validation_error, saving, success | C-CAMP, C-AUD, C-DOCPRV |
| `PLT-05` | تشغيل الإرسال والإخفاقات | PLT | A | أساسي | ready, empty, partial, server_error | C-TABLE, C-STATUS, C-NOTICE |
| `PLT-06` | طلبات تحقق منشآت السوق | PLT | A | أساسي | ready, loading, empty, validation_error, success | C-DOCPRV, C-STATUS, C-DIALOG |
| `PLT-07` | مراجعة بلاغ وتعليق نشر واعتراض | PLT | A | أساسي | ready, validation_error, permission_denied, success | C-DOCPRV, C-DIALOG, C-TIMELIST |
| `PLT-08` | متابعة الخلافات | PLT | A | أساسي | ready, loading, empty, partial | C-TABLE, C-TIMELIST, C-STATUS |
| `PLT-09` | صحة المزامنة والخادم | PLT | A | أساسي | ready, loading, stale, server_error | C-TABLE, C-SYNC, C-STATUS |
| `PLT-10` | نسخ خادمية وتجربة استعادة | PLT | A | أساسي | ready, loading, server_error, success | C-TABLE, C-DIALOG, C-NOTICE |
| `PLT-11` | لوحة اكتساب وقياس M0 | PLT | A | أساسي | ready, loading, empty, stale | C-TABLE, C-FILTER, C-NOTICE |
| `PLT-12` | إدارة استحقاقات وإعدادات تشغيل | PLT | A | أساسي | ready, validation_error, permission_denied, success | C-TABLE, C-FIELD, C-DIALOG |


### WEB — تكامل الويب  (3 شاشة)

**الأدوار:** كل الأدوار التجارية  
**مرجع الوثيقة:** §١٢،١٣

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `WEB-01` | تثبيت PWA أو عدم دعم التثبيت | WEB | W | أساسي | ready, offline, permission_denied, success | C-NOTICE, C-BTN, C-DOCPRV |
| `WEB-02` | إذن Web Push وحالاته | WEB | W | أساسي | ready, permission_denied, expired, success | C-NOTICE, C-BTN, C-STATUS |
| `WEB-03` | ربط طابعة ويب وتجربة عربية | WEB | W | أساسي | ready, validation_error, server_error, success | C-PRINT, C-NOTICE, C-DOCPRV |

> **WEB-03 — قرار مطبق:** G-10 العتاد والأنظمة المعتمدة

### NAT — تكامل الموبايل  (4 شاشة)

**الأدوار:** كل الأدوار التجارية  
**مرجع الوثيقة:** §١٢،١٣

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `NAT-01` | أذونات كاميرا وباركود | NAT | M | أساسي | ready, validation_error, permission_denied, success | C-SHEET, C-NOTICE, C-FIELD |
| `NAT-02` | طابعة وأذونات Bluetooth | NAT | M | أساسي | ready, loading, permission_denied, server_error, success | C-PRINT, C-SHEET, C-NOTICE |
| `NAT-03` | Push وفتح رابط عميق | NAT | M | أساسي | ready, expired, permission_denied, success | C-NOTICE, C-STATUS, C-DIALOG |
| `NAT-04` | تحديث وأسرار ونسخة احتياطية | NAT | M | أساسي | ready, validation_error, pending_sync, server_error, success | C-DIALOG, C-SYNC, C-NOTICE |

> **NAT-02 — قرار مطبق:** G-10 العتاد والأنظمة المعتمدة

### DESK — تكامل الديسكتوب  (5 شاشة)

**الأدوار:** كل الأدوار التجارية  
**مرجع الوثيقة:** §١٢،١٣

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `DESK-01` | إعداد أول تشغيل وتحديث | DESK | D | أساسي | ready, loading, validation_error, server_error, success | C-NOTICE, C-DIALOG, C-BTN |
| `DESK-02` | اختيار طابعة ومعاينة وطابور | DESK | D | أساسي | ready, empty, server_error, success | C-PRINT, C-DOCPRV, C-TABLE |
| `DESK-03` | اختصارات وإدارة التركيز | DESK | D | أساسي | ready, validation_error, conflict | C-TABLE, C-DIALOG, C-NOTICE |
| `DESK-04` | حوار حفظ واستعادة ملف | DESK | D | أساسي | ready, validation_error, server_error, success | C-DIALOG, C-UPLOAD, C-NOTICE |
| `DESK-05` | إشعارات وإغلاق التطبيق | DESK | D | أساسي | ready, offline, permission_denied | C-NOTICE, C-STATUS, C-DIALOG |

> **DESK-01 — قرار مطبق:** G-10 العتاد والأنظمة المعتمدة

### PUB — صفحات عامة وخدمة  (4 شاشة)

**الأدوار:** زائر  
**مرجع الوثيقة:** §١١،١٤،١٧

| ID | الاسم | المجموعة | المنصات | المرحلة | الحالات | المكونات |
|---|---|---|---|---|---|---|
| `PUB-01` | تعريف Sting والباقات ومدخل السوق | PUB | W | أساسي | ready, offline | C-FRAME, C-BTN, C-TABLE |
| `PUB-02` | الخصوصية وشروط السوق والمساعدة | PUB | W | أساسي | ready, loading, phase_locked | C-FRAME, C-DOCPRV |
| `PUB-03` | حالة الخدمة والصيانة | PUB | W | أساسي | ready, stale, server_error | C-STATUS, C-TIMELIST, C-NOTICE |
| `PUB-04` | صفحة غير موجودة أو رابط منتهٍ | PUB | W | أساسي | empty, expired, permission_denied | C-NOTICE, C-BTN |

> **PUB-02 — قرار مطبق:** G-11 المراجعة القانونية

## Interactions & Behavior
### الرحلات (F01–F17)
النماذج التفاعلية لهذه الرحلات في `11-Prototype-Flows.dc.html`.

| ID | الرحلة | الدور | المنصات | الخطوات | مسارات الفشل المطلوب تغطيتها |
|---|---|---|---|---|---|
| `F01` | تهيئة | مالك | W/M/D | ACC-01 → ACC-10 → SHIFT-01 → POS-01 | إنترنت مفقود، تنزيل متوقف |
| `F02` | بيع مختلط | كاشير | W/M/D | POS-01 → POS-04 → POS-07 → POS-08 → PTY-05 | نقص حقل، فشل حفظ، فشل طباعة بعد حفظ |
| `F03` | سداد | مالك / مدير فرع | W/M/D | PTY-01 → PTY-05 → PTY-06 → PTY-08 | وسيلة خاطئة، انقطاع، حق مشاركة |
| `F04` | مرتجع | كاشير | W/M/D | POS-09 → POS-10 → POS-08 | كمية تتجاوز الأصل، تالف، رد إلى ذمة |
| `F05` | وردية | كاشير / مالك | W/M/D | SHIFT-01 → SHIFT-02 → SHIFT-04 → SHIFT-05 | إغلاق بلا عد، حركة متأخرة |
| `F06` | مخزون | أمين مخزن / مالك | W/M/D | INV-04 → INV-01 → INV-05 → INV-06 | اختلاف وحدة، فروق جرد، صلاحية اعتماد |
| `F07` | استعادة | مالك | W/M/D | SYS-05 → SYS-06 → SYS-01 | نسخة مكررة، غير متوافقة، معلق محفوظ |
| `F08` | تعطيل | مالك | W/M/D | ORG-05 → SYS-07 → SYS-03 | إلغاء مستخدم دون محو جهاز مشترك |
| `F09` | اكتساب | زائر → مدعو | W | PUB-01 → MP-02 → MP-03 → MP-07 → ACC-06 | دعوة منتهية، عدم النشر التلقائي |
| `F10` | نشر مورد | ناشر الكتالوج | W/M/D | MP-08 → MP-09 → MP-11 → MP-05 | سعر خاص، معاينة عامة، حقول ناقصة |
| `F11` | توريد | مسؤول مشتريات / مبيعات المورد | W/M/D | MP-04 → MP-05 → ORD-01 → ORD-02 → ORD-06 → ORD-07 | رد مفقود، نسخة قديمة، سعر منتهٍ |
| `F12` | تنفيذ جزئي | مسؤول الاستلام | W/M/D | ORD-05 → ORD-08 → ORD-09 → ORD-12 | استلام ٧ من ٨، إلغاء المتبقي، مرتجع |
| `F13` | ربط لاحق | مالك | W/D | LINK-01 → LINK-02 → LINK-03 → LINK-04 | مصدر مكرر، منشأة خاطئة؛ وسم M3 |
| `F14` | حملة | مسؤول حملات المحل | W/M/D | NOT-03 → NOT-04 → NOT-05 → NOT-06 | جمهور غير مخول، إلغاء مجدول |
| `F15` | زبون | زبون المحل | C | CUS-01 → CUS-02 → CUS-03 → CUS-04 | رفض إذن، إلغاء محل واحد |
| `F16` | إشراف | مشرف السوق | A | PLT-06 → PLT-07 → PLT-08 | اعتراض، تعليق بائع مع طلب مفتوح |
| `F17` | اشتراك | مالك + مشغّل الخدمة | W/A | ORG-06 → ORG-07 → PLT-03 → ORG-08 | إثبات مرفوض، انتهاء لا يغلق البيع |

### قواعد سلوك عامة
- **كل شاشة تُبنى بحالاتها المعلنة** في جدول الشاشات، لا بالحالة `ready` فقط. كل حالة لها رسالة عربية وإجراء تالٍ واحد واضح.
- **بلا اتصال أولاً:** POS والمخزون والورديات تعمل محلياً. التسلسل: `saving` → `saved_local` → `pending_sync` → `synced`. لا تُعرض «تم» قبل `synced` إلا بصيغة «محفوظ محلياً».
- **التعارض (`conflict`) لا يُحسم صامتاً** — يعرض النسختين ويطلب قراراً من المستخدم.
- **`permission_denied`** يوضح الدور المطلوب ولا يخفي وجود الشيء إلا حين يكون الإخفاء نفسه هو القاعدة (تسريب جمهور مستأجر آخر).
- **`phase_locked`** لميزة مرحلة لاحقة: وسم صريح، لا زر معطّل بلا تفسير، ولا إعلان عن ميزة غير متاحة في الباقة.
- **`stale`** يُعرض مع تاريخ آخر مطابقة، ولا يُحجب المحتوى.
- **الانتقالات:** 150–200ms ease-out للدخول، 100ms للخروج. لا حركة على تغيّر بيانات جدول.
- **التجاوب:** إعادة ترتيب المحتوى عبر المقاسات لا تعني منتجات مختلفة — نفس القدرات في كل مقاس مُعلن للشاشة.

## State Management
لكل شاشة: `status` من مفردات الحالات الـ17، `data`، `error` (رسالة عربية + إجراء)، و`syncState` للشاشات المحلية. إضافة إلى حالة عامة مشتركة:
- **الهوية والدور:** المستخدم، الدور الفعّال، المنشأة والفرع النشطان (C-ORGSW يبدّلهما ويُبطل كاش الشاشة).
- **الاتصال والمزامنة:** حالة الشبكة، طابور العمليات المعلّقة، عدّاد التعارضات (C-SYNC).
- **الوردية:** وردية مفتوحة/مغلقة تحكم توفّر POS بالكامل.
- **الباقة والمرحلة:** تحدد ظهور `phase_locked`.

جلب البيانات: قراءة محلية فورية ثم مطابقة خادمية.

## Design Tokens
### الألوان
| الرمز | القيمة | الاستخدام |
|---|---|---|
| teal-900 | `#115E59` | الهوية، الترويسات، الروابط |
| teal-700 | `#0F766E` | عناصر فعّالة، تأكيد |
| teal-500 | `#14B8A6` | حدود على أرضية داكنة |
| teal-300 | `#5EEAD4` | نص ثانوي على داكن |
| teal-200 | `#99F6E4` | حدود فاتحة |
| teal-100 | `#CCFBF1` | تحديد، نص على داكن |
| teal-50 | `#F0FDFA` | أرضية مُبرزة |
| amber-500 | `#F59E0B` | تنبيه، قرار مطلوب، شعار |
| amber-400 | `#FBBF24` | حدود تنبيه |
| amber-50 | `#FFFBEB` | أرضية تنبيه |
| amber-800 | `#92400E` | نص تنبيه |
| green-700 | `#15803D` | نجاح، اعتماد |
| green-800 | `#166534` | نص نجاح |
| green-100 | `#DCFCE7` | أرضية نجاح |
| red-700 | `#B91C1C` | خطأ، تعارض |
| red-50 | `#FEF2F2` | أرضية خطأ |
| blue-700 | `#1D4ED8` | معلومة، توضيح |
| blue-50 | `#EFF6FF` | أرضية معلومة |
| slate-900 | `#0F172A` | النص الأساسي |
| slate-700 | `#334155` | نص المتن |
| slate-600 | `#475569` | نص ثانوي |
| slate-300 | `#CBD5E1` | حدود |
| slate-200 | `#E2E8F0` | فواصل |
| slate-100 | `#F1F5F9` | أرضية محايدة |
| slate-50 | `#F8FAFC` | أرضية الصفحة |
| white | `#FFFFFF` | أرضية البطاقات |

### الخطوط
- **العناوين (h1–h3):** `Cairo` بأوزان 600 / 700، بديل `IBM Plex Sans Arabic` (D37).
- **الواجهة:** `IBM Plex Sans Arabic` ثم `system-ui` — بلا Noto. الأوزان 400 / 500 / 600 / 700.
- **الأرقام والمعرفات والمال:** `IBM Plex Mono` (الأرقام دائماً لاتينية غربية، لا أرقام هندية).
- **المقاس:** 30px/700 عنوان صفحة · 22px/700 عنوان قسم · 16px/700 عنوان بطاقة · 15px/600 عنوان فرعي · 14px متن · 13.5px متن كثيف (line-height 1.7) · 13px ملاحظة · 12–12.5px شارة. الحد الأدنى 12px للشارات فقط.
- `text-wrap: pretty` على كل نص متن وعناوين.

### المسافات
مقياس 4px: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 24 · 32 · 44 · 64. حشو البطاقة 16px، فجوة الشبكة 14px، فجوة الأقسام 44px، حشو الصفحة 24px، عرض المحتوى الأقصى 1240px.

### الأنصاف والحدود والظلال
- الأنصاف: 6px شارة · 7px أيقونة صغيرة · 9px لوحة صغيرة · 10px بطاقة إحصاء · 12px بطاقة.
- الحدود: 1px solid دائماً؛ المحايد `#CBD5E1`.
- الظلال: لا ظلال على البطاقات — الفصل بالحدود واللون. الظل للطبقات العائمة فقط (حوار، لوحة جانبية، bottom sheet): `0 8px 24px rgba(15,23,42,.12)`.

## المكونات المشتركة (C-*)
أنشئ هذه كمكونات حقيقية قبل بناء الشاشات؛ الشاشات تركيب لها.

| ID | المكون | المنصات |
|---|---|---|
| `C-FRAME` | إطار التطبيق | W/M/D/A/C |
| `C-NAV` | تنقل (جانبي/سفلي/علوي) | W/M/D/A/C |
| `C-ORGSW` | محوّل منشأة وفرع | W/M/D |
| `C-BTN` | زر | W/M/D/A/C |
| `C-FIELD` | حقل ونموذج | W/M/D/A/C |
| `C-PICK` | اختيار وبحث | W/M/D/A/C |
| `C-DIALOG` | حوار | W/M/D/A/C |
| `C-PANEL` | لوحة جانبية | W/D/A |
| `C-SHEET` | bottom sheet | M |
| `C-TABLE` | جدول / بطاقة صف | W/M/D/A |
| `C-FILTER` | مرشح وترقيم | W/M/D/A |
| `C-MONEY` | إدخال مال | W/M/D |
| `C-QTYUNIT` | إدخال كمية ووحدة | W/M/D |
| `C-STATUS` | شارة حالة | W/M/D/A/C |
| `C-TIMELIST` | قائمة وقتية | W/M/D/A/C |
| `C-UPLOAD` | رفع ملف | W/M/D/A |
| `C-DOCPRV` | معاينة مستند | W/M/D/A |
| `C-NOTICE` | إشعار وحالة فارغة | W/M/D/A/C |
| `C-SYNC` | مؤشر اتصال ومزامنة | W/M/D |
| `C-CART` | سلة ودفع | W/M/D |
| `C-LEDLINE` | بند كشف حساب | W/M/D |
| `C-LISTING` | بطاقة عرض منشور | W/M/D |
| `C-QUOTE` | إصدار عرض سعر | W/M/D |
| `C-ORDTL` | خط زمني لطلب | W/M/D |
| `C-RECV` | استلام جزئي | W/M/D |
| `C-AUD` | اختيار جمهور | W/M/D/A |
| `C-CAMP` | محرر حملة | W/M/D/A |
| `C-PRINT` | طابعة وإيصال | W/M/D |
| `C-PHASE` | وسم مرحلة (M3/M4/مشروط) | W/M/D |

## المنصات والمقاسات
| المنصة | المقاسات | ملاحظة |
|---|---|---|
| W | 390 · 834 · 1440px | تحقق إضافي على 360px؛ إعادة ترتيب المحتوى لا تعني ثلاث صفحات أعمال |
| M | 390px | تحقق على 360px؛ نسخة تابلت 834px لشاشات POS فقط |
| D | 1366 · 1920px | تغيير حجم النافذة مطلوب بين المقاسين |
| A | 390 · 834 · 1440px | إدارة Sting ويب متجاوب داخل إطار منفصل |
| C | 390 · 1440px | بوابة الزبون ويب/PWA؛ لا تتطلب Expo |

## مفردات الحالات (17)
| الرمز | العربية |
|---|---|
| `ready` | جاهز |
| `loading` | تحميل |
| `empty` | فارغ |
| `validation_error` | خطأ تحقق |
| `permission_denied` | صلاحية مرفوضة |
| `offline` | بلا اتصال |
| `stale` | بيانات قديمة |
| `saving` | جارٍ الحفظ |
| `saved_local` | محفوظ محلياً |
| `pending_sync` | معلّق المزامنة |
| `synced` | مؤكد خادمياً |
| `conflict` | تعارض |
| `server_error` | خطأ خادم |
| `expired` | منتهي الصلاحية |
| `partial` | جزئي |
| `success` | نجاح |
| `phase_locked` | مرحلة غير مفعّلة |

**قواعد إسناد الحالة إلى شاشة** (طُبِّقت على 15 موضع تعارض في `30-Decisions-States-Registry.dc.html`):
1. **السجل هو المرجع الأوحد.** إطار مرسوم بحالة خارج قائمة شاشته اقتراحٌ بتوسيع السجل لا توسيع تلقائي.
2. **`pending_sync` للقوائم و`saved_local` للنماذج.** خلطهما يوهم المستخدم أن فعله خرج من الجهاز وهو لم يخرج.
3. **التنبيه ليس حالة.** شارةٌ على صفّ داخل شاشة `ready` محتوىً لا حالة؛ وإلا بلغت المصفوفة آلافاً بلا معنى.

## Acceptance Criteria (ACC-01–150)
عمود **الأثر**: `full` أثر مرئي كامل · `partial` أثر مرئي جزئي · `tech` تقني خارج التصميم · `none` لا يولد شاشة.

| ID | السيناريو | الأثر | الشاشات | الملاحظة |
|---|---|---|---|---|
| `ACC-01` | قتل التطبيق أثناء ١٠٠٠ عملية | partial | POS-11, SYS-01 | ذرّية الحفظ اختبار تقني خارج التصميم؛ المرئي: تمييز محفوظ/غير محفوظ |
| `ACC-02` | بيع آجل ١٠٠ بعد لقطة صفر أثناء الانقطاع | full | POS-06, PTY-05 | الرصيد ١٠٠ يظهر مع بيان المعلق المحلي |
| `ACC-03` | لقطة ١٠٠ وسداد محلي ٤٠ | full | PTY-05, PTY-06 | الرصيد ٦٠ مع «آخر تحديث خادمي + معلق هذا الجهاز» |
| `ACC-04` | ACK لبيع محلي برقم أكبر من S | tech | SYS-01 | اختبار تقني خارج التصميم؛ الحالة المرئية: pending_sync لا يغير الرصيد |
| `ACC-05` | فقد ACK ثم لقطة ثم duplicate | partial | SYS-01, SYS-02 | المرئي: عملية واحدة لا تُحتسب مرتين في السجل |
| `ACC-06` | PULL قبل ACK وبالعكس | tech | SYS-01 | اختبار تقني خارج التصميم |
| `ACC-07` | بيع جديد أثناء مصالحة مرشح | partial | POS-01, SYS-08 | المرئي: البيع غير محجوب أثناء المصالحة |
| `ACC-08` | بيع ١٠٠ منه ٤٠ نقداً و٦٠ آجلاً | full | POS-07, PTY-05, SHIFT-02 | قيم السيناريو الموحد ظاهرة في ثلاث شاشات |
| `ACC-09` | بيع ومرتجع كامل صالح | full | POS-10, POS-08 | مستندان مستقلان، لا حذف أصل |
| `ACC-10` | مرتجع تالف | full | POS-10, INV-07 | وجهة الرد حجر أو هالك لا مخزون صالح |
| `ACC-11` | مرتجع آجل ومختلط وجزئي | full | POS-10 | حالة partial وvalidation_error عند تجاوز الأصل |
| `ACC-12` | بيع نقدي لعميل مجهول | full | POS-04, POS-05 | لا عميل وهمي؛ العميل مطلوب للأثر الآجل فقط |
| `ACC-13` | جزء نقد وجزء بنك وجزء آجل | full | POS-07, SHIFT-02 | النقد وحده في الصندوق |
| `ACC-14` | تحويل بنكي مسجل غير مطابق | full | POS-07, PTY-06, ORD-13 | شارة «مسجل — غير مطابق» |
| `ACC-15` | إعادة استعمال مبلغ تحويل مستهلك | partial | PTY-06, ORD-13 | المرئي: منع الاستخدام المكرر وتوزيع مشروع |
| `ACC-16` | جهازان يعيدان نفس الكمية بهويتين | partial | POS-12, SYS-03 | المرئي: مراجعة تكرار وحجر |
| `ACC-17` | جهازان يبيعان آخر مخزون | partial | INV-01, POS-01 | المرئي: تنبيه رصيد سالب دون منع البيع |
| `ACC-18` | استقبال نفس تحويل المخزون مرتين | partial | INV-10, SYS-03 | المرئي: الباقي محفوظ ولا مضاعفة |
| `ACC-19` | كرتونة إلى حبة ثم تغيير المعامل | full | CAT-03, CAT-04, POS-02 | سطر الماضي يحفظ معامله؛ يظهر في تاريخ التغيير |
| `ACC-20` | بيع ٠٫١ و٠٫١٢٣ كغ مراراً | full | POS-02 | دقة الكمية والوحدة |
| `ACC-21` | عدد يتجاوز سقف Number الآمن | tech | — | اختبار تقني خارج التصميم |
| `ACC-22` | JSON عددي و-0 وأصفار بادئة | tech | — | اختبار تقني خارج التصميم |
| `ACC-23` | سعر صرف صفري أو منازل خاطئة | tech | ACC-04 | المرئي: العملة واحدة غير قابلة للتبديل |
| `ACC-24` | تقريب ±٢٫٥ و±٢٫٤ ومجاميع السطور | full | POS-05, POS-07 | نفس النتيجة على كل منصة؛ لا حساب مختلف |
| `ACC-25` | حدود طول وقيمة وضرب ومجموع | partial | POS-01, CAT-02 | المرئي: validation_error مضبوط |
| `ACC-26` | عملة أخرى أو أُس خاطئ | tech | ACC-04 | اختبار تقني؛ المرئي: رفض تغيير العملة |
| `ACC-27` | تغيير عملة مؤسسة قبل أول بيع | full | ACC-04, ORG-09 | رفض صريح مع سبب |
| `ACC-28` | الشخص نفسه عميل ومورد | full | PTY-03, PTY-05 | رصيدان منفصلان؛ لا مقاصة تلقائية |
| `ACC-29` | إعادة النقل ثلاث مرات وقطع الرد | tech | SYS-02 | اختبار تقني خارج التصميم |
| `ACC-30` | عملية ناقصة الأعضاء | partial | POS-11 | المرئي: لا رسالة نجاح لما لم يكتمل |
| `ACC-31` | عملية فاشلة بقيد مؤجل | tech | — | اختبار تقني خارج التصميم |
| `ACC-32` | نفس operation_id بعضو مختلف | partial | SYS-03 | المرئي: بند conflict قابل للمراجعة |
| `ACC-33` | مرجع أب غير مؤكد ونقل مقطع | tech | SYS-02 | اختبار تقني خارج التصميم |
| `ACC-34` | فتح وردية offline ثم بيع ورفع | full | SHIFT-01, SHIFT-02 | العمل بلا اتصال ثم pending_sync |
| `ACC-35` | قيد مفقود من الهجرة | tech | — | اختبار تقني خارج التصميم |
| `ACC-36` | كتابتان متزامنتان وقراءة | tech | — | اختبار تقني خارج التصميم |
| `ACC-37` | كتابة sync_log دون قفل صحيح | tech | — | اختبار تقني خارج التصميم |
| `ACC-38` | كتابة أعمال عبر admin أو استيراد | partial | SYS-10 | المرئي: نتيجة الاستيراد ومنع التكرار |
| `ACC-39` | تحديث كيان بين قراءة الفهرس والمحتوى | tech | — | اختبار تقني خارج التصميم |
| `ACC-40` | إعادة صفحة ووصول صفحات خارج الترتيب | tech | ACC-05 | المرئي: تقدم التهيئة لا يتراجع |
| `ACC-41` | has_more وتعدد نطاقات | tech | ACC-05 | اختبار تقني؛ المرئي: استئناف التنزيل |
| `ACC-42` | منح فرع أو شراء مجموعة جديدة | partial | ORG-03, ACC-05 | المرئي: تهيئة النطاق الجديد |
| `ACC-43` | حد الصفحة داخل عملية بيع | partial | POS-11 | المرئي: لا عرض لعملية ناقصة |
| `ACC-44` | إسقاط لا يحق للجهاز قراءة كل أعضائه | partial | PTY-05, ORG-02 | المرئي: الجزء المخول يكتمل |
| `ACC-45` | تعطيل مرجع أو سحب وصول | full | ORG-05, CAT-01 | شاهد صريح لا اختفاء صامت |
| `ACC-46` | جهاز فرع يحسب دين نشأ في فرع آخر | full | PTY-05, ORG-02 | رصيد مؤسسي دون كشف فواتير فرع آخر |
| `ACC-47` | snapshot أقدم من النشط | tech | SYS-01 | اختبار تقني خارج التصميم |
| `ACC-48` | قتل التطبيق أثناء تفعيل لقطة | tech | SYS-01 | اختبار تقني خارج التصميم |
| `ACC-49` | تعارض حساب واحد | full | SYS-03 | عزل الحساب واستمرار البقية |
| `ACC-50` | A عند S=٥٠ وB عند S=١٠٠ | tech | — | اختبار تقني خارج التصميم |
| `ACC-51` | حركة مؤكدة أحدث من لقطة المستهلك | tech | — | اختبار تقني خارج التصميم |
| `ACC-52` | جهاز جديد لمؤسسة عمرها سنتان | full | ACC-05 | لقطة ودلتا؛ لا تنزيل كامل |
| `ACC-53` | انتهاء صلاحية لقطة خلال التهيئة | full | ACC-05 | استئناف أو بدء آمن |
| `ACC-54` | تاريخ حديث مشمول في لقطة | tech | — | اختبار تقني خارج التصميم |
| `ACC-55` | استعادة الخادم إلى رقم أقدم | full | SYS-08 | جيل جديد ومصالحة |
| `ACC-56` | ACK أو PULL من جيل سابق | tech | SYS-08 | اختبار تقني؛ المرئي: بيان الجيل |
| `ACC-57` | إعادة رفع أحداث فقدها الخادم | full | SYS-08, SYS-03 | مصالحة بالهويات الأصلية |
| `ACC-58` | ترقية عقد التجزئة وإعادة عملية قديمة | tech | — | اختبار تقني خارج التصميم |
| `ACC-59` | خطأ شبكة و429 و5xx مقابل تحقق دائم | full | SYS-02 | إعادة للعابر وحجر للدائم |
| `ACC-60` | مستأجر يحاول قراءة بيانات آخر | full | PUB-04, MP-05 | رفض عام بلا تسريب اسم أو سعر |
| `ACC-61` | اتصال قاعدة يعاد استخدامه بسياق سابق | tech | — | اختبار تقني خارج التصميم |
| `ACC-62` | كاشير يطلب متحققات فرع آخر | full | ACC-07, ORG-02 | رفض دون تنزيل أسرار |
| `ACC-63` | تعطيل موظف على جهاز مشترك | full | ORG-05, SYS-03 | استمرار الآخرين وحفظ معلّق الموظف |
| `ACC-64` | إلغاء جهاز أو سحب نطاق وفيه معلّق | full | ORG-05, SYS-07 | استرداد مخول قبل المحو |
| `ACC-65` | تزوير وسم جهاز ملغى | tech | — | اختبار تقني خارج التصميم |
| `ACC-66` | قفل خمول ثم استئناف وانقطاع كهرباء | full | ACC-07, SHIFT-02 | نفس الوردية بلا فتح مكرر |
| `ACC-67` | تبديل كاشير وتسليم صندوق | full | SHIFT-04, SHIFT-05 | غير المعدود لا يعرض فرقاً صفرياً |
| `ACC-68` | حركة متأخرة لوردية مغلقة | full | SHIFT-05 | لقطة الإغلاق ثابتة |
| `ACC-69` | امتلاء التخزين وفشل حفظ جديد | full | SYS-04, POS-11 | لا نجاح كاذب ومسار يدوي |
| `ACC-70` | رفض التخزين المستديم أثناء التجهيز | full | SYS-04, ACC-05 | لا اعتماد صامت |
| `ACC-71` | تبويبان أو نسختان على نفس الجهاز | full | ORG-04, SYS-01 | لا اعتماد بيع مكرر |
| `ACC-72` | تحديث ومئات العمليات غير المرفوعة | full | SYS-09 | تأجيل آمن أو تصدير |
| `ACC-73` | استعادة ملف مرتين على جهاز بديل | full | SYS-06 | لا تكرار؛ هوية جديدة للكتابات الجديدة |
| `ACC-74` | ملف تالف أو مستأجر مختلف | full | SYS-06 | رفض قبل تغيير البيانات |
| `ACC-75` | تعطل الخادم واستعادة نسخة مستقلة | full | PLT-10 | نتائج RPO/RTO معروضة كقياس لا وعد |
| `ACC-76` | تشغيل بارد بعد أيام بلا شبكة | full | WEB-01, POS-01 | الواجهة والخطوط والبحث تعمل |
| `ACC-77` | ساعة جهاز في سنة ماضية أو مستقبلية | full | POS-09, SYS-02 | تاريخ مشكوك فيه معلن دون تعديل الأصل |
| `ACC-78` | دمج ثم أحداث متأخرة ثم تراجع | full | PTY-07 | خريطة هوية دون إعادة كتابة الحركات |
| `ACC-79` | رصيد افتتاحي وسداد بلا توزيع فواتير | full | PTY-04, REP-02 | لا اختلاق أعمار ديون |
| `ACC-80` | انتهى الاشتراك أو صلاحية رمز المزامنة | full | ORG-08 | البيع المحلي مستمر وفق العقد |
| `ACC-81` | انتهاء اشتراك مع استعادة جهاز بديل | full | ORG-08, SYS-06 | لا حجب للبيانات |
| `ACC-82` | تخفيض باقة ووحدة لها معلّق | full | ORG-06, ORG-08 | حدود العرض والكتابة واضحة |
| `ACC-83` | طباعة عربية ومختلطة على طرازين | full | POS-08, DESK-02, WEB-03 | نص متصل واتجاه وباركود |
| `ACC-84` | نفاد ورق وإطفاء طابعة | full | POS-11, DESK-02 | إعادة نسخة بنفس الرقم دون بيع جديد |
| `ACC-85` | مشاركة كشف ونسخة استرداد | full | PTY-08, SYS-05 | معاينة قبل التنفيذ دون وعد تسليم |
| `ACC-86` | استيراد ٥٠٠ صنف و٢٠٠ رصيد وإعادته | full | SYS-10, CAT-05 | معاينة ومطابقة ومنع تكرار |
| `ACC-87` | سجل تشخيص وحجر ونسخ | full | SYS-11 | لا أسرار ولا بيانات مستأجر آخر |
| `ACC-88` | تعطل Redis أو العامل الخلفي | partial | NOT-06, SYS-01 | المرئي: العملية الأساسية تلتزم |
| `ACC-89` | إضافة قطاع | tech | — | اختبار تقني خارج التصميم |
| `ACC-90` | هامش مع تكلفة مفقودة | full | PUR-05, REP-05 | لا رقم ربح مضلل؛ وسم عقد التكلفة |
| `ACC-91` | متطلبات عميل تجريبي الضريبية | tech | PUB-02 | قرار مفتوح G-11؛ لا شاشة ضريبية مفترضة |
| `ACC-92` | واجهة PWA على هاتف وتابلت وحاسوب | full | POS-01, PTY-05, MP-04 | رحلات متجاوبة صالحة على 390/834/1440 |
| `ACC-93` | تثبيت PWA وتحديث Service Worker | full | WEB-01, SYS-09 | تحديث آمن دون فقد المعلق |
| `ACC-94` | SSR/ISR مع مستخدمين مختلفين | tech | — | اختبار تقني خارج التصميم |
| `ACC-95` | بوابة زبون مقابل POS على نفس المتصفح | full | CUS-01, WEB-02 | عزل النطاق؛ لا وصول لدفاتر الإدارة |
| `ACC-96` | بيع من الويب وسداد من Expo ومرتجع من Tauri | full | SYS-01, PTY-05 | رصيد واحد صحيح بعد المزامنة |
| `ACC-97` | أعداد كبيرة عبر SQLite وIndexedDB | tech | — | اختبار تقني خارج التصميم |
| `ACC-98` | JWT منتهٍ وتجديد متزامن وإلغاء جهاز | full | ACC-08, ACC-09 | حفظ محلي مخول مستمر دون كشف رمز |
| `ACC-99` | تخزين أسرار الموبايل والديسكتوب | full | NAT-04, SYS-05 | لا أسرار في نسخ الأعمال |
| `ACC-100` | ترقية Expo وتحديث Tauri مع معلّق | full | NAT-04, DESK-01, SYS-09 | استئناف أو رجوع آمن |
| `ACC-101` | طباعة أصلية وملفات Tauri دون خادم Next | full | DESK-02 | طباعة نسخة بلا بيع جديد |
| `ACC-102` | PWA وتطبيق أصلي على نفس الجهاز | full | ORG-04 | هويتان وبادئتان واضحتان |
| `ACC-103` | مسؤول محل يرسل لمستأجر آخر | full | NOT-04, PLT-05 | رفض دون تسريب جمهور |
| `ACC-104` | ناشر Sting يعلن ميزة مقيدة بباقة | full | PLT-04, ORG-06 | لا إعلان مضلل عن ميزة غير متاحة |
| `ACC-105` | زبون يشترك بمحلين ثم يلغي قناة | full | CUS-04 | تفضيلات مستقلة |
| `ACC-106` | زبون اسمه وهاتفه فقط في Party | full | CUS-02, PTY-03 | لا ربط كشف حساب تلقائي |
| `ACC-107` | رفض إذن Push أو متصفح غير مدعوم | full | CUS-05, WEB-02, NAT-01 | لا اشتراك ناجح كاذب |
| `ACC-108` | إعادة تشغيل الجدول أثناء حملة | partial | NOT-06 | المرئي: نتيجة مزود غير معروفة معلنة |
| `ACC-109` | إلغاء حملة بعد الجدولة | full | NOT-05, NOT-06 | إعادة تحقق قبل المحاولة |
| `ACC-110` | عودة الاتصال بعد انتهاء عرض | full | MP-14, NOT-01 | لا تنبيه قديم مضلل |
| `ACC-111` | قبول المزود مع غياب دليل تسليم | full | NOT-06 | لا تسجيل قراءة افتراضي |
| `ACC-112` | token معطل أو تبديل مستخدم | full | CUS-04, NAT-03 | لا تسريب للمستخدم التالي |
| `ACC-113` | رابط عميق أو إشعار شاشة قفل | full | NAT-03, NOT-01 | لا مبالغ ديون في التنبيه |
| `ACC-114` | تعطل Django أو Redis | full | PUB-03, POS-01 | قناة حالة مستقلة |
| `ACC-115` | فحص حدود النواة واستيراداتها | tech | — | اختبار تقني خارج التصميم |
| `ACC-116` | عقد التخزين على Dexie وExpo وTauri | tech | — | اختبار تقني خارج التصميم |
| `ACC-117` | بيانات سيناريو وإعادة ضبط ومحاكاة | full | F01-F17 | زر إعادة الضبط في النموذج وحده |
| `ACC-118` | سجل مورد خاص دون موافقة نشر | full | PTY-02, MP-08 | لا ملف عام تلقائي |
| `ACC-119` | منشأة تشتري وتبيع بحساب سوق محدود | full | MP-08, ACC-01 | G-06 محسوم: المسار ب تحقق بائع منفصل |
| `ACC-120` | نشر منتجات مختارة وسحب النشر | full | MP-09, MP-10, MP-11 | الحقول المصرح بها فقط |
| `ACC-121` | سعر خاص ومنشأة ثالثة | full | MP-12, PUB-04 | رفض عام بلا تسريب |
| `ACC-122` | منتج كرتونة ١٢ وآخر ٢٤ | full | MP-04, MP-05 | لا «الأرخص» عند اختلاف الوحدة |
| `ACC-123` | مسودة بلا شبكة ثم تغير السعر | full | ORD-01, MP-13 | لا تأكيد محلي؛ موافقة على التغيير |
| `ACC-124` | قطع رد إنشاء الطلب وإعادته | full | ORD-14 | طلب واحد؛ اختلاف الحمولة تعارض |
| `ACC-125` | موافقة على عرض قديم | full | ORD-07 | رفض الإصدار القديم |
| `ACC-126` | سلة موردين | full | ORD-01, ORD-02 | طلبان مستقلان وحدود ورسوم |
| `ACC-127` | طلب ١٠ وعرض ٨ واستلام ٧ | full | ORD-05, ORD-09 | لا دين من الطلب |
| `ACC-128` | شحن أو استلام يتجاوز المتبقي | full | ORD-08, ORD-09 | رفض خادمي |
| `ACC-129` | إلغاء بعد استلام جزئي | full | ORD-10 | إلغاء المتبقي فقط |
| `ACC-130` | تحويل الاستلام إلى مستند وإعادته | full | LINK-03 | لا أثر مالي مكرر |
| `ACC-131` | ربط صنف أو طرف لمستأجر آخر | full | LINK-01, LINK-02 | لا دمج بالاسم |
| `ACC-132` | رفض المشتري كمية يدعي البائع تسليمها | full | ORD-12 | دفاتر الطرفين مستقلة |
| `ACC-133` | إيصال تحويل أو إشعار وصول | full | ORD-13 | لا سداد ذمة بمجرد الرفع |
| `ACC-134` | إلغاء متابعة تسويق مورد | full | MP-06 | أحداث الطلب المخولة تبقى |
| `ACC-135` | تعليق بائع أو انتهاء باقة أدواته | full | MP-14, PLT-07 | منع الجديد وبقاء التصدير |
| `ACC-136` | توقف السوق أثناء البيع | full | POS-01, SYS-01 | POS المحلي مستمر |
| `ACC-137` | استعادة خادم وطلب مؤكد مفقود | full | ORD-15, SYS-08 | لا تحويل مالي صامت |
| `ACC-138` | قائمة أسعار خاصة وتبديل حساب | full | MP-12, ACC-03 | لا إعادة استخدام كاش الحساب السابق |
| `ACC-139` | تعليق نشر وملف ضار أو انتحال | full | MP-15, PLT-07 | لا مساس بدفاتر الأطراف |
| `ACC-140` | عرض بالجنيه وحساب بعملة مختلفة | full | MP-05, ORD-02 | منع التأكيد دون تحويل ضمني |
| `ACC-141` | مرتجع جزئي مكرر من جهازين | full | ORD-11 | لا تجاوز للمستلم غير المعاد |
| `ACC-142` | تقرير قيمة التجارة وحالات الطلب | full | PLT-11, GROW-02 | لا مضاعفة قيمة بين الطرفين |
| `ACC-143` | انتهاء عرض مع توقف عامل الجدولة | full | MP-05, MP-14 | التأكيد الخادمي يمنع اعتباره سعراً حالياً |
| `ACC-144` | تعديل وصف أو تحديث آلي للعرض | full | MP-13 | لا تجديد تأكيد تلقائي |
| `ACC-145` | انتهاء كتالوج بعد قبول عرض | full | ORD-05 | الاتفاق السابق ثابت |
| `ACC-146` | تقرير M0 دون فرص كافية | full | PLT-11 | نتيجة غير حاسمة لا توقف البناء |
| `ACC-147` | تقرير M0 ناجح مع وساطة مكثفة | full | PLT-11 | الدقائق والكلفة والأهداف ظاهرة |
| `ACC-148` | شكوى جودة وإغلاق تذكرة دعم | full | ORD-12, PLT-08 | لا تسوية دفتر تلقائية |
| `ACC-149` | نطاق الإصدار الأول دون نتائج M0 | none | — | معيار وثيقة لا يولد شاشة؛ يظهر في فهرس المصمم |
| `ACC-150` | مشاركة عرض ودعوة منشأة ورابط خاص | full | MP-07, ACC-06 | لا تسرب بالمعاينة ولا اشتراك تلقائي |

## التعارضات والنواقص (G-01–G-16)
### G-01 — نمط الأرقام في الواجهة
**النوع:** تعارض · **الحالة:** محسوم — أرقام لاتينية tabular للمبالغ والكميات والمعرفات، نص عربي كامل، مبدّل واحد في ORG-09

التكليف §٩ يقول «المرجع الأولي يستخدم الأرقام العربية»، لكن الجداول المالية الكثيفة (PTY-05، REP-01، ORD-09) تحتاج محاذاة عمودية ومقارنة سريعة، وهو ما تخدمه أرقام لاتينية بعرض ثابت. خلط النمطين في نفس الشاشة يخالف «يطبق باستمرار».

**المقترح المطبق:** أرقام لاتينية بعرض ثابت (tabular) في كل المبالغ والكميات والمعرفات، مع نصوص عربية كاملة؛ إعداد واحد في ORG-09 يبدل النمط للنظام كله.

### G-02 — وسيلة تحقق الحساب
**النوع:** نقص · **الحالة:** محسوم — مسار «رمز تحقق» محايد للمزود + بديل «تحقق يدوي بالدعم»، لا افتراض SMS OTP

ACC-02 يشترط «وسيلة التحقق قرار موثق لا مزود مفترض»، وv21 §١٩ يتركها قراراً مفتوحاً. تصميم شاشة يفترض SMS OTP يخلق وعداً تشغيلياً غير مثبت.

**المقترح المطبق:** ACC-02 يُصمم بمسار محايد «رمز تحقق» + شاشة بديل «تحقق يدوي بواسطة الدعم»، مع وسم قرار مفتوح ظاهر في فهرس المصمم.

### G-03 — عقد التكلفة يحجب تقارير معتمدة
**النوع:** تعارض · **الحالة:** مقترح — يحدد نطاق REP-01

PUR-01–05 «مشروط» بعقد تكلفة، وREP-05 يعتمد الهامش، لكن REP-01 «أساسي/مشروط» دون بيان أي أعمدته مشروط.

**المقترح المطبق:** REP-01 أساسي بأعمدة إيراد ومرتجعات ووسائل دفع فقط؛ أي عمود تكلفة/هامش يظهر بحالة phase_locked داخل REP-01 وREP-05 مع سبب «يتطلب سياسة تكلفة معتمدة».

### G-04 — تسعير العرض الممول
**النوع:** نقص · **الحالة:** محسوم — لا تسعير في الإصدار الأول؛ GROW-03 مؤجلة بلا شاشة (M4)

GROW-03 يذكر «تفاصيل التسعير قرار مفتوح». لا يمكن تصميم شاشة دفع أو نموذج سعر دون قرار.

**المقترح المطبق:** GROW-03 يُصمم كطلب داخلي بلا رقم: وسم إعلان + جمهور + مدة + حالة «التسعير غير معتمد — يتواصل الفريق»، دون واجهة دفع.

### G-05 — منصات بوابة الزبون
**النوع:** توضيح · **الحالة:** موثق — لا يحتاج قراراً

السجل يعطي CUS المنصة C فقط، بينما F15 رحلة هاتف بالكامل. قد يُقرأ ذلك كنقص تغطية موبايل.

**المقترح المطبق:** C = ويب/PWA متجاوب يُصمم على 390 و1440؛ لا نسخة Expo. مسجل صريحاً في عمود المنصات ولا يعد فجوة.

### G-06 — لا معرف لتفعيل دور البائع
**النوع:** نقص · **الحالة:** محسوم — المسار ب: تحقق بائع منفصل يراجعه مشرف السوق، حالة داخل MP-08

v21 §٣.٤ ينص أن «المتجر المسجل كمشترٍ يستطيع نشر عروض عند تفعيل دور البائع»، وACC-119 يختبره. السجل لا يعطي هذا الانتقال معرفاً؛ MP-08 مكتوب لتهيئة بائع جديد.

**المقترح المطبق:** إضافة MP-08 حالة فرعية «ترقية حساب مشترٍ إلى بائع» أو معرف جديد MP-16. المقترح: حالة داخل MP-08 لتجنب توسيع السجل، وتسجيلها في التغطية باسم إطار W/MP-08/1440/upgrade_role.

### G-07 — طابور إشعارات المستأجر
**النوع:** نقص · **الحالة:** مقترح — لا يوسع السجل

PLT-05 يغطي تشغيل الإرسال على مستوى المنصة، وNOT-06 يغطي نتائج حملة واحدة. لا شاشة تعرض للتاجر حصته وطابوره وإخفاقاته عبر الحملات.

**المقترح المطبق:** إضافة الحصة والطابور والإخفاقات كقسم داخل NOT-03 (قائمة الحملات) بدل معرف جديد؛ ACC-088 وACC-111 يبقيان مربوطين بـNOT-06.

### G-08 — «وظائف POS الأساسية» غير معرّفة
**النوع:** تعارض · **الحالة:** محسوم — القائمة الصريحة معتمدة؛ البيع والذمم والورديات والتصدير تستمر، والسوق والتقارير الخادمية تُحجب

ORG-08 يقول «الأعمال الأساسية مستمرة» وACC-80 يقول «وفق العقد»، والعقد لا يعدّد الوظائف. بدون قائمة، شاشة انتهاء الاشتراك تصبح افتراضاً تجارياً.

**المقترح المطبق:** قائمة صريحة مقترحة تستمر بعد الانتهاء: POS-01–08 و10–11، SHIFT-01–05، PTY-05–06 و08، SYS-05، REP-06 (تصدير). تُحجب: MP، ORD، NOT-03–06، REP-01–05، CAT-05، SYS-10.

### G-09 — سقوف التفويض المالي
**النوع:** نقص · **الحالة:** محسوم — حد لكل دور قابل للتحرير (قيمة + وحدة + نطاق)، وقيم النموذج تجريبية معلنة

ORG-02 يطلب «الحد المالي»، وPOS-03 يطلب «حدود التفويض»، دون قيم أو وحدات في أي وثيقة.

**المقترح المطبق:** المصفوفة تصمم بحد لكل دور قابل للتحرير (قيمة + وحدة + نطاق يومي/للعملية)، والقيم في النموذج بيانات تجريبية معلنة لا توصية سعرية.

### G-10 — العتاد والأنظمة المعتمدة
**النوع:** نقص · **الحالة:** موثق — بيانات لاحقة

v21 §١.١ يقول إن الأنظمة والعتاد «يثبتان بالاختبار لكل إصدار». DESK-01 وNAT-02 وWEB-03 تحتاج قائمة لعرضها.

**المقترح المطبق:** تصميم هذه الشاشات بقائمة متطلبات مصدرها بيانات قابلة للتحديث، ونص «طرازات مثبتة بالاختبار» بدل وعد بكل طابعة.

### G-11 — النص القانوني والضريبي
**النوع:** نقص · **الحالة:** موثق — يحتاج مراجعة خارجية

PUB-02 وACC-91 يتركان الالتزام الضريبي وشروط السوق لمراجعة نهائية.

**المقترح المطبق:** PUB-02 يُصمم بهيكل أقسام ونص مؤقت موسوم «يحتاج مراجعة قانونية»؛ لا شاشة ضريبية مفترضة ولا حقل رقم ضريبي إلزامي.

### G-12 — اتجاه الشريط الجانبي في RTL
**النوع:** توضيح · **الحالة:** موثق — قاعدة تنفيذ

التكليف §٥ يقول «شريط جانبي يميناً». في RTL اليمين هو الجانب الابتدائي، فالتعبير صحيح لكنه يُنفّذ منطقياً لا بصرياً.

**المقترح المطبق:** استخدام inset-inline-start بدل right، ليبقى الشريط في الجانب الابتدائي ويعمل تحقق الإنجليزية LTR دون إعادة تخطيط.

### G-13 — حالة «مرحلة غير مفعّلة» غير موجودة في المفردات
**النوع:** نقص · **الحالة:** محسوم — phase_locked حالة سابعة عشرة معتمدة؛ شاشة مصمَّمة ببيانات معطَّلة وسبب صريح

التكليف §٦ يعدّ ١٦ حالة مشتركة، وشاشات M3/M4 والمشروط تحتاج حالة تعني «مصمم ولن يعمل الآن». ليست permission_denied (لا علاقة بالدور) ولا expired ولا server_error.

**المقترح المطبق:** إضافة حالة سابعة عشرة phase_locked إلى المفردات، برسالة «هذه الوظيفة مصممة وتُفعّل في المرحلة M3/M4 أو بعد عقدها»، ومكوّن C-PHASE لعرضها.

### G-14 — المنشأة الثالثة في بيانات التجربة
**النوع:** توضيح · **الحالة:** موثق — لا يحتاج قراراً

سيناريو «الصلاحية» في التكليف §٩ يحتاج منشأة ثالثة تفتح رابطاً غير مخول، والمذكور «متجر الأمان — غير مشارك في الطلب».

**المقترح المطبق:** يستخدم «متجر الأمان — تجريبي» كالمنشأة الثالثة في سيناريو الصلاحية أيضاً؛ لا منشأة رابعة، ولا بيانات إضافية.

### G-15 — توقع تقادم الديون
**النوع:** تعارض · **الحالة:** مقترح — يمنع سوء فهم

REP-02 يمنع عمر الدين ويكتفي بآخر سداد (ACC-79)، وهو ما يطلبه أصحاب المحلات عادة. تصميم صامت سيقرأ كنقص.

**المقترح المطبق:** REP-02 يعرض «آخر سداد» و«أقدم حركة غير مسددة» كتاريخ فقط، مع سطر صريح «تقادم الديون غير مفعّل — يحتاج توزيع دفعات على الفواتير». لا جدول أعمار.

### G-16 — ACC-149 لا يولد شاشة
**النوع:** توضيح · **الحالة:** موثق — لا يحتاج قراراً

معيار قبول على مستوى الوثيقة (نطاق الإصدار الأول) لا أثر مرئي له.

**المقترح المطبق:** يسجل في مصفوفة المعايير بأثر «لا شاشة» وسبب معلن، امتثالاً لقاعدة «غير المرئي لا يولد شاشة زخرفية».

### بندان مفتوحان — غير معطّلين
- **G-10 — قائمة الأجهزة المعتمدة:** ينتظر مدخلات العميل. الأثر محصور في شاشة واحدة؛ ابنِ الشاشة بالقائمة كبيانات، لا كنص مضمّن.
- **G-11 — النص القانوني لـ PUB-02:** ينتظر النص النهائي. ابنِ PUB-02 بهيكل المستند ونص placeholder معلّم صراحة.

## Assets
لا أصول صور أو أيقونات ثنائية في الحزمة. الأيقونات في النماذج محارف/أشكال CSS بسيطة — استبدلها بمجموعة أيقونات الكودبيس القائم. أماكن الصور (شعار المنشأة، صور المنتجات، صور العروض المنشورة) معلّمة كمواضع placeholder وتحتاج أصولاً حقيقية من العميل. الخطوط من Google Fonts — استضفها محلياً في الإنتاج.

## Files
| الملف | المحتوى |
|---|---|
| `00-Coverage.dc.html` | سجل التغطية الكامل: 164 معرف شاشة، المنصات، المقاسات، الحالات، المكونات، الرحلات، معايير القبول، الفجوات |
| `01-Design-Directions.dc.html` | اتجاهات التصميم البصرية والاتجاه المعتمد |
| `02-Design-System.dc.html` | نظام التصميم المطبق: الألوان، الخطوط، المسافات، المكونات C-* |
| `03-D2-POS.dc.html` | POS — البيع والفواتير |
| `04-D2-Parties.dc.html` | PTY — الأطراف والذمم |
| `05-D2-Catalog-Inventory.dc.html` | CAT / INV — الكتالوج والمخزون |
| `06-D2-Shifts-Access.dc.html` | SHIFT / ACC — الورديات والدخول |
| `07-D3-Admin-Reports-Sync.dc.html` | ORG / REP / SYS — الإدارة والتقارير والمزامنة |
| `08-D4-Marketplace-Orders.dc.html` | MP / ORD — السوق والطلبات |
| `09-D5-Platform-Integrations.dc.html` | PLT / WEB / NAT — إدارة Sting والتكاملات |
| `10-D6-Marketplace-Orders-Completion.dc.html` | استكمال شاشات السوق والطلبات |
| `11-Prototype-Flows.dc.html` | النماذج التفاعلية للرحلات F01–F17 |
| `12-D7-Remaining-Screens.dc.html` | الشاشات المتبقية |
| `13-D8-Decisions-Applied.dc.html` | تطبيق القرارات المحسومة |
| `14-D9-POS-Inventory-States.dc.html` | حالات POS والمخزون |
| `15-D10-Parties-Shifts-Org.dc.html` | PTY / SHIFT / ORG — استكمال |
| `16-D11-System-Reports.dc.html` | SYS / REP — استكمال |
| `17-D12-Notifications-Campaigns.dc.html` | NOT — الإشعارات والحملات |
| `18-D13-Platform-Operator.dc.html` | PLT — مشغّل الخدمة (يضم PLT-09 تشخيص صحة الخادم) |
| `19-D14-Sync-Recovery-Reports.dc.html` | SYS — المزامنة والاستعادة والتقارير |
| `20-D15-Org-Access-Closure.dc.html` | ORG / ACC — إغلاق |
| `21-D16-Subscription-Customer-Public.dc.html` | ORG-06 / CUS / PUB — الاشتراك وبوابة الزبون والصفحات العامة |
| `22-Rules-Register.dc.html` | سجل القواعد — المرجع الملزم للسلوك |
| `24-D17-Critical-States.dc.html` | الحالات الحرجة (conflict, pending_sync, permission_denied) بالأحجام الثلاثة |
| `25-D18-Pending-Inputs-Closed.dc.html` | إغلاق المدخلات المعلّقة |
| `26-D19-Platform-Operator-Complete.dc.html` | PLT — استكمال مشغّل الخدمة |
| `27-D20-Org-Orders-Complete.dc.html` | ORG / ORD — استكمال |
| `28-D21-Access-Inventory-Complete.dc.html` | ACC / INV — استكمال |
| `29-D22-Marketplace-Link-Complete.dc.html` | MP / LINK — استكمال السوق والربط المحلي |
| `30-Decisions-States-Registry.dc.html` | **تسوية سجل الحالات** — القواعد الثلاث و15 قراراً بحجّة كلٍّ منها |
| `31-D23-Catalog-Home-Shift.dc.html` | CAT-02 / CAT-06 / HOME-03 / SHIFT-03 بكل حالاتها |
| `32-D24-Purchasing-Growth.dc.html` | PUR-01…PUR-05 / GROW-01 / GROW-02 بكل حالاتها |
| `33-D25-Failure-Payment-Closure.dc.html` | POS-11 / PTY-06 / SHIFT-04 بكل حالاتها |
| `23-Handoff.dc.html` | صفحة حزمة التسليم: فهرس الحزمة، مواصفات المكونات الـ29 بمتغيراتها وRTL ولوحة المفاتيح وقارئ الشاشة، القواعد الأكثر أثراً، ترتيب التنفيذ |
| `handoff/tokens.json` | توثيق قيم التصميم بصيغة Design Tokens CG — **مرجع للقيم لا مصدر يُولّد منه CSS** |
| `handoff/coverage.csv` | 164 صفاً: كل شاشة بمنصاتها وحالاتها ومكوناتها ورحلاتها ومعايير قبولها وملف تصميمها |
| `handoff/states-matrix.csv` | صف لكل تركيبة شاشة × منصة × مقاس × حالة (4069)، بمعرّف إطار فريد وعمودَي `design_status` و`frame_ref` — مدخل قائمة المهام ومصفوفة الاختبار |
| `handoff/not-drawn.md` | حالة الرسم: ما رُسم وما وُصف فقط، مولَّد من قراءة سطور المراجع ومطابقتها بالمصفوفة |

`coverage-data.json` — بيانات السجل (شاشات، رحلات، معايير، فجوات) كـ JSON؛ أفضل مدخل لتوليد جداول أو قوائم مهام برمجياً. نفس البيانات متاحة في النماذج عبر `window.STING` من `sting-coverage.js`.

`support.js` — طبقة عرض النماذج فقط. **لا تنقله ولا تقلّده.**

## أين تبدأ
1. اقرأ `22-Rules-Register.dc.html` و`02-Design-System.dc.html` — القواعد والتوكنات.
2. ابنِ مكونات C-* أولاً (C-FRAME, C-NAV, C-STATUS, C-NOTICE, C-TABLE, C-FIELD, C-BTN ثم الباقي).
3. نفّذ رحلة F01 (التهيئة) كاملة عبر شاشاتها — تُثبت الهوية والوردية والبيع.
4. ثم F02/F03 (البيع والمزامنة) — تُثبت طبقة بلا اتصال، وهي أعلى مخاطر المشروع تقنياً.
5. بعدها المجموعات بترتيب المرحلة: «أساسي» كاملاً قبل أي شاشة M1+.
