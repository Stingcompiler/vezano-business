from django.apps import AppConfig


class CatalogConfig(AppConfig):
    name = "catalog"
    verbose_name = "الكتالوج"

    def ready(self) -> None:
        # تسجيل محلّلات المراجع (PULL/bootstrap) ومزوّدي الرئيسية والبحث
        from catalog import providers  # noqa: F401
