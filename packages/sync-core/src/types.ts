/**
 * أنواع عقد النقل (§٨.٣) كما يراها الجهاز — مرآة لـ backend/sync/push.py.
 */

export const PROTOCOL_VERSION = 1 as const;

export interface MemberDraft {
  readonly entity: string;
  readonly id: string;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
}

export interface OperationDraft {
  /** يولّده منشئ المسودة مرة واحدة: إعادة الضغط أو إعادة تشغيل الشاشة لا تنشئ هوية جديدة (§٨.٢). */
  readonly operationId: string;
  readonly kind: string;
  readonly opVersion: number;
  readonly dependencies: readonly string[];
  readonly members: readonly MemberDraft[];
}

export type ResultStatus =
  "accepted" | "duplicate" | "conflicted" | "rejected" | "pending_dependency";

export interface MemberReceipt {
  readonly entity: string;
  readonly id: string;
  readonly server_seq: string;
}

export interface OperationResult {
  readonly operation_id: string;
  readonly status: ResultStatus;
  readonly code?: string;
  readonly detail?: string;
  readonly member_receipts?: readonly MemberReceipt[];
}

export interface PushEnvelope {
  readonly protocol_version: typeof PROTOCOL_VERSION;
  readonly sync_epoch: string;
  readonly request_id: string;
  readonly operations: readonly {
    readonly operation_id: string;
    readonly kind: string;
    readonly op_version: number;
    readonly dependencies: readonly string[];
    readonly members: readonly {
      readonly entity: string;
      readonly id: string;
      readonly schema_version: number;
      readonly payload: Record<string, unknown>;
    }[];
  }[];
}

export interface PushResponse {
  readonly protocol_version: number;
  readonly sync_epoch: string;
  readonly request_id: string;
  readonly results: readonly OperationResult[];
  readonly server_seq_high: string;
}

/** تصنيف أخطاء النقل (§٨.٣): العابر يُعاد بتراجع، والدائم يُحجر، والمصادقة/الجيل مساران خاصان. */
export type TransportFailure =
  | {
      readonly kind: "transient";
      readonly reason: "network" | "timeout" | "rate_limited" | "server_error";
      readonly status?: number;
    }
  | { readonly kind: "auth"; readonly status: 401 | 403; readonly detail?: string }
  | { readonly kind: "epoch_mismatch"; readonly currentEpoch: string }
  | { readonly kind: "permanent"; readonly status: number; readonly detail?: string };

export type TransportOutcome =
  | { readonly ok: true; readonly response: PushResponse }
  | ({ readonly ok: false } & TransportFailure);

export interface PushTransport {
  push(envelope: PushEnvelope): Promise<TransportOutcome>;
}
