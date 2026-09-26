# ملفات الخطوط (رخصة SIL OFL 1.1)

تُوضع هنا الملفات التي يشير إليها `src/fonts.css`. لا تُحمَّل من CDN وقت التشغيل.

| الملف | المصدر الرسمي | الأوزان |
|---|---|---|
| `Tajawal-{Regular,Medium,Bold,ExtraBold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/tajawal/` | 400 / 500 / 700 / 800 — **الواجهة والعناوين** (هوية فيزانو 2026-09-22) |
| `Inter[opsz,wght].ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/inter/` | متغيّر — **الأرقام والمعرفات واللاتينية** (tabular-nums) |
| `Cairo[slnt,wght].ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/cairo/` | متغيّر؛ يُستعمل 600 و700 |
| `IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/ibmplexsansarabic/` | 400 / 500 / 600 / 700 |
| `IBMPlexMono-{Regular,Medium,SemiBold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/ibmplexmono/` | 400 / 500 / 600 |
| `ReemKufi[wght].ttf` (المصدر) + `ReemKufi-Wordmark.woff2` (مقتطع) | github.com/google/fonts — `ofl/reemkufi/` | متغيّر 400–700 — **اسم الشعار «فيزانو بلص» وحده** (0005 §١٣٢) |

ملف `OFL.txt` لكل عائلة يُنسخ بجانبها. تحويل TTF إلى WOFF2 اختياري (أصغر حجماً)؛ CSS يذكر الصيغتين.

**الحالة:** نُزِّلت بإذن المالك 2026-09-20 من `github.com/google/fonts` (`ofl/cairo`، `ofl/ibmplexsansarabic`، `ofl/ibmplexmono`) مع `OFL-*.txt` لكل عائلة؛ TTF فقط (WOFF2 اختياري لاحقاً). اختبار `fonts.test.ts` يثبت وجود الملفات الثمانية.

**Reem Kufi** (نُزِّل بإذن المالك 2026-09-26 مع `OFL-ReemKufi.txt`): الواجهة تحمّل `ReemKufi-Wordmark.woff2` وحده (~5 ك.ب)، مقتطعاً لحروف «فيزانو بلص Vezano Plus». لإعادة الاقتطاع إن تغيّر الاسم:

```bash
cd packages/design/fonts
uvx --from "fonttools[woff]" pyftsubset "ReemKufi[wght].ttf" --text="فيزانو بلص Vezano Plus" --layout-features='*' --flavor=woff2 --output-file=ReemKufi-Wordmark.woff2
```
