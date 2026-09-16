/** عقد الرئيسية والبحث كما يعيده الخادم (core/home.py) — كل رقم بمصدره ووقته (R-01). */
export interface MoneyValue {
  readonly kind: "money";
  readonly amount_minor: string;
  readonly exponent: number;
}
export interface CountValue {
  readonly kind: "count";
  readonly n: number;
}
export interface Kpi {
  readonly key: string;
  readonly label: string;
  readonly value: MoneyValue | CountValue;
  readonly scope: string;
  readonly note: string;
  readonly note_kind: "info" | "warn" | "ok";
  readonly as_of: string;
  readonly href: string;
  /** يشمل معلّق هذا الجهاز (pending_sync). */
  readonly includes_pending?: boolean;
}
export interface Decision {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly action: string;
  readonly href: string;
  readonly severity: "danger" | "warn";
}
export interface Attention {
  readonly id: string;
  readonly title_count?: number;
  readonly title: string;
  readonly minutes?: number;
  readonly detail: string;
  readonly action: string;
  readonly href: string;
}
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly href: string;
}
export interface HomeSummary {
  readonly kind: "owner" | "employee";
  readonly tenant_name: string;
  readonly user: {
    readonly display_name: string;
    readonly role_name: string;
    readonly branch_name: string;
    readonly device_name: string;
  };
  readonly period: string;
  readonly branch_id: string;
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly branches_synced: boolean;
  readonly coverage_at: string;
  readonly decisions: readonly Decision[];
  readonly decisions_count: number;
  readonly kpis: readonly Kpi[];
  readonly attention: readonly Attention[];
  readonly tasks: readonly Task[];
  readonly quick_actions: readonly ("sale" | "payment" | "return")[];
  readonly can_see_finance: boolean;
  readonly margin_locked: boolean;
  readonly shift: { readonly open_since: string } | null;
}
export interface SearchResult {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly tag: string;
  readonly tag_kind: "ok" | "warn" | "danger" | "info" | "muted";
  readonly href: string;
}
export interface SearchResponse {
  readonly query: string;
  readonly groups: readonly {
    readonly kind: string;
    readonly label: string;
    readonly results: readonly SearchResult[];
  }[];
  readonly restricted: readonly { readonly kind_label: string; readonly count: number }[];
  readonly suggestions: {
    readonly nearest: readonly string[];
    readonly other_branches: boolean;
    readonly create: boolean;
  };
  readonly total: number;
  readonly kinds_with_results: number;
  readonly elapsed_ms: number;
}
export interface Notice {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly when?: string;
  readonly needs_action: boolean;
  readonly href: string;
}
