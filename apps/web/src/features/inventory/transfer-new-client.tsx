"use client";

import {
  type LocalItem,
  type LocalTransfer,
  readLocalBalances,
  readLocalItems,
  saveTransferLocally,
} from "@sting/sync-core";
import {
  Button,
  formatQty,
  Frame,
  Notice,
  SelectField,
  SyncIndicator,
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
import { hhmm } from "@/features/home/format";
import { PosNav } from "@/features/pos/pos-nav";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { TransferCard, type TransferView } from "./transfer-card";
import { parseQtyInput, type UnitOption, unitOptions } from "./units";

type State = "ready" | "validation_error" | "saving" | "saved_local" | "success" | "partial";

interface LineDraft {
  readonly key: string;
  readonly itemId: string;
  readonly unitKey: string;
  readonly qty: string;
}

interface Row {
  readonly key: string;
  readonly item: LocalItem | undefined;
  readonly unit: UnitOption | undefined;
  readonly qtyMilli: bigint | null;
  readonly baseMilli: bigint | null;
  readonly availableMilli: bigint | null;
  readonly exceedsBy: bigint;
}

const emptyLine = (): LineDraft => ({ key: crypto.randomUUID(), itemId: "", unitKey: "", qty: "" });

/**
 * INV-09 — إنشاء وإرسال تحويل (28-D21 ready/validation_error/success · 40-D32 saving/saved_local ·
 * 14-D9 partial): مستند خروج يخصم من المُرسل ولا يضيف للمستقبِل — «في الطريق» طور ثالث حقيقي حتى
 * استلام مستقلّ (INV-10)؛ لا نسمح بتحويل ما ليس موجوداً حتى لو كان في الطريق إلى المصدر؛ يُحفظ
 * محلياً ثم يُعلَم الفرع المستقبل بالمزامنة.
 */
export function TransferNewClient({ viewId }: { viewId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [balances, setBalances] = useState<Map<string, { qty_milli: string }>>(new Map());
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [toId, setToId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<LocalTransfer | null>(null);
  const [viewed, setViewed] = useState<TransferView | null>(null);
  const ids = useRef<{ operationId: string; transferId: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory%2Ftransfers%2Fnew");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [c, its, bal] = await Promise.all([
        readShiftContext(storage, app),
        readLocalItems(storage),
        readLocalBalances(storage),
      ]);
      setCtx(c);
      setItems(its.filter((i) => i.is_active !== false));
      setBalances(bal);
      try {
        const { data, response } = await api().GET("/api/inventory/transfers", {});
        const body = data as unknown as { branches: { id: string; name: string }[] } | undefined;
        if (response.ok && body) setBranches(body.branches);
      } catch {
        /* بلا اتصال: الفروع من آخر مرة غير محفوظة — الإرسال محلياً يحتاج وجهة معروفة */
      }
      if (viewId) {
        try {
          const { data, response } = await api().GET("/api/inventory/transfers/{transfer_id}", {
            params: { path: { transfer_id: viewId } },
          });
          const body = data as unknown as { transfer: TransferView } | undefined;
          if (response.ok && body) setViewed(body.transfer);
        } catch {
          /* يبقى نموذج الإنشاء */
        }
      }
    })();
  }, [router, viewId]);

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const rows: Row[] = lines.map((ln) => {
    const item = itemOf(ln.itemId);
    const opts = item ? unitOptions(item) : [];
    const unit = opts.find((u) => u.key === ln.unitKey) ?? opts[0];
    const q = parseQtyInput(ln.qty);
    const factor = unit ? BigInt(unit.factorMilli || "0") : 0n;
    const base = q !== null && factor > 0n ? (q * factor) / 1000n : null;
    const b = item ? balances.get(item.id) : undefined;
    const available = b ? BigInt(b.qty_milli) : null;
    const exceedsBy =
      base !== null && available !== null && base > available ? base - available : 0n;
    return {
      key: ln.key,
      item,
      unit,
      qtyMilli: q,
      baseMilli: base,
      availableMilli: available,
      exceedsBy,
    };
  });
  const anyExceeds = rows.some((r) => r.exceedsBy > 0n);
  const errors: Record<string, string> = {};
  if (!toId) errors["to"] = "إلى";
  if (ctx && toId === ctx.branchId) errors["to"] = "فرع آخر";
  for (const r of rows) {
    if (!r.item) errors[`item:${r.key}`] = "الصنف";
    if (r.qtyMilli === null || r.qtyMilli <= 0n) errors[`qty:${r.key}`] = "كمية التحويل";
    if (r.unit && BigInt(r.unit.factorMilli || "0") <= 0n)
      errors[`unit:${r.key}`] = "المعامل غير محدَّد";
    if (r.exceedsBy > 0n) errors[`qty:${r.key}`] = "يتجاوز المتاح";
  }
  const invalid = Object.keys(errors).length > 0;
  const totalBase = rows.reduce((a, r) => a + (r.baseMilli ?? 0n), 0n);
  const toName = branches.find((b) => b.id === toId)?.name ?? "";

  const state: State = viewed
    ? viewed.status === "partially_received"
      ? "partial"
      : "ready"
    : phase === "saving"
      ? "saving"
      : phase === "saved"
        ? push === "synced"
          ? "success"
          : "saved_local"
        : anyExceeds || (attempted && invalid)
          ? "validation_error"
          : "ready";

  const send = async () => {
    if (!ctx || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    if (!ids.current)
      ids.current = { operationId: crypto.randomUUID(), transferId: crypto.randomUUID() };
    const { transfer } = await saveTransferLocally(getStorage(), {
      operationId: ids.current.operationId,
      transferId: ids.current.transferId,
      branchFromId: ctx.branchId,
      branchFromName: ctx.branchName,
      branchToId: toId,
      branchToName: toName,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      lines: rows.map((r) => ({
        lineId: crypto.randomUUID(),
        movementId: crypto.randomUUID(),
        itemId: r.item!.id,
        itemName: r.item!.name,
        unitCode: r.unit!.code,
        unitName: r.unit!.name,
        factorMilli: r.unit!.factorMilli,
        qtyMilli: (r.qtyMilli ?? 0n).toString(),
        availableMilli: (r.availableMilli ?? 0n).toString(),
      })),
      sentAt: new Date().toISOString(),
    });
    setSaved(transfer);
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

  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const columns = [
    {
      key: "item",
      header: "الصنف",
      render: (r: Row) => (
        <div>
          <SelectField
            label="الصنف"
            value={r.item?.id ?? ""}
            onChange={(e) => update(r.key, { itemId: e.target.value, unitKey: "" })}
            options={[
              { value: "", label: "—" },
              ...items.map((i) => ({ value: i.id, label: i.name })),
            ]}
            error={attempted ? errors[`item:${r.key}`] : undefined}
          />
          {r.item ? (
            <SelectField
              label="الوحدة"
              value={r.unit?.key ?? ""}
              onChange={(e) => update(r.key, { unitKey: e.target.value })}
              options={unitOptions(r.item).map((u) => ({ value: u.key, label: u.name }))}
              error={attempted ? errors[`unit:${r.key}`] : undefined}
            />
          ) : null}
        </div>
      ),
    },
    {
      key: "avail",
      header: "متاح بالمصدر",
      render: (r: Row) =>
        r.item && r.availableMilli !== null ? (
          <span className="sting-mono">
            {formatQty(r.availableMilli, r.item.base_unit_decimal_places ?? 0)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "qty",
      header: "كمية التحويل",
      render: (r: Row) => (
        <TextField
          label="كمية التحويل"
          mono
          value={lines.find((l) => l.key === r.key)?.qty ?? ""}
          onChange={(e) => update(r.key, { qty: e.target.value })}
          error={attempted && !r.exceedsBy ? errors[`qty:${r.key}`] : undefined}
        />
      ),
    },
    {
      key: "check",
      header: "التحقّق",
      render: (r: Row) => {
        if (!r.item || r.baseMilli === null || r.availableMilli === null) return "—";
        const dp = r.item.base_unit_decimal_places ?? 0;
        return r.exceedsBy > 0n ? (
          <span className="inv-review__bad">
            يتجاوز المتاح بـ<span className="sting-mono">{formatQty(r.exceedsBy, dp)}</span>. الأقصى{" "}
            <span className="sting-mono">{formatQty(r.availableMilli, dp)}</span> — الإرسال موقوف.
          </span>
        ) : (
          "ضمن المتاح."
        );
      },
    },
  ];

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={ctx?.roleCode === "owner"} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              إنشاء وإرسال تحويل — البضاعة في الطريق ليست في أي فرع
            </h2>
            <span className="cat-head__hint">
              مستند خروج يخصم من المُرسل ولا يضيف للمستقبِل. الكمية تصبح «في الطريق» حتى استلام
              مستقلّ (INV-10) — بلا زيادة مزدوجة.
            </span>
          </div>
          <div className="acc-card__body">
            {viewed ? (
              <>
                <TransferCard t={viewed} pending={false} />
                <div className="cat-form__actions">
                  <Button variant="quiet" onClick={() => router.push("/inventory/transfers")}>
                    قائمة التحويلات
                  </Button>
                </div>
              </>
            ) : null}

            {!viewed && phase !== "saved" ? (
              <>
                <div className="inv-line">
                  <div>
                    <div className="acc-choice__note">من</div>
                    <div className="pty-merge__name">{ctx?.branchName ?? "—"}</div>
                  </div>
                  <SelectField
                    label="إلى"
                    value={toId}
                    onChange={(e) => setToId(e.target.value)}
                    options={[
                      { value: "", label: "—" },
                      ...branches
                        .filter((b) => b.id !== ctx?.branchId)
                        .map((b) => ({ value: b.id, label: b.name })),
                    ]}
                    error={attempted ? errors["to"] : undefined}
                    required
                  />
                </div>
                <Table caption="سطور التحويل" columns={columns} rows={rows} rowKey={(r) => r.key} />
                <div className="cat-form__actions">
                  <Button
                    variant="secondary"
                    onClick={() => setLines((ls) => [...ls, emptyLine()])}
                  >
                    صنف آخر
                  </Button>
                </div>
                {anyExceeds ? (
                  <Notice kind="error" title="طُلب تحويل أكثر من المتاح">
                    <p className="acc-lead">
                      لا نسمح بتحويل ما ليس موجوداً حتى لو كان في الطريق إلى المصدر — البضاعة
                      تُحوَّل بعد وصولها لا قبله.
                    </p>
                  </Notice>
                ) : null}
                <div className="inv-ledger inv-ledger--in">
                  <div className="pty-merge__role">أثر الإرسال — ثلاثة أرقام لا رقمان</div>
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">{ctx?.branchName ?? "المصدر"}</span>
                      <span className="shift-facts__v sting-mono inv-delta--out">
                        −{formatQty(totalBase, 0)}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">في الطريق</span>
                      <span className="shift-facts__v sting-mono">+{formatQty(totalBase, 0)}</span>
                    </div>
                    <div>
                      <span className="shift-facts__k">{toName || "إلى"}</span>
                      <span className="shift-facts__v">
                        <span className="sting-mono">0</span> — حتى الاستلام
                      </span>
                    </div>
                  </div>
                  <p className="acc-choice__note">
                    «في الطريق» طور ثالث حقيقي. بلا هذا الطور إمّا تختفي البضاعة من الدفتر أو تُحسب
                    مرتين — والاثنان خطأ يظهر عند أول جرد.
                  </p>
                </div>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void send()}
                    loading={phase === "saving"}
                    disabledReason={
                      anyExceeds
                        ? "الإرسال موقوف"
                        : attempted && invalid
                          ? "أكمل الحقول المطلوبة"
                          : undefined
                    }
                  >
                    إرسال التحويل
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory/transfers")}>
                    قائمة التحويلات
                  </Button>
                </div>
              </>
            ) : null}

            {state === "saving" ? (
              <Notice kind="info" title="جارٍ الإرسال">
                <p className="acc-lead">
                  الحفظ والإرسال فعلان: يُحفظ التحويل ثم يُعلَم الفرع المستقبل.
                </p>
                <p className="acc-choice__note">
                  <strong>لو فشل الإعلام</strong> · التحويل محفوظ ومُعلَّم «لم يُعلَم» بزرّ إعادة.
                  البضاعة قد خرجت فعلاً من الرفّ.
                </p>
              </Notice>
            ) : null}

            {phase === "saved" && saved ? (
              <>
                {state === "success" ? (
                  <Notice
                    kind="success"
                    title={
                      <>
                        أُرسل — مستند خروج{" "}
                        <span className="sting-mono">{saved.transfer_number}</span>
                      </>
                    }
                  >
                    <p className="acc-lead">
                      يُطبع مع الشحنة ويُطابق عند الاستلام. الفرق إن وُجد يُحسم في ساق استلام
                      مستقلّة لا بتعديل هذا المستند.
                    </p>
                  </Notice>
                ) : (
                  <Notice kind="offline" title="محفوظ محلياً">
                    <p className="acc-lead">
                      المخزن بلا شبكة. التحويل محفوظ وخرج من رصيد المصدر محلياً.
                    </p>
                    <p className="acc-choice__note">
                      <strong>الفرع المستقبل لا يعلم</strong> · حتى تعود الشبكة. نقولها: «سيصل إعلام
                      الفرع عند المزامنة» — والسائق قد يصل قبل الإعلام.
                    </p>
                    {push === "failed" ? (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void pushPending()
                            .then(() => setPush("synced"))
                            .catch(() => setPush("failed"))
                        }
                      >
                        لم يُعلَم — إعادة
                      </Button>
                    ) : null}
                  </Notice>
                )}
                <TransferCard t={saved} pending={push !== "synced"} />
                <SyncIndicator
                  state={!online ? "offline" : push === "synced" ? "synced" : "pending_sync"}
                  lastServerAt={push === "synced" ? hhmm(new Date().toISOString()) : null}
                  pendingCount={push === "synced" ? 0 : 1}
                  pendingLabel={(n) =>
                    n === 1 ? "عملية واحدة معلقة من هذا الجهاز" : `${n} عمليات معلقة من هذا الجهاز`
                  }
                />
                <div className="cat-form__actions">
                  <Button onClick={() => window.print()} pos>
                    اطبع
                  </Button>
                  <Button variant="secondary" onClick={() => router.push("/inventory/transfers")}>
                    قائمة التحويلات
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
