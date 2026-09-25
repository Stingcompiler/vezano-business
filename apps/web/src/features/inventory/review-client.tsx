"use client";

import { readLocalCountSession } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  Status,
  Table,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import "@/features/inventory/inventory.css";
import { PosNav } from "@/features/pos/pos-nav";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import type { Dp } from "./units";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface ServerRow {
  readonly line_id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_name: string;
  readonly book_milli: string;
  readonly counted_milli: string;
  readonly system_at_count_milli: string;
  readonly delta_milli: string;
  readonly value_minor: string;
  readonly moved_since_count: boolean;
}

interface Adjustment {
  readonly id: string;
  readonly adjustment_number: string;
  readonly decided_by_name: string;
  readonly line_count: number;
}

interface Review {
  readonly session: {
    readonly id: string;
    readonly session_number: string;
    readonly branch_name: string;
    readonly status: "closed" | "adjusted";
    readonly user_name: string;
    readonly total_items: number;
    readonly counted_items: number;
    readonly closed_at: string;
  };
  readonly rows: readonly ServerRow[];
  readonly variance_count: number;
  readonly effect_minor: string;
  readonly suggested_reasons: readonly string[];
  readonly adjustment: Adjustment | null;
  readonly can_adjust: boolean;
}

interface Row {
  readonly id: string;
  readonly name: string;
  readonly dp: Dp;
  readonly bookMilli: bigint;
  readonly countedMilli: bigint;
  readonly deltaMilli: bigint;
  readonly moved: boolean;
}

/** «13/09» من تاريخ ISO — بأرقام لاتينية داخل mono. */
function ddmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/**
 * INV-06 — مراجعة فروق الجرد وتسوية (28-D21 ready/validation_error/permission_denied/success): لا
 * فرق يُمرَّر بلا سبب مكتوب ولا «قبول الكل»؛ التسوية تُنشئ حركة `count` بسبب وفاعل ومستند؛ من يعدّ
 * ليس من يسوّي (صلاحية مالية)؛ العدّ الأصلي محفوظ كما أُدخل ولا يُعاد كتابته؛ حركة وقعت على جهاز
 * آخر أثناء الجرد تُكتشف وتُعرض (ACC-07).
 */
