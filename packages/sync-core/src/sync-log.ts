/**
 * سجلّ المزامنة من جهة الجهاز (SYS-01/SYS-02؛ §٨.٣، §١٣.٦): لكل عملية خطّ زمني — حُفظت محلياً،
 * أُرسلت، ردّ الخادم (قبول/تكرار/تعارض/رفض) أو تعذّر النقل (شبكة/مصادقة/جيل) — بوقته وسببه؛ ووقت
 * آخر وصول ناجح للخادم («هناك شبكة» ≠ «نجح الوصول»). وصف العملية بلغة المحل لا برسالة تقنية.
 *
 * تنبيه Dexie: الدوال التي تأخذ `tx` تكتب على المعاملة مباشرةً بلا مساعد async خارجي.
 */
import type { StoragePort, StorageTransaction, StoredOperation } from "@sting/platform";

import { formatInvoiceNumber, INVOICE_SEQ_META, type InvoiceNumberParts } from "./invoice-number";

export const ATTEMPTS_PREFIX = "sync.attempts:";
/** آخر ردّ ناجح من الخادم (PUSH مقبول أو فحص وصول) — ISO. */
export const LAST_OK_META = "sync.last_ok";
/** وقوف الرفع التلقائي بعد المحاولات المتباعدة (ISO) — الطابور محفوظ كما هو، والاستئناف يدوي. */
export const HALTED_META = "sync.halted";
/** «ثلاث محاولات متباعدة ثم وقوف» (07-D3) — لا إعادة بلا حدّ. */
export const MAX_AUTO_ATTEMPTS = 3;
const MAX_ENTRIES = 30;

export type AttemptEvent =
  | "saved"
  | "sent"
  | "transient"
  | "auth"
  | "epoch_mismatch"
  | "permanent"
  | "accepted"
  | "duplicate"
  | "conflicted"
  | "rejected"
  | "pending_dependency"
  | "requeued"
  | "renumbered";

export interface AttemptEntry {
  readonly at: string;
  readonly event: AttemptEvent;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
}

export const attemptsKey = (operationId: string): string => ATTEMPTS_PREFIX + operationId;

export async function appendAttempt(
  tx: StorageTransaction,
  operationId: string,
  entry: AttemptEntry,
): Promise<void> {
  const raw = await tx.getMeta(attemptsKey(operationId));
  const list = raw ? (JSON.parse(raw) as AttemptEntry[]) : [];
  list.push(entry);
  await tx.putMeta(attemptsKey(operationId), JSON.stringify(list.slice(-MAX_ENTRIES)));
}

export async function readAttempts(
  storage: StoragePort,
  operationId: string,
): Promise<AttemptEntry[]> {
  const raw = await storage.read((tx) => tx.getMeta(attemptsKey(operationId)));
  return raw ? (JSON.parse(raw) as AttemptEntry[]) : [];
}

/** وقت الحفظ المحلي من السجل — العمليات لا تحمل طابعاً زمنياً في التخزين. */
export function savedAt(attempts: readonly AttemptEntry[]): string | null {
  return attempts.find((a) => a.event === "saved")?.at ?? null;
}

