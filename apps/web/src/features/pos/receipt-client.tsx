"use client";

import type { StoredOperation } from "@sting/platform";
import { LAST_SALE_META, type LocalSale, readSale } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  Receipt,
  type ReceiptLine,
  Status,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { hhmm } from "@/features/home/format";
import { readHomeCache } from "@/features/home/home-cache";
import { apiBaseUrl, getAccessToken } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { recordPrintFailure } from "@/lib/diagnostics";
import { printReceiptOnDevice } from "@/lib/print/printers";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { type LastPush, pushPending, readLastPush } from "@/lib/sync";

import { PosNav } from "./pos-nav";

type State = "saved_local" | "pending_sync" | "synced" | "success" | "server_error";

/** سطور الإيصال من البيع المحفوظ — الكميات والمبالغ بأرقام لاتينية في mono. */
export function receiptLines(sale: LocalSale): ReceiptLine[] {
  const lines: ReceiptLine[] = sale.lines.map((l) => ({
    // «سكر — 1 كغ»: الكمية بلا أصفار زائدة على الورقة (1 لا 1.000)
    label: `${l.item_name} — ${formatQty(l.qty_milli, l.decimal_places as 0 | 1 | 2 | 3)
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "")} ${l.unit_code}`,
    value: formatMinor(l.line_total_minor),
    mono: true,
  }));
  if (BigInt(sale.discount_minor) > 0n)
    lines.push({ label: "خصم", value: `−${formatMinor(sale.discount_minor)}`, mono: true });
  lines.push({ label: "الإجمالي", value: formatMinor(sale.total_minor), mono: true, strong: true });
  if (BigInt(sale.cash_minor) > 0n)
    lines.push({ label: "نقداً", value: formatMinor(sale.cash_minor), mono: true });
  if (BigInt(sale.credit_minor) > 0n)
    lines.push({
      label: `آجل — ${sale.party_name}`,
      value: formatMinor(sale.credit_minor),
      mono: true,
    });
  if (BigInt(sale.bank_minor) > 0n)
    lines.push({
      label: "تحويل بنكي — مسجَّل غير مطابق",
      value: formatMinor(sale.bank_minor),
      mono: true,
    });
  return lines;
}

/**
 * POS-08 — نجاح البيع والإيصال (03-D2 saved_local/synced · 42-D34 pending_sync/success/server_error):
 * محفوظ محلياً مقابل مؤكد خادمياً، والإيصال لا ينتظر المزامنة (بوسم «محفوظ على الجهاز» في ذيله حتى
 * التأكيد)، وإعادة الطباعة نسخة بنفس الرقم دون بيع جديد (ACC-84). الطباعة خطوة لاحقة: فشلها لا يلغي
 * البيع (القاعدة 6).
 */
