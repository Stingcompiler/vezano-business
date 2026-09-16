"""فحص صحة يثبت الوصول الفعلي لقاعدة البيانات — «هناك شبكة» ≠ «نجح الوصول» (§١٣.٦)."""

from django.db import connection
from django.http import HttpRequest, JsonResponse


def healthz(_request: HttpRequest) -> JsonResponse:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        row = cursor.fetchone()
    ok = row == (1,)
    return JsonResponse({"ok": ok, "database": "postgresql"}, status=200 if ok else 503)
