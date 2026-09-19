"""REP-02 — تقرير الذمم بلا تقادم مخترَع (G-15؛ ACC-79): الرصيد، وتاريخ آخر سداد، وتاريخ أقدم حركة
لم يغطها سداد لاحق — لا جدول أعمار (30/60/90) لأن السداد يُخفض الرصيد الإجمالي دون ربطه بفاتورة.
الأرقام من الحركات المؤكَّدة خادمياً؛ «قد لا تشمل سداداً وقع في فرع لم يُزامن»."""

from __future__ import annotations

from datetime import date
from typing import Any

from django.utils import timezone

from core import home
from parties.models import Party
from parties.services import (
    balance_minor,
    statement_lines,
    supplier_owed_minor,
)


def _iso_date(d: date | None) -> str:
    return d.isoformat() if d else ""


def _customer_row(party: Party) -> dict[str, Any] | None:
    balance = balance_minor(party)
    if balance <= 0:
        return None
    lines = [ln for ln in statement_lines(party) if not ln.info]
    payments = [ln for ln in lines if ln.kind in {"payment", "refund"} and ln.credit_minor > 0]
    last_payment = max((ln.business_date or ln.occurred_at.date() for ln in payments), default=None)
    debits = [ln for ln in lines if ln.debit_minor > 0]
    # أقدم حركة لم يغطها سداد لاحق: أقدم مدين بعد آخر سداد (أو أقدم مدين إن لم يقع سداد)
    uncovered = [
        ln
        for ln in debits
        if last_payment is None or (ln.business_date or ln.occurred_at.date()) > last_payment
    ]
    oldest = min(
        (ln.business_date or ln.occurred_at.date() for ln in uncovered),
        default=None,
    )
    invoices = [ln for ln in debits if ln.kind == "sale"]
    openings = [ln for ln in debits if ln.kind == "opening"]
    if invoices and openings:
        source = f"رصيد افتتاحي + {len(invoices)} فواتير آجلة"
    elif len(invoices) == 1:
        source = "فاتورة واحدة"
    elif invoices:
        source = "فواتير آجلة"
    elif openings:
        source = "رصيد افتتاحي — بلا فواتير"
    else:
        source = ""
    return {
        "id": str(party.id),
        "name": party.name,
        "balance_minor": str(balance),
        "last_payment_date": _iso_date(last_payment),
        "oldest_unpaid_date": _iso_date(oldest),
        "invoices": len(invoices),
        "source": source,
    }


def _supplier_row(party: Party) -> dict[str, Any] | None:
    owed = supplier_owed_minor(party)
    if owed <= 0:
        return None
    return {
        "id": str(party.id),
        "name": party.name,
        "balance_minor": str(owed),
        "last_payment_date": "",
        "oldest_unpaid_date": "",
        "invoices": 0,
        "source": "رصيد افتتاحي — بلا فواتير",
    }


def receivables_report(*, viewer: home.Viewer, side: str = "customers") -> dict[str, Any]:
    side = "suppliers" if side == "suppliers" else "customers"
    rows: list[dict[str, Any]] = []
    qs = Party.objects.filter(merged_into__isnull=True).order_by("name_normalized")
    qs = qs.filter(is_supplier=True) if side == "suppliers" else qs.filter(is_customer=True)
    for party in qs:
        row = _supplier_row(party) if side == "suppliers" else _customer_row(party)
        if row:
            rows.append(row)
    rows.sort(key=lambda r: -int(r["balance_minor"]))
    total = sum(int(r["balance_minor"]) for r in rows)
    return {
        "side": side,
        "scope": "all",
        "rows": rows,
        "totals": {"balance_minor": str(total), "parties": len(rows)},
        "computed_at": timezone.now().isoformat().replace("+00:00", "Z"),
        # G-15: لا جدول أعمار — غير مفعّل بسببه المعلَن
        "ageing": "disabled",
    }


def export_csv(payload: dict[str, Any]) -> str:
    head = (
        f"# تقرير الذمم · {'لنا على الموردين' if payload['side'] == 'suppliers' else 'على العملاء'}"
        f" · حُسب في {payload['computed_at']} · بلا جدول أعمار (G-15)"
    )
    lines = [head, "name,balance_minor,last_payment_date,oldest_unpaid_date,source"]
    for r in payload["rows"]:
        lines.append(
            ",".join(
                [
                    str(r["name"]).replace(",", " "),
                    str(r["balance_minor"]),
                    r["last_payment_date"],
                    r["oldest_unpaid_date"],
                    str(r["source"]).replace(",", " "),
                ]
            )
        )
    return "\n".join(lines) + "\n"