export function ReceiptClient({ saleId }: { saleId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [sale, setSale] = useState<LocalSale | null | undefined>(undefined);
  const [op, setOp] = useState<StoredOperation | null>(null);
  const [lastPush, setLastPush] = useState<LastPush | null>(null);
  const [shop, setShop] = useState("");
  const [prints, setPrints] = useState<string[]>([]);
  const [printFailed, setPrintFailed] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    const id =
      saleId === "last" ? ((await storage.read((tx) => tx.getMeta(LAST_SALE_META))) ?? "") : saleId;
    const s = id ? await readSale(storage, id) : null;
    setSale(s);
    if (s) setOp(await storage.read((tx) => tx.getOperation(s.operation_id)));
    setLastPush(await readLastPush());
    setShop((await readHomeCache())?.summary.tenant_name ?? "");
  }, [saleId]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/pos/receipt/${saleId}`)}`);
      return;
    }
    void load();
  }, [load, router, saleId]);

  useEffect(() => {
    if (sale === null) router.replace("/pos");
  }, [router, sale]);

  const opState = op?.state ?? "local";
  const rejected = opState === "quarantined" || opState === "conflict";
  const state: State = rejected
    ? "server_error"
    : opState === "synced"
      ? prints.length > 0
        ? "success"
        : "synced"
      : opState === "pending"
        ? "pending_sync"
        : "saved_local";

  const print = async () => {
    if (!sale) return;
    // فشل الطابعة لا يلغي البيع: مفتاح العطل `printer_fail` يحاكي طابعة لا تستجيب (WEB-03 يربط الناقل)
    let failed = false;
    if (online) {
      try {
        // خارج العقد (نقطة سيناريو تطويرية خلف حارس) — لذا fetch مباشر
        const r = await fetch(`${apiBaseUrl()}/api/scenario/faults`, {
          headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
        });
        const faults = r.ok ? ((await r.json()) as { active?: string[] }) : null;
        failed = Boolean(faults?.active?.includes("printer_fail"));
      } catch {
        failed = false;
      }
    }
    if (failed) {
      setPrintFailed(true);
      void recordPrintFailure();
      return;
    }
    // الناقل الفعلي (WEB-03): طابعة BLE مثبتة بالتجربة → raster عبر Bluetooth؛ وإلا حوار المتصفح
    const out = await printReceiptOnDevice({
      shopName: shop || "—",
      title: "فاتورة",
      number: sale.invoice_number,
      dateLabel: `${sale.business_date} ${hhmm(sale.occurred_at)}`,
      lines: receiptLines(sale).map((l) => ({ label: l.label, value: l.value, strong: l.strong })),
      copy: prints.length > 0,
    });
    if (out === "failed" || out === "unknown") {
      // فشل الطابعة لا يلغي البيع؛ «unknown» لا يُعاد تلقائياً كي لا يتكرر إيصال (§١٢.٣)
      setPrintFailed(true);
      void recordPrintFailure();
      return;
    }
    setPrintFailed(false);
    if (out === "system") window.print();
    setPrints((p) => [...p, new Date().toISOString()]);
  };

  const retry = async () => {
    if (!online) return;
    await pushPending();
    await load();
  };

  return (
    <Frame title="نقطة البيع" nav={<PosNav currentId="pos" canSeeReports={false} />} footer={null}>
      <div className="pos" data-screen="POS-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {rejected
                ? "رُفض الرفع"
                : state === "synced" || state === "success"
                  ? "مؤكد خادمياً"
                  : state === "pending_sync"
                    ? "محفوظ — في طابور الرفع"
                    : "حُفظ البيع محلياً"}
            </h2>
            {sale ? (
              <Status
                state={
                  rejected
                    ? "server_error"
                    : opState === "synced"
                      ? "synced"
                      : opState === "pending"
                        ? "pending_sync"
                        : "saved_local"
                }
                label={
                  rejected
                    ? "رُفض الرفع"
                    : opState === "synced"
                      ? "مؤكد خادمياً"
                      : opState === "pending"
                        ? "معلّق المزامنة"
                        : "محفوظ محلياً"
                }
              />
            ) : null}
          </div>
          {sale ? (
            <div className="acc-card__body">
              {state === "saved_local" ? (
                <p className="acc-lead">
                  الفاتورة <span className="sting-mono">{sale.invoice_number}</span> مسجَّلة على هذا
                  الجهاز. تُرفع تلقائياً عند عودة الاتصال — لا تُعِد البيع.
                </p>
              ) : null}
              {state === "pending_sync" ? (
                <Notice kind="info" title="محفوظ — في طابور الرفع">
                  <p className="acc-lead">البيع محفوظ محلياً وينتظر دوره.</p>
                  <p className="acc-lead">
                    <strong>الإيصال لا ينتظر</strong> · يُطبع الآن بوسم «محفوظ على الجهاز» في ذيله.
                    الزبون لا يقف على المزامنة، والوسم يحفظ صدق الورقة.
                  </p>
                </Notice>
              ) : null}
              {state === "synced" || state === "success" ? (
                <>
                  <p className="acc-lead">
                    الفاتورة <span className="sting-mono">{sale.invoice_number}</span> وصلت الخادم{" "}
                    <span className="sting-mono">
                      {lastPush ? hhmm(lastPush.at) : hhmm(sale.occurred_at)}
                    </span>{" "}
                    وصارت مرجعية.
                  </p>
                  {state === "success" ? (
                    <Notice kind="success" title="مؤكَّد خادمياً">
                      <p className="acc-lead">العملية على الخادم، والإيصال بلا وسم محلي.</p>
                    </Notice>
                  ) : null}
                  {prints.length > 0 ? (
                    <p className="cat-saving__note">
                      طُبعت نسخة واحدة <span className="sting-mono">{hhmm(prints[0]!)}</span>. إعادة
                      الطباعة تصدر <strong>نسخة</strong> بنفس الرقم{" "}
                      <span className="sting-mono">{sale.invoice_number}</span> وتُوسَم «نسخة»، ولا
                      تسجّل بيعاً جديداً.
                    </p>
                  ) : (
                    <p className="cat-saving__note">
                      <strong>إعادة الطباعة نسخة</strong> · كل طبعة بعد الأولى تحمل «نسخة» ورقمَ
                      الأصل نفسه (ACC-84).
                    </p>
                  )}
                </>
              ) : null}
              {rejected ? (
                <Notice kind="error" title="رُفض الرفع">
                  <p className="acc-lead">
                    البيع محفوظ محلياً والخادم ردّه — تحقق دائم لا عطل عابر.
                  </p>
                  <p className="acc-lead">
                    <strong>البيع لا يُلغى</strong> · الرفض يذهب إلى مراجعة العمليات المتعثرة
                    (SYS-02) ولا يمسّ إيصالاً سُلّم. النقد قُبض والبضاعة خرجت — الورقة صادقة
                    والمشكلة إدارية.
                  </p>
                </Notice>
              ) : null}

              {printFailed ? (
                // 03-D2 POS-11 «حُفظت ولم تُطبَع»: التمييز الحاسم — محفوظة لم تُطبَع ≠ لم تُحفظ
                <Notice kind="warning" title="حُفظ البيع — لم تتم الطباعة">
                  <p className="acc-lead">
                    الفاتورة <span className="sting-mono">{sale.invoice_number}</span> مسجَّلة.
                    المشكلة في الطابعة وحدها.
                  </p>
                  <p className="acc-lead">
                    إعادة الطباعة لاحقاً تصدر نسخة بنفس الرقم{" "}
                    <span className="sting-mono">{sale.invoice_number}</span> ولا تسجّل بيعاً
                    جديداً.
                  </p>
                </Notice>
              ) : null}

              <Receipt
                shopName={shop || "—"}
                title="فاتورة"
                number={sale.invoice_number}
                dateLabel={`${sale.business_date} ${hhmm(sale.occurred_at)}`}
                lines={receiptLines(sale)}
                copy={prints.length > 0}
                footer={opState !== "synced" ? <span>محفوظ على الجهاز</span> : null}
              />

              <div className="cat-form__actions">
                {printFailed ? (
                  <Button onClick={() => void print()} pos>
                    إعادة محاولة الطباعة
                  </Button>
                ) : prints.length === 0 ? (
                  <Button onClick={() => void print()} pos>
                    طباعة الإيصال
                  </Button>
                ) : (
                  <Button onClick={() => void print()} pos variant="secondary">
                    إعادة طباعة نسخة
                  </Button>
                )}
                {state === "synced" || state === "success" ? (
                  <Button
                    variant="secondary"
                    onClick={() => router.push(`/pos/invoices/${sale.id}`)}
                  >
                    فتح الفاتورة
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void navigator.share?.({
                        title: sale.invoice_number,
                        text: sale.invoice_number,
                      });
                    }}
                    disabledReason={
                      typeof navigator !== "undefined" && "share" in navigator
                        ? undefined
                        : "المشاركة غير متاحة على هذا المتصفح"
                    }
                  >
                    مشاركة
                  </Button>
                )}
                {rejected || (opState !== "synced" && online) ? (
                  <Button
                    variant="quiet"
                    onClick={() => router.push(`/pos/receipt/${sale.id}/problem`)}
                  >
                    {rejected ? "الخادم رفض الفاتورة" : "المزامنة"}
                  </Button>
                ) : null}
                {!rejected && opState !== "synced" && online ? (
                  <Button variant="quiet" onClick={() => void retry()}>
                    إعادة المحاولة
                  </Button>
                ) : null}
                <Button onClick={() => router.push("/pos")} pos>
                  بيع جديد
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
