"""يثبت أن خط الاختبار يعمل على PostgreSQL حقيقي لا SQLite."""

import pytest
from django.db import connection
from django.test import Client


@pytest.mark.django_db
def test_database_is_postgresql() -> None:
    assert connection.vendor == "postgresql"


@pytest.mark.django_db
def test_healthz_reports_database_ok() -> None:
    response = Client().get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "database": "postgresql"}


def test_openapi_schema_is_3_1() -> None:
    response = Client().get("/api/schema/")
    assert response.status_code == 200
    assert response.content.startswith(b"openapi: 3.1")
