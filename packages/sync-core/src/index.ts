/**
 * @sting/sync-core — طابور العمليات، PUSH/PULL، معادلة الرصيد واللقطات (§٨).
 * المحتوى الفعلي في T0.12 وT0.13.
 */
import { DOMAIN_CONTRACT_VERSION } from "@sting/domain";

/** حالات العملية المحلية كما في القسم ٣ من الأمر وR-11: محلي → قيد الرفع → مؤكَّد | تعارض. */
export type LocalOperationState = "local" | "pending" | "synced" | "conflict";

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_DEPENDS_ON_DOMAIN = DOMAIN_CONTRACT_VERSION;
