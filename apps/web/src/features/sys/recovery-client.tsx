"use client";

import type { StoredOperation } from "@sting/platform";
import { describeOperation } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/sys/sys.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { DayLabel } from "@/features/pos/invoices-client";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

type State = "ready" | "permission_denied" | "pending_sync" | "conflict" | "success";

interface HeldItem {
  readonly id: string;
  readonly operation_id: string;
  readonly kind: string;
  readonly members: readonly { entity: string; id: string; payload: Record<string, unknown> }[];
  readonly received_at: string;
  readonly effect_minor: string;
}

interface DeviceRow {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly branch_name: string;
  readonly status: "revoked" | "frozen" | "wiped" | "active";
  readonly revoked_at: string;
  readonly frozen_at: string;
  readonly wiped_at: string;
  readonly held_count: number;
  readonly held_value_minor: string;
  readonly reported_pending: number;
  readonly reported_pending_at: string;
  readonly last_seen_at: string;
  readonly actor_names: readonly string[];
  readonly items?: readonly HeldItem[];
}

interface ListData {
  readonly is_owner: boolean;
  readonly devices: readonly DeviceRow[];
}

interface RestoreResult {
  readonly device_id: string;
  readonly status: string;
  readonly restored: number;
  readonly duplicate: number;
  readonly conflicted: number;
  readonly rejected: number;
}

const STATUS_LABEL: Record<DeviceRow["status"], string> = {
  revoked: "مسحوب",
  frozen: "مجمَّد",
  wiped: "ممحو",
  active: "فعّال",
};

function asStored(i: HeldItem): StoredOperation {
  return {
    operationId: i.operation_id,
    kind: i.kind,
    opVersion: 1,
    dependencies: [],
    members: i.members.map((m) => ({ ...m, schemaVersion: 1, serverSeq: null })),
    state: "quarantined",
    createdLocalSeq: 0,
    snapshotRelation: "none",
  };
}

/**
 * SYS-07 — استرداد جهاز مسحوب (19-D14 ready/permission_denied/conflict/success · 16-D11 pending_sync):
 * السحب قرار إداري والعمل أمانة مال — والشاشة تفصل بينهما. الاسترداد للمالك بتفصيله؛ المدير يرى
 * العدد والقيمة بلا تفصيل؛ لا ترجيح تلقائي عند التعارض (SYS-03)؛ الجهاز يبقى مسحوباً بعد الاسترداد؛
 * لا محو قبل إنقاذ المعلّق: تجميد فوري أو محو بعد إقرار مكتوب.
 */
