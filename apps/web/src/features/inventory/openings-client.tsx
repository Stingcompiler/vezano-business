"use client";

import { type LocalItem, readLocalItems } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  SelectField,
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
import { parseAmount } from "@/features/pos/use-sale";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

import { parseQtyInput, type UnitOption, unitOptions } from "./units";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface LineDraft {
  readonly key: string;
  readonly itemId: string;
  readonly unitKey: string;
  readonly qty: string;
  readonly cost: string;
}

interface OpeningLine {
  readonly id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_name: string;
  readonly factor_milli: string;
  readonly qty_milli: string;
  readonly base_qty_milli: string;
  readonly unit_cost_minor: string;
}

interface Opening {
  readonly id: string;
  readonly status: "submitted" | "approved";
  readonly created_by_name: string;
  readonly approved_by_name: string;
  readonly lines: readonly OpeningLine[];
  readonly line_count: number;
  readonly value_minor: string;
}

interface OpeningsData {
  readonly branch_id: string;
  readonly can_approve: boolean;
  readonly openings: readonly Opening[];
  readonly opened_item_ids: readonly string[];
  readonly moved_item_ids: readonly string[];
}

interface ServerError {
  readonly line: number;
  readonly field: string;
  readonly code: string;
}

/** صف المراجعة: الصنف والوحدة المُدخلة والكمية والتحويل الصريح إلى وحدة المخزون وملاحظته. */
interface ReviewRow {
  readonly key: string;
  readonly item: string;
  readonly unit: string;
  readonly qty: string;
  readonly base: string;
  readonly note: string;
  readonly bad: boolean;
}

const emptyLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  itemId: "",
  unitKey: "",
  qty: "",
  cost: "",
});

/**
 * INV-03 — افتتاحيات المخزون (28-D21 ready/permission_denied · 40-D32 validation_error/success):
 * مستند واحد يجمع الأصناف يُراجَع قبل الاعتماد — لا حركات متفرّقة؛ التحويل إلى وحدة المخزون معروض
 * صريحاً؛ لا نقبل تقديراً؛ تُعتمد مرة واحدة لكل صنف وقبل أول حركة (كما PTY-04)؛ الاعتماد يُنشئ
 * رصيداً فهو للمالك — أمين المخزن يُدخل ويرى «أُرسلت للاعتماد».
 */
