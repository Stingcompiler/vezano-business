from django.apps import AppConfig


class ShiftsConfig(AppConfig):
    name = "shifts"
    verbose_name = "الورديات"

    def ready(self) -> None:
        # تسجيل مُطبِّقات الإسقاط (sync.appliers) ومزوّد الرئيسية
        from shifts import providers  # noqa: F401
