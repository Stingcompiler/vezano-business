# النشر على خادم خاص (OVHcloud VPS) — فيزانو بلص

- القرار في 0005 §١٤٠. المالك يملك خادماً خاصاً على OVHcloud، فجُهِّز بديل لـRender (`docs/deploy-render.md` باقٍ كما هو).
- التعريف كاملاً في `deploy/ovh/` بخمس حاويات Docker Compose.

## ما يُنشأ

| الحاوية | ماذا تفعل |
|---|---|
| `caddy` | المنفذان 80 و443، وشهادة HTTPS تلقائية من Let's Encrypt لنطاقك |
| `web` | Next.js؛ يمرّر `/api/*` داخلياً إلى `api` (أصل واحد، بلا CORS) |
| `api` | Django + gunicorn، بلا منفذ خارجي. الهجرات و`apply_launch_flags` عند كل تشغيل |
| `worker` | النسخة الليلية 01:00 UTC (تُحفظ 14 يوماً، وتظهر في «النسخ» عند المشغّل)، و`grow_compute` 04:00 UTC (06:00 بالخرطوم) |
| `db` | PostgreSQL 16 |

**عزل المستأجرين**:
- التطبيق يتصل بدور `vezano`، وهو ليس مشرفاً ولا يتجاوز RLS (`init-db.sh`).
- المشرف `postgres` للنسخ الليلي وحده، إذ يرفض `pg_dump` الجداول المحمية بغيره.

## ⚠️ قبل أن تعتمده للمتاجر الحقيقية

- مراكز OVHcloud في أوروبا وأمريكا الشمالية وآسيا وأستراليا، لا في السودان.
- **الخادم الخاص لا يحلّ مسألة «لائحة الحوسبة السحابية لسنة 2025»** (0005 §١٣٩، `docs/research/sudan-legal.md` الأسئلة 1–3): البيانات تبقى خارج السودان.
- مزاياه على Render:
  - عنوان IP ثابت، يُضاف إلى القوائم المسموحة لمزوّدي البريد والرسائل.
  - كلفة ثابتة.
  - تحكّم كامل في النسخ.
- للعرض والتجربة التجريبية لا مانع.

## المتطلبات

- Ubuntu 24.04 أو Debian 12.
- **2 vCPU و4 GB ذاكرة على الأقل**: بناء Next يحتاج نحو 2–3 GB. بأقل من ذلك أضف ملف swap 4 GB.
- نطاق (أو نطاق فرعي) تملك تعديل سجلات DNS له.

## أول نشر — خطوات المالك على الخادم

1. **الدخول والجدار الناري** (بمفتاح SSH، لا كلمة مرور):
   ```bash
   sudo apt update && sudo apt -y upgrade
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
   ```
2. **Docker**:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # ثم اخرج وادخل
   ```
3. **DNS**:
   - أضف سجل `A` لنطاقك يشير إلى عنوان الخادم.
   - تأكد قبل الخطوة 6 أن النطاق يحلّ إلى الخادم، وإلا تعذّرت الشهادة.
4. **المستودع**: خاص، فاستعمل مفتاح نشر للقراءة فقط من GitHub (Settings ← Deploy keys).
   ```bash
   git clone git@github.com:Stingcompiler/vezano-business.git && cd vezano-business/deploy/ovh
   cp .env.example .env && chmod 600 .env
   ```
5. **الأسرار** في `.env` (لا تُلتزم ولا تُرسل):
   - `DOMAIN` و`ACME_EMAIL`.
   - `POSTGRES_PASSWORD` و`APP_DB_PASSWORD`، من `openssl rand -base64 32` لكلٍّ منهما.
   - `DJANGO_SECRET_KEY`، من `openssl rand -base64 48`.
   - قنوات التحقق حين تتوفر. الغائب يعطّل قناته وحدها، ويبقى التحقق اليدوي.
6. **التشغيل** — على خادم فارغ بوكيل Caddy داخل Compose:
   ```bash
   docker compose --profile caddy up -d --build
   docker compose logs -f api   # انتظر «Listening at: http://0.0.0.0:8000»
   ```
   على خادم فيه وكيل عكسي أصلاً (كخادم المالك الذي يخدم `vezano.app`): شغّل بلا الملف الشخصي `caddy`، فتُنشر الواجهة على `127.0.0.1:3100` وحدها، وأضف إلى Caddy النظام كتلة مستقلة:
   ```
   plus.vezano.app {
   	encode zstd gzip
   	reverse_proxy 127.0.0.1:3100
   }
   ```
   ثم `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy` (إعادة تحميل بلا انقطاع للمواقع الأخرى).
7. **مفاتيح الإشعارات** (مرة واحدة): يطبع الأمر ثلاثة أسطر، الصقها في `.env` ثم `docker compose up -d`.
   ```bash
   docker compose run --rm api uv run --no-sync python manage.py gen_vapid_keys
   ```
8. **أول مشغّل**:
   ```bash
   docker compose exec -e FIRST_ADMIN_PASSWORD='…12 حرفاً على الأقل…' api \
     uv run --no-sync python manage.py create_first_admin --email you@yourdomain --name "اسمك"
   ```
   - الأوامر `seed_*` و`showcase` **لا تُشغَّل في الإنتاج**.
   - للعرض على خادم منفصل، شغّلها على قاعدة غير الإنتاج فقط.
9. **تحقق**:
   - `https://نطاقك/` يفتح الواجهة.
   - `/status` أخضر.
   - `/platform/login` يدخل، ثم يطلب تغيير كلمة المرور إن كانت مؤقتة (§١٣٨).
   - «الأعلام»: `market_m3` مرفوع و`market_m4` منخفض.