export function OpeningsClient() {
  const router = useRouter();
  const app = useApp();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [data, setData] = useState<OpeningsData | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerError[]>([]);
  const [submitted, setSubmitted] = useState<Opening | null>(null);
  const [approved, setApproved] = useState<Opening | null>(null);
  const [denied, setDenied] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = async () => {
    try {
      const { data, response } = await api().GET("/api/inventory/openings", {});
      const body = data as unknown as OpeningsData | undefined;
      if (response.ok && body) setData(body);
    } catch {
      /* بلا اتصال: الإدخال ممكن والاعتماد أونلاين */
    }
  };

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory%2Fopenings");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [c, its] = await Promise.all([readShiftContext(storage, app), readLocalItems(storage)]);
      setCtx(c);
      setItems(its.filter((i) => i.is_active !== false));
      await load();
    })();
  }, [router]);

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const unitOf = (ln: LineDraft): UnitOption | undefined => {
    const it = itemOf(ln.itemId);
    if (!it) return undefined;
    const opts = unitOptions(it);
    return opts.find((u) => u.key === ln.unitKey) ?? opts[0];
  };

  const opened = new Set(data?.opened_item_ids ?? []);
  const moved = new Set(data?.moved_item_ids ?? []);
  const serverLineErrors = new Map<number, ServerError[]>();
  for (const e of serverErrors) {
    serverLineErrors.set(e.line, [...(serverLineErrors.get(e.line) ?? []), e]);
  }
  const hasMovementError = serverErrors.some(
    (e) => e.code === "has_movements" || e.code === "already_opened",
  );

  const review: ReviewRow[] = lines.map((ln, i) => {
    const it = itemOf(ln.itemId);
    const u = unitOf(ln);
    const q = parseQtyInput(ln.qty);
    const srv = serverLineErrors.get(i) ?? [];
    if (!it || !u) {
      return { key: ln.key, item: "—", unit: "—", qty: "—", base: "—", note: "", bad: false };
    }
    if (ln.qty.trim() && q === null) {
      return {
        key: ln.key,
        item: it.name,
        unit: u.name,
        qty: "—",
        base: "—",
        note: `أُدخل «${ln.qty.trim()}» — لا نقبل تقديراً في افتتاحية. نطلب رقماً أو نترك الصنف بلا افتتاحية ويُبنى رصيده من أول استلام.`,
        bad: true,
      };
    }
    if (srv.some((e) => e.code === "has_movements" || e.code === "already_opened")) {
      return {
        key: ln.key,
        item: it.name,
        unit: u.name,
        qty: q === null ? "—" : formatQty(q, u.decimalPlaces),
        base: "—",
        note: "افتتاحي على صنف له حركات — كما في «الرصيد الافتتاحي للطرف»: الافتتاحي مرة واحدة وقبل أول حركة.",
        bad: true,
      };
    }
    const factor = BigInt(u.factorMilli || "0");
    if (q === null) {
      return {
        key: ln.key,
        item: it.name,
        unit: u.name,
        qty: "—",
        base: "—",
        note: "",
        bad: false,
      };
    }
    const baseDp = it.base_unit_decimal_places ?? 0;
    if (factor === 1000n) {
      return {
        key: ln.key,
        item: it.name,
        unit: u.name,
        qty: formatQty(q, u.decimalPlaces),
        base: `${formatQty(q, baseDp)} ${it.base_unit_name}`,
        note: "وحدة الإدخال = وحدة المخزون. لا تحويل.",
        bad: false,
      };
    }
    const base = (q * factor) / 1000n;
    return {
      key: ln.key,
      item: it.name,
      unit: u.name,
      qty: formatQty(q, u.decimalPlaces),
      base: `${formatQty(base, baseDp)} ${it.base_unit_name}`,
      note: `التحويل معروض صريحاً: ${formatQty(q, u.decimalPlaces)} × ${formatQty(factor, baseDp)} = ${formatQty(base, baseDp)}. لا نخبّئ الحساب.`,
      bad: false,
    };
  });

  const errors: Record<string, string> = {};
  for (const ln of lines) {
    if (!ln.itemId) errors[`item:${ln.key}`] = "الصنف";
    const q = parseQtyInput(ln.qty);
    if (q === null || q <= 0n) errors[`qty:${ln.key}`] = "الكمية — رقم لا تقدير";
    const u = unitOf(ln);
    if (u && BigInt(u.factorMilli || "0") <= 0n) errors[`unit:${ln.key}`] = "المعامل غير محدَّد";
    if (ln.cost.trim() && parseAmount(ln.cost) === null) errors[`cost:${ln.key}`] = "التكلفة";
    if (opened.has(ln.itemId) || moved.has(ln.itemId))
      errors[`item:${ln.key}`] = "افتتاحي على صنف له حركات";
  }
  const invalid = Object.keys(errors).length > 0;
  const isOwner = data?.can_approve ?? ctx?.roleCode === "owner";

  const state: State = approved
    ? "success"
    : denied || submitted
      ? "permission_denied"
      : serverErrors.length > 0 || (attempted && invalid)
        ? "validation_error"
        : "ready";

  const send = async () => {
    if (!ctx || busy) return;
    setAttempted(true);
    if (invalid) return;
    setBusy(true);
    setServerErrors([]);
    try {
      const {
        data: res,
        error,
        response,
      } = await api().POST("/api/inventory/openings", {
        body: {
          branch_id: ctx.branchId,
          lines: lines.map((ln) => {
            const it = itemOf(ln.itemId)!;
            const u = unitOf(ln)!;
            const cost = ln.cost.trim() ? parseAmount(ln.cost) : null;
            return {
              item_id: it.id,
              unit_code: u.code,
              unit_name: u.name,
              factor_milli: u.factorMilli,
              qty_milli: (parseQtyInput(ln.qty) ?? 0n).toString(),
              unit_cost_minor: cost === null ? "" : cost.toString(),
            };
          }),
        },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.status === 400) {
        const errs = (error as { errors?: ServerError[] } | undefined)?.errors ?? [];
        setServerErrors(errs.length ? errs : [{ line: 0, field: "lines", code: "invalid" }]);
        return;
      }
      const body = res as unknown as { opening: Opening } | undefined;
      if (!response.ok || !body) return;
      if (body.opening.status === "approved") setApproved(body.opening);
      else setSubmitted(body.opening);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const approve = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const {
        data: res,
        error,
        response,
      } = await api().POST("/api/inventory/openings/{opening_id}/approve", {
        params: { path: { opening_id: id } },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.status === 400) {
        const errs = (error as { errors?: ServerError[] } | undefined)?.errors ?? [];
        setServerErrors(errs);
        return;
      }
      const body = res as unknown as { opening: Opening } | undefined;
      if (response.ok && body) setApproved(body.opening);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const update = (key: string, patch: Partial<LineDraft>) => {
    setServerErrors([]);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const reviewColumns = [
    { key: "item", header: "الصنف", render: (r: ReviewRow) => r.item },
    { key: "unit", header: "الوحدة المُدخلة", render: (r: ReviewRow) => r.unit },
    { key: "qty", header: "الكمية", mono: true, render: (r: ReviewRow) => r.qty },
    {
      key: "base",
      header: "بوحدة المخزون",
      render: (r: ReviewRow) => (
        <span className={r.bad ? "inv-review__bad" : "inv-review__base"}>
          {r.base === "—" ? (
            "—"
          ) : (
            <>
              <span className="sting-mono">{r.base.split(" ")[0]}</span>{" "}
              {r.base.split(" ").slice(1).join(" ")}
            </>
          )}
        </span>
      ),
    },
    {
      key: "note",
      header: "المراجعة",
      render: (r: ReviewRow) => (
        <span className={r.bad ? "inv-review__bad" : undefined}>{r.note}</span>
      ),
    },
  ];

  const pendingDocs = (data?.openings ?? []).filter((o) => o.status === "submitted");
  const filled = lines.filter((l) => l.itemId).length;
  const doc = approved ?? submitted;

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={Boolean(isOwner)} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">افتتاحية المخزون — مراجعة قبل الاعتماد</h2>
            <span className="cat-head__hint">
              تُعتمد مرة واحدة لكل صنف. بعدها أي تغيير يكون جرداً أو تسوية بسبب، لا تعديل افتتاحية.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && doc ? (
              <>
                <Notice kind="success" title="سُجّلت الافتتاحيات">
                  <p className="acc-lead">
                    عدد الأصناف والكميات وقيمتها، ومستندٌ واحد يجمعها قابل للطباعة والمراجعة.
                  </p>
                  <p className="acc-choice__note">
                    <strong>مستند لا حركات متفرّقة</strong> · ليُراجَع ويُتراجع عنه كوحدة.
                    افتتاحياتٌ مبثوثة لا يُعرف أيّها كان معاً.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">عدد الأصناف</span>
                    <span className="shift-facts__v sting-mono">{doc.line_count}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">القيمة</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(doc.value_minor)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المعتمد</span>
                    <span className="shift-facts__v">{doc.approved_by_name || "—"}</span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button pos onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                  <Button variant="secondary" onClick={() => window.print()}>
                    طباعة
                  </Button>
                </div>
              </>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="locked" title="أُرسلت للاعتماد">
                <p className="acc-lead">
                  أمين المخزن يُدخل الافتتاحيات ولا يعتمدها. الاعتماد يُنشئ رصيداً يُحسب عليه كل شيء
                  بعده، فهو صلاحية المالك أو من فوّضه. يظهر للأمين «أُرسلت للاعتماد» لا زرّ رمادي
                  بلا تفسير.
                </p>
                {submitted ? (
                  <p className="acc-choice__note">
                    مسودة — <span className="sting-mono">{submitted.line_count}</span> صنفاً ·{" "}
                    {submitted.created_by_name}
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {state === "validation_error" && hasMovementError ? (
              <Notice kind="error" title="افتتاحي على صنف له حركات">
                <p className="acc-lead">
                  كما في «الرصيد الافتتاحي للطرف»: الافتتاحي مرة واحدة وقبل أول حركة.
                </p>
                <p className="acc-choice__note">
                  <strong>المخرج</strong> · تسوية جرد بسبب مكتوب — وهي الطريق الصحيح لتصحيح رصيد له
                  تاريخ.
                </p>
              </Notice>
            ) : null}

            {!doc ? (
              <>
                {isOwner && pendingDocs.length > 0 ? (
                  <div className="cat-table">
                    <div className="cat-head">
                      <h3 className="cat-head__title">
                        مسودة —{" "}
                        {pendingDocs.length === 1 ? "مستند واحد" : `${pendingDocs.length} مستندات`}
                      </h3>
                    </div>
                    {pendingDocs.map((o) => (
                      <div key={o.id} className="pty-dupe">
                        <span>
                          <Status state="pending_sync" label="أُرسلت للاعتماد" dot={false} />{" "}
                          <span className="sting-mono">{o.line_count}</span> صنفاً ·{" "}
                          {o.created_by_name}
                        </span>
                        <span className="pty-actions">
                          <Button financial onClick={() => void approve(o.id)} loading={busy}>
                            اعتماد
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {lines.map((ln, idx) => {
                  const it = itemOf(ln.itemId);
                  const u = unitOf(ln);
                  return (
                    <div key={ln.key} className="inv-line">
                      <SelectField
                        label="الصنف"
                        value={ln.itemId}
                        onChange={(e) => update(ln.key, { itemId: e.target.value, unitKey: "" })}
                        options={[
                          { value: "", label: "—" },
                          ...items.map((i) => ({ value: i.id, label: i.name })),
                        ]}
                        error={attempted ? errors[`item:${ln.key}`] : undefined}
                        required
                      />
                      <SelectField
                        label="الوحدة المُدخلة"
                        value={u?.key ?? ""}
                        onChange={(e) => update(ln.key, { unitKey: e.target.value })}
                        options={
                          it
                            ? unitOptions(it).map((o) => ({
                                value: o.key,
                                label:
                                  BigInt(o.factorMilli || "0") > 0n
                                    ? o.name
                                    : `${o.name} — المعامل غير محدَّد`,
                              }))
                            : [{ value: "", label: "—" }]
                        }
                        error={attempted ? errors[`unit:${ln.key}`] : undefined}
                      />
                      <TextField
                        label="الكمية"
                        value={ln.qty}
                        onChange={(e) => update(ln.key, { qty: e.target.value })}
                        error={attempted ? errors[`qty:${ln.key}`] : undefined}
                        required
                      />
                      <TextField
                        label="التكلفة — اختياري"
                        mono
                        value={ln.cost}
                        onChange={(e) => update(ln.key, { cost: e.target.value })}
                        hint="يدوية — تُستبدل بأول مستند شراء حقيقي"
                        error={attempted ? errors[`cost:${ln.key}`] : undefined}
                      />
                      {lines.length > 1 ? (
                        <Button
                          variant="quiet"
                          onClick={() => setLines((ls) => ls.filter((l) => l.key !== ln.key))}
                        >
                          حذف السطر {idx + 1}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                <div className="cat-form__actions">
                  <Button
                    variant="secondary"
                    onClick={() => setLines((ls) => [...ls, emptyLine()])}
                  >
                    صنف آخر
                  </Button>
                </div>

                <div className="inv-head">
                  <h3 className="cat-head__title">المراجعة</h3>
                  <span className="inv-head__chip">
                    <Status
                      state="pending_sync"
                      label={
                        <>
                          مسودة — <span className="sting-mono">{filled}</span> صنفاً
                        </>
                      }
                      dot={false}
                    />
                  </span>
                </div>
                <Table
                  caption="مراجعة الافتتاحية"
                  columns={reviewColumns}
                  rows={review}
                  rowKey={(r) => r.key}
                />
                <p className="acc-choice__note">
                  <strong>التكلفة</strong> · الافتتاحي يحمل تكلفةً تُدخَل يدوياً وتُوسم «يدوية»،
                  وتُستبدل بأول مستند شراء حقيقي.
                </p>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void send()}
                    loading={busy}
                    disabledReason={attempted && invalid ? "أكمل الحقول المطلوبة" : undefined}
                  >
                    {isOwner ? "اعتماد الافتتاحية" : "إرسال للاعتماد"}
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
