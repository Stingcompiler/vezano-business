"use client";

import {
  type LocalSale,
  type LocalShift,
  readOpenShift,
  readReturnedQty,
  readSale,
  type ReturnCondition,
  type ReturnDestination,
  returnTotals,
  saleFromServer,
  saveReturnLocally,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  RadioGroupField,
  SyncIndicator,
  Table,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import { hhmm } from "@/features/home/format";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { PosNav } from "./pos-nav";
import { today } from "./use-sale";

type State =
  "ready" | "partial" | "validation_error" | "permission_denied" | "saved_local" | "success";

/**
 * سقف الردّ النقدي بحسب الدور (G-09 مؤقتاً حتى ORG-02): «المرتجع يُخرج نقداً من الصندوق، وحدّه
 * المالي حدّ الدور». الخصم من الذمّة حدّه أوسع («الوجهة تغيّر الحكم») — القيم من عندي (0005 §٢٣).
 */
const CASH_REFUND_CAP_MINOR: Record<string, bigint> = {
  cashier: 20000n,
  manager: 500000n,
};
const CREDIT_REFUND_CAP_MINOR: Record<string, bigint> = {
  cashier: 100000n,
  manager: 2000000n,
};

interface RowState {
  readonly line: LocalSale["lines"][number];
  readonly sold: bigint;
  readonly returned: bigint;
  readonly available: bigint;
  readonly now: bigint;
}

const trimQty = (milli: bigint | string, dp: number) =>
  formatQty(milli.toString(), dp as 0 | 1 | 2 | 3)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");

/**
 * POS-10 — مرتجع كلي أو جزئي (03-D2 partial · 42-D34 ready/validation_error/permission_denied/
 * saved_local/success): من الفاتورة الأصل، كل سطر يعرض المُباع والمُرتجَع سابقاً والمتاح ردّه
 * (السقف تراكمي — ACC-11)؛ حالة البضاعة تُسأل (صالحة → المخزون، تالفة → الحجر — ACC-10)؛ وجهة
 * الردّ معلنة؛ مستند مستقل لا يمحو الأصل (ACC-09، القاعدة 8).
 */
export function ReturnClient({ saleId }: { saleId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [sale, setSale] = useState<LocalSale | null | undefined>(undefined);
  const [saleOpId, setSaleOpId] = useState<string | undefined>(undefined);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [returned, setReturned] = useState<Map<string, bigint>>(new Map());
  const [qty, setQty] = useState<Map<string, bigint>>(new Map());
  const [condition, setCondition] = useState<ReturnCondition>("good");
  const [destination, setDestination] = useState<ReturnDestination>("cash");
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<{ number: string; total: string } | null>(null);
  const [overTyped, setOverTyped] = useState<string | null>(null);
  const ids = useRef<{
    operationId: string;
    returnId: string;
    lines: string[];
    movements: string[];
  } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/pos/invoices/${saleId}/return`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [s, c, local, ret] = await Promise.all([
        readOpenShift(storage),
        readShiftContext(storage, app),
        readSale(storage, saleId),
        readReturnedQty(storage, saleId),
      ]);
      setShift(s);
      setCtx(c);
      if (local) {
        // معامل الوحدة من حدث البيع إن غاب عن الإسقاط القديم
        const op = await storage.read((tx) => tx.getOperation(local.operation_id));
        const factors = new Map<string, string>();
        for (const m of op?.members ?? [])
          if (m.entity === "sales.SaleLine")
            factors.set(
              m.id,
              typeof m.payload["factor_milli"] === "string" ? m.payload["factor_milli"] : "1000",
            );
        setSale({
          ...local,
          lines: local.lines.map((l) => ({
            ...l,
            factor_milli: l.factor_milli ?? factors.get(l.id) ?? "1000",
          })),
        });
        setSaleOpId(op ? local.operation_id : undefined);
        setReturned(ret);
        return;
      }
      if (!navigator.onLine) {
        setSale(null);
        return;
      }
      try {
        const { data, response } = await api().GET("/api/sales/{sale_id}", {
          params: { path: { sale_id: saleId } },
        });
        const body = data as unknown as
          | (Parameters<typeof saleFromServer>[0] & {
              lines: readonly { id: string; returned_qty_milli: string }[];
            })
          | undefined;
        if (!response.ok || !body) {
          setSale(null);
          return;
        }
        setSale(saleFromServer(body));
        const fromServer = new Map<string, bigint>();
        for (const l of body.lines) fromServer.set(l.id, BigInt(l.returned_qty_milli ?? "0"));
        // المُرتجَع سابقاً = خادمياً + ما على هذا الجهاز ولم يُرفع
        for (const [k, v] of ret) fromServer.set(k, (fromServer.get(k) ?? 0n) + v);
        setReturned(fromServer);
      } catch {
        setSale(null);
      }
    })();
  }, [router, saleId]);

  useEffect(() => {
    if (sale === null || shift === null) router.replace(`/pos/invoices/${saleId}`);
  }, [router, sale, saleId, shift]);

  const rows: RowState[] = (sale?.lines ?? []).map((l) => {
    const sold = BigInt(l.qty_milli);
    const r = returned.get(l.id) ?? 0n;
    return {
      line: l,
      sold,
      returned: r,
      available: sold - r > 0n ? sold - r : 0n,
      now: qty.get(l.id) ?? 0n,
    };
  });
  const active = rows.filter((r) => r.now > 0n);
  const totals =
    sale && active.length
      ? returnTotals(
          sale,
          active.map((r) => ({ saleLineId: r.line.id, qtyMilli: r.now.toString() })),
        )
      : null;
  const total = totals?.totalMinor ?? 0n;
  const allAvailable = rows.reduce((a, r) => a + r.available, 0n);
  const chosen = rows.reduce((a, r) => a + r.now, 0n);
  const exceeds = rows.some((r) => r.now > r.available);
  const role = ctx?.roleCode ?? "cashier";
  const isOwner = ctx?.roleName === "مالك" || role === "owner";
  const cap = isOwner
    ? null
    : ((destination === "cash" ? CASH_REFUND_CAP_MINOR : CREDIT_REFUND_CAP_MINOR)[role] ?? null);
  const overCap = cap !== null && total > cap;
  const creditNoParty = destination === "credit" && !sale?.party_id;

  const state: State =
    phase === "saved"
      ? push === "synced"
        ? "success"
        : "saved_local"
      : exceeds || overTyped !== null
        ? "validation_error"
        : overCap
          ? "permission_denied"
          : chosen > 0n && chosen < allAvailable
            ? "partial"
            : "ready";

  // الخطوة وحدة كاملة (الإطار يعدّ بالقطع)؛ الكسور تُردّ كاملةً في آخر خطوة
  const step = (r: RowState, dir: 1 | -1) => {
    let next = r.now + BigInt(dir) * 1000n;
    if (dir === 1 && next > r.available && r.now < r.available) next = r.available;
    if (next < 0n) next = 0n;
    // «الكمية المرتجعة لا تتجاوز المُباع ناقص المُرتجَع سابقاً» — الزرّ يقف عند السقف
    if (next > r.available) {
      setOverTyped(r.line.id);
      return;
    }
    setOverTyped(null);
    setQty((m) => new Map(m).set(r.line.id, next));
  };

  const commit = async () => {
    if (!sale || !shift || !ctx || phase !== "idle" || !active.length) return;
    if (exceeds || overCap || creditNoParty) return;
    setPhase("saving");
    if (!ids.current)
      ids.current = {
        operationId: crypto.randomUUID(),
        returnId: crypto.randomUUID(),
        lines: active.map(() => crypto.randomUUID()),
        movements: active.map(() => crypto.randomUUID()),
      };
    const { ret } = await saveReturnLocally(getStorage(), {
      operationId: ids.current.operationId,
      returnId: ids.current.returnId,
      sale,
      saleOperationId: saleOpId,
      lines: active.map((r) => ({ saleLineId: r.line.id, qtyMilli: r.now.toString() })),
      condition,
      destination,
      shift,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      businessDate: shift.business_date || today(),
      occurredAt: new Date().toISOString(),
      memberIds: { lines: ids.current.lines, movements: ids.current.movements },
    });
    setSaved({ number: ret.return_number, total: ret.total_minor });
    if (!online) {
      setPush("pending");
      setPhase("saved");
      return;
    }
    try {
      const out = await pushPending();
      setPush(
        out.kind === "applied" || out.kind === "idle"
          ? "synced"
          : out.kind === "retry"
            ? "failed"
            : "pending",
      );
    } catch {
      setPush("failed");
    } finally {
      setPhase("saved");
    }
  };

  const columns = [
    {
      key: "item",
      header: "الصنف",
      render: (r: RowState) => (
        <div>
          <div>{r.line.item_name}</div>
          <div className="acc-choice__note">
            المتاح <span className="sting-mono">{trimQty(r.available, r.line.decimal_places)}</span>{" "}
            {r.line.unit_code}
          </div>
        </div>
      ),
    },
    {
      key: "sold",
      header: "مُباع",
      mono: true,
      render: (r: RowState) => trimQty(r.sold, r.line.decimal_places),
    },
    {
      key: "returned",
      header: "مُرتجَع سابقاً",
      mono: true,
      render: (r: RowState) => trimQty(r.returned, r.line.decimal_places),
    },
    {
      key: "now",
      header: "الكمية المرتجعة الآن",
      render: (r: RowState) => (
        <span className="pos-ret__step">
          <Button
            variant="icon"
            iconLabel={`إنقاص ${r.line.item_name}`}
            icon={<span aria-hidden="true">−</span>}
            onClick={() => step(r, -1)}
            disabledReason={phase !== "idle" ? "انتظر اكتمال الحفظ" : undefined}
          />
          <span className="sting-mono pos-ret__qty">{trimQty(r.now, r.line.decimal_places)}</span>
          <Button
            variant="icon"
            iconLabel={`زيادة ${r.line.item_name}`}
            icon={<span aria-hidden="true">+</span>}
            onClick={() => step(r, 1)}
            disabledReason={phase !== "idle" ? "انتظر اكتمال الحفظ" : undefined}
          />
        </span>
      ),
    },
  ];

  const overRow =
    rows.find((r) => r.line.id === overTyped) ?? rows.find((r) => r.now > r.available);

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="invoices" canSeeReports={isOwner} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {sale ? (
                <>
                  مرتجع على الفاتورة <span className="sting-mono">{sale.invoice_number}</span>
                </>
              ) : (
                "مرتجع كلي أو جزئي"
              )}
            </h2>
            <span className="cat-head__hint">الأصل يبقى كما هو؛ هذا مستند مرتجع مستقل</span>
          </div>
          <div className="acc-card__body">
            {sale && phase !== "saved" ? (
              <>
                <Notice kind="info" title="من الفاتورة الأصل">
                  <p className="acc-lead">
                    المرتجع يبدأ باختيار الأصل، وكل سطر يعرض المباع والمرتَجع سابقاً والمتاح رده.
                  </p>
                  <p className="acc-choice__note">
                    <strong>السقف معروض</strong> · «بيع 5 — رُدّ 2 — المتاح 3». بلا هذا العمود
                    يُكتشف التجاوز عند الخطأ لا قبله.
                  </p>
                </Notice>

                <Table
                  caption="سطور الأصل"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.line.id}
                />

                {state === "validation_error" && overRow ? (
                  <Notice kind="error" title="كمية تتجاوز المتاح">
                    <p className="acc-lead">
                      ردّ{" "}
                      <span className="sting-mono">
                        {trimQty(
                          overRow.now > overRow.available ? overRow.now : overRow.available + 1000n,
                          overRow.line.decimal_places,
                        )}
                      </span>{" "}
                      والمتاح{" "}
                      <span className="sting-mono">
                        {trimQty(overRow.available, overRow.line.decimal_places)}
                      </span>
                      .
                    </p>
                    <p className="acc-lead">
                      <strong>الأصل ناقص المردود</strong> · السقف تراكمي عبر كل مرتجعات الفاتورة
                      (ACC-11) — وإلا صار المرتجع باباً لإخراج نقدٍ بلا بضاعة.
                    </p>
                  </Notice>
                ) : null}

                <RadioGroupField
                  label="حالة البضاعة"
                  name="cond"
                  value={condition}
                  onChange={(v) => setCondition(v as ReturnCondition)}
                  options={[
                    { value: "good", label: "صالحة — تعود للمخزون" },
                    { value: "damaged", label: "تالفة — إلى الحجر أو الهالك" },
                  ]}
                />
                <p className="acc-choice__note">
                  <strong>حالة البضاعة تُسأل</strong> · صالحة تعود للمخزون؛ تالفة إلى حجر أو هالك
                  (ACC-10) — لا تدخل المتاح للبيع.
                </p>
                <RadioGroupField
                  label="وجهة الرد"
                  name="dest"
                  value={destination}
                  onChange={(v) => {
                    setDestination(v as ReturnDestination);
                  }}
                  options={[
                    { value: "cash", label: "نقداً من الصندوق" },
                    {
                      value: "credit",
                      label: "خصماً من ذمة العميل",
                      ...(sale.party_id ? {} : { hint: "عميل مسمّى — شرط الأثر الآجل" }),
                    },
                  ]}
                  error={creditNoParty ? "عميل مسمّى — شرط الأثر الآجل" : undefined}
                />

                {state === "permission_denied" ? (
                  <Notice kind="locked" title="ردّ نقدي فوق الحدّ">
                    <p className="acc-lead">
                      المرتجع يُخرج نقداً من الصندوق، وحدّه المالي حدّ الدور (G-09).
                    </p>
                    <p className="acc-lead">
                      <strong>الوجهة تغيّر الحكم</strong> · الرد إلى ذمّة الطرف تخفيضُ دينٍ يحتمل
                      حدّاً أوسع؛ إخراج النقد أضيق. الحدّان منفصلان في ORG-02.
                    </p>
                    <p className="acc-choice__note">
                      الحدّ{" "}
                      <span className="sting-mono">{formatMinor((cap ?? 0n).toString())}</span> ·
                      قيمة المرتجع{" "}
                      <span className="sting-mono">{formatMinor(total.toString())}</span>
                    </p>
                  </Notice>
                ) : null}

                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">قيمة المرتجع</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(total.toString())}
                    </span>
                  </div>
                </div>
                <p className="acc-choice__note">
                  الكمية المرتجعة لا تتجاوز <strong>المُباع ناقص المُرتجَع سابقاً</strong>.
                  {rows[0] ? (
                    <>
                      {" "}
                      المتاح لـ{rows[0].line.item_name} الآن{" "}
                      <span className="sting-mono">
                        {trimQty(rows[0].available, rows[0].line.decimal_places)}
                      </span>{" "}
                      لا{" "}
                      <span className="sting-mono">
                        {trimQty(rows[0].sold, rows[0].line.decimal_places)}
                      </span>
                      .
                    </>
                  ) : null}
                </p>

                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void commit()}
                    loading={phase === "saving"}
                    disabledReason={
                      !active.length
                        ? "اختر كمية"
                        : exceeds || overTyped
                          ? "كمية تتجاوز المتاح"
                          : overCap
                            ? "ردّ نقدي فوق الحدّ"
                            : creditNoParty
                              ? "عميل مسمّى — شرط الأثر الآجل"
                              : undefined
                    }
                  >
                    تسجيل المرتجع
                  </Button>
                  <Button variant="quiet" onClick={() => router.push(`/pos/invoices/${saleId}`)}>
                    الفاتورة
                  </Button>
                </div>
              </>
            ) : null}

            {sale && phase === "saved" && saved ? (
              <>
                {state === "success" ? (
                  <Notice kind="success" title="سُجّل المرتجع">
                    <p className="acc-lead">
                      مستندٌ مستقل يشير إلى أصله، والأصل باقٍ كما كان (ACC-09).
                    </p>
                    <p className="acc-lead">
                      <strong>وجهة الرد معلنة</strong> · نقدٌ من الصندوق، أو تخفيض ذمّة، والتالف إلى
                      الحجر — الثلاثة في شاشة النجاح لا في افتراض القارئ.
                    </p>
                  </Notice>
                ) : (
                  <Notice kind="offline" title="مرتجع بلا اتصال">
                    <p className="acc-lead">محفوظ محلياً، والنقد خرج من الصندوق فعلاً.</p>
                    <p className="acc-lead">
                      <strong>الصندوق لا ينتظر</strong> · حركة الصندوق تُقيَّد لحظتها محلياً
                      (SHIFT-02) — العدّ في الإغلاق يطابق الواقع لا المزامنة.
                    </p>
                  </Notice>
                )}
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">رقم المرتجع</span>
                    <span className="shift-facts__v sting-mono">{saved.number}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الأصل</span>
                    <span className="shift-facts__v sting-mono">{sale.invoice_number}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">قيمة المرتجع</span>
                    <span className="shift-facts__v sting-mono">{formatMinor(saved.total)}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">وجهة الرد</span>
                    <span className="shift-facts__v">
                      {destination === "cash" ? "نقداً من الصندوق" : "خصماً من ذمة العميل"}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">حالة البضاعة</span>
                    <span className="shift-facts__v">
                      {condition === "good"
                        ? "صالحة — تعود للمخزون"
                        : "تالفة — إلى الحجر أو الهالك"}
                    </span>
                  </div>
                </div>
                <SyncIndicator
                  state={!online ? "offline" : push === "synced" ? "synced" : "pending_sync"}
                  lastServerAt={push === "synced" ? hhmm(new Date().toISOString()) : null}
                  pendingCount={push === "synced" ? 0 : 1}
                  pendingLabel={(n) =>
                    n === 1 ? "عملية واحدة معلقة من هذا الجهاز" : `${n} عمليات معلقة من هذا الجهاز`
                  }
                />
                <div className="cat-form__actions">
                  <Button onClick={() => router.push(`/pos/invoices/${saleId}`)} pos>
                    الفاتورة
                  </Button>
                  <Button variant="secondary" onClick={() => router.push("/pos")} pos>
                    بيع جديد
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
