"use client";

import { recordCreditOverride } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, SyncIndicator, TextField } from "@sting/ui-web";
import { useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { hhmm } from "@/features/home/format";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { PayMethods } from "./pay-methods";
import { PosNav } from "./pos-nav";
import { useSale } from "./use-sale";

type State = "ready" | "validation_error" | "permission_denied" | "stale" | "saved_local";

/** «عمليتين معلقتين من هذا الجهاز» — صيغ العدد. */
function pendingWord(n: number): string {
  return n === 1
    ? "عملية واحدة معلقة"
    : n === 2
      ? "عمليتين معلقتين"
      : `${n} ${n <= 10 ? "عمليات معلقة" : "عملية معلقة"}`;
}

/**
 * POS-06 — الدفع الآجل (03-D2 stale · 42-D34 ready/validation_error/permission_denied/saved_local):
 * الرصيد قبل الالتزام مركّباً «خادمي X + معلّق هذا الجهاز Y = Z» (ACC-02)، ومبلغ الفاتورة، ورصيده
 * بعدها — ثم الالتزام. حدّ الائتمان أداة انتباه لا قفل: التجاوز تنبيهٌ بالمبلغ الزائد وسببٌ ثم يُكمَل
 * البيع بحدث تجاوز يُراجع عند الاتصال (§٧.٤). الكاشير يرى رصيد من أمامه ولا يفتح كشفه الكامل.
 */
export function CreditClient() {
  const sale = useSale("/pos/pay/credit");
  const { draft, party, pendingCredit, totals, phase, ctx, shift, online } = sale;
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [statementDenied, setStatementDenied] = useState(false);
  const overrideIds = useRef({ operationId: "", overrideId: "" });

  const total = totals.totalMinor;
  const serverBalance = BigInt(party?.balance_minor ?? "0");
  const before = serverBalance + pendingCredit.pendingMinor;
  const after = before + total;
  const limit = BigInt(party?.credit_limit_minor ?? "0");
  const overLimit = limit > 0n && after > limit;
  const remaining = limit > 0n ? limit - before : null;
  const isOwner = ctx?.roleName === "مالك";

  const state: State =
    phase === "saved"
      ? "saved_local"
      : statementDenied
        ? "permission_denied"
        : attempted && overLimit && !reason.trim()
          ? "validation_error"
          : pendingCredit.count > 0 || !online
            ? "stale"
            : "ready";

  const commit = async () => {
    if (!draft || !party) return;
    setAttempted(true);
    if (overLimit && !reason.trim()) return;
    const saved = await sale.save(draft.lines, [
      { method: "credit", amountMinor: total.toString() },
    ]);
    if (!saved) return;
    if (overLimit) {
      if (!overrideIds.current.operationId)
        overrideIds.current = { operationId: crypto.randomUUID(), overrideId: crypto.randomUUID() };
      await recordCreditOverride(getStorage(), {
        ...overrideIds.current,
        saleId: saved.id,
        saleOperationId: saved.operation_id,
        partyId: party.id,
        branchId: saved.branch_id,
        creditLimitMinor: limit.toString(),
        balanceAfterMinor: after.toString(),
        reason,
        occurredAt: new Date().toISOString(),
      });
      if (online) void pushPending();
    }
    await sale.pushAfterSave();
  };

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="pos" canSeeReports={isOwner} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الدفع الآجل</h2>
            {shift ? (
              <span className="cat-head__hint">
                وردية مفتوحة <span className="sting-mono">{hhmm(shift.opened_at)}</span> ·{" "}
                {shift.user_name}
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {phase !== "saved" ? <PayMethods current="credit" /> : null}

            {!party && draft ? (
              <Notice
                kind="locked"
                title="آجلاً على"
                action={
                  <Button onClick={() => sale.router.push("/pos/customer")}>اختيار العميل</Button>
                }
              >
                <p className="acc-lead">عميل مسمّى — شرط الأثر الآجل</p>
              </Notice>
            ) : null}

            {party ? (
              <>
                <h3 className="pos-credit__title">آجل على {party.name}</h3>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">عليه قبل هذا البيع</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(before.toString())}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">يضاف الآن</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(total.toString())}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">
                      <strong>عليه بعد الحفظ</strong>
                    </span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(after.toString())}
                    </span>
                  </div>
                </div>
                <p className="acc-choice__note">
                  الرصيد مركّب: خادمي{" "}
                  <span className="sting-mono">{formatMinor(serverBalance.toString())}</span> +
                  معلّق هذا الجهاز{" "}
                  <span className="sting-mono">
                    {formatMinor(pendingCredit.pendingMinor.toString())}
                  </span>{" "}
                  = <span className="sting-mono">{formatMinor(before.toString())}</span>، وبعد البيع{" "}
                  <span className="sting-mono">{formatMinor(after.toString())}</span>
                </p>
                <p className="acc-choice__note">
                  الرصيد حتى تغطية الخادم{" "}
                  <span className="sting-mono">{sale.matchedAt ? hhmm(sale.matchedAt) : "—"}</span>
                  {pendingCredit.count > 0 ? (
                    <>، ويشمل {pendingWord(pendingCredit.count)} من هذا الجهاز</>
                  ) : null}
                  . قد يختلف إن سجّل جهاز آخر سداداً لم يصلنا بعد.
                </p>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">
                      حد ائتمان مرن <span className="acc-choice__note">— اختياري</span>
                    </span>
                    <span className="shift-facts__v">
                      {limit > 0n ? (
                        <>
                          <span className="sting-mono">{formatMinor(limit.toString())}</span> ·
                          متبقٍ{" "}
                          <span className="sting-mono">
                            {formatMinor((remaining ?? 0n).toString())}
                          </span>
                        </>
                      ) : (
                        "غير محدد"
                      )}
                    </span>
                  </div>
                </div>

                {overLimit && phase !== "saved" ? (
                  <Notice kind="error" title="تجاوز حدّ الائتمان">
                    <p className="acc-lead">الرصيد بعد البيع يتجاوز حدّ الطرف.</p>
                    <p className="acc-lead">
                      حدّه <span className="sting-mono">{formatMinor(limit.toString())}</span> — هذا
                      البيع يرفعه إلى{" "}
                      <span className="sting-mono">{formatMinor(after.toString())}</span>
                    </p>
                    <p className="acc-lead">
                      يظهر تنبيه بالمبلغ الزائد ويُطلب سبب، ثم <strong>يُكمَل البيع</strong>. الحد
                      أداة انتباه لا قفل — والمالك يستطيع تركه «غير محدد» لأي عميل.
                    </p>
                    <TextField
                      label="السبب"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      error={attempted && !reason.trim() ? "يُطلب سبب" : undefined}
                      required
                    />
                    <Button variant="secondary" onClick={() => sale.router.push("/pos/pay/mixed")}>
                      تحويل الفارق نقداً في دفع مختلط
                    </Button>
                  </Notice>
                ) : (
                  <p className="cat-saving__note">
                    <strong>لو تجاوز البيع الحد</strong> · يظهر تنبيه بالمبلغ الزائد ويُطلب سبب، ثم
                    يُكمَل البيع. الحد أداة انتباه لا قفل — والمالك يستطيع تركه «غير محدد» لأي عميل.
                  </p>
                )}

                {statementDenied ? (
                  <Notice kind="locked" title="رصيد مخوَّل وقت البيع">
                    <p className="acc-lead">
                      الكاشير يرى رصيد من أمامه ليقرّر البيع، ولا يفتح كشفه الكامل.
                    </p>
                    <p className="acc-lead">والفواتير التفصيلية بابها PTY-05 بصلاحيته.</p>
                  </Notice>
                ) : null}

                {phase === "saved" && sale.sale ? (
                  <>
                    <Notice kind="success" title="آجل بلا اتصال">
                      <p className="acc-lead">الدين تكوَّن محلياً ولم يره الخادم.</p>
                      <p className="acc-lead">
                        <strong>المعلّق يظهر فوراً</strong> · الفاتورة تدخل «معلّق هذا الجهاز» في
                        رصيده المركّب من اللحظة — فبيعٌ آجل ثانٍ له يراها (ACC-02).
                      </p>
                    </Notice>
                    <div className="shift-facts">
                      <div>
                        <span className="shift-facts__k">رقم الفاتورة</span>
                        <span className="shift-facts__v sting-mono">
                          {sale.sale.invoice_number}
                        </span>
                      </div>
                    </div>
                    <SyncIndicator
                      state={
                        !online ? "offline" : sale.push === "synced" ? "synced" : "pending_sync"
                      }
                      lastServerAt={sale.matchedAt ? hhmm(sale.matchedAt) : null}
                      pendingCount={sale.push === "synced" ? 0 : 1}
                      pendingLabel={(n) =>
                        n === 1
                          ? "عملية واحدة معلقة من هذا الجهاز"
                          : `${n} عمليات معلقة من هذا الجهاز`
                      }
                    />
                    <div className="cat-form__actions">
                      <Button
                        onClick={() => sale.router.push(`/pos/receipt/${sale.sale?.id ?? "last"}`)}
                        pos
                      >
                        طباعة الإيصال
                      </Button>
                      <Button variant="secondary" onClick={() => sale.router.push("/pos")} pos>
                        بيع جديد
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="cat-form__actions">
                    <Button
                      financial
                      pos
                      onClick={() => void commit()}
                      loading={phase === "saving"}
                      disabledReason={
                        !draft?.lines.length
                          ? "السلة فارغة"
                          : attempted && overLimit && !reason.trim()
                            ? "يُطلب سبب"
                            : undefined
                      }
                    >
                      حفظ البيع الآجل
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        isOwner
                          ? sale.router.push(`/parties/${party.id}/statement`)
                          : setStatementDenied(true)
                      }
                    >
                      كشف حساب
                    </Button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
