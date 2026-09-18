"use client";

/**
 * ناقل Web Bluetooth (§١٢.٢): BLE/GATT فقط — Bluetooth Classic/RFCOMM يُحال لمسار آخر (تعريف
 * النظام أو التطبيق الأصلي). القدرة تُفحص قبل عرض أي زر (R-09). الطرازات وخدماتها من بيانات
 * خارجية `/printers/models.json` (G-10) لا نصاً مضمّناً. الكتابة بحزم صغيرة؛ انقطاع بعد الإرسال
 * = «unknown» ولا يُعاد تلقائياً كي لا يتكرر إيصال (§١٢.٣).
 */
import type { PrintOutcome } from "@sting/platform";

export interface PrinterProfile {
  readonly id: string;
  readonly label: string;
  readonly service: string;
  readonly characteristic: string;
  readonly chunk: number;
  readonly widths: readonly (58 | 80)[];
}

export interface TestedModel {
  readonly model: string;
  readonly device: string;
  readonly os: string;
  readonly browser: string;
  readonly firmware: string;
  readonly result: "ok" | "failed";
  readonly evidence: string;
}

export interface ModelsData {
  readonly version: number;
  readonly profiles: readonly PrinterProfile[];
  readonly tested: readonly TestedModel[];
}

export interface PairedDevice {
  readonly id: string;
  readonly name: string;
  readonly profileId: string;
}

interface BleFake {
  available?: boolean;
  pair?: PairedDevice | null;
  outcome?: PrintOutcome;
  written?: number[];
}

let bleFake: BleFake | null = null;
const devices = new Map<string, BluetoothDevice>();

export async function loadModels(): Promise<ModelsData | null> {
  try {
    const r = await fetch("/printers/models.json", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ModelsData;
  } catch {
    return null;
  }
}

/** القدرة قبل الزر (R-09): وجود Web Bluetooth وتشغيل البلوتوث. */
export async function bleAvailable(): Promise<boolean> {
  if (bleFake) return bleFake.available ?? false;
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) return false;
  try {
    return await navigator.bluetooth.getAvailability();
  } catch {
    return false;
  }
}

/** يفتح حوار المتصفح لاختيار طابعة BLE تعلن إحدى خدمات الطرازات — بتفاعل المستخدم فقط. */
export async function pairPrinter(
  profiles: readonly PrinterProfile[],
): Promise<PairedDevice | null> {
  if (bleFake) return bleFake.pair ?? null;
  if (!(await bleAvailable()) || profiles.length === 0) return null;
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: profiles.map((p) => ({ services: [p.service] })),
      optionalServices: profiles.map((p) => p.service),
    });
    devices.set(device.id, device);
    // الطراز يُستدل من الخدمة المتاحة بعد الاتصال؛ قبلها الأول المطابق
    const profile = await detectProfile(device, profiles);
    return {
      id: device.id,
      name: device.name ?? "طابعة BLE",
      profileId: profile?.id ?? profiles[0]!.id,
    };
  } catch {
    return null;
  }
}

async function detectProfile(
  device: BluetoothDevice,
  profiles: readonly PrinterProfile[],
): Promise<PrinterProfile | null> {
  try {
    const server = await device.gatt?.connect();
    if (!server) return null;
    for (const p of profiles) {
      try {
        await server.getPrimaryService(p.service);
        return p;
      } catch {
        // ليست هذه الخدمة
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** يكتب البتّات بحزم بحجم الطراز؛ فشل قبل أول حزمة = failed؛ انقطاع بعدها = unknown. */
export async function printBle(
  paired: PairedDevice,
  profile: PrinterProfile,
  bytes: Uint8Array,
): Promise<PrintOutcome> {
  if (bleFake) {
    bleFake.written = [bytes.length];
    return bleFake.outcome ?? "printed";
  }
  const device = devices.get(paired.id);
  if (!device) return "failed"; // لم تُقرن في هذه الجلسة — الربط يُعاد بتفاعل
  let sent = 0;
  try {
    const server = await device.gatt?.connect();
    if (!server) return "failed";
    const service = await server.getPrimaryService(profile.service);
    const ch = await service.getCharacteristic(profile.characteristic);
    const size = Math.max(20, Math.min(profile.chunk, 512));
    for (let i = 0; i < bytes.length; i += size) {
      const chunk = bytes.slice(i, i + size);
      if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(chunk);
      else await ch.writeValueWithResponse(chunk);
      sent += chunk.length;
    }
    return "printed";
  } catch {
    return sent > 0 ? "unknown" : "failed";
  }
}

/** للاختبار (لا في الإنتاج): بلوتوث وهمي — لا Web Bluetooth في Chromium بلا رأس. */
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __stingBleFake?: (fake: BleFake | null) => void }).__stingBleFake = (
    fake,
  ) => {
    bleFake = fake;
  };
}
