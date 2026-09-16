# backend

Django 5 · DRF · PostgreSQL 16 — Modular Monolith (§٤.١).

```bash
uv sync                      # يثبّت Python 3.12 والاعتماديات من uv.lock
createdb sting_dev           # مرة واحدة محلياً (Homebrew PostgreSQL 16)
uv run ruff check . && uv run ruff format --check . && uv run mypy .
uv run pytest                # يحتاج DATABASE_URL أو الافتراضي postgresql:///sting_dev
```

الوحدات تُضاف تدريجياً بترتيب `docs/PLAN.md` (T0.5 فصاعداً).

## السيناريو التجريبي وإعادة الضبط (§١٥.٤)

```bash
STING_ENV=development STING_FAULTS_ENABLED=1 uv run python manage.py scenario reset
```

يمحو مستأجري السيناريو ويبني الحالة الابتدائية: رصيد العميل 0، مخزون الصنف 10، الصندوق 0، جهازان (A2، B3).
الأمر **مرفوض** إن كانت `STING_ENV=production` أو لم يحمل اسم القاعدة وسم تجريب أو وُجد مستأجر خارج السيناريو.
نقطتا `POST /api/scenario/reset` و`GET|POST /api/scenario/faults` (drop_ack، freeze_reconciliation، network_cut، printer_fail)
لا تُركَّبان إلا مع `STING_FAULTS_ENABLED=1` في بيئة غير إنتاجية.
