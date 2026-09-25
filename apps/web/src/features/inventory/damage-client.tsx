"use client";

import { type LocalItem, readLocalBalances, readLocalItems, storeBalances } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  RadioGroupField,
  SelectField,
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

import { parseQtyInput, type UnitOption, unitOptions } from "./units";

type State = "ready" | "validation_error" | "permission_denied" | "success";
type Destination = "quarantine" | "write_off";

interface Damage {
  readonly damage_number: string;
  readonly qty_milli: string;
  readonly base_qty_milli: string;
  readonly unit_name: string;
  readonly destination: Destination;
  readonly reason: string;
  readonly value_minor: string;
}

/**
 * INV-07 — هالك وحجر تالف (05-D2 ready · 40-D32 validation_error/permission_denied/success): التالف
 * لا يدخل المتاح للبيع (ACC-10) — الحجر يخرج من المتاح ويبقى في المخزون الفعلي موسوماً (قد يُرتجع
 * للمورد)، والهالك خروج نهائي؛ الحدّ من الرصيد ولو كان خاطئاً (تصحيحه بالجرد لا بالهالك)؛ الهالك
 * بحدٍّ مالي لغير المالك؛ السبب إلزامي.
 */
export function DamageClient({ itemId }: { itemId: string }) {
  const router = useRouter();
  const app = useApp();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [item, setItem] = useState<LocalItem | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [qty, setQty] = useState("1");
  const [unitKey, setUnitKey] = useState("");
  const [destination, setDestination] = useState<Destination>("quarantine");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<{ cap: string; value: string } | null>(null);
  const [serverBalance, setServerBalance] = useState<bigint | null>(null);
  const [done, setDone] = useState<Damage | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/inventory/items/${itemId}/damage`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [c, items, balances] = await Promise.all([
        readShiftContext(storage, app),
        readLocalItems(storage),
        readLocalBalances(storage),
      ]);
      setCtx(c);
      const it = items.find((i) => i.id === itemId) ?? null;
      setItem(it);
      const b = balances.get(itemId);
      setBalance(b ? BigInt(b.qty_milli) : null);
    })();
  }, [router, itemId]);

  useEffect(() => {
    if (item === null) router.replace("/inventory");
  }, [item, router]);

  const units: UnitOption[] = item ? unitOptions(item) : [];
  const unit = units.find((u) => u.key === unitKey) ?? units[0];
  const q = parseQtyInput(qty);
  const factor = unit ? BigInt(unit.factorMilli || "0") : 0n;
  const base = q !== null && factor > 0n ? (q * factor) / 1000n : null;
  const available = serverBalance ?? balance;
  const after = available !== null && base !== null ? available - base : null;
  const exceeds = after !== null && after < 0n;
  const dp = item?.base_unit_decimal_places ?? 0;

  const errors: Record<string, string> = {};
  if (q === null || q <= 0n) errors["qty"] = "الكمية";
  else if (exceeds) errors["qty"] = "هالك يتجاوز الرصيد";
  if (unit && factor <= 0n) errors["unit"] = "المعامل غير محدَّد";
  if (!reason.trim()) errors["reason"] = "السبب — إلزامي";
  const invalid = Object.keys(errors).length > 0;

  const state: State = done
    ? "success"
    : denied
      ? "permission_denied"
      : (attempted && invalid) || (exceeds && q !== null)
        ? "validation_error"
        : "ready";

  const submit = async () => {
    if (!item || !ctx || !unit || busy) return;
    setAttempted(true);
    if (invalid) return;
    setBusy(true);
    try {
      const { data, error, response } = await api().POST("/api/inventory/items/{item_id}/damage", {
        params: { path: { item_id: item.id } },
        body: {
          branch_id: ctx.branchId,
          unit_code: unit.code,
          unit_name: unit.name,
          factor_milli: unit.factorMilli,
          qty_milli: (q ?? 0n).toString(),
          destination,
          reason: reason.trim(),
        },
      });
      if (response.status === 403) {
        const e = error as { cap_minor?: string; value_minor?: string } | undefined;
        setDenied({ cap: e?.cap_minor ?? "", value: e?.value_minor ?? "" });
        return;
      }
      if (response.status === 400) {
        const errs =
          (error as { errors?: { code: string; balance_milli?: string }[] } | undefined)?.errors ??
          [];
        const ex = errs.find((e) => e.code === "exceeds_balance");
        if (ex?.balance_milli) setServerBalance(BigInt(ex.balance_milli));
        return;
      }
      const body = data as unknown as
        { damage: Damage; balance_milli: string; quarantine_milli: string } | undefined;
      if (!response.ok || !body) return;
      // رصيد الجهاز يتبع الخادم فوراً — التالف لا يدخل المتاح للبيع
      await storeBalances(getStorage(), new Date().toISOString(), [
        { item_id: item.id, qty_milli: body.balance_milli },
      ]);
      setBalance(BigInt(body.balance_milli));
      setDone(body.damage);
    } finally {
      setBusy(false);
    }
  };

  const step = (delta: bigint) => {
    const cur = q ?? 0n;
    const next = cur + delta * 1000n;
    if (next < 0n) return;
    setQty(formatQty(next, unit?.decimalPlaces ?? 0));
    setDenied(null);
  };

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={ctx?.roleCode === "owner"} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تسجيل تالف{item ? <> — {item.name}</> : null}</h2>
            <span className="cat-head__hint">التالف لا يدخل المتاح للبيع.</span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" && denied ? (
              <Notice kind="locked" title="الهالك بحدٍّ مالي">
                <p className="acc-lead">
                  أمين المخزن يُهلك حتى حدٍّ معرَّف في «الأدوار والصلاحيات»، وما فوقه يحتاج اعتماد
                  المالك.
                </p>
                <p className="acc-choice__note">
                  <strong>لماذا حدّ</strong> · الهالك خسارةٌ مباشرة وبابٌ لإخفاء نقص. الحدّ يوازن
                  بين تسهيل العمل ومنع الإفراط.
                </p>
                {denied.cap ? (
                  <p className="acc-choice__note">
                    الحدّ <span className="sting-mono">{formatMinor(denied.cap)}</span> · القيمة{" "}
                    <span className="sting-mono">{formatMinor(denied.value)}</span>
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {state === "validation_error" && exceeds ? (
              <Notice kind="error" title="هالك يتجاوز الرصيد">
                <p className="acc-lead">
                  إهلاك{" "}
                  <span className="sting-mono">{base === null ? "—" : formatQty(base, dp)}</span>{" "}
                  والرصيد{" "}
                  <span className="sting-mono">
                    {available === null ? "—" : formatQty(available, dp)}
                  </span>
                  .
                </p>
                <p className="acc-choice__note">
                  <strong>الحدّ من الرصيد</strong> · ولو كان الرصيد خاطئاً. تصحيحه بالجرد لا بالهالك
                  — وإلا صار الهالك باباً لتصحيح الأرصدة بلا أثر.
                </p>
              </Notice>
            ) : null}

            {state === "success" && done && item ? (
              <>
                <Notice kind="success" title="سُجّل الهالك">
                  <p className="acc-lead">
                    الكمية والسبب المصنَّف والوجهة: هالكٌ يُخرج، أو حجرٌ يبقى في المخزون موسوماً غير
                    قابل للبيع.
                  </p>
                  <p className="acc-choice__note">
                    <strong>الحجر ليس هالكاً</strong> · التالف المحجور قد يُرتجع للمورد. إهلاكه
                    يُفقد حقّ المطالبة.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">المستند</span>
                    <span className="shift-facts__v sting-mono">{done.damage_number}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الكمية</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">
                        {formatQty(done.qty_milli, unit?.decimalPlaces ?? 0)}
                      </span>{" "}
                      {done.unit_name}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الوجهة</span>
                    <span className="shift-facts__v">
                      {done.destination === "quarantine"
                        ? "حجر — قابل للمراجعة"
                        : "هالك — خروج نهائي"}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">السبب</span>
                    <span className="shift-facts__v">{done.reason}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المتاح للبيع بعد التسجيل</span>
                    <span className="shift-facts__v sting-mono">
                      {balance === null ? "—" : formatQty(balance, dp)}
                    </span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() =>
                      router.push(`/inventory/items/${item.id}?branch=${ctx?.branchId ?? ""}`)
                    }
                  >
                    سجل حركة الصنف
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                </div>
              </>
            ) : null}

            {item && !done ? (
              <>
                <div className="inv-line">
                  <div>
                    <div className="c-field__label">الكمية</div>
                    <div className="inv-stepper" role="group" aria-label="عدّاد الكمية">
                      <button
                        type="button"
                        className="inv-stepper__btn"
                        aria-label="نقص"
                        onClick={() => step(-1n)}
                      >
                        −
                      </button>
                      <input
                        className="inv-stepper__input sting-mono"
                        aria-label="الكمية"
                        inputMode="decimal"
                        value={qty}
                        onChange={(e) => {
                          setQty(e.target.value);
                          setDenied(null);
                        }}
                      />
                      <button
                        type="button"
                        className="inv-stepper__btn"
                        aria-label="زيادة"
                        onClick={() => step(1n)}
                      >
                        +
                      </button>
                    </div>
                    {attempted && errors["qty"] && !exceeds ? (
                      <div className="c-field__error">{errors["qty"]}</div>
                    ) : null}
                  </div>
                  <SelectField
                    label="الوحدة"
                    value={unit?.key ?? ""}
                    onChange={(e) => setUnitKey(e.target.value)}
                    options={units.map((u) => ({
                      value: u.key,
                      label: factorOk(u) ? u.name : `${u.name} — المعامل غير محدَّد`,
                    }))}
                    error={attempted ? errors["unit"] : undefined}
                  />
                </div>
                <RadioGroupField
                  label="الوجهة"
                  name="dst"
                  value={destination}
                  onChange={(v) => {
                    setDestination(v as Destination);
                    setDenied(null);
                  }}
                  options={[
                    {
                      value: "quarantine",
                      label: "حجر — قابل للمراجعة",
                      hint: "يخرج من المتاح للبيع ويبقى في المخزون الفعلي",
                    },
                    {
                      value: "write_off",
                      label: "هالك — خروج نهائي",
                      hint: "يخرج من المخزون بالكامل ولا يعود",
                    },
                  ]}
                />
                <TextField
                  label="السبب — إلزامي"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  error={attempted ? errors["reason"] : undefined}
                  required
                />
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">المتاح للبيع بعد التسجيل</span>
                    <span className={`shift-facts__v sting-mono${exceeds ? " inv-qty--neg" : ""}`}>
                      {after === null ? "—" : formatQty(after, dp)}
                    </span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void submit()}
                    loading={busy}
                    disabledReason={
                      exceeds
                        ? "الحدّ من الرصيد"
                        : attempted && invalid
                          ? "أكمل الحقول المطلوبة"
                          : undefined
                    }
                  >
                    تسجيل التالف
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() =>
                      router.push(`/inventory/items/${item.id}?branch=${ctx?.branchId ?? ""}`)
                    }
                  >
                    سجل حركة الصنف
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

function factorOk(u: UnitOption): boolean {
  return BigInt(u.factorMilli || "0") > 0n;
}
