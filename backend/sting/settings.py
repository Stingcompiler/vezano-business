"""إعدادات Sting — الخلفية Django/DRF.

المبدأ: الإعدادات الحساسة من البيئة؛ لا أسرار في المستودع (§١٣.٥).
قاعدة البيانات PostgreSQL 16 حصراً — اختبارات العزل والذرّية لا تصح على SQLite (§٥.٤، §٨.٣).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-not-a-secret-change-me-32b")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = [
    h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h
]

# الإنتاج (Render — 0005 §١١٨): لا تشغيل بمفتاح التطوير، والطلب يصل عبر وكيل HTTPS
if not DEBUG:
    if SECRET_KEY.startswith("dev-only"):
        msg = "DJANGO_SECRET_KEY مطلوب في الإنتاج — مفتاح التطوير لا يُقبل"
        raise RuntimeError(msg)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "drf_spectacular",
    "rest_framework_simplejwt.token_blacklist",
    "core",
    "sync",
    "catalog",
    "shifts",
    "parties",
    "sales",
    "inventory",
    "market",
    "stingops",
    # وحدات Sting تُضاف تدريجياً: core, sync, parties, catalog, inventory, sales,
    # purchasing, notifications, marketplace (§٤.١) — لا حزم فارغة قبل الحاجة (§٤.٤).
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # PLT-09: قياس p95 حيّ لطلبات /api — عدّاد لا محتوى
    "stingops.metrics.LatencyMiddleware",
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
        # اتصالات دائمة في الإنتاج تخفّف كلفة فتح اتصال لكل طلب (0 افتراضاً — الاختبارات)
        "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "0")),
        "OPTIONS": {"options": "-c timezone=UTC"},
    }


DATABASES = {
    "default": _database_from_url(os.environ.get("DATABASE_URL", "postgresql:///sting_dev")),
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "core.User"
# اسم المستخدم فريد داخل المستأجر لا عالمياً (§٣.١)؛ الدخول يمرّ بمستأجر + اسم أو بهوية JWT (T0.6)،
# فيُسكَت فحص Django الذي يشترط تفرّداً عالمياً لـ USERNAME_FIELD.
SILENCED_SYSTEM_CHECKS = ["auth.E003"]

LANGUAGE_CODE = "ar"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": ["core.auth.tokens.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
}

from datetime import timedelta  # noqa: E402

# عقد JWT (§٩.٤): وصول قصير، تجديد مدوّر مع قائمة سوداء، إلغاء بالجلسة.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# متحقق PIN: يُقاس على العتاد قبل الاعتماد (§١٩.٢)؛ الطول ٤–٦ حسب إعداد المؤسسة (§٩.١)
PIN_DEFAULT_LENGTH = 6

# البريد (قناة رمز التحقق للبريد — 0005 §١١٧): SMTP لأي مزوّد (Resend، Amazon SES…) من البيئة
EMAIL_HOST = os.environ.get("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "1") == "1"
EMAIL_TIMEOUT = 10

SPECTACULAR_SETTINGS = {
    "TITLE": "Sting Systems API",
    "VERSION": "0.0.0",
    "OAS_VERSION": "3.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}