## التحديث

```bash
cd vezano-business && git pull && cd deploy/ovh && docker compose up -d --build
```

`api` يطبّق الهجرات وأعلام الإطلاق الغائبة عند إقلاعه.

## النسخ والاستعادة

- **النسخ الليلي**:
  - في الحجم `backups` داخل `worker`.
  - يُرفع كل ليلة مشفّراً خارج الخادم حين يُضبط التخزين (القسم التالي). قبل ذلك تقول شاشة «النسخ»: «النسخ على هذا الخادم وحده».
- **تجربة استعادة** على قاعدة مؤقتة (ACC-75 — وجود النسخة ليس صلاحيتها):
  ```bash
  docker compose exec db createdb -U postgres restore_test
  docker compose cp worker:/backups/<الملف>.dump /tmp/x.dump && docker compose cp /tmp/x.dump db:/tmp/x.dump
  docker compose exec db pg_restore -U postgres -d restore_test --no-owner /tmp/x.dump
  ```

## النسخ خارج الخادم (0005 §١٥١)

بعد كل نسخة ليلية صالحة:
1. تُشفَّر على الخادم بعبارة سرّ لا يعرفها مزوّد التخزين.
2. تُرفع إلى تخزين كائنات متوافق مع S3، ويُتحقَّق من حجمها هناك.
3. يُحتفظ في التخزين بآخر 30 ليلية و12 أسبوعية.

الحالة تظهر في عمود «خارج الخادم» بشاشة «النسخ». وإن لم تُرفع آخر نسخة خلال ساعتين، يرسل الفحص الذاتي بريداً.

**الضبط — مرة واحدة:**

1. **أنشئ الحاوية** من لوحة OVHcloud: Public Cloud ← Object Storage ← حاوية جديدة.
   - اختر واجهة S3 وفئة Standard، والوصول خاص.
   - اختر منطقة **غير** منطقة الخادم، فلا يضيعان معاً.
   - يصلح أي مزوّد متوافق مع S3 أيضاً (Backblaze B2، Cloudflare R2، Wasabi).
2. **أنشئ مستخدم S3** للحاوية، وانسخ:
   - مفتاح الوصول (Access key) والمفتاح السرّي (Secret key)؛
   - الـEndpoint الظاهر في اللوحة، بصيغة `https://s3.<المنطقة>.io.cloud.ovh.net`.
3. **ولّد عبارة سرّ التشفير** في مدير كلماتك: 20 حرفاً فأكثر، بلا علامة `'`. **احفظها هناك.** بدونها لا تُفكّ أي نسخة، ولا يمكن استرجاعها.
4. **اكتب القيم على الخادم** بالسكربت. يسأل عن كل قيمة، ويخفي السرّية منها، ويحفظ نسخة من `.env` قبل التعديل:
   ```bash
   cd /srv/apps/vezano-plus/deploy/ovh && sudo bash set-offsite.sh
   sudo docker compose up -d worker
   sudo docker compose exec worker /app/deploy/backup.sh   # نسخة ورفع الآن للتجربة
   ```
   آخر سطر يجب أن يكون `offsite: ok vezano-plus/…`. وشاشة «النسخ» تعرض «خارج الخادم».

**الاستعادة من التخزين الخارجي** (والخادم الأصلي ضائع):

1. انشر خادماً جديداً بالخطوات أعلاه، بنفس قيم `STING_OFFSITE_*` و`STING_BACKUP_PASSPHRASE`.
2. اسرد النسخ، ثم نزّل واحدة وفكّها:
   ```bash
   sudo docker compose exec worker uv run --no-sync python manage.py offsite_restore --list
   sudo docker compose exec worker uv run --no-sync python manage.py offsite_restore \
     --key vezano-plus/nightly/vezano-<الطابع>.dump.vzb --out /backups/restore.dump
   ```
3. استعدها بـ`pg_restore` كما في «تجربة استعادة» أعلاه، على قاعدة مؤقتة أولاً.

## السجلات والأعطال

- `docker compose ps` حالة الحاويات.
- `docker compose logs -f --tail=200 api worker web caddy` السجلات.
- **البريد عبر Brevo**: أضف عنوان الخادم الثابت في Security ← Authorised IPs، ثم اختبر:
  ```bash
  docker compose exec api uv run --no-sync python manage.py send_test_email --to plus@vezano.app
  ```
- **حدّ طلبات «اطلب الجولة»** (20 في الساعة لكل زائر) يقرأ الزائر الحقيقي خلف Caddy وNext (`STING_PROXY_HOPS=2`)، لا عنوان الحاوية.

## المراقبة والتنبيه (0005 §١٤٨)

- **خارجية**: `.github/workflows/uptime.yml` يفحص من خارج الخادم كل 5 دقائق: الواجهة البرمجية والصفحة الرئيسية وحالة الخدمة، بثلاث محاولات.
  - الفشل يُرسل عنه GitHub بريداً لصاحب المستودع (Settings ← Notifications ← Actions ← «Send notifications for failed workflows only»).
  - يكشف توقّف الخادم كاملاً.
- **داخلية**: `worker` يشغّل `manage.py ops_selfcheck` كل ساعة:
  - آخر نسخة ليلية صالحة خلال 26 ساعة.
  - رفعها خارج الخادم خلال ساعتين، حين يُضبط التخزين (§١٥١).
  - القرص أقل من 85٪.
  - عند مشكلة: بريد واحد في اليوم لكل نوع إلى `STING_ALERT_EMAIL` في `.env`.

