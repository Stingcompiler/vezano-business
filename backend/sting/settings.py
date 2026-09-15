"""إعدادات Sting — الخلفية Django/DRF.

المبدأ: الإعدادات الحساسة من البيئة؛ لا أسرار في المستودع (§١٣.٥).
قاعدة البيانات PostgreSQL 16 حصراً — اختبارات العزل والذرّية لا تصح على SQLite (§٥.٤، §٨.٣).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-not-a-secret-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = [
    h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h
]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "drf_spectacular",
    # وحدات Sting تُضاف تدريجياً: core, sync, parties, catalog, inventory, sales,
    # purchasing, notifications, marketplace (§٤.١) — لا حزم فارغة قبل الحاجة (§٤.٤).
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "sting.urls"
WSGI_APPLICATION = "sting.wsgi.application"


def _database_from_url(url: str) -> dict[str, object]:
    u = urlparse(url)
    if u.scheme not in {"postgres", "postgresql"}:
        msg = "DATABASE_URL يجب أن يكون PostgreSQL — لا يُعتمد محرك آخر (§١٢.١)"
        raise RuntimeError(msg)
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": u.path.lstrip("/") or "sting_dev",
        "USER": u.username or "",
        "PASSWORD": u.password or "",
        "HOST": u.hostname or "",
        "PORT": str(u.port or ""),
        "CONN_MAX_AGE": 0,
        "OPTIONS": {"options": "-c timezone=UTC"},
    }


DATABASES = {
    "default": _database_from_url(os.environ.get("DATABASE_URL", "postgresql:///sting_dev")),
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "ar"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Sting Systems API",
    "VERSION": "0.0.0",
    "OAS_VERSION": "3.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}