const minor = (v: unknown): string => {
  const s = (str(v) || "0").replace("-", "");
  const n = s.padStart(3, "0");
  const whole = n.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${n.slice(-2)}`;
};

const p = (op: StoredOperation, entity: string): Record<string, unknown> =>
  op.members.find((m) => m.entity === entity)?.payload ?? {};

const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

const count = (op: StoredOperation, entity: string): number =>
  op.members.filter((m) => m.entity === entity).length;

export interface OperationDescription {
  /** «فاتورة 9987 — بيع نقدي» */
  readonly title: string;
  /** «بيع 100.00 — يزيد الذمة 60.00 ويدخل الصندوق 40.00» — الأثر على مال المستخدم */
  readonly effect: string;
  /** الرقم المرئي إن وُجد — يُعرض داخل mono */
  readonly number: string;
}

/** وصف العملية بلغة المحل: ما هي وما أثرها على ماله — لا JSON ولا رسائل خادم خام. */
export function describeOperation(op: StoredOperation): OperationDescription {
  switch (op.kind) {
    case "sale": {
      const h = p(op, "sales.Sale");
      const pays = op.members.filter((m) => m.entity === "sales.Payment").map((m) => m.payload);
      const cash = pays
        .filter((x) => x["method"] === "cash")
        .reduce((a, x) => a + BigInt(str(x["amount_minor"]) || "0"), 0n);
      const bank = pays
        .filter((x) => x["method"] === "bank")
        .reduce((a, x) => a + BigInt(str(x["amount_minor"]) || "0"), 0n);
      const credit = pays
        .filter((x) => x["method"] !== "cash" && x["method"] !== "bank")
        .reduce((a, x) => a + BigInt(str(x["amount_minor"]) || "0"), 0n);
      const mode = credit > 0n ? (cash + bank > 0n ? "بيع مختلط" : "بيع آجل") : "بيع نقدي";
      const parts: string[] = [];
      if (credit > 0n) parts.push(`يزيد الذمة ${minor(credit.toString())}`);
      if (cash > 0n) parts.push(`يدخل الصندوق ${minor(cash.toString())}`);
      if (bank > 0n) parts.push(`يدخل البنك ${minor(bank.toString())}`);
      return {
        title: `فاتورة — ${mode}`,
        number: str(h["invoice_number"]),
        effect: `بيع ${minor(h["total_minor"])} — ${parts.join(" و") || "بلا أثر مالي"}`,
      };
    }
    case "sale_return": {
      const h = p(op, "sales.SaleReturn");
      return {
        title: "مرتجع",
        number: str(h["return_number"]),
        effect: `مرتجع ${minor(h["total_minor"])} — يخرج من الصندوق ويعيد البضاعة`,
      };
    }
    case "payment_receipt":
    case "refund": {
      const h = p(op, "parties.PaymentReceipt");
      const name = str(h["party_name"]);
      const isRefund = op.kind === "refund" || h["kind"] === "refund";
      return {
        title: isRefund ? "سند صرف" : "سند قبض",
        number: str(h["receipt_number"]),
        effect: isRefund
          ? `صرف ${minor(h["amount_minor"])} — يخرج من الصندوق${name ? ` إلى ${name}` : ""}`
          : `سداد ${minor(h["amount_minor"])} — يخفض ذمة ${name || "الطرف"}`,
      };
    }
    case "cash_movement": {
      const h = p(op, "shifts.CashMovement");
      const kind = str(h["kind"]);
      const label = kind === "deposit" ? "إيداع" : kind === "withdrawal" ? "سحب" : "مصروف";
      return {
        title: `حركة صندوق — ${label}`,
        number: str(h["number"]),
        effect: `${label} ${minor(h["signed_amount_minor"])} — ${kind === "deposit" ? "يدخل الصندوق" : "يخرج من الصندوق"}`,
      };
    }
    case "shift_open":
      return { title: "فتح وردية", number: "", effect: "يبدأ عدّ الصندوق من رصيد الافتتاح" };
    case "shift_close":
      return { title: "إقفال وردية", number: "", effect: "يثبّت الفرق بين المعدود والمتوقع" };
    case "stock_receipt": {
      const h = p(op, "inventory.GoodsReceipt");
      const n = count(op, "inventory.GoodsReceiptLine");
      return {
        title: `إدخال مخزون — ${n} صنفاً`,
        number: str(h["receipt_number"]),
        effect: `يزيد المخزون${str(h["supplier_name"]) ? ` — من ${str(h["supplier_name"])}` : ""}`,
      };
    }
    case "count_session": {
      const h = p(op, "inventory.CountSession");
      const n = count(op, "inventory.CountLine");
      return {
        title: `جلسة جرد — ${n} صنفاً`,
        number: str(h["session_number"]),
        effect: "الفروق تُعرض للمراجعة ولا تغيّر الرصيد بنفسها",
      };
    }
    case "stock_transfer": {
      const h = p(op, "inventory.StockTransfer");
      return {
        title: "تحويل بين فرعين",
        number: str(h["transfer_number"]),
        effect: "يخرج من رصيد فرعك إلى «بضاعة في الطريق»",
      };
    }
    case "transfer_receipt": {
      const h = p(op, "inventory.TransferReceipt");
      return {
        title: "استلام تحويل",
        number: str(h["receipt_number"]),
        effect: "يدخل المستلم رصيدك والفرق يبقى على التحويل",
      };
    }
    case "party_create": {
      const h = p(op, "parties.PartyCreated");
      return { title: `طرف جديد — ${str(h["name"])}`, number: "", effect: "بلا أثر مالي" };
    }
    case "opening":
      return { title: "رصيد افتتاحي لطرف", number: "", effect: "يثبّت ذمة سابقة على النظام" };
    case "credit_override":
      return { title: "تجاوز حدّ الائتمان", number: "", effect: "يسمح ببيع آجل فوق الحدّ بسبب" };
    case "discount_override":
      return { title: "تجاوز سقف الخصم", number: "", effect: "خصم فوق السقف بسبب" };
    default:
      return { title: op.kind, number: "", effect: "" };
  }
}

/** يعيد عملية محجورة/متعارضة إلى الطابور بموضعها الزمني (رقم إنشائها المحلي لا يتغير — «لا قفز»). */
export async function requeueOperation(
  storage: StoragePort,
  operationId: string,
): Promise<boolean> {
  return storage.transaction(async (tx) => {
    const op = await tx.getOperation(operationId);
    if (!op || op.state === "synced" || op.state === "local" || op.state === "pending")
      return false;
    await tx.putOperation({ ...op, state: "local" });
    const raw = await tx.getMeta(attemptsKey(operationId));
    const list = raw ? (JSON.parse(raw) as AttemptEntry[]) : [];
    list.push({ at: new Date().toISOString(), event: "requeued" });
    await tx.putMeta(attemptsKey(operationId), JSON.stringify(list.slice(-MAX_ENTRIES)));
    return true;
  });
}

/** «إعادة ترقيم بموافقتك ثم رفع»: رقم فاتورة جديد من عدّاد الجهاز للبيع المحجور برقم مستعمل، ثم الطابور.
 * العدّاد يُقرأ ويُكتب على المعاملة مباشرةً — لا مساعد async تحت Dexie (يُغلق المعاملة قبل أوانها). */
export async function renumberSale(
  storage: StoragePort,
  operationId: string,
  parts: InvoiceNumberParts,
  projectionPrefix: string,
): Promise<string | null> {
  return storage.transaction(async (tx) => {
    const op = await tx.getOperation(operationId);
    if (!op || op.kind !== "sale" || op.state === "synced") return null;
    const head = op.members.find((m) => m.entity === "sales.Sale");
    if (!head) return null;
    const seq = Number((await tx.getMeta(INVOICE_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(INVOICE_SEQ_META, String(seq));
    const number = formatInvoiceNumber(parts, seq);
    await tx.putOperation({
      ...op,
      state: "local",
      members: op.members.map((m) =>
        m.entity === "sales.Sale" ? { ...m, payload: { ...m.payload, invoice_number: number } } : m,
      ),
    });
    const row = await tx.getProjection(projectionPrefix + head.id);
    if (row)
      await tx.putProjection({ key: row.key, value: { ...row.value, invoice_number: number } });
    const raw = await tx.getMeta(attemptsKey(operationId));
    const list = raw ? (JSON.parse(raw) as AttemptEntry[]) : [];
    list.push({ at: new Date().toISOString(), event: "renumbered", detail: number });
    await tx.putMeta(attemptsKey(operationId), JSON.stringify(list.slice(-MAX_ENTRIES)));
    return number;
  });
}