export function RecoveryClient({ selectedId }: { selectedId: string }) {
  const router = useRouter();
  const app = useApp();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [data, setData] = useState<ListData | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [ack, setAck] = useState("");
  const [ackAttempted, setAckAttempted] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/sync/recovery", {});
    const body = data as unknown as ListData | undefined;
    if (response.ok && body) setData(body);
    else setFailed("list");
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsync%2Frecovery");
      return;
    }
    void (async () => {
      setCtx(await readShiftContext(getStorage(), app));
      await load();
    })();
  }, [router, load]);

  const isOwner = data?.is_owner ?? ctx?.roleCode === "owner";
  const devices = data?.devices ?? [];
  const selected = devices.find((d) => d.id === selectedId) ?? devices[0] ?? null;
  const pendingOnly = Boolean(
    selected &&
    selected.held_count === 0 &&
    selected.reported_pending > 0 &&
    selected.status !== "wiped",
  );

  const state: State = result
    ? result.conflicted > 0 || result.rejected > 0
      ? "conflict"
      : "success"
    : !isOwner
      ? "permission_denied"
      : pendingOnly
        ? "pending_sync"
        : "ready";

  const act = async (action: "restore" | "freeze" | "wipe") => {
    if (!selected || busy) return;
    if (action === "wipe") {
      setAckAttempted(true);
      if (!ack.trim()) return;
    }
    setBusy(true);
    setFailed(null);
    try {
      const { data, error, response } = await api().POST(
        "/api/sync/recovery/{device_id}/{action}",
        {
          params: { path: { device_id: selected.id, action } },
          body: action === "wipe" ? { acknowledgement: ack.trim() } : {},
        },
      );
      if (!response.ok) {
        const e = error as unknown as { detail?: string } | undefined;
        setFailed(e?.detail ?? "server_error");
        return;
      }
      if (action === "restore") setResult(data as unknown as RestoreResult);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const items = selected?.items ?? [];

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="recovery" />} footer={null}>
      <div className="sys" data-screen="SYS-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">استرداد جهاز مسحوب</h2>
            <span className="cat-head__hint">
              جهاز سُحب وصوله وعليه عمل لم يُرفع. السحب قرار إداري والعمل أمانة مال — والشاشة تفصل
              بينهما.
            </span>
          </div>
          <div className="acc-card__body">
            {devices.length > 1 ? (
              <ul className="sys-recent" aria-label="الأجهزة">
                {devices.map((d) => (
                  <li key={d.id} className="sys-recent__row">
                    <Button
                      variant="quiet"
                      className="shift-row__open"
                      onClick={() => router.push(`/sync/recovery?id=${d.id}`)}
                    >
                      {d.name} · <span className="sting-mono">{d.prefix}</span>
                    </Button>
                    <Status
                      state={d.status === "wiped" ? "empty" : "conflict"}
                      label={STATUS_LABEL[d.status]}
                      dot={false}
                    />
                    <span className="sting-mono">{d.held_count}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {!selected && data ? (
              <Notice kind="empty" title="لا أجهزة مسحوبة عليها عمل">
                <p className="acc-lead">
                  كل الأجهزة فعّالة أو سُوّي ما عليها. الشاشة تُفتح حين يُسحب جهاز وعليه عمل لم
                  يُرفع.
                </p>
              </Notice>
            ) : null}

            {state === "success" && result ? (
              <Notice kind="success" title="استُرد العمل">
                <p className="acc-lead">
                  <span className="sting-mono">{result.restored}</span> عمليات دخلت الدفتر منسوبةً
                  إلى من أنشأها لا إلى من استردّها — والفرق بينهما مسجّل في السجل.
                </p>
                <p className="acc-choice__note">
                  <strong>والجهاز</strong> · يبقى مسحوباً. نقولها في شاشة النجاح لئلا يُظنّ أن
                  الاسترداد أعاده للخدمة.
                </p>
                {result.duplicate > 0 ? (
                  <p className="acc-choice__note">
                    <span className="sting-mono">{result.duplicate}</span> كانت عند الخادم سلفاً —
                    لم تُحسب مرتين.
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {state === "conflict" && result ? (
              <Notice
                kind="warning"
                title="عملٌ مسترد يعارض ما وقع بعده"
                action={<Button onClick={() => router.push("/sync/review")}>مراجعة المالك</Button>}
              >
                <p className="acc-lead">
                  دخل <span className="sting-mono">{result.restored}</span> · تعارض{" "}
                  <span className="sting-mono">{result.conflicted}</span> · رُفض{" "}
                  <span className="sting-mono">{result.rejected}</span>. الجهاز المسحوب باع، وجهازٌ
                  آخر باع بعد السحب — القطع واحدة والمبيع مرتان.
                </p>
                <p className="acc-choice__note">
                  <strong>لا ترجيح تلقائي</strong> · لا الأقدم ولا الأحدث. البيعان وقعا فعلاً
                  ونقدهما في درجين مختلفين. يُحال إلى «مراجعة التعارضات» بالنسختين.
                </p>
              </Notice>
            ) : null}

            {selected ? (
              <>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">الجهاز</span>
                    <span className="shift-facts__v">
                      {selected.name} · <span className="sting-mono">{selected.prefix}</span> ·{" "}
                      {selected.branch_name}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الحالة</span>
                    <span className="shift-facts__v">
                      <Status
                        state={selected.status === "wiped" ? "empty" : "conflict"}
                        label={STATUS_LABEL[selected.status]}
                        dot={false}
                      />
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">ما على الجهاز المسحوب</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{selected.held_count}</span> عمليات بـ
                      <span className="sting-mono">{formatMinor(selected.held_value_minor)}</span>
                      {selected.reported_pending > selected.held_count ? (
                        <>
                          {" "}
                          · لم تصل بعد{" "}
                          <span className="sting-mono">{selected.reported_pending}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">آخر نشاط</span>
                    <span className="shift-facts__v">
                      {selected.last_seen_at ? (
                        <>
                          <DayLabel iso={selected.last_seen_at} now={new Date()} />{" "}
                          <span className="sting-mono">{hhmm(selected.last_seen_at)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                      {selected.actor_names.length ? ` · ${selected.actor_names.join("، ")}` : ""}
                    </span>
                  </div>
                </div>

                {state === "permission_denied" ? (
                  <Notice kind="info" title="الاسترداد للمالك">
                    <p className="acc-lead">
                      مدير الفرع سحب الجهاز ولا يسترد عمله: الاسترداد يقرأ عمليات موظف آخر بتفصيلها.
                    </p>
                    <p className="acc-choice__note">
                      <strong>ما يراه المدير</strong> · العدد والقيمة الإجمالية بلا تفصيل — يكفي لأن
                      يعرف أن ثمّة ما يُسترد فيطلبه.
                    </p>
                  </Notice>
                ) : null}

                {state === "pending_sync" ? (
                  <Notice kind="warning" title="خطر فقد">
                    <p className="acc-lead">
                      على الجهاز <span className="sting-mono">{selected.reported_pending}</span>{" "}
                      عمليات لم تصل. محوها الآن يعني أن بضاعة خرجت من مخزنك بلا قيد.
                    </p>
                    <p className="acc-choice__note">
                      التجميد يمنع أي بيع جديد فوراً ويُبقي المعلّق قابلاً للرفع لو عاد الجهاز
                      للشبكة. المحو متاح بعد إقرار مكتوب بفقد العمليات.
                    </p>
                    <p className="acc-choice__note">
                      يُجمَّد الجهاز فوراً: لا بيع جديد، لا وصول للبيانات، والمحفوظ باقٍ.
                    </p>
                    <p className="acc-choice__note">
                      المحو يحتاج إقراراً مكتوباً باسم المالك بأن العمليات تُعدّ مفقودة، ويُسجَّل
                      الإقرار في سجل التدقيق.
                    </p>
                    <TextField
                      label="إقرار مكتوب بفقد المعلّق"
                      value={ack}
                      onChange={(ev) => setAck(ev.target.value)}
                      error={ackAttempted && !ack.trim() ? "الإقرار إلزامي قبل المحو" : undefined}
                    />
                    <div className="cat-form__actions">
                      <Button
                        pos
                        onClick={() => void act("freeze")}
                        loading={busy}
                        disabledReason={selected.status === "frozen" ? "مجمَّد سلفاً" : undefined}
                      >
                        تجميد الجهاز الآن
                      </Button>
                      <Button
                        variant="secondary"
                        financial
                        onClick={() => void act("wipe")}
                        loading={busy}
                      >
                        محو — بعد الإقرار
                      </Button>
                    </div>
                  </Notice>
                ) : null}

                {state === "ready" && selected.held_count > 0 ? (
                  <>
                    <h3 className="cat-head__title">ما على الجهاز المسحوب</h3>
                    <p className="acc-choice__note">
                      عدد العمليات المعلّقة ونوعها وقيمتها وآخر نشاط. القرار يحتاج هذه الأرقام.
                    </p>
                    <ul className="sys-recent" aria-label="العمل المحجوز">
                      {items.map((i) => {
                        const d = describeOperation(asStored(i));
                        return (
                          <li key={i.id} className="sys-recent__row">
                            <span>
                              {d.title}
                              {d.number ? (
                                <>
                                  {" "}
                                  <span className="sting-mono">{d.number}</span>
                                </>
                              ) : null}
                            </span>
                            <span className="acc-choice__note">{d.effect}</span>
                            <span className="sting-mono">{formatMinor(i.effect_minor)}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="acc-choice__note">
                      <strong>السحب قائم</strong> · الجهاز لا يستعيد وصوله بهذا. الاسترداد يسحب
                      العمل ولا يُعيد الصلاحية — فعلان منفصلان.
                    </p>
                    {failed ? (
                      <Notice kind="error" title="لم يُنفَّذ">
                        <p className="acc-lead">
                          {failed === "acknowledgement_required"
                            ? "المحو يحتاج إقراراً مكتوباً."
                            : "الخادم لم يقبل الطلب."}
                        </p>
                      </Notice>
                    ) : null}
                    <div className="cat-form__actions">
                      <Button financial pos onClick={() => void act("restore")} loading={busy}>
                        استرداد العمل إلى الدفتر
                      </Button>
                    </div>
                  </>
                ) : null}
                {state === "ready" &&
                selected.held_count === 0 &&
                selected.reported_pending === 0 ? (
                  <p className="acc-choice__note">لا عمل محجوزاً على هذا الجهاز.</p>
                ) : null}
              </>
            ) : null}
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/sync")}>
                مركز المزامنة
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
