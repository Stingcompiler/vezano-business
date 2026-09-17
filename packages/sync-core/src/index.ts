/**
 * @sting/sync-core — طابور العمليات، PUSH/PULL، معادلة الرصيد واللقطات (§٨).
 * لا تستورد React ولا DOM ولا Dexie؛ التخزين عبر عقود @sting/platform (§٤.٦).
 */
export * from "./types";
export * from "./retry";
export * from "./local-save";
export * from "./invoice-number";
export * from "./pusher";
export * from "./balance";
export * from "./snapshots";
export * from "./pull-apply";
export * from "./epoch";
export * from "./pruning";
export * from "./receipt-local";
export * from "./bootstrap";
export * from "./pin";
export * from "./catalog-local";

export const SYNC_PROTOCOL_VERSION = 1 as const;
export type LocalOperationState = "local" | "pending" | "synced" | "conflict" | "quarantined";
export * from "./shift-local";
export * from "./pos-local";
export * from "./parties-list";
export * from "./parties-local";
export * from "./return-local";
export * from "./sale-local";
export * from "./inventory-local";
export * from "./goods-receipt-local";
