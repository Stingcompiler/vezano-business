# ملفات الخطوط (رخصة SIL OFL 1.1)

تُوضع هنا الملفات التي يشير إليها `src/fonts.css`. لا تُحمَّل من CDN وقت التشغيل.

| الملف | المصدر الرسمي | الأوزان |
|---|---|---|
| `Cairo[slnt,wght].ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/cairo/` | متغيّر؛ يُستعمل 600 و700 |
| `IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/ibmplexsansarabic/` | 400 / 500 / 600 / 700 |
| `IBMPlexMono-{Regular,Medium,SemiBold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/ibmplexmono/` | 400 / 500 / 600 |

ملف `OFL.txt` لكل عائلة يُنسخ بجانبها. تحويل TTF إلى WOFF2 اختياري (أصغر حجماً)؛ CSS يذكر الصيغتين.

**الحالة:** بانتظار إذن التنزيل من صاحب المشروع (تنزيل الملفات يحتاج إذناً صريحاً). اختبار `fonts.test.ts` موسوم `todo` حتى توضع الملفات.
