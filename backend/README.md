# backend

Django 5 · DRF · PostgreSQL 16 — Modular Monolith (§٤.١).

```bash
uv sync                      # يثبّت Python 3.12 والاعتماديات من uv.lock
createdb sting_dev           # مرة واحدة محلياً (Homebrew PostgreSQL 16)
uv run ruff check . && uv run ruff format --check . && uv run mypy .
uv run pytest                # يحتاج DATABASE_URL أو الافتراضي postgresql:///sting_dev
```

الوحدات تُضاف تدريجياً بترتيب `docs/PLAN.md` (T0.5 فصاعداً).
