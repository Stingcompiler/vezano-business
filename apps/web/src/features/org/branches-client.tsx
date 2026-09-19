"use client";

import { Button, Dialog, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { Ago } from "@/features/org/ago";
import type { DeviceRow } from "@/features/org/devices-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "validation_error" | "permission_denied";

interface BranchRow {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  is_default: boolean;
  code_locked: boolean;
  ledger: {
    invoices: number;
    shifts: number;
    open_shifts: number;
    stock_items: number;
    receivables_minor: string;
    has_ledger: boolean;
  };
  devices: DeviceRow[];
  staff: number;
}
interface Payload {
  branches: BranchRow[];
  can_create: boolean;
}

function deviceNote(d: DeviceRow): { label: string; tone: string; text: string } {
  if (d.pending > 0)
    return {
      label: "معلّق",
      tone: "expired",
      text: `${d.pending} عمليات محفوظة محلياً لم تُرفع. فصله الآن يفقدها.`,
    };
  if (d.connectivity === "stale" || d.connectivity === "silent")
    return {
      label: "صامت",
      tone: "disabled",
      text: "لا نفترض فقده ولا نفصله تلقائياً. نعرض آخر ظهوره وتقرر أنت.",
    };
  if (!d.sells)
    return { label: "نظيف", tone: "active", text: "متصل · قراءة تقارير فقط بحكم دور مستخدمه" };
  return { label: "نظيف", tone: "active", text: "متصل · لا معلّق" };
}

/**
 * ORG-03 — الفروع وتفاصيلها (39-D31 ready/empty/permission_denied · 15-D10 validation_error): لكل
 * فرع مخزنه وصناديقه وأجهزته وموظفوه؛ الحذف غير موجود — فرعٌ له دفتر يُقفل بعد تحويل المخزون ويبقى
 * تاريخه؛ الرمز ثابت بعد أول فاتورة (§٨.٢)؛ الإنشاء للمالك ومدير الفرع يرى فرعه (§١٠.١).
 */
export function BranchesClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [blocked, setBlocked] = useState<BranchRow | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data: d, response } = await api().GET("/api/org/branches", {});
    if (response.ok && d) setData(d);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fbranches");
      return;
    }
    void load().catch(() => setData({ branches: [], can_create: false }));
  }, [router, load]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { error, response } = await api().POST("/api/org/branches", {
        body: { name, code },
      });
      if (!response.ok) {
        const e = error as unknown as { detail?: string } | undefined;
        setErr(
          e?.detail === "code_taken"
            ? "الرمز مستعمل لفرع آخر"
            : e?.detail === "code_invalid"
              ? "الرمز حرفان إلى ستة، لاتينية وأرقام"
              : "اكتب اسم الفرع",
        );
        return;
      }
      setOpen(false);
      setName("");
      setCode("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const close = async (b: BranchRow) => {
    if (busy) return;
    setBusy(true);
    setCloseErr(null);
    try {
      const { error, response } = await api().POST("/api/org/branches/{branch_id}/{action}", {
        params: { path: { branch_id: b.id, action: "close" } },
      });
      if (!response.ok) {
        const e = error as unknown as { detail?: string; extra?: unknown } | undefined;
        setCloseErr(
          e?.detail === "stock_remaining"
            ? `المخزون المتبقي لم يُحوَّل بعد — ${String(e.extra)} صنفاً`
            : e?.detail === "open_shift"
              ? "وردية مفتوحة في هذا الفرع — أغلقها أولاً"
              : e?.detail === "devices_pending"
                ? "جهاز في هذا الفرع يحمل معلّقاً لم يُرفع"
                : e?.detail === "default_branch"
                  ? "الفرع الرئيسي لا يُقفل"
                  : "تعذّر الإقفال",
        );
        return;
      }
      setBlocked(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const branches = data?.branches ?? [];
  const state: State = !data
    ? "ready"
    : blocked
      ? "validation_error"
      : !data.can_create
        ? "permission_denied"
        : branches.length <= 1
          ? "empty"
          : "ready";

  const num = (n: number | string) => <span className="sting-mono">{n}</span>;

  return (
    <Frame title="الفروع" nav={<AppNav currentId="org-branches" />} footer={null}>
      <div className="sys" data-screen="ORG-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الفروع وتفاصيلها</h2>
            <span className="cat-head__hint">
              ثلاث حالات ناقصة. الفرع وحدة مخزون وصندوق لا عنوان.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "empty" ? (
              <Notice kind="empty" title="فرع واحد">
                <p className="acc-lead">
                  أغلب المحلات فرعٌ واحد. لا نعرض هذا فراغاً بل حالةً سويّة.
                </p>
                <p className="acc-choice__note">
                  <strong>متى يُقترح الثاني</strong> · لا نقترحه. إضافة فرع قرار توسّع تجاري،
                  واقتراحه من شاشة إعدادات عبثٌ.
                </p>
              </Notice>
            ) : null}
            {state === "permission_denied" ? (
              <Notice kind="info" title="مدير الفرع يرى فرعه">
                <p className="acc-lead">
                  يرى تفاصيل فرعه ويعدّل ما يخصّه، ولا يرى الفروع الأخرى ولا يُنشئ.
                </p>
                <p className="acc-choice__note">
                  <strong>الإنشاء للمالك</strong> · الفرع يستهلك من الباقة ويُنشئ مخزناً وصندوقاً —
                  التزامٌ مالي وتشغيلي.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" && blocked ? (
              <Notice
                kind="warning"
                title="إجراء محجوب"
                action={
                  <>
                    <Button
                      onClick={() => void close(blocked)}
                      loading={busy}
                      disabledReason={
                        blocked.ledger.stock_items > 0
                          ? "المخزون المتبقي يُحوَّل أولاً (INV-08)"
                          : blocked.ledger.open_shifts > 0
                            ? "وردية مفتوحة"
                            : undefined
                      }
                    >
                      إقفال الفرع بعد تحويل المخزون
                    </Button>
                    <Button variant="secondary" disabledReason="الحذف يترك فواتير بلا فرع">
                      حذف — غير متاح
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">
                  <strong>لا يمكن حذف «{blocked.name}»</strong> · الحذف يترك فواتير بلا فرع وأرصدة
                  بلا موضع، ويكسر تقارير أشهر مضت.
                </p>
                <p className="acc-choice__note">
                  <strong>ما يحمله هذا الفرع</strong> · فواتير صادرة {num(blocked.ledger.invoices)}{" "}
                  · ورديات مسجَّلة {num(blocked.ledger.shifts)} · مخزون حالي{" "}
                  {num(blocked.ledger.stock_items)} صنفاً · ذمم منسوبة لمعاملاته{" "}
                  {num((Number(blocked.ledger.receivables_minor) / 100).toFixed(2))}
                </p>
                <p className="acc-choice__note">
                  <strong>البديل: إقفال الفرع.</strong> يتوقف البيع والفتح فيه، ويبقى في التقارير
                  التاريخية وفي كل فاتورة تحمل اسمه. المخزون المتبقي يُحوَّل بـ INV-08 لا يختفي،
                  والذمم تبقى منسوبة لأطرافها.
                </p>
                {closeErr ? <p className="acc-choice__note">{closeErr}</p> : null}
                <h3 className="cat-head__title">الأجهزة المرتبطة</h3>
                <p className="acc-choice__note">
                  <strong>الجهاز يحمل معلّقاً محلياً — فصله ليس إلغاء اشتراك</strong> · قبل فصل أي
                  جهاز نعرض ما عليه من معلّق غير مزامَن ونطلب مزامنته أو الإقرار بفقده كتابةً. الفصل
                  الصامت يُضيّع بيعاً حدث فعلاً وقبض الكاشير ثمنه.
                </p>
                <ul className="acc-choice__note">
                  {blocked.devices.map((d) => {
                    const n = deviceNote(d);
                    return (
                      <li key={d.id}>
                        <strong>{d.name}</strong> ·{" "}
                        {n.text.split(/([0-9]+)/).map((p, i) =>
                          /^[0-9]+$/.test(p) ? (
                            <span key={i} className="sting-mono">
                              {p}
                            </span>
                          ) : (
                            p
                          ),
                        )}{" "}
                        · آخر مزامنة <Ago iso={d.last_seen_at} /> ·{" "}
                        <span className={`org-badge org-badge--${n.tone}`}>{n.label}</span>
                      </li>
                    );
                  })}
                </ul>
                <Button variant="quiet" onClick={() => setBlocked(null)}>
                  رجوع
                </Button>
              </Notice>
            ) : null}

            {data ? (
              <>
                <div className="cat-head">
                  <div>
                    <h3 className="cat-head__title">الفروع ومخازنها</h3>
                    <span className="cat-head__hint">
                      لكل فرع مخزنه وصناديقه وأجهزته وموظفوه. والحذف غير موجود: الفرع يُعطَّل ويبقى
                      تاريخه.
                    </span>
                  </div>
                  {data.can_create ? (
                    <Button pos onClick={() => setOpen(true)}>
                      فرع جديد
                    </Button>
                  ) : null}
                </div>
                <ul className="acc-choice__note">
                  {branches.map((b) => (
                    <li key={b.id} className="org-effects__row">
                      <div>
                        <strong>{b.name}</strong> · رمز <span className="sting-mono">{b.code}</span>
                        {b.is_default ? " · الرئيسي" : ""}
                        {!b.is_active ? " · مُقفل" : ""}
                        <p className="acc-choice__note">
                          فواتير {num(b.ledger.invoices)} · ورديات {num(b.ledger.shifts)} · أصناف
                          برصيد {num(b.ledger.stock_items)} · موظفون {num(b.staff)} · أجهزة{" "}
                          {num(b.devices.length)}
                          {b.code_locked ? " · الرمز ثابت بعد أول فاتورة" : ""}
                        </p>
                      </div>
                      <span className="cat-form__actions">
                        {data.can_create && b.is_active && !b.is_default ? (
                          <Button variant="quiet" onClick={() => setBlocked(b)}>
                            حذف
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  <strong>لا حذف</strong> · فرعٌ باع سنةً لا يُحذف — حذفه يُيتّم فواتير ومخزوناً.
                  التعطيل يمنع الجديد ويُبقي القديم مقروءاً.
                </p>
              </>
            ) : null}

            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/org/devices")}>
                الأجهزة
              </Button>
            </div>
          </div>
        </div>

        <Dialog
          open={open}
          kind="form"
          title="فرع جديد"
          onClose={() => setOpen(false)}
          primaryLabel="إنشاء الفرع"
          onPrimary={() => void create()}
          saving={busy}
          error={err ?? undefined}
        >
          <TextField
            label="اسم الفرع"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <TextField
            label="رمز الفرع في الترقيم"
            hint="حرفان إلى ستة لاتينية — يدخل رقم كل فاتورة ولا يتغيّر بعد أولها"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="sting-mono"
            required
          />
          <p className="acc-choice__note">
            <strong>الإنشاء للمالك</strong> · الفرع يستهلك من الباقة ويُنشئ مخزناً وصندوقاً —
            التزامٌ مالي وتشغيلي.
          </p>
        </Dialog>
      </div>
    </Frame>
  );
}
