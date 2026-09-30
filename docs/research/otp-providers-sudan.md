# مزوّدو رمز التحقق والرسائل إلى السودان (+249)

بحث ويب بتاريخ 2026-09-30، بأمر المالك: «إن احتجت بيانات واقعية فابحث على الويب». القرار في 0005 §١٣٩.

- لكل ادعاء مصدره.
- ما لم يُتحقَّق منه موسوم **[غير متحقق]**.
- الأسعار تتغيّر؛ تُراجَع قبل التعاقد.

## الخلاصة والتوصية

| الترتيب | القناة | لماذا | ما يلزم قبل الإطلاق |
|---|---|---|---|
| 1 | **WhatsApp Cloud API** (قالب `verify_code` الموجود) | 0.004$ لرسالة المصادقة في سوق «Rest of Africa»، أي أرخص من الرسالة النصية بـ37–119 ضعفاً. السودان غير محظور لدى Meta. لا يحتاج تسجيل اسم مرسل. | حساب Meta تجاري؛ طريقة الدفع من السودان **[غير متحقق]**، وقد تلزم بطاقة أجنبية أو مزوّد وسيط (BSP) |
| 2 | **مجمّع رسائل نصية سوداني** (المرشّح: برق BrqSMS) عبر محوّل HTTP العام | يصل من لا واتساب له أو بلا باقة بيانات. يسجّل «VEZANO» لدى زين وMTN وسوداني سريعاً، ويقبل الدفع بالجنيه، ويسمح بالحملات | السعر الفعلي، واختبار التسليم على الشبكات الثلاث، وصيغة واجهته (محوّلنا على نمط Infobip) |
| 3 | **Twilio** أو Infobip، للطوارئ | شروط السودان موثّقة علناً | مكلف: 0.4749$ للرسالة؛ تسجيل الاسم عبر Twilio 3 أسابيع ولا يقبل المحتوى الترويجي |

- نصّ الرمز الحالي 65 حرفاً، أي مقطع UCS-2 واحد (الحدّ 70)، ويحرسه اختبار في `core/tests/test_senders.py`.
- الحملات التسويقية: عبر المزوّد المحلي، أو قالب Marketing في واتساب (0.0225$).

## 1 · واتساب

