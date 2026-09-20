"""PLT-09: زمن الاستجابة p95 من قياس حيّ (آخر 5 دقائق في ذاكرة العملية) — لا كاش ولا وعد."""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable
from typing import Any

from django.http import HttpRequest, HttpResponse

WINDOW_SECONDS = 300
_samples: deque[tuple[float, float]] = deque(maxlen=5000)


def record(ms: float, now: float | None = None) -> None:
    _samples.append((now or time.monotonic(), ms))


def p95(now: float | None = None) -> tuple[float, int]:
    """(p95 بالمللي ثانية، عدد العيّنات) خلال النافذة — (0, 0) بلا عيّنات."""
    t = now or time.monotonic()
    xs = sorted(ms for ts, ms in _samples if t - ts <= WINDOW_SECONDS)
    if not xs:
        return 0.0, 0
    idx = min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))
    return round(xs[idx], 1), len(xs)


class LatencyMiddleware:
    """يسجّل مدة كل طلب /api — عدّاد لا محتوى."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> Any:
        start = time.monotonic()
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            record((time.monotonic() - start) * 1000, time.monotonic())
        return response
