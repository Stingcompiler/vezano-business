# النشر على Render — فيزانو بلص (Vezano Plus)

القرار في 0005 §١١٨. التعريف كاملاً في `render.yaml` بجذر المستودع (Blueprint).

## ما يُنشأ

| القطعة | النوع | المنطقة | ماذا تفعل |
|---|---|---|---|
| `vezano-web` | خدمة ويب عامة (Node 24) | فرانكفورت | Next.js؛ يمرّر `/api/*` داخلياً إلى الخادم — أصل واحد بلا CORS |
| `vezano-api` | خدمة خاصة (Python 3.12) | فرانكفورت | Django + gunicorn؛ بلا عنوان عام؛ الهجرات وأعلام الإطلاق قبل كل نشر |
| `vezano-db` | PostgreSQL 16 | فرانكفورت | العزل بين المستأجرين بـRLS مفروض حتى على مالك الجداول |

فرانكفورت أقرب مناطق Render إلى السودان. الخطة `starter` للخدمتين: الخطة المجانية تنام بعد الخمول وتمنع `preDeployCommand`.

## أول نشر — خطوات المالك

1. من لوحة Render: **New → Blueprint**، ثم اختر المستودع `Stingcompiler/vezano-business`. سيقرأ `render.yaml`.
2. املأ الأسرار (`sync: false`). لا يتوقف أي منها الإطلاق؛ الغائب يعطّل قناته وحدها:
   | المتغيّر | من أين | بدونه |
   |---|---|---|
   | `STING_WHATSAPP_TOKEN`، `STING_WHATSAPP_PHONE_ID` | Meta → WhatsApp Business Platform؛ قالب مصادقة باسم `verify_code` بالعربية | الرمز لا يصل عبر واتساب |
   | `STING_SMS_URL`، `STING_SMS_TOKEN` | مجمِّع رسائل بمسارات مباشرة لزين وMTN وسوداني (Infobip أو eSMS Africa)، مع تسجيل اسم المرسِل `VEZANO` | لا احتياط نصي |
   | `STING_EMAIL_FROM`، `EMAIL_HOST`، `EMAIL_HOST_USER`، `EMAIL_HOST_PASSWORD` | Resend أو Amazon SES (SMTP)، مع سجلات SPF وDKIM للنطاق | الرمز لا يصل للبريد |
   | `STING_VAPID_PUBLIC_KEY`، `STING_VAPID_PRIVATE_KEY`، `STING_VAPID_SUBJECT` | يُولَّد مرة واحدة: `cd backend && uv run vapid --gen`؛ و`SUBJECT` = `mailto:plus@vezano.app` | لا إشعارات ويب |
   - بلا أي قناة يبقى التحقق اليدوي عبر الدعم، وهو المسار البديل المرسوم.
   - `DJANGO_SECRET_KEY` يولّده Render تلقائياً.
3. **النطاق**: من `vezano-web` ← Settings ← Custom Domains. أضف النطاق وسجل DNS الذي يطلبه Render، وشهادة HTTPS تلقائية.
4. **أول مشغّل**: من Shell الخاص بـ`vezano-api`:
   ```bash
   FIRST_ADMIN_PASSWORD='…12 حرفاً على الأقل…' uv run python manage.py create_first_admin --email you@yourdomain --name "اسمك"
   ```
   - الأوامر `seed_platform_demo` و`seed_*` التجريبية **لا تُشغَّل في الإنتاج**.
   - نقاط السيناريو والأعطال مقفلة أصلاً حين `STING_ENV=production`.
5. **تحقق**:
   - `/` يفتح الواجهة.
   - `/status` يعرض حالة الخدمات.
   - الدخول إلى `/platform/login` ينجح.
   - في «الأعلام» (PLT-12): `market_m3` مرفوع و`market_m4` منخفض لبيئة `production`.

## ما يحدث في كل نشر
- `vezano-api`:
  1. `uv sync --frozen --no-dev`
  2. `migrate`
  3. `apply_launch_flags`: ينشئ الأعلام الغائبة فقط، ولا يغيّر ما ضبطه المشغّل.
  4. gunicorn: عاملان × 4 خيوط.
- `vezano-web`: `pnpm install --frozen-lockfile` ثم `next build` ثم `next start` على `$PORT`.

## النسخ الاحتياطي
- Render يأخذ نسخاً يومية لقاعدة `basic` وما فوقها.
- التصدير الكامل لكل منشأة متاح لها من داخل النظام دائماً (§٩٤).
- التزام الشروط: دوران النسخ 35 يوماً، والحفظ في فرانكفورت.
