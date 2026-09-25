"use client";

import {
  clearCountEntry,
  closeCountSession,
  type LocalCountSession,
  type LocalItem,
  type OpenCountSession,
  readLocalBalances,
  readLocalItems,
  readOpenCountSession,
  saveCountEntry,
  startCountSession,
} from "@sting/sync-core";
import { Button, formatMinor, formatQty, Frame, Notice, Status, Table } from "@sting/ui-web";
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
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { type Dp, parseQtyInput } from "./units";

type State = "ready" | "saving" | "saved_local" | "partial" | "offline" | "success";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly dp: Dp;
  readonly price: bigint;
  /** رصيد النظام — لا يدخل DOM قبل إدخال المعدود (القاعدة 9) */
  readonly systemMilli: bigint | null;
  readonly countedMilli: bigint | null;
  readonly draft: string;
}

/**
 * INV-05 — جلسة جرد (05-D2 saved_local · 40-D32 ready/saving/partial/offline/success): العدّ صنفاً
 * صنفاً والمتوقَّع محجوب حتى يُدخل المعدود — كما إقفال الصندوق (القاعدة 9)؛ يُحفظ بعد كل صنف ويُستأنف
 * بعد الانقطاع؛ يعمل بلا اتصال؛ الجرد الجزئي مشروع ولا نسوّي ما لم يُعدّ؛ الإغلاق يوثّق ما عُدّ
 * ولا يُسوّي — التسوية قرار تالٍ في INV-06.
 */
