"use client";

import { type LocalSale, readSale } from "@sting/sync-core";
import { Button, formatMinor, formatQty, Frame, Notice, Table, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

import { DayLabel, localDateSuspect, type RowSync, SyncCell } from "./invoices-client";
import { PosNav } from "./pos-nav";

type State = "ready" | "loading" | "offline" | "pending_sync" | "stale";

interface Line {
  readonly id: string;
  readonly item_name: string;
  readonly unit_code: string;
  readonly qty_milli: string;
  readonly decimal_places?: number;
  readonly unit_price_minor: string;
  readonly line_total_minor: string;
  readonly manual_price: boolean;
}

interface Detail {
  readonly id: string;
  readonly invoice_number: string;
  readonly user_name: string;
  readonly device_name: string;
  readonly party_name: string;
  readonly subtotal_minor: string;
  readonly discount_minor: string;
  readonly total_minor: string;
  readonly cash_minor: string;
  readonly bank_minor: string;
  readonly credit_minor: string;
  readonly business_date: string;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly date_suspect: boolean;
  readonly sync: RowSync;
  readonly lines: readonly Line[];
  readonly reversal: {
    readonly reason: string;
    readonly decided_by_name: string;
    readonly occurred_at: string;
    readonly kept_sale_id: string;
  } | null;
  readonly source: "local" | "server";
}

function fromLocal(s: LocalSale, sync: RowSync): Detail {
  return {
    id: s.id,
    invoice_number: s.invoice_number,
    user_name: s.user_name,
    device_name: "",
    party_name: s.party_name,
    subtotal_minor: s.subtotal_minor,
    discount_minor: s.discount_minor,
    total_minor: s.total_minor,
    cash_minor: s.cash_minor,
    bank_minor: s.bank_minor,
    credit_minor: s.credit_minor,
    business_date: s.business_date,
    occurred_at: s.occurred_at,
    received_at: "",
    date_suspect: localDateSuspect(s),
    sync,
    lines: s.lines,
    reversal: null,
    source: "local",
  };
}

/**
 * POS-09 (تفاصيل) — الفاتورة بسطورها ودفعاتها ووضع مزامنتها وجودة تاريخها (§٧.٦: تظهر جودة
 * التاريخ ومصدره في الحالات الملتبسة). المحلي يُقرأ فوراً؛ فاتورة جهاز آخر تحتاج اتصالاً بسبب
 * معلن (§١٤.١). إعادة الطباعة نسخة عبر POS-08؛ «أبلغ عن اشتباه» للكاشير (POS-12).
 */
export function InvoiceDetailClient({ saleId }: { saleId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [reported, setReported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;
  const now = new Date();

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/pos/invoices/${saleId}`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const local = await readSale(storage, saleId);
      if (local) {
        const op = await storage.read((tx) => tx.getOperation(local.operation_id));
        const st = op?.state ?? "local";
        setDetail(
          fromLocal(local, st === "synced" ? "synced" : st === "pending" ? "pending" : "local"),
        );
        return;
      }
      if (!navigator.onLine) {
        setDetail(null);
        return;
      }
      try {
        const { data, response } = await api().GET("/api/sales/{sale_id}", {
          params: { path: { sale_id: saleId } },
        });
        const body = data as unknown as
          (Omit<Detail, "sync" | "source"> & { sync_state: "synced" | "reversed" }) | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          setDetail(null);
          return;
        }
        setDetail({ ...body, sync: body.sync_state, source: "server" });
      } catch {
        setFailed(true);
        setDetail(null);
      }
    })();
  }, [router, saleId]);

  const state: State =
    detail === undefined
      ? "loading"
      : detail === null
        ? !online
          ? "offline"
          : "stale"
        : detail.sync === "local" || detail.sync === "pending"
          ? "pending_sync"
          : "ready";

  const report = async () => {
    if (!detail || busy || !online) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/sales/{sale_id}/duplicate-report", {
        params: { path: { sale_id: detail.id } },
        body: { note: note.trim() },
      });
      const body = data as unknown as { reported_by_name: string } | undefined;
      if (response.ok && body) setReported(body.reported_by_name);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "item",
      header: "الصنف",
      render: (l: Line) => (
        <>
          {l.item_name} —{" "}
          <span className="sting-mono">
            {formatQty(l.qty_milli, (l.decimal_places ?? 3) as 0 | 1 | 2 | 3)
              .replace(/(\.\d*?)0+$/, "$1")
              .replace(/\.$/, "")}
          </span>{" "}
          {l.unit_code}
        </>
      ),
    },
    {
      key: "price",
      header: "السعر",
      mono: true,
      render: (l: Line) => formatMinor(l.unit_price_minor),
    },
    {
      key: "total",
      header: "الإجمالي",
      mono: true,
      render: (l: Line) => formatMinor(l.line_total_minor),
    },
  ];

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="invoices" canSeeReports={false} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {detail ? (
                <>
                  فاتورة <span className="sting-mono">{detail.invoice_number}</span>
                </>
              ) : (
                "قائمة الفواتير وتفاصيلها"
              )}
            </h2>
            {detail ? <SyncCell sync={detail.sync} /> : null}
          </div>
          <div className="acc-card__body">
            {state === "offline" ? (
              <Notice kind="offline" title="فواتير الجهاز وما زامنه">
                <p className="acc-lead">
                  القائمة كاملة لما يعرفه الجهاز، وفواتير الفروع الأخرى غائبة معلَنة.
                </p>
                <p className="acc-lead">هذه الفاتورة ليست على هذا الجهاز — تحتاج اتصالاً لعرضها.</p>
              </Notice>
            ) : null}
            {state === "stale" && failed ? (
              <Notice kind="warning" title="فرع آخر يبيع الآن">
                <p className="acc-lead">المجاميع من آخر مطابقة. تعذّر جلب الفاتورة من الخادم.</p>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="المحلي فوراً">
                <p className="acc-lead">
                  فواتير الجهاز تظهر بلا انتظار، وفواتير الأجهزة الأخرى تلحق موسومة.
                </p>
              </Notice>
            ) : null}

            {detail ? (
              <>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">الرقم والوقت</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{hhmm(detail.occurred_at)}</span>{" "}
                      <DayLabel iso={detail.occurred_at} now={now} />
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">العميل</span>
                    <span className="shift-facts__v">{detail.party_name || "نقدي"}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الإجمالي</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(detail.total_minor)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">نقداً</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(detail.cash_minor)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">آجل</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(detail.credit_minor)}
                    </span>
                  </div>
                  {detail.device_name || detail.user_name ? (
                    <div>
                      <span className="shift-facts__k">المنفّذ</span>
                      <span className="shift-facts__v">
                        {[detail.device_name, detail.user_name].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  ) : null}
                </div>

                {detail.date_suspect ? (
                  <Notice kind="warning" title="تاريخ مشكوك فيه">
                    <p className="acc-lead">
                      الصف ذو التاريخ المشكوك فيه معلَّم — ساعة الجهاز كانت خاطئة، والأصل لم يُعدَّل
                    </p>
                    <p className="acc-choice__note">
                      وقت الجهاز <span className="sting-mono">{hhmm(detail.occurred_at)}</span> ·
                      يوم الأعمال <span className="sting-mono">{detail.business_date}</span>
                      {detail.received_at ? (
                        <>
                          {" "}
                          · وصلت الخادم{" "}
                          <span className="sting-mono">{hhmm(detail.received_at)}</span>
                        </>
                      ) : null}
                    </p>
                  </Notice>
                ) : null}

                {detail.reversal ? (
                  <Notice kind="error" title="مستند إلغاء مستقلاً">
                    <p className="acc-lead">
                      مرتبطاً بالمستند المختار، ويُسجَّل بهوية المنفّذ وسببه في سجل التدقيق. الأصل
                      يبقى مقروءاً للأبد.
                    </p>
                    <p className="acc-choice__note">
                      {detail.reversal.decided_by_name} ·{" "}
                      <span className="sting-mono">{hhmm(detail.reversal.occurred_at)}</span> ·{" "}
                      {detail.reversal.reason}
                    </p>
                  </Notice>
                ) : null}

                <Table
                  caption="سطور الفاتورة"
                  columns={columns}
                  rows={detail.lines}
                  rowKey={(l) => l.id}
                />

                {reported ? (
                  <Notice kind="success" title="الكاشير يُبلغ">
                    <p className="acc-lead">
                      الملاحظة من الميدان والقرار ممن يملك أثره — سُجّل البلاغ باسم {reported}.
                    </p>
                  </Notice>
                ) : (
                  <div className="pos-inv__report">
                    <TextField
                      label="ملاحظة الاشتباه"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      hint="زرّ «أبلغ عن اشتباه» متاح له — الملاحظة من الميدان والقرار ممن يملك أثره."
                    />
                  </div>
                )}

                <div className="cat-form__actions">
                  <Button onClick={() => router.push(`/pos/receipt/${detail.id}`)} pos>
                    إعادة طباعة نسخة
                  </Button>
                  {!reported ? (
                    <Button
                      variant="secondary"
                      onClick={() => void report()}
                      loading={busy}
                      disabledReason={
                        !online
                          ? "البلاغ يحتاج اتصالاً"
                          : detail.sync !== "synced" && detail.sync !== "reversed"
                            ? "الفاتورة لم تصل الخادم بعد"
                            : undefined
                      }
                    >
                      أبلغ عن اشتباه
                    </Button>
                  ) : null}
                  <Button variant="quiet" onClick={() => router.push("/pos/invoices")}>
                    قائمة الفواتير
                  </Button>
                </div>
              </>
            ) : null}
            {detail === null ? (
              <div className="cat-form__actions">
                <Button variant="quiet" onClick={() => router.push("/pos/invoices")}>
                  قائمة الفواتير
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
