"use client";

import type { StoredOperation } from "@sting/platform";
import { describeOperation } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, Table, TextField } from "@sting/ui-web";
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

type State = "ready" | "conflict" | "permission_denied" | "success";

interface MemberView {
  readonly entity: string;
  readonly id: string;
  readonly payload: Record<string, unknown>;
}

interface Item {
  readonly id: string;
  readonly operation_id: string;
  readonly kind: string;
  readonly reason: "conflicted" | "rejected";
  readonly code: string;
  readonly detail: string;
  readonly device_id: string;
  readonly device_name: string;
  readonly received_at: string;
  readonly effect_minor: string;
  readonly members: readonly MemberView[];
  readonly reviewed_at: string;
  readonly decision: string;
  readonly decision_reason: string;
  readonly decided_by_name: string;
}

interface Confirmed {
  readonly kind: string;
  readonly device_name: string;
  readonly actor_name: string;
  readonly received_at: string;
  readonly members: readonly MemberView[];
}

interface Effect {
  readonly party_id?: string;
  readonly party_name?: string;
  readonly balance_now_minor?: string;
  readonly balance_if_accept_minor?: string;
  readonly balance_if_reject_minor?: string;
  readonly device_amount_minor?: string;
  readonly confirmed_amount_minor?: string;
}

interface Detail {
  readonly item: Item;
  readonly confirmed: Confirmed | null;
  readonly effect: Effect;
  readonly acceptable: boolean;
  readonly is_owner: boolean;
}

interface ListData {
  readonly is_owner: boolean;
  readonly items: readonly Item[];
  readonly as_of: string;
}

/** يُشكَّل من أعضاء النسخة ليوصف بلغة المحل كما في SYS-01/02. */
function asStored(kind: string, members: readonly MemberView[], id: string): StoredOperation {
  return {
    operationId: id,
    kind,
    opVersion: 1,
    dependencies: [],
    members: members.map((m) => ({ ...m, schemaVersion: 1, serverSeq: null })),
    state: "conflict",
    createdLocalSeq: 0,
    snapshotRelation: "none",
  };
}

const head = (members: readonly MemberView[], entity: string): Record<string, unknown> =>
  members.find((m) => m.entity === entity)?.payload ?? {};

const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

const METHOD_LABEL: Record<string, string> = {
  cash: "نقداً",
  bank: "تحويلاً بنكياً",
  credit: "آجلاً",
};

/** بطاقة نسخة (07-D3): «على الخادم — مؤكد» / «على هذا الجهاز — محجوز» بالمبلغ والوقت والمُدخِل. */
function VersionCard({
  title,
  chip,
  kind,
  members,
  at,
  actor,
  device,
  reserved,
}: {
  title: string;
  chip: "synced" | "conflict";
  kind: string;
  members: readonly MemberView[];
  at: string;
  actor: string;
  device: string;
  reserved: boolean;
}) {
  const d = describeOperation(asStored(kind, members, "x"));
  const h = head(members, "parties.PaymentReceipt");
  const amount = str(h["amount_minor"]) || str(head(members, "sales.Sale")["total_minor"]);
  const method = str(h["method"]);
  return (
    <div className={`inv-ledger${reserved ? "" : " inv-ledger--in"}`} data-version={chip}>
      <div className="inv-head">
        <div className="pty-merge__role">{title}</div>
        <Status state={chip} label={reserved ? "محجوز" : "مؤكد"} dot={false} />
      </div>
      <div className="shift-facts">
        <div>
          <span className="shift-facts__k">{d.title}</span>
          <span className="shift-facts__v sting-mono">{d.number}</span>
        </div>
        {amount ? (
          <div>
            <span className="shift-facts__k">المبلغ</span>
            <span className="shift-facts__v">
              <span className="sting-mono">{formatMinor(amount)}</span>
              {method ? ` ${METHOD_LABEL[method] ?? method}` : ""}
            </span>
          </div>
        ) : null}
        <div>
          <span className="shift-facts__k">أُدخلت</span>
          <span className="shift-facts__v">
            {at ? (
              <>
                <DayLabel iso={at} now={new Date()} />{" "}
                <span className="sting-mono">{hhmm(at)}</span>
              </>
            ) : (
              "—"
            )}
            {actor ? ` · ${actor}` : ""}
            {device ? ` · ${device}` : ""}
          </span>
        </div>
      </div>
      <p className="acc-choice__note">{d.effect}</p>
    </div>
  );
}

