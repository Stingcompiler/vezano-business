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

## عقد الردود (0005 §١٦١)

كل ردّ JSON ناجح من `/api/*` له مخطط في OpenAPI: إمّا من مسلسِل DRF، وإمّا **مرصوداً** من مجموعة الاختبارات في `core/api_contract.json` (مع تصحيحات القيم المحدودة في `core/api_contract_overrides.json`). في pytest يتحقّق وسيط من كل ردّ 2xx مقابل مخططه افتراضياً، فحقل جديد أو نوع مختلف يُسقط الاختبار.

حين تغيّر شكل ردّ عن قصد، أو تضيف نقطة جديدة:

```bash
cd backend
rm -rf /tmp/sting-api-samples
STING_API_CONTRACT=capture STING_API_CONTRACT_SAMPLES=/tmp/sting-api-samples STING_ENV=test STING_FAULTS_ENABLED=1 uv run pytest -p no:warnings
uv run python manage.py api_contract infer --samples /tmp/sting-api-samples
cd .. && pnpm --filter @sting/contracts generate && pnpm exec prettier --write packages/contracts/openapi.json
```

- قيمة محدودة (enum) أو مصفوفة لم تُرصد إلا فارغة ← أضف تصحيحاً في `core/api_contract_overrides.json` (مصدره النوع المعرّف في شاشة الويب).
- نقطة بلا جسم JSON أو لم تغطّها الاختبارات ← `UNTYPED_ALLOWED` في `core/tests/test_api_contract.py` بسبب مكتوب.
- `STING_API_CONTRACT=off` يعطّل الإنفاذ مؤقتاً للتشخيص فقط.
