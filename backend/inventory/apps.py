from django.apps import AppConfig


class InventoryConfig(AppConfig):
    name = "inventory"
    verbose_name = "المخزون"

    def ready(self) -> None:
        from inventory import providers  # noqa: F401