/**
 * SYS-03 — تعارض وحجر ومراجعة مالك (07-D3 ready/conflict/permission_denied/success): النسختان
 * معروضتان ولا نختار عنك؛ قبول مخوَّل بسبب أو رفض بسبب — دون إعادة كتابة الأصل (ACC-32، ACC-49)؛
 * المرفوض يبقى مقروءاً في السجل؛ لا تراجع؛ الحجز على البند وحده والبيع يستمر؛ الترتيب بالأثر المالي.
 */
export function ReviewClient({
  selectedId,
  operationId,
}: {
  selectedId: string;
  operationId: string;
}) {
  const router = useRouter();
  const app = useApp();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [list, setList] = useState<ListData | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [decided, setDecided] = useState<{
    decision: "accept" | "reject";
    balanceAfter: string | null;
    item: Item;
  } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/sync/quarantine", {});
    const body = data as unknown as ListData | undefined;
    if (!response.ok || !body) {
      setFailed("list");
      return;
    }
    setList(body);
    const id =
      selectedId ||
      (operationId ? (body.items.find((i) => i.operation_id === operationId)?.id ?? "") : "");
    if (id) {
      const r = await api().GET("/api/sync/quarantine/{item_id}", {
        params: { path: { item_id: id } },
      });
      const d = r.data as unknown as Detail | undefined;
      setDetail(r.response.ok && d ? d : null);
    } else {
      setDetail(null);
    }
  }, [selectedId, operationId]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsync%2Freview");
      return;
    }
    void (async () => {
      setCtx(await readShiftContext(getStorage(), app));
      await load();
    })();
  }, [router, load]);

  const isOwner = detail?.is_owner ?? list?.is_owner ?? ctx?.roleCode === "owner";
  const state: State = decided
    ? "success"
    : detail
      ? isOwner
        ? "conflict"
        : "permission_denied"
      : "ready";

  const decide = async (decision: "accept" | "reject") => {
    if (!detail || busy) return;
    setAttempted(true);
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const { data, error, response } = await api().POST("/api/sync/quarantine/{item_id}/decide", {
        params: { path: { item_id: detail.item.id } },
        body: { decision, reason: reason.trim() },
      });
      if (!response.ok) {
        const e = error as unknown as { detail?: string } | undefined;
        setFailed(e?.detail ?? "server_error");
        return;
      }
      const body = data as unknown as {
        item: Item;
        applied: { balance_after_minor?: string };
      };
      setDecided({
        decision,
        balanceAfter: body.applied.balance_after_minor ?? null,
        item: body.item,
      });
    } finally {
      setBusy(false);
    }
  };

  const items = list?.items ?? [];
  const columns = [
    {
      key: "op",
      header: "البند",
      render: (i: Item) => {
        const d = describeOperation(asStored(i.kind, i.members, i.operation_id));
        return (
          <div>
            <Button
              variant="quiet"
              className="shift-row__open"
              onClick={() => router.push(`/sync/review?id=${i.id}`)}
            >
              {d.title}
              {d.number ? (
                <>
                  {" "}
                  <span className="sting-mono">{d.number}</span>
                </>
              ) : null}
            </Button>
            <div className="acc-choice__note">
              {i.device_name || "جهاز"} · <DayLabel iso={i.received_at} now={new Date()} />{" "}
              <span className="sting-mono">{hhmm(i.received_at)}</span>
            </div>
          </div>
        );
      },
    },
    {
      key: "why",
      header: "السبب",
      render: (i: Item) =>
        i.reason === "conflicted" ? (
          <Status state="conflict" label="تعارض" dot={false} />
        ) : (
          <Status state="server_error" label="مرفوضة" dot={false} />
        ),
    },
    {
      key: "effect",
      header: "الأثر المالي",
      mono: true,
      render: (i: Item) => formatMinor(i.effect_minor),
    },
  ];

  const e = detail?.effect ?? {};
  const item = detail?.item;
  const confirmedHead = detail?.confirmed
    ? head(detail.confirmed.members, "parties.PaymentReceipt")
    : {};
  const deviceHead = item ? head(item.members, "parties.PaymentReceipt") : {};
  const sameNumber =
    Boolean(str(confirmedHead["receipt_number"])) &&
    str(confirmedHead["receipt_number"]) === str(deviceHead["receipt_number"]);
  const partyFirst = (e.party_name ?? "").split(" ")[0] ?? "";

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="sync" />} footer={null}>
      <div className="sys" data-screen="SYS-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تعارض وحجر ومراجعة المالك</h2>
            <span className="cat-head__hint">قبول مخوَّل أو رفض بسبب — دون إعادة كتابة الأصل.</span>
          </div>
          <div className="acc-card__body">
            {state === "ready" ? (
              <>
                <Notice
                  kind={items.length ? "warning" : "success"}
                  title={
                    items.length ? (
                      <>
                        <span className="sting-mono">{items.length}</span> بنود محجوزة
                      </>
                    ) : (
                      "لا بنود محجوزة"
                    )
                  }
                >
                  <p className="acc-lead">
                    قائمة ما ينتظر قرارك، مرتّبةً بالأثر المالي لا بالتاريخ: تعارض على رصيد صنفٍ ثم
                    على سعر ثم على بيانات طرف.
                  </p>
                  <p className="acc-choice__note">
                    <strong>الترتيب بالأثر</strong> · تعارضٌ على{" "}
                    <span className="sting-mono">400</span> ريال قبل تعارضٍ على هجاء اسم. الأقدم
                    أولاً ترتيبٌ محايد، والمحايد هنا إهدار.
                  </p>
                  <p className="acc-choice__note">
                    <strong>ما لا يُحجز</strong> · التعارضات التي يحسمها النظام بأمان (طابعٌ مختلف
                    لنفس القيمة) لا تصل هنا. حجزُ ما لا يحتاج قراراً يُعلّم المالك تجاهل الشاشة.
                  </p>
                  {failed === "list" ? (
                    <p className="acc-choice__note">تعذّر جلب القائمة من الخادم.</p>
                  ) : null}
                </Notice>
                <Table
                  caption="البنود المحجوزة"
                  columns={columns}
                  rows={items}
                  rowKey={(i) => i.id}
                  onOpenRow={(i) => router.push(`/sync/review?id=${i.id}`)}
                />
                <p className="acc-choice__note">
                  العمل لا يتوقف على المحجوز: البيع يستمر والحجز على البند وحده.
                </p>
              </>
            ) : null}

            {(state === "conflict" || state === "permission_denied") && item ? (
              <>
                <Notice kind="warning" title="عملية محجوزة تحتاج قرارك">
                  <p className="acc-lead">
                    {item.reason === "conflicted" ? (
                      <>
                        رفض الخادم عملية{" "}
                        {
                          describeOperation(asStored(item.kind, item.members, item.operation_id))
                            .title
                        }{" "}
                        بسبب تعارض{sameNumber ? " في المبلغ" : ""}. لم يُكتب فوق أي مستند
                        {e.party_name ? (
                          <>، وحساب {e.party_name} وحده معلَّق — بقية العملاء يزامنون طبيعياً.</>
                        ) : (
                          "."
                        )}
                      </>
                    ) : (
                      <>
                        رفض الخادم العملية: <span className="sting-mono">{item.code}</span>
                        {item.detail ? ` — ${item.detail}` : ""}. لم يُكتب فوق أي مستند.
                      </>
                    )}
                  </p>
                </Notice>
                <div className="inv-ledgers">
                  {detail?.confirmed ? (
                    <VersionCard
                      title="على الخادم — مؤكد"
                      chip="synced"
                      kind={detail.confirmed.kind}
                      members={detail.confirmed.members}
                      at={detail.confirmed.received_at}
                      actor={detail.confirmed.actor_name}
                      device={detail.confirmed.device_name}
                      reserved={false}
                    />
                  ) : null}
                  <VersionCard
                    title="على هذا الجهاز — محجوز"
                    chip="conflict"
                    kind={item.kind}
                    members={item.members}
                    at={item.received_at}
                    actor=""
                    device={item.device_name}
                    reserved
                  />
                </div>
                {sameNumber ? (
                  <p className="acc-choice__note">
                    نفس رقم المستند بمبلغين مختلفين — غالباً سُجّل السداد على جهازين بقيمتين.
                  </p>
                ) : null}
                {e.balance_if_accept_minor && e.balance_if_reject_minor ? (
                  <p className="acc-lead">
                    الأثر على الرصيد: بالقبول يصبح رصيد {partyFirst}{" "}
                    <span className="sting-mono">{formatMinor(e.balance_if_accept_minor)}</span>،
                    وبالرفض يبقى{" "}
                    <span className="sting-mono">{formatMinor(e.balance_if_reject_minor)}</span>.
                    راجع الإيصال الورقي قبل أن تقرّر.
                  </p>
                ) : null}

                {state === "conflict" ? (
                  <>
                    <TextField
                      label="سبب القرار"
                      value={reason}
                      onChange={(ev) => setReason(ev.target.value)}
                      error={attempted && !reason.trim() ? "سبب القرار" : undefined}
                      required
                    />
                    {failed && failed !== "list" ? (
                      <Notice kind="error" title="لم يُسجَّل القرار">
                        <p className="acc-lead">
                          {failed === "manual_merge_required"
                            ? "هذا التعارض يحتاج دمجاً يدوياً — غير مبني بعد."
                            : failed === "already_decided"
                              ? "حُسم هذا البند سلفاً — لا تراجع."
                              : "الخادم لم يقبل القرار."}
                        </p>
                      </Notice>
                    ) : null}
                    <div className="cat-form__actions">
                      <Button
                        financial
                        pos
                        onClick={() => void decide("accept")}
                        loading={busy}
                        disabledReason={
                          detail?.acceptable
                            ? undefined
                            : "الدمج اليدوي غير مبني — القبول لتعارض سداد مؤكد"
                        }
                      >
                        قبول نسخة الجهاز بسبب
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void decide("reject")}
                        loading={busy}
                      >
                        رفض والإبقاء على المؤكد
                      </Button>
                      <Button variant="quiet" disabledReason="الدمج حقلاً حقلاً غير مبني">
                        فتح الدمج اليدوي
                      </Button>
                    </div>
                    <p className="acc-choice__note">
                      القرار يتطلب صلاحية المالك، ويُسجَّل في سجل التدقيق باسمك وسببك ووقته.
                      المستندان يبقيان مقروءين بعده.
                    </p>
                  </>
                ) : (
                  <Notice kind="info" title="حسم التعارض صلاحية مالك">
                    <p className="acc-lead">
                      حسم التعارض صلاحية مالك. الكاشير يرى التعارض ويُبلّغ عنه ولا يحسمه — وهذه هي
                      حالة permission_denied.
                    </p>
                    <p className="acc-choice__note">
                      النسختان محفوظتان كلتاهما. لا شيء ضاع، ولا شيء يُطبَّق حتى تقرّر.
                    </p>
                  </Notice>
                )}
                <div className="cat-form__actions">
                  <Button variant="quiet" onClick={() => router.push("/sync/review")}>
                    البنود المحجوزة
                  </Button>
                </div>
              </>
            ) : null}

            {state === "success" && decided ? (
              <>
                <Notice kind="success" title="حُسم التعارض">
                  <p className="acc-lead">
                    {decided.decision === "accept" ? (
                      <>
                        اختار المالك نسخة الجهاز
                        {decided.balanceAfter ? (
                          <>
                            . نقول أثر القرار بالأرقام: الرصيد صار{" "}
                            <span className="sting-mono">{formatMinor(decided.balanceAfter)}</span>
                          </>
                        ) : null}
                        ، والنسخة الأخرى محفوظة في السجل لا ممحوّة.
                      </>
                    ) : (
                      <>
                        أبقى المالك النسخة المؤكدة
                        {e.balance_if_reject_minor ? (
                          <>
                            . الرصيد يبقى{" "}
                            <span className="sting-mono">
                              {formatMinor(e.balance_if_reject_minor)}
                            </span>
                          </>
                        ) : null}
                        ، والنسخة المرفوضة محفوظة في السجل لا ممحوّة.
                      </>
                    )}
                  </p>
                  <p className="acc-choice__note">
                    <strong>المرفوض يبقى</strong> · النسخة غير المختارة تبقى مقروءة في سجل التدقيق
                    باسم من أدخلها. من راجع بعد شهر يحتاج أن يرى أن خلافاً وقع وحُسم.
                  </p>
                  <p className="acc-choice__note">
                    <strong>لا تراجع</strong> · الحسم نهائي. التصحيح بقرارٍ جديد يشير إليه — لا
                    بتراجعٍ يمحو أن قراراً اتُّخذ.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">القرار</span>
                    <span className="shift-facts__v">
                      {decided.decision === "accept"
                        ? "قبول نسخة الجهاز"
                        : "رفض والإبقاء على المؤكد"}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">السبب</span>
                    <span className="shift-facts__v">{decided.item.decision_reason}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">باسم</span>
                    <span className="shift-facts__v">{decided.item.decided_by_name}</span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => {
                      setDecided(null);
                      setDetail(null);
                      setReason("");
                      setAttempted(false);
                      router.push("/sync/review");
                    }}
                  >
                    البنود المحجوزة
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
