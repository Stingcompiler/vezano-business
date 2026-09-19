import type { CartLine } from "@/features/market/offer-detail-client";
import { readSnapshot, writeSnapshot } from "@/features/market/market-store";

/** ORD-01: السلة والمسودة محليتان (ACC-123) — لا تُثبّتان سعراً؛ ما يُرسل يعاد التحقق منه خادمياً. */
export const CART_KEY = "market.cart";

export function readCart(): { at: string; lines: CartLine[] } {
  const snap = readSnapshot<CartLine[]>(CART_KEY);
  return { at: snap?.at ?? "", lines: snap?.data ?? [] };
}

export function writeCart(lines: CartLine[]): void {
  writeSnapshot(CART_KEY, lines);
}

export function opIdFor(supplierTenantId: string): string {
  // معرّف عملية واحد للمسودة حتى تُرسل — إعادة المحاولة تُرسل الطلب نفسه (ACC-124)
  const key = `market.checkout.op.${supplierTenantId}`;
  try {
    const cur = localStorage.getItem(key);
    if (cur) return cur;
    const fresh = crypto.randomUUID();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearOpId(supplierTenantId: string): void {
  try {
    localStorage.removeItem(`market.checkout.op.${supplierTenantId}`);
  } catch {
    // لا تخزين — لا شيء يُمسح
  }
}