- **الدعم**: قائمة الدول المحظورة لدى Meta هي كوبا وإيران وكوريا الشمالية وسوريا والقرم ودونيتسك ولوهانسك، والسودان ليس منها — [Meta support](https://developers.facebook.com/documentation/business-messaging/whatsapp/support)، و[Twilio 63058](https://www.twilio.com/docs/api/errors/63058).
- **السعر**: جدول Meta الساري من 2026-07-01 يضع السودان في «Rest of Africa» — [pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing).
  - المصادقة 0.0040$ للرسالة.
  - الخدمة (Utility) 0.0040$.
  - التسويق 0.0225$.
  - خصم الحجم يبدأ بعد 300 ألف رسالة في الشهر.
- **العقوبات**:
  - رُفع السودان من قائمة الدول الراعية للإرهاب في 2020 — [Federal Register](https://www.federalregister.gov/documents/2021/01/19/2020-29037/implementation-in-the-export-administration-regulations-of-the-united-states-rescission-of-sudans).
  - برنامج OFAC الحالي يستهدف أشخاصاً وكيانات بعينهم لا البلد كله — [OFAC](https://ofac.treasury.gov/sanctions-programs-and-country-information)، و[Treasury](https://home.treasury.gov/news/press-releases/sb0544).
  - عقوبات يوليو 2026 بقانون CBW استثنت ما ليس في قائمة CCL من القيود — [Baker McKenzie](https://sanctionsnews.bakermckenzie.com/additional-sanctions-on-sudan-under-the-chemical-and-biological-weapons-control-and-warfare-elimination-act/).
- **قيد محلي**: هيئة تنظيم الاتصالات حجبت مكالمات واتساب الصوتية والمرئية منذ 2025-07-25، والرسائل تعمل — [TechAfrica](https://techafricanews.com/2025/07/28/sudan-blocks-whatsapp-calls-nationwide-citing-security-concerns/).

## 2 · الرسائل النصية — مقارنة

| المزوّد | يدعم السودان | السعر للرسالة | اسم المرسل | المصدر |
|---|---|---|---|---|
| Twilio | نعم | 0.4749$ | أبجدي بتسجيل مسبق (3 أسابيع)، ولا يقبل المحتوى الترويجي | [pricing](https://www.twilio.com/en-us/sms/pricing/sd)، [guidelines](https://www.twilio.com/en-us/guidelines/sd/sms) |
| D7 Networks | نعم | 0.36$ | تسجيل إلزامي، والجهة الرقابية TPRA | [d7](https://d7networks.com/sms/sudan/) |
| Unimatrix | نعم | 0.1498$ موحّد للشبكات | غير محدد | [unimtx](https://www.unimtx.com/sms/sd) |
| Infobip | نعم | **[غير متحقق]** (داخل البوابة) | أبجدي بتسجيل | [infobip](https://www.infobip.com/docs/sms/get-started) |
| Plivo | نعم | **[غير متحقق]** | أبجدي «فوري»، والرقمي محجوب على MTN وZain | [plivo](https://www.plivo.com/sms/coverage/sd/) |
| Telnyx | نعم | **[غير متحقق]** | MTN يشترط التسجيل | [telnyx](https://support.telnyx.com/en/articles/6680225-sudan-sms-guidelines) |
| BulkSMS.com | نعم | **[غير متحقق]** | غير محدد | [bulksms](https://www.bulksms.com/countries/s/sudan) |
| برق BrqSMS (محلي) | نعم | باقات بالجنيه **[غير متحقق]** | تسجيل «عادة في نفس اليوم»، وواجهة HTTP بصيغة JSON | [brqsms](https://brqsms.com/) |
| eSMS Africa | نعم | بالجنيه **[غير متحقق]** | يساعدون في التسجيل | [esmsafrica](https://esmsafrica.io/blog/bulk-sms-sudan) |
| Zain Sudan مباشرة | نعم (SMPP) | **[غير متحقق]** | بعقد مع الشركة | [zain](https://www.sd.zain.com/sites/business/en/smpp) |

- الأسعار الزهيدة المعلنة («من 0.013€») تسويقية، ويُرجَّح أن تمرّ عبر مسارات رمادية تستبدل اسم المرسل أو لا تسلّم الرسالة.
- الأرقام المنشورة المحدّدة ثلاثة فقط: Twilio وD7 وUnimatrix.

## 3 · تسجيل «VEZANO» والجهة الرقابية

- الجهة هي هيئة تنظيم الاتصالات والبريد (TPRA)، والتسجيل يمرّ عبر المشغّلين.
- حصص السوق التقريبية: زين نحو 50٪، وMTN نحو 30٪، وسوداني نحو 18–20٪ — [d7](https://d7networks.com/sms/sudan/).
- لم توجد وثيقة رسمية منشورة من الهيئة بقواعد الرسائل الجماعية **[غير متحقق]**.
- الوثائق المتوقعة: سجل تجاري وخطاب تفويض LOA — **[غير متحقق]**.

## 4 · الترميز العربي

- UCS-2: الرسالة الواحدة 70 حرفاً، والمقسّمة 67 حرفاً لكل جزء (مقابل 160 و153 في GSM-7) — [Twilio](https://www.twilio.com/docs/glossary/what-sms-character-limit)، و[Messangi](https://docs.messangi.com/docs/sms-encoding).
- **ملاحظة للحملات**: عدّاد أجزاء الحملات (NOT-03) ما زال على نموذج الإطار 160/153 (0005 §٥٧). الأرقام العربية الحقيقية أعلاه تُطبَّق مع التعاقد مع المزوّد، لأن المزوّد هو من يحسب الأجزاء فعلاً.

## 5 · الوضع الميداني

- فبراير 2024: انقطاع شبه كامل للشبكات — [Dabanga](https://www.dabangasudan.org/en/all-news/article/sudan-telecom-networks-blackout-widens-amid-accusations).
- مايو 2024: عودة تدريجية لشبكة زين — [Telecompaper](https://www.telecompaper.com/news/zain-sudan-gradually-restores-network-operations--1499571).
- 2025: قطع الشبكات أثناء امتحانات الجامعات — [Wikipedia](https://en.wikipedia.org/wiki/Internet_shutdowns_in_Sudan).
- أغسطس 2026: إعادة تأهيل 7 من 15 محطة كهرباء فرعية في الخرطوم الكبرى — [UNMAS](https://unmas.org/en/news/powering-recovery-restoring-electricity-to-greater-khartoum).
- حالة كل مشغّل في الخرطوم حتى سبتمبر 2026 **[غير متحقق]**.
- الرسالة النصية لا تحتاج باقة بيانات، فتصل حين يُقطع الإنترنت وحده، لا حين تُقطع الشبكة كلها. هذا يؤكد قرار «العمل بلا شبكة أولاً».

## ما يُتحقَّق منه مباشرة قبل التعاقد

- أسعار برق وeSMS Africa وInfobip للسودان.
- وثائق تسجيل «VEZANO».
- طريقة الدفع لحساب Meta من السودان.
- حالة الشبكات الثلاث في الخرطوم.