export function CountClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [balances, setBalances] = useState<Map<string, { qty_milli: string }>>(new Map());
  const [session, setSession] = useState<OpenCountSession | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "closed">("idle");
  const [closed, setClosed] = useState<LocalCountSession | null>(null);
  const [pushed, setPushed] = useState<"none" | "synced" | "pending">("none");
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory%2Fcount");
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
      if (!c) return;
      const open =
        (await readOpenCountSession(storage)) ??
        (await startCountSession(storage, {
          branchId: c.branchId,
          userName: c.userName,
          startedAt: new Date().toISOString(),
        }));
      setSession(open);
    })();
  }, [router]);

  const rows: Row[] = items.map((it) => {
    const b = balances.get(it.id);
    const entry = session?.counts[it.id];
    return {
      id: it.id,
      name: it.name,
      unit: it.base_unit_name,
      dp: it.base_unit_decimal_places ?? 0,
      price: BigInt(it.sale_price_minor || "0"),
      systemMilli: b ? BigInt(b.qty_milli) : null,
      countedMilli: entry ? BigInt(entry.countedMilli) : null,
      draft:
        drafts[it.id] ??
        (entry ? formatQty(entry.countedMilli, it.base_unit_decimal_places ?? 0) : ""),
    };
  });
  const counted = rows.filter((r) => r.countedMilli !== null);
  const variances = counted.filter(
    (r) => r.systemMilli !== null && r.countedMilli !== r.systemMilli,
  );
  const varianceValue = variances.reduce(
    (a, r) => a + ((r.countedMilli! - r.systemMilli!) * r.price) / 1000n,
    0n,
  );

  const state: State = closed
    ? "success"
    : phase === "saving"
      ? "saving"
      : confirmPartial
        ? "partial"
        : !online
          ? "offline"
          : counted.length > 0
            ? "saved_local"
            : "ready";

  const commit = async (row: Row, text: string) => {
    const q = parseQtyInput(text);
    if (q === null) {
      // إدخال غير رقمي أو فارغ: لا يُحفظ ويبقى الصنف غير معدود
      const next = await clearCountEntry(getStorage(), row.id);
      if (next) setSession(next);
      return;
    }
    const next = await saveCountEntry(getStorage(), row.id, {
      countedMilli: q.toString(),
      systemMilli: row.systemMilli === null ? "" : row.systemMilli.toString(),
      countedAt: new Date().toISOString(),
    });
    if (next) setSession(next);
    setDrafts((d) => ({ ...d, [row.id]: formatQty(q, row.dp) }));
  };

  const step = async (row: Row, delta: bigint) => {
    const cur = parseQtyInput(row.draft) ?? 0n;
    const next = cur + delta * 1000n;
    if (next < 0n) return;
    await commit(row, formatQty(next, row.dp));
  };

  const finish = async () => {
    if (!ctx || !session || phase !== "idle" || counted.length === 0) return;
    if (counted.length < rows.length && !confirmPartial) {
      setConfirmPartial(true);
      return;
    }
    setPhase("saving");
    const out = await closeCountSession(getStorage(), {
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      totalItems: rows.length,
      itemNames: Object.fromEntries(rows.map((r) => [r.id, { name: r.name, unit: r.unit }])),
      closedAt: new Date().toISOString(),
    });
    if (!out) {
      setPhase("idle");
      return;
    }
    if (online) {
      try {
        const res = await pushPending();
        setPushed(res.kind === "applied" || res.kind === "idle" ? "synced" : "pending");
      } catch {
        setPushed("pending");
      }
    } else {
      setPushed("pending");
    }
    setClosed(out.session);
    setPhase("closed");
  };

  const columns = [
    { key: "name", header: "الصنف", render: (r: Row) => r.name },
    {
      key: "sys",
      header: "رصيد النظام",
      // المتوقَّع محجوب حتى يُدخل المعدود: لا يُرسم في DOM قبل ذلك (القاعدة 9)
      render: (r: Row) =>
        r.countedMilli === null ? (
          <span className="inv-hidden">—</span>
        ) : r.systemMilli === null ? (
          "—"
        ) : (
          <span className="sting-mono">{formatQty(r.systemMilli, r.dp)}</span>
        ),
    },
    {
      key: "count",
      header: "العدّ الفعلي",
      render: (r: Row) => (
        <div className="inv-stepper" role="group" aria-label={`عدّاد — ${r.name}`}>
          <button
            type="button"
            className="inv-stepper__btn"
            aria-label={`نقص — ${r.name}`}
            onClick={() => void step(r, -1n)}
          >
            −
          </button>
          <input
            className="inv-stepper__input sting-mono"
            aria-label={`العدّ الفعلي — ${r.name}`}
            inputMode="decimal"
            value={r.draft}
            onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
            onBlur={(e) => void commit(r, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit(r, (e.target as HTMLInputElement).value);
            }}
          />
          <button
            type="button"
            className="inv-stepper__btn"
            aria-label={`زيادة — ${r.name}`}
            onClick={() => void step(r, 1n)}
          >
            +
          </button>
        </div>
      ),
    },
    {
      key: "diff",
      header: "الفرق",
      render: (r: Row) => {
        if (r.countedMilli === null || r.systemMilli === null) return "—";
        const d = r.countedMilli - r.systemMilli;
        return (
          <span
            className={`sting-mono ${d < 0n ? "inv-delta--out" : d > 0n ? "inv-delta--in" : ""}`}
          >
            {d > 0n ? "+" : ""}
            {formatQty(d, r.dp)}
          </span>
        );
      },
    },
  ];

  const startedAt = session?.startedAt ?? "";

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={ctx?.roleCode === "owner"} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              جرد {ctx?.branchName ?? ""} — بدأ{" "}
              <span className="sting-mono">{startedAt ? hhmm(startedAt) : "—"}</span>
            </h2>
            <span className="cat-head__hint">أمين المخزن: {ctx?.userName ?? "—"}</span>
          </div>
          <div className="acc-card__body">
            {state === "success" && closed ? (
              <>
                <Notice kind="success" title="أُغلقت الجلسة">
                  <p className="acc-lead">
                    المعدود والمتوقَّع والفوارق بعددها وقيمتها. والتسوية قرارٌ تالٍ في «مراجعة فروق
                    الجرد» لا أثرٌ تلقائي.
                  </p>
                  <p className="acc-choice__note">
                    <strong>الإغلاق لا يُسوّي</strong> · الجرد يوثّق ما عُدّ؛ والتسوية تُحرّك
                    المخزون وتحتاج اعتماداً. فصلهما يمنع تسوياتٍ بالسهو.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">الجلسة</span>
                    <span className="shift-facts__v sting-mono">{closed.session_number}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المعدود</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{closed.lines.length}</span> من{" "}
                      <span className="sting-mono">{closed.total_items}</span>
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الفوارق</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{variances.length}</span> · بقيمة{" "}
                      <span className="sting-mono">{formatMinor(varianceValue.toString())}</span>
                    </span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button pos onClick={() => router.push(`/inventory/count/${closed.id}/review`)}>
                    مراجعة الفروق
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                </div>
                {pushed === "pending" ? (
                  <p className="acc-choice__note">
                    <strong>الخطر المُعلن</strong> · بيعٌ يقع على جهاز آخر أثناء الجرد. يُكتشف عند
                    المزامنة ويُعرض في مراجعة الفروق.
                  </p>
                ) : null}
              </>
            ) : null}

            {state !== "success" ? (
              <>
                <div className="inv-head">
                  <span className="acc-choice__note">
                    <strong>القاعدة نفسها</strong> · «لا تُرِ المتوقَّع قبل العدّ». والفرق يُعرض بعد
                    تأكيد العدّ لا قبله.
                  </span>
                  <span className="inv-head__chip">
                    <Status
                      state={!online ? "offline" : counted.length ? "pending_sync" : "empty"}
                      label={
                        <>
                          محفوظ محلياً · <span className="sting-mono">{counted.length}</span> من{" "}
                          <span className="sting-mono">{rows.length}</span>
                        </>
                      }
                      dot={false}
                    />
                  </span>
                </div>
                {state === "offline" ? (
                  <Notice kind="offline" title="جرد بلا اتصال">
                    <p className="acc-lead">
                      الحالة الطبيعية: المخازن بلا تغطية غالباً. العدّ محلي كاملاً.
                    </p>
                    <p className="acc-choice__note">
                      <strong>الخطر المُعلن</strong> · بيعٌ يقع على جهاز آخر أثناء الجرد. يُكتشف عند
                      المزامنة ويُعرض في مراجعة الفروق.
                    </p>
                  </Notice>
                ) : null}
                {state === "saving" ? (
                  <Notice kind="info" title="حفظ العدّ">
                    <p className="acc-lead">يُحفظ بعد كل صنف لا في النهاية.</p>
                  </Notice>
                ) : null}
                {state === "partial" ? (
                  <Notice
                    kind="warning"
                    title="جرد جزئي"
                    action={
                      <>
                        <Button financial onClick={() => void finish()}>
                          إنهاء العدّ ومراجعة الفروق
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirmPartial(false)}>
                          حفظ ومتابعة لاحقاً
                        </Button>
                      </>
                    }
                  >
                    <p className="acc-lead">
                      عُدّ <span className="sting-mono">{counted.length}</span> صنفاً من{" "}
                      <span className="sting-mono">{rows.length}</span> وأُغلقت الجلسة. حالةٌ
                      مشروعة: جردُ فئةٍ أو رفٍّ.
                    </p>
                    <p className="acc-choice__note">
                      <strong>لا نسوّي ما لم يُعدّ</strong> · الأصناف غير المعدودة تبقى بأرصدتها ولا
                      تُصفَّر. التسوية تمسّ المعدود وحده — وهذا أهم قرار في الشاشة.
                    </p>
                  </Notice>
                ) : null}

                <Table caption="جلسة الجرد" columns={columns} rows={rows} rowKey={(r) => r.id} />

                <p className="acc-choice__note">
                  العدّ محفوظ على الجهاز ويستأنف بعد انقطاع الكهرباء.{" "}
                  <strong>لم يتغير أي رصيد بعد</strong> — التسوية تحتاج مراجعة واعتماداً في «مراجعة
                  فروق الجرد».
                </p>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void finish()}
                    loading={phase === "saving"}
                    disabledReason={counted.length === 0 ? "لم يُعدّ صنف بعد" : undefined}
                  >
                    إنهاء العدّ ومراجعة الفروق
                  </Button>
                  <Button variant="secondary" onClick={() => router.push("/inventory")}>
                    حفظ ومتابعة لاحقاً
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
