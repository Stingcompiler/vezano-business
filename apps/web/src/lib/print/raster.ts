"use client";

/**
 * تنقيط الإيصال العربي (§١٢.٣): التشكيل والاتجاه في المتصفح بخطّ محلي على لوحة رسم، ثم صورة
 * أحادية اللون وأوامر raster (`GS v 0`). التنقيط يعالج التشكيل ولا يثبت نجاح النقل — النقل في
 * `ble.ts`. صفحة التجربة تجمع نصاً متصلاً ومختلطاً وأرقاماً وباركوداً وكشفاً طويلاً لأن العطب
 * يظهر في أحدها لا في كلّها (ACC-83).
 */

export type PaperWidth = 58 | 80;

/** عرض النقاط الشائع لرؤوس 203dpi — يُقاس فعلياً على الطراز ولا يُفترض (§١٢.٣). */
export const DOTS: Record<PaperWidth, number> = { 58: 384, 80: 576 };

export interface RasterLine {
  readonly text: string;
  readonly align?: "start" | "center" | "end";
  readonly size?: number;
  readonly bold?: boolean;
  /** سطر بعمودين: النص في البداية والقيمة في النهاية (أرقام لاتينية). */
  readonly value?: string;
  readonly barcode?: string;
}

export interface RasterDoc {
  readonly width: PaperWidth;
  readonly lines: readonly RasterLine[];
}

/** صفحة التجربة العربية — ما نطبعه ونسأل المستخدم أن يتحققه. */
export function testPage(width: PaperWidth): RasterDoc {
  const statement: RasterLine[] = Array.from({ length: 12 }, (_, i) => ({
    text: `بند ${i + 1} — كشف طويل لاختبار تقطيع الحزم`,
    value: `${(i + 1) * 12.5}`.padEnd(1),
  }));
  return {
    width,
    lines: [
      { text: "بقالة النيل — تجريبي", align: "center", size: 28, bold: true },
      { text: "صفحة تجربة عربية", align: "center" },
      { text: "فاتورة INV-000123 · 2026-09-18", align: "center" },
      { text: "سكر أبيض · 2 كغ", value: "200.00" },
      { text: "الإجمالي", value: "200.00", bold: true },
      { text: "", barcode: "200123" },
      { text: "كشف طويل:", bold: true },
      ...statement,
      { text: "شكراً لتعاملكم معنا", align: "center" },
    ],
  };
}

// Code 39 — تسعة عناصر لكل رمز (عريض/ضيق) تبدأ بخط؛ يكفي الأرقام والنجمة لصفحة التجربة
const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  "*": "nwnnwnwnn",
};

function drawBarcode(
  ctx: CanvasRenderingContext2D,
  value: string,
  x0: number,
  y: number,
  w: number,
) {
  const chars = `*${value.replace(/[^0-9]/g, "")}*`;
  const units = chars
    .split("")
    .reduce(
      (n, c) => n + (CODE39[c] ?? "").split("").reduce((m, e) => m + (e === "w" ? 3 : 1), 0) + 1,
      0,
    );
  const unit = Math.max(1, Math.floor(w / units));
  const total = units * unit;
  let x = x0 + Math.floor((w - total) / 2);
  ctx.fillStyle = "#000";
  for (const c of chars) {
    const pat = CODE39[c] ?? "";
    pat.split("").forEach((e, i) => {
      const width = (e === "w" ? 3 : 1) * unit;
      if (i % 2 === 0) ctx.fillRect(x, y, width, 60);
      x += width;
    });
    x += unit; // فجوة بين الرموز
  }
}

function uiFont(): string {
  if (typeof document === "undefined") return "sans-serif";
  const f = getComputedStyle(document.body).getPropertyValue("--font-ui").trim();
  return f || "sans-serif";
}

/** يرسم المستند على لوحة بعرض النقاط ويعيدها — المعاينة تعرضها كصورة، والنقل يحوّلها بتّات. */
export function renderCanvas(doc: RasterDoc): HTMLCanvasElement {
  const width = DOTS[doc.width];
  const pad = 8;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  const measure = canvas.getContext("2d");
  if (!measure) throw new Error("canvas غير متاح");
  const font = uiFont();
  let height = pad;
  const rows: { line: RasterLine; y: number; h: number }[] = [];
  for (const line of doc.lines) {
    const size = line.size ?? 22;
    const h = line.barcode ? 60 + 12 : Math.round(size * 1.5);
    rows.push({ line, y: height, h });
    height += h;
  }
  height += pad * 4;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas غير متاح");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.direction = "rtl";
  ctx.textBaseline = "top";
  for (const { line, y } of rows) {
    if (line.barcode) {
      drawBarcode(ctx, line.barcode, pad, y + 6, width - pad * 2);
      continue;
    }
    const size = line.size ?? 22;
    ctx.font = `${line.bold ? "700" : "400"} ${size}px ${font}`;
    if (line.value !== undefined) {
      ctx.textAlign = "right";
      ctx.fillText(line.text, width - pad, y);
      ctx.textAlign = "left";
      ctx.direction = "ltr";
      ctx.fillText(line.value, pad, y);
      ctx.direction = "rtl";
      continue;
    }
    const align = line.align ?? "start";
    ctx.textAlign = align === "center" ? "center" : align === "end" ? "left" : "right";
    const x = align === "center" ? width / 2 : align === "end" ? pad : width - pad;
    ctx.fillText(line.text, x, y);
  }
  return canvas;
}

/** لوحة → أحادية اللون → `ESC @` + `GS v 0` + تغذية وقصّ. */
export function toEscPos(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas غير متاح");
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (img[i]! * 299 + img[i + 1]! * 587 + img[i + 2]! * 114) / 1000;
      if (lum < 128) bitmap[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  const head = [
    0x1b,
    0x40, // ESC @
    0x1d,
    0x76,
    0x30,
    0x00, // GS v 0, m=0
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ];
  const tail = [0x1b, 0x64, 0x04, 0x1d, 0x56, 0x00]; // ESC d 4 (تغذية) + GS V 0 (قصّ)
  const out = new Uint8Array(head.length + bitmap.length + tail.length);
  out.set(head, 0);
  out.set(bitmap, head.length);
  out.set(tail, head.length + bitmap.length);
  return out;
}
