from django.apps import AppConfig


class PartiesConfig(AppConfig):
    name = "parties"
    verbose_name = "الأطراف"

    def ready(self) -> None:
        # محلّلات المراجع (PULL/bootstrap) ومُطبِّق حدث الإنشاء السريع من PUSH
        from parties import providers  # noqa: F401
