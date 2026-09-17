"use client";

import { Button, formatMinor, formatQty, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

import { PosNav } from "./pos-nav";

type State = "ready" | "empty" | "conflict" | "permission_denied";

interface DocLine {
  readonly id: string;
  readonly item_name: string;
  readonly unit_code: string;
  readonly qty_milli: string;
  readonly line_total_minor: string;
}

interface Doc {
  readonly id: string;
  readonly invoice_number: string;
  readonly device_name: string;
  readonly user_name: string;
  readonly party_name: string;
  readonly total_minor: string;
  readonly cash_minor: string;
  readonly credit_minor: string;
  readonly occurred_at: string;
  readonly sync_state: "synced" | "reversed";
  readonly lines: readonly DocLine[];
}

interface Pair {
  readonly source: "auto" | "report";
  readonly seconds_apart: number;
  readonly first: Doc;
  readonly second: Doc;
  readonly note: string;
  readonly reported_by_name: string;
}

interface Data {
  readonly can_decide: boolean;
  readonly role_name: string;
  readonly user_name: string;
  readonly window_days: number;
  readonly pairs: readonly Pair[];
}

const pairKey = (p: Pair) => `${p.first.id}:${p.second.id}`;

/** ثواني ← «10:31:22» بالوقت المحلي مع الثواني (الإطار يعرض الدقائق والثواني). */
function hhmmss(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** المستند كما في إطار POS-12: الرقم، الوقت · الجهاز · المنفّذ، السطور، الدفع، وضع المزامنة. */
function DocCard({ title, doc, decided }: { title: string; doc: Doc; decided?: string }) {
  return (
    <div className="pos-dup__doc">
      <div className="pos-dup__title">{title}</div>
      <div className="pos-dup__no sting-mono">{doc.invoice_number}</div>
      <div className="acc-choice__note">
        <span className="sting-mono">{hhmmss(doc.occurred_at)}</span> · {doc.device_name} ·{" "}
        {doc.user_name}
      </div>
      <ul className="pos-dup__lines">
        {doc.lines.map((l) => (
          <li key={l.id}>
            {l.item_name}{" "}
            <span className="sting-mono">
              {formatQty(l.qty_milli, 3)
                .replace(/(\.\d*?)0+$/, "$1")
                .replace(/\.$/, "")}
            </span>{" "}
            {l.unit_code} · <span className="sting-mono">{formatMinor(l.line_total_minor)}</span>
          </li>
        ))}
      </ul>
      <div className="pos-dup__pay">
        {BigInt(doc.cash_minor) > 0n ? (
          <span>
            نقداً <span className="sting-mono">{formatMinor(doc.cash_minor)}</span>
          </span>
        ) : null}
        {BigInt(doc.credit_minor) > 0n ? (
          <span>
            آجل — {doc.party_name}{" "}
            <span className="sting-mono">{formatMinor(doc.credit_minor)}</span>
          </span>
        ) : null}
      </div>
      <Status
        state={doc.sync_state === "reversed" ? "validation_error" : "synced"}
        label={doc.sync_state === "reversed" ? (decided ?? "مستند إلغاء مستقلاً") : "مؤكد خادمياً"}
      />
    </div>
  );
}

/**
 * POS-12 — مراجعة تكرار تجاري أو تصحيح (03-D2 conflict · 42-D34 ready/empty/permission_denied):
 * المستندان جنباً إلى جنب بهويّتيهما وجهازيهما ومنفّذيهما (ACC-16)؛ الإجراء عكسي — «سجّل عكساً
 * للثانية» لا «احذف»؛ المراجعة لمدير الفرع والكاشير يُبلغ.
 */
export function DuplicatesClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<{ key: string; label: string; by: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos%2Fduplicates");
      return;
    }
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/sales/duplicates");
        const body: Data | undefined = data;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
      } catch {
        setFailed(true);
      }
    })();
  }, [router]);

  const pairs = data?.pairs ?? [];
  const pair = pairs.find((p) => pairKey(p) === selected) ?? null;
  const canDecide = data?.can_decide ?? false;

  const state: State = pair
    ? canDecide
      ? "conflict"
      : "permission_denied"
    : data && pairs.length === 0 && !decided
      ? "empty"
      : "ready";

  const decide = async (decision: "reverse" | "both_real") => {
    if (!pair || busy) return;
    setAttempted(true);
    if (decision === "reverse" && !reason.trim()) return;
    setBusy(true);
    try {
      const { data: out, response } = await api().POST("/api/sales/duplicates/decide", {
        body: {
          first_id: pair.first.id,
          second_id: pair.second.id,
          decision,
          reason: reason.trim(),
        },
      });
      const body = out as unknown as { decided_by_name: string } | undefined;
      if (!response.ok || !body) return;
      setDecided({
        key: pairKey(pair),
        label:
          decision === "reverse"
            ? `إلغاء المستند ${pair.second.invoice_number} بسبب`
            : "الاثنان بيعان حقيقيان",
        by: body.decided_by_name,
      });
      setData((d) =>
        d ? { ...d, pairs: d.pairs.filter((p) => pairKey(p) !== pairKey(pair)) } : d,
      );
      setSelected(null);
      setReason("");
      setAttempted(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="invoices" canSeeReports={canDecide} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-12" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مراجعة تكرار تجاري أو تصحيح</h2>
            <span className="cat-head__hint">
              يعرض المستندين جنباً إلى جنب، ويتيح إجراءً عكسياً مخوَّلاً دون حذف الأصل (ACC-16).
            </span>
          </div>
          <div className="acc-card__body">
            {failed || !online ? (
              <Notice kind="offline" title="المراجعة تحتاج اتصالاً">
                <p className="acc-lead">الاشتباه يُكشف مركزياً من فواتير الأجهزة كلها.</p>
              </Notice>
            ) : null}

            {decided ? (
              <Notice kind="success" title={decided.label}>
                <p className="acc-lead">
                  سُجّل القرار باسم {decided.by}. الإجراء العكسي يُنشئ{" "}
                  <strong>مستند إلغاء مستقلاً</strong> مرتبطاً بالمستند المختار، ويُسجَّل بهوية
                  المنفّذ وسببه في سجل التدقيق. الأصل يبقى مقروءاً للأبد.
                </p>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title="لا اشتباهات">
                <p className="acc-lead">حالة سويّة — القائمة تُفتح من تنبيه لا من تصفّح.</p>
              </Notice>
            ) : null}

            {pair ? (
              <>
                <Notice
                  kind={state === "permission_denied" ? "locked" : "warning"}
                  title={state === "permission_denied" ? "المراجعة لمدير الفرع" : "تعارض"}
                >
                  {state === "permission_denied" ? (
                    <>
                      <p className="acc-lead">القرار «هذا تكرار» يُنشئ مستنداً عكسياً بأثر مالي.</p>
                      <p className="acc-lead">
                        <strong>الكاشير يُبلغ</strong> · زرّ «أبلغ عن اشتباه» متاح له — الملاحظة من
                        الميدان والقرار ممن يملك أثره.
                      </p>
                      <p className="acc-lead">
                        الإلغاء يتطلب صلاحية مدير فرع أو مالك. الكاشير يرى الشاشة ويبلّغ فقط.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="acc-lead">
                        <strong>فاتورتان متطابقتان خلال دقيقة</strong> · جهازان سجّلا نفس البيع. لم
                        يُحذف أي منهما — اختر الإجراء.
                      </p>
                      {pair.source === "report" ? (
                        <p className="acc-choice__note">
                          بلاغ {pair.reported_by_name}
                          {pair.note ? <> · {pair.note}</> : null}
                        </p>
                      ) : null}
                    </>
                  )}
                </Notice>

                <div className="pos-dup">
                  <DocCard title="المستند الأول — الأصل" doc={pair.first} />
                  <DocCard title="المستند الثاني — المشتبه به" doc={pair.second} />
                </div>

                <p className="acc-choice__note">
                  الإجراء العكسي يُنشئ <strong>مستند إلغاء مستقلاً</strong> مرتبطاً بالمستند
                  المختار، ويُسجَّل بهوية المنفّذ وسببه في سجل التدقيق. الأصل يبقى مقروءاً للأبد.
                </p>

                {canDecide ? (
                  <>
                    <TextField
                      label="السبب"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      error={attempted && !reason.trim() ? "يُطلب سبب" : undefined}
                      required
                    />
                    <div className="cat-form__actions">
                      <Button
                        variant="danger"
                        financial
                        onClick={() => void decide("reverse")}
                        loading={busy}
                        disabledReason={!online ? "القرار يحتاج اتصالاً" : undefined}
                      >
                        إلغاء المستند{" "}
                        <span className="sting-mono">{pair.second.invoice_number}</span> بسبب
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void decide("both_real")}
                        loading={busy}
                        disabledReason={!online ? "القرار يحتاج اتصالاً" : undefined}
                      >
                        الاثنان بيعان حقيقيان
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="cat-form__actions">
                    <Button variant="danger" disabledReason="الإلغاء يتطلب صلاحية مدير فرع أو مالك">
                      إلغاء المستند <span className="sting-mono">{pair.second.invoice_number}</span>{" "}
                      بسبب
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/pos/invoices/${pair.second.id}`)}
                    >
                      أبلغ عن اشتباه
                    </Button>
                  </div>
                )}
                <Button variant="quiet" onClick={() => setSelected(null)}>
                  رجوع إلى القائمة
                </Button>
              </>
            ) : null}

            {!pair && pairs.length > 0 ? (
              <>
                <Notice kind="info" title="المستندان جنباً إلى جنب">
                  <p className="acc-lead">
                    نفس الصنف والكمية والدقائق من جهازين — بهويّتيهما وجهازيهما ومنفّذيهما (ACC-16).
                  </p>
                  <p className="acc-lead">
                    <strong>الإجراء عكسي</strong> · «سجّل عكساً للثانية» لا «احذف». فقد يكون زبونان
                    اشتريا الشيء نفسه فعلاً — والحذف يمحو بيعاً صحيحاً بلا أثر.
                  </p>
                  <p className="acc-choice__note">عمليتان متشابهتان ليستا بالضرورة خطأً.</p>
                </Notice>
                <ul className="pos-dup__list">
                  {pairs.map((p) => (
                    <li key={pairKey(p)}>
                      <Button variant="quiet" onClick={() => setSelected(pairKey(p))}>
                        <span className="sting-mono">{p.first.invoice_number}</span> ·{" "}
                        <span className="sting-mono">{p.second.invoice_number}</span> —{" "}
                        <span className="sting-mono">{formatMinor(p.first.total_minor)}</span> ·{" "}
                        {p.source === "report" ? (
                          <>بلاغ {p.reported_by_name}</>
                        ) : (
                          <>
                            خلال <span className="sting-mono">{p.seconds_apart}</span> ث
                          </>
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
