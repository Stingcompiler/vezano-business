"use client";

/**
 * طابعات هذا الجهاز (WEB-03): سجل محلي في meta — الطابعة وطريقة اتصالها وقياس ورقها ونتيجة آخر
 * تجربة عربية عليها. «مدعومة» لا تُقال قبل ورقة تحقّق منها المستخدم بعينه (G-10 مفتوح؛ ACC-83).
 */
import { getStorage } from "@/lib/storage";

import { type PairedDevice, loadModels, printBle } from "./ble";
import { type PaperWidth, renderCanvas, testPage, toEscPos } from "./raster";

export type Conn = "ble" | "usb" | "network";
export type TestMode = "text" | "image";
export type TestResult = "ok" | "failed" | "sent" | "unknown";

export interface PrinterTest {
  readonly at: string;
  readonly mode: TestMode;
  readonly result: TestResult;
}

export interface DevicePrinter {
  readonly id: string;
  readonly name: string;
  readonly conn: Conn;
  readonly width: PaperWidth | "a4";
  readonly ble?: PairedDevice;
  readonly lastTest?: PrinterTest;
}

export const PRINTERS_META = "print.printers";
export const RECEIPT_WIDTH_META = "print.receipt_width";

export async function listPrinters(): Promise<DevicePrinter[]> {
  const raw = await getStorage().read((tx) => tx.getMeta(PRINTERS_META));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DevicePrinter[];
  } catch {
    return [];
  }
}

export async function savePrinters(list: readonly DevicePrinter[]): Promise<void> {
  const json = JSON.stringify(list);
  await getStorage().transaction((tx) => tx.putMeta(PRINTERS_META, json));
}

/** قياس الإيصال المعدّ على هذا الجهاز — الافتراض ٨٠ ملم. */
export async function receiptWidth(): Promise<PaperWidth> {
  const raw = await getStorage().read((tx) => tx.getMeta(RECEIPT_WIDTH_META));
  return raw === "58" ? 58 : 80;
}

export async function setReceiptWidth(w: PaperWidth): Promise<void> {
  const v = String(w);
  await getStorage().transaction((tx) => tx.putMeta(RECEIPT_WIDTH_META, v));
}

export function connLabel(p: DevicePrinter): string {
  return p.conn === "ble" ? "بلوتوث BLE" : p.conn === "usb" ? "USB · تعريف النظام" : "شبكة";
}

/** يرسل صفحة التجربة: BLE بتّات raster؛ تعريف النظام بحوار الطباعة (نص أو صورة). */
export async function sendTestPage(
  p: DevicePrinter,
  mode: TestMode,
  width: PaperWidth,
): Promise<TestResult> {
  if (p.conn === "ble") {
    const models = await loadModels();
    const profile = models?.profiles.find((x) => x.id === p.ble?.profileId);
    if (!p.ble || !profile) return "failed";
    const bytes = toEscPos(renderCanvas(testPage(width)));
    const out = await printBle(p.ble, profile, bytes);
    return out === "printed" ? "sent" : out;
  }
  // تعريف النظام: المتصفح يقول «أُرسل للطباعة» ولا يعرف ما خرج — نسأل المستخدم
  return "sent";
}

export interface ReceiptDoc {
  readonly shopName: string;
  readonly title: string;
  readonly number: string;
  readonly dateLabel: string;
  readonly lines: readonly { label: string; value: string; strong?: boolean | undefined }[];
  readonly footer?: string | undefined;
  readonly copy: boolean;
}

/**
 * الناقل الفعلي للإيصال (POS-08/11 → WEB-03): طابعة BLE أثبتت تجربتها العربية → raster عبر
 * Bluetooth؛ وإلا «system» فيطبع المتصفح بحواره. «نسخة» تُطبع في الرأس عند إعادة الطباعة.
 */
export async function printReceiptOnDevice(
  doc: ReceiptDoc,
): Promise<"printed" | "failed" | "unknown" | "system"> {
  const list = await listPrinters();
  const p = list.find((x) => x.conn === "ble" && x.ble && x.lastTest?.result === "ok");
  if (!p?.ble || p.width === "a4") return "system";
  const models = await loadModels();
  const profile = models?.profiles.find((x) => x.id === p.ble?.profileId);
  if (!profile) return "system";
  const bytes = toEscPos(
    renderCanvas({
      width: p.width,
      lines: [
        { text: doc.shopName, align: "center", size: 28, bold: true },
        ...(doc.copy ? [{ text: "نسخة", align: "center" as const, bold: true }] : []),
        { text: `${doc.title} #${doc.number}`, align: "center" },
        { text: doc.dateLabel, align: "center" },
        ...doc.lines.map((l) => ({ text: l.label, value: l.value, bold: l.strong ?? false })),
        ...(doc.footer ? [{ text: doc.footer, align: "center" as const }] : []),
      ],
    }),
  );
  return printBle(p.ble, profile, bytes);
}
