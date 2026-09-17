"use client";

import { maskPhone, storeParties } from "@sting/sync-core";
import { Button, Dialog, formatMinor, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import { PosNav } from "@/features/pos/pos-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "permission_denied" | "conflict" | "success";

interface Side {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly balance_minor: string;
  readonly movements: number;
  readonly merged_into: string;
}

interface Preview {
  readonly source: Side;
  readonly target: Side;
  readonly movements_after: number;
  readonly balance_after_minor: string;
  readonly phones_differ: boolean;
}

interface MergeResult {
  readonly merge: { readonly id: string; readonly occurred_at: string };
  readonly source: Side;
  readonly target: Side;
}

/** «4 حركات» / «11 حركة» — الرقم لاتيني داخل mono والكلمة خارجه. */
function Movements({ n }: { n: number }) {
  const word = n === 1 ? "حركة" : n === 2 ? "حركتان" : n >= 3 && n <= 10 ? "حركات" : "حركة";
  return (
    <>
      <span className="sting-mono">{n}</span> {word}
    </>
  );
}

/** «عليه 60.00» / «له 60.00» بحسب إشارة الرصيد. */
function Owed({ minor }: { minor: string }) {
  const v = BigInt(minor || "0");
  return (
    <>
      {v < 0n ? "له" : "عليه"}{" "}
      <span className="sting-mono">{formatMinor((v < 0n ? -v : v).toString())}</span>
    </>
  );
}

/**
 * PTY-07 — دمج أطراف (04-D2 ready · 40-D32 validation_error/permission_denied/conflict/success):
 * المصدر يُدمج ويختفي والهدف يبقى؛ معاينة الأثر قبل التأكيد المزدوج (كلمة تُكتب)؛ خريطة هوية لا
 * إعادة كتابة للحركات (ACC-78) — الحدث المتأخر باسم المصدر يصل إلى الهدف موسوماً بمصدره؛ للمالك
 * وحده والصلاحية قبل التأكيد لا بدلاً منه؛ التراجع محدود بعدم تسجيل حركة جديدة على المدموج.
 */
export function MergeClient({ sourceId, targetId }: { sourceId: string; targetId: string }) {
  const router = useRouter();
  const app = useApp();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [denied, setDenied] = useState(false);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [done, setDone] = useState<MergeResult | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    const here = `/parties/${sourceId}/merge?target=${targetId}`;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    if (!targetId) {
      setPreview(null);
      return;
    }
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/parties/{party_id}/merge", {
          params: { path: { party_id: sourceId }, query: { target: targetId } },
        });
        if (response.status === 403) {
          setDenied(true);
          setPreview(null);
          return;
        }
        const body = data as unknown as Preview | undefined;
        if (!response.ok || !body) {
          setPreview(null);
          return;
        }
        setPreview(body);
      } catch {
        setPreview(null);
      }
    })();
  }, [sourceId, targetId, router]);

  useEffect(() => {
    if (preview === null && !denied) router.replace(`/parties/${sourceId}`);
  }, [preview, denied, router, sourceId]);

  // تعارض: قرار دمج آخر سبقنا (المصدر مدموج، أو الهدف نفسه دُمج) — الحركات المتأخرة تُوجَّه بخريطة الهوية
  const alreadyMerged = Boolean(preview?.source.merged_into || preview?.target.merged_into);
  const conflict = alreadyMerged || rejected !== null;
  const evidenceAgainst = preview?.phones_differ ?? false;

  const state: State = done
    ? "success"
    : denied
      ? "permission_denied"
      : conflict
        ? "conflict"
        : evidenceAgainst
          ? "validation_error"
          : "ready";

  const merge = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/parties/{party_id}/merge", {
        params: { path: { party_id: preview.source.id } },
        body: { target_id: preview.target.id, confirm: "MERGE", reason: reason.trim() },
      });
      if (response.status === 403) {
        setDenied(true);
        setConfirming(false);
        return;
      }
      if (response.status === 400) {
        const errs = (data as unknown as { errors?: { code: string }[] } | undefined)?.errors;
        setRejected(errs?.[0]?.code ?? "rejected");
        setConfirming(false);
        return;
      }
      const body = data as unknown as MergeResult | undefined;
      if (!response.ok || !body) return;
      await storeParties(
        getStorage(),
        [body.source as never, body.target as never],
        new Date().toISOString(),
      );
      setDone(body);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  // البديل المعروض: وسمهما «مراجَعان ومنفصلان» يُسكت التنبيه بلا دمج (PTY-03)
  const markDistinct = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const { response } = await api().POST("/api/parties/{party_id}/distinct", {
        params: { path: { party_id: preview.source.id } },
        body: { other_id: preview.target.id },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.ok) router.push(`/parties/${preview.target.id}`);
    } finally {
      setBusy(false);
    }
  };

  const src = preview?.source;
  const tgt = preview?.target;

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={!denied} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">دمج طرفين مكررين</h2>
            <span className="cat-head__hint">الدمج لا يُلغى بسهولة — راجع المعاينة بدقة</span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="الدمج للمالك">
                <p className="acc-lead">يوحّد دفترين ماليين. لا مدير فرع ولا محاسب.</p>
                <p className="acc-choice__note">
                  <strong>حتى بالتأكيد المزدوج</strong> · الصلاحية قبل التأكيد لا بدلاً منه.
                </p>
              </Notice>
            ) : null}

            {state === "conflict" ? (
              <Notice kind="warning" title="حركات متأخرة على الطرف الممحوّ">
                <p className="acc-lead">وصلت فاتورة من جهاز غير مزامن على الطرف الذي دُمج.</p>
                <p className="acc-choice__note">
                  <strong>خريطة هوية لا إعادة كتابة</strong> · الحركة المتأخرة تُوجَّه إلى الطرف
                  الباقي بخريطةٍ تحفظ هويتها الأصلية (ACC-78) — لا نُعيد كتابة حركة مضت.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="warning" title="دمج طرفين بأرقام وعناوين مختلفة">
                <p className="acc-lead">
                  الاسمان متقاربان والدليل ضد الدمج لا معه: رقمان مختلفان وعنوانان.
                </p>
                <p className="acc-choice__note">
                  <strong>نعرض الدليل</strong> · لا نقترح الدمج ولا نفعله تلقائياً. لو كانا شخصين
                  لطالبتَ أحدهما بدين غيره.
                </p>
                <p className="acc-choice__note">
                  <strong>البديل المعروض</strong> · «وسمهما مراجَعان ومنفصلان» — يُسكت التنبيه بلا
                  دمج، وهو الصواب في أغلب الحالات.
                </p>
              </Notice>
            ) : null}

            {state === "success" && done ? (
              <>
                <Notice kind="success" title="دُمج الطرفان">
                  <p className="acc-lead">
                    رصيدٌ واحد وكشفٌ واحد، والطرف الممحوّ يبقى مرئياً في السجل بإشارةٍ إلى وارثه.
                  </p>
                  <p className="acc-choice__note">
                    <strong>التراجع محدود</strong> · ممكن ما لم تُسجَّل حركة جديدة على المدموج.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">الهدف — يبقى</span>
                    <span className="shift-facts__v">{done.target.name}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الرصيد المجمّع</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(done.target.balance_minor)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المصدر — يُدمج ويختفي</span>
                    <span className="shift-facts__v">{done.source.name}</span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button onClick={() => router.push(`/parties/${done.target.id}/statement`)} pos>
                    كشف الحساب
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => router.push(`/parties/${done.target.id}`)}
                  >
                    بطاقة الطرف
                  </Button>
                </div>
              </>
            ) : null}

            {src && tgt && !done ? (
              <>
                <div className="pty-merge">
                  <div className="pty-merge__side">
                    <div className="pty-merge__role">المصدر — يُدمج ويختفي</div>
                    <div className="pty-merge__name">{src.name}</div>
                    <div className="acc-choice__note">
                      {src.phone ? (
                        <span className="sting-mono">{maskPhone(src.phone)}</span>
                      ) : null}
                      <br />
                      <Movements n={src.movements} /> · <Owed minor={src.balance_minor} />
                    </div>
                  </div>
                  <div className="pty-merge__side pty-merge__side--target">
                    <div className="pty-merge__role">الهدف — يبقى</div>
                    <div className="pty-merge__name">{tgt.name}</div>
                    <div className="acc-choice__note">
                      {tgt.phone ? (
                        <span className="sting-mono">{maskPhone(tgt.phone)}</span>
                      ) : null}
                      <br />
                      <Movements n={tgt.movements} /> · <Owed minor={tgt.balance_minor} />
                    </div>
                  </div>
                </div>

                <div className="cat-head">
                  <h3 className="cat-head__title">معاينة الأثر</h3>
                </div>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">الحركات بعد الدمج</span>
                    <span className="shift-facts__v sting-mono">{preview.movements_after}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الرصيد المجمّع</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(preview.balance_after_minor)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المستندات القديمة</span>
                    <span className="shift-facts__v">تبقى بأسمائها الأصلية — لا تُعاد كتابتها</span>
                  </div>
                </div>
                <Notice kind="info" title="الأحداث المتأخرة.">
                  <p className="acc-lead">
                    إن وصل من جهاز غير متصل سدادٌ مسجَّل باسم المصدر بعد الدمج، تُوجّهه خريطة الهوية
                    إلى الهدف تلقائياً ويظهر في كشفه موسوماً بمصدره. لا يُفقد ولا يُنشئ طرفاً
                    جديداً.
                  </p>
                </Notice>
                <TextField
                  label="السبب"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  hint="اختياري — يظهر في سجل التدقيق"
                />
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    variant="danger"
                    onClick={() => setConfirming(true)}
                    disabledReason={
                      denied
                        ? "الدمج للمالك"
                        : conflict
                          ? "حركات متأخرة على الطرف الممحوّ"
                          : undefined
                    }
                  >
                    تأكيد الدمج
                  </Button>
                  {evidenceAgainst ? (
                    <Button variant="secondary" onClick={() => void markDistinct()} loading={busy}>
                      وسمهما «مراجَعان ومنفصلان»
                    </Button>
                  ) : null}
                  <Button variant="quiet" onClick={() => router.push(`/parties/${tgt.id}`)}>
                    إلغاء
                  </Button>
                </div>
                <Dialog
                  open={confirming}
                  kind="danger"
                  title="تأكيد الدمج"
                  onClose={() => setConfirming(false)}
                  primaryLabel="تأكيد الدمج"
                  onPrimary={() => void merge()}
                  saving={busy}
                  confirmWord="دمج"
                >
                  <p className="acc-lead">
                    {src.name} → {tgt.name} · الرصيد المجمّع{" "}
                    <span className="sting-mono">{formatMinor(preview.balance_after_minor)}</span>
                  </p>
                  <p className="acc-choice__note">الدمج لا يُلغى بسهولة — راجع المعاينة بدقة</p>
                </Dialog>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