export function ReviewClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const app = useApp();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [localOnly, setLocalOnly] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverMissing, setServerMissing] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Adjustment | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/inventory/count/${sessionId}/review`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const c = await readShiftContext(storage, app);
      setCtx(c);
      const fetchReview = async () => {
        const { data, response } = await api().GET("/api/inventory/count-sessions/{session_id}", {
          params: { path: { session_id: sessionId } },
        });
        return response.ok ? (data as unknown as Review) : null;
      };
      try {
        let body = await fetchReview();
        if (!body) {
          // الجلسة لم تُرفع بعد: نرفع ثم نعيد المحاولة
          try {
            await pushPending();
          } catch {
            /* بلا اتصال */
          }
          body = await fetchReview();
        }
        if (body) {
          setReview(body);
          return;
        }
      } catch {
        /* بلا اتصال: العرض من اللقطة المحلية */
      }
      const local = await readLocalCountSession(storage, sessionId);
      if (!local) {
        setReview(null);
        return;
      }
      setLocalOnly(true);
      setReview({
        session: {
          id: local.id,
          session_number: local.session_number,
          branch_name: c?.branchName ?? "",
          status: "closed",
          user_name: local.user_name,
          total_items: local.total_items,
          counted_items: local.lines.length,
          closed_at: local.closed_at,
        },
        rows: local.lines.map((l) => ({
          line_id: `${local.id}:${l.item_id}`,
          item_id: l.item_id,
          item_name: l.item_name,
          unit_name: l.unit_name,
          book_milli: l.system_qty_milli || "0",
          counted_milli: l.counted_qty_milli,
          system_at_count_milli: l.system_qty_milli,
          delta_milli: (BigInt(l.counted_qty_milli) - BigInt(l.system_qty_milli || "0")).toString(),
          value_minor: "0",
          moved_since_count: false,
        })),
        variance_count: local.lines.filter(
          (l) => BigInt(l.counted_qty_milli) !== BigInt(l.system_qty_milli || "0"),
        ).length,
        effect_minor: "0",
        suggested_reasons: ["تالف", "سرقة", "خطأ عدّ", "خطأ استلام"],
        adjustment: null,
        can_adjust: false,
      });
    })();
  }, [router, sessionId]);

  useEffect(() => {
    if (review === null) router.replace("/inventory");
  }, [review, router]);

  const rows: Row[] = (review?.rows ?? []).map((r) => ({
    id: r.item_id,
    name: r.unit_name ? `${r.item_name} — ${r.unit_name}` : r.item_name,
    dp: 0,
    bookMilli: BigInt(r.book_milli),
    countedMilli: BigInt(r.counted_milli),
    deltaMilli: BigInt(r.delta_milli),
    moved: r.moved_since_count,
  }));
  const diffs = rows.filter((r) => r.deltaMilli !== 0n);
  const missing = diffs.filter((r) => !(reasons[r.id] ?? "").trim() || serverMissing.has(r.id));
  const canAdjust = review?.can_adjust ?? false;
  const already = review?.session.status === "adjusted" ? review.adjustment : null;

  const state: State = done
    ? "success"
    : review && !canAdjust && !localOnly
      ? "permission_denied"
      : attempted && missing.length > 0
        ? "validation_error"
        : "ready";

  const adjust = async () => {
    if (!review || busy) return;
    setAttempted(true);
    if (missing.length > 0) return;
    setBusy(true);
    try {
      const { data, error, response } = await api().POST(
        "/api/inventory/count-sessions/{session_id}",
        {
          params: { path: { session_id: review.session.id } },
          body: { reasons: Object.fromEntries(diffs.map((r) => [r.id, reasons[r.id]!.trim()])) },
        },
      );
      if (response.status === 403) {
        setReview({ ...review, can_adjust: false });
        return;
      }
      if (response.status === 400) {
        const errs =
          (error as { errors?: { item_id: string; code: string }[] } | undefined)?.errors ?? [];
        setServerMissing(new Set(errs.map((e) => e.item_id)));
        return;
      }
      const body = data as unknown as Review | undefined;
      if (!response.ok || !body?.adjustment) return;
      setReview(body);
      setDone(body.adjustment);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: "item", header: "الصنف", render: (r: Row) => r.name },
    {
      key: "book",
      header: "الدفتري",
      render: (r: Row) => (
        <div>
          <span className="sting-mono">{formatQty(r.bookMilli, r.dp)}</span>
          {r.moved ? (
            <div className="acc-choice__note">
              بيعٌ يقع على جهاز آخر أثناء الجرد. يُكتشف عند المزامنة ويُعرض في مراجعة الفروق.
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "counted",
      header: "المعدود",
      mono: true,
      render: (r: Row) => formatQty(r.countedMilli, r.dp),
    },
    {
      key: "diff",
      header: "الفرق",
      render: (r: Row) => (
        <span
          className={`sting-mono ${r.deltaMilli < 0n ? "inv-delta--out" : r.deltaMilli > 0n ? "inv-delta--in" : ""}`}
        >
          {r.deltaMilli > 0n ? "+" : ""}
          {formatQty(r.deltaMilli, r.dp)}
        </span>
      ),
    },
    {
      key: "reason",
      header: "السبب — مطلوب لكل صف",
      render: (r: Row) =>
        r.deltaMilli === 0n ? (
          "—"
        ) : already ? (
          <span>{reasons[r.id] || "—"}</span>
        ) : (
          <TextField
            label={`السبب — ${r.name}`}
            value={reasons[r.id] ?? ""}
            list="inv-reasons"
            onChange={(e) => {
              setServerMissing((s) => {
                const n = new Set(s);
                n.delete(r.id);
                return n;
              });
              setReasons((m) => ({ ...m, [r.id]: e.target.value }));
            }}
            error={
              attempted && (!(reasons[r.id] ?? "").trim() || serverMissing.has(r.id))
                ? "مطلوب — أدخل سبباً لهذا الفرق"
                : undefined
            }
            disabledReason={canAdjust ? undefined : "من يعدّ ليس من يسوّي"}
            required
          />
        ),
    },
  ];

  const effect = review ? BigInt(review.effect_minor) : 0n;
  const s = review?.session;

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={ctx?.roleCode === "owner"} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              مراجعة فروق الجرد وتسوية — لا فرق يُمرَّر بلا سبب مكتوب
            </h2>
            <span className="cat-head__hint">
              الجرد يُنتج فروقاً؛ التسوية تُنشئ حركة بسبب وفاعل ومستند. ولا يوجد «قبول الكل» يمحو
              أثر عشرين فرقاً بضغطة واحدة.
            </span>
          </div>
          <div className="acc-card__body">
            {s ? (
              <div className="inv-head">
                <div>
                  <h3 className="cat-head__title">
                    جلسة جرد <span className="sting-mono">{ddmm(s.closed_at)}</span> —{" "}
                    <span className="sting-mono">{review?.variance_count ?? 0}</span> فروق من{" "}
                    <span className="sting-mono">{s.counted_items}</span> صنفاً
                  </h3>
                  <div className="acc-choice__note">
                    العدّ الفعلي محفوظ كما أُدخل. الرصيد لم يتغيّر بعد — يتغيّر عند التسوية فقط.
                  </div>
                </div>
                <span className="inv-head__chip">
                  <Status
                    state={effect < 0n ? "stale" : "synced"}
                    label={
                      <>
                        أثر التسوية{" "}
                        <span className="sting-mono">{formatMinor(effect.toString())}</span> SDG
                      </>
                    }
                    dot={false}
                  />
                </span>
              </div>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="locked" title="من يعدّ ليس من يسوّي">
                <p className="acc-lead">
                  أمين المخزن أدخل العدّ، والتسوية تحتاج صلاحية مالية. الفصل مقصود: لو عدّ وسوّى
                  الشخص نفسه صار النقص قابلاً للإخفاء بلا شاهد. يظهر له «أُرسلت الفروق للمراجعة» مع
                  نسخة من عدّه.
                </p>
                <Status state="pending_sync" label="أُرسلت الفروق للمراجعة" dot={false} />
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="error" title="فرق بلا سبب.">
                <p className="acc-lead">
                  لا نحفظ التسوية ولا نكتب «تسوية جرد» سبباً عامّاً — سبب الفرق هو الفرق الوحيد بين
                  تصحيح مشروع وإخفاء نقص. نعرض قائمة أسباب مقترحة (تالف، سرقة، خطأ عدّ، خطأ استلام)
                  مع حقل حرّ.
                </p>
              </Notice>
            ) : null}
            {state === "success" && done ? (
              <Notice
                kind="success"
                title={
                  <>
                    سُوّيت <span className="sting-mono">{done.line_count}</span> فروق — مستند{" "}
                    <span className="sting-mono">{done.adjustment_number}</span>
                  </>
                }
              >
                <p className="acc-lead">
                  الرصيد تغيّر بحركة لها مستند وفاعل وسبب، وتظهر في «حركات المخزون» كسطر «تسوية جرد»
                  لا كرصيد تغيّر بلا تفسير. العدّ الأصلي محفوظ كما أُدخل ولا يُعاد كتابته.
                </p>
              </Notice>
            ) : null}
            {localOnly ? (
              <Notice kind="offline" title="جرد بلا اتصال">
                <p className="acc-lead">
                  الحالة الطبيعية: المخازن بلا تغطية غالباً. العدّ محلي كاملاً.
                </p>
              </Notice>
            ) : null}

            <datalist id="inv-reasons">
              {(review?.suggested_reasons ?? []).map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <Table
              caption="فروق الجرد"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={review === undefined ? 3 : undefined}
            />

            <div className="cat-form__actions">
              {!done && !already ? (
                <Button
                  financial
                  pos
                  onClick={() => void adjust()}
                  loading={busy}
                  disabledReason={
                    localOnly
                      ? "التسوية أونلاين بعد رفع الجلسة"
                      : !canAdjust
                        ? "من يعدّ ليس من يسوّي"
                        : diffs.length === 0
                          ? "لا فروق"
                          : attempted && missing.length > 0
                            ? "السبب — مطلوب لكل صف"
                            : undefined
                  }
                >
                  تسوية الفروق
                </Button>
              ) : null}
              <Button variant="quiet" onClick={() => router.push("/inventory")}>
                أرصدة المخزون
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
