from django.apps import AppConfig


class SalesConfig(AppConfig):
    name = "sales"
    verbose_name = "البيع"

    def ready(self) -> None:
        from sales import providers  # noqa: F401
