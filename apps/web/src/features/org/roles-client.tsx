"use client";

import { Button, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { MonoText } from "@/features/org/mono";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "permission_denied" | "success";

type CellValue =
  "yes" | "no" | "unlimited" | "limit" | "branch" | "own_customer" | "cash_only" | "propose";
interface Cell {
  role_id: string;
  label: string;
  value: CellValue;
  limit_minor: string | null;
  period: string;
}
interface RowT {
  key: string;
  label: string;
  note: string;
  financial: boolean;
  cells: Cell[];
}
interface Matrix {
  tenant_name?: string;
  roles: { id: string; code: string; name: string; users: number; locked: boolean }[];
  rows: RowT[];
  can_edit: boolean;
  changed_cells?: number;
  affected_users?: number;
}

const VALUE_OPTIONS: { value: CellValue; label: string }[] = [
  { value: "yes", label: "نعم" },
  { value: "no", label: "لا" },
  { value: "unlimited", label: "بلا حد" },
  { value: "limit", label: "حد مالي" },
  { value: "branch", label: "فرعه" },
  { value: "own_customer", label: "عميل البيع فقط" },
  { value: "cash_only", label: "نقداً فقط" },
  { value: "propose", label: "اقتراح فقط" },
];

/** «الإجراء وأثره» (20-D15): كل بند جملة — من يستطيع، وما يقع من أثر. */
const EFFECTS: { action: string; effect: string; roles: [string, string, string, string] }[] = [
  {
    action: "بيع نقدي وإصدار فاتورة",
    effect: "يُسجَّل باسمه وينسب لورديته",
    roles: ["نعم", "نعم", "نعم", "نعم"],
  },
  {
    action: "بيع بالذمة",
    effect: "يُنشئ ديناً على طرف — أثره مالي يتجاوز الوردية",
    roles: ["نعم", "لا", "نعم", "نعم"],
  },
  {
    action: "إلغاء فاتورة بعد إصدارها",
    effect: "لا حذف؛ مرتجع أو قيد عكسي بسبب مكتوب",
    roles: ["لا", "لا", "باعتماد", "نعم"],
  },
  {
    action: "تسوية جرد وتعديل كميات",
    effect: "يغيّر رقم المخزون بلا حركة بيع أو شراء",
    roles: ["لا", "باعتماد", "نعم", "نعم"],
  },
  {
    action: "اعتماد فارق الوردية",
    effect: "شهادة بأن العجز أو الزيادة مقبولان — لا يشهد أحد لنفسه",
    roles: ["لا", "لا", "نعم", "نعم"],
  },
  {
    action: "حسم تعارض نسختين",
    effect: "يختار أي رقم يصبح الحقيقة في الدفتر",
    roles: ["لا", "لا", "لا", "نعم"],
  },
  {
    action: "قراءة سجل التدقيق",
    effect: "نطاق الرؤية يتبع نطاق المسؤولية",
    roles: ["أفعاله", "أفعاله", "فرعه", "نعم"],
  },
  {
    action: "نقل ملكية المنشأة",
    effect: "ينقل الدفتر كله لشخص آخر",
    roles: ["لا", "لا", "لا", "نعم"],
  },
];
const EFFECT_ROLES = ["كاشير", "أمين مخزن", "مدير فرع", "مالك"];

/**
 * ORG-02 — مصفوفة الأدوار والصلاحيات (07-D3 ready · 20-D15 validation_error · 39-D31
 * permission_denied/success): الصلاحية تُمنح للدور والنطاق للمستخدم في الفرع؛ الحدود المالية قيم
 * تجريبية تُحرَّر هنا (G-09)؛ المصفوفة للمالك وحده تعديلاً؛ عمود المالك مقفل؛ الحفظ يقول الأثر
 * بالعدد ويسري عند الفعل التالي لا في لحظته.
 */
export function RolesClient() {
  const router = useRouter();
  const app = useApp();
  const [m, setM] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Map<string, Cell>>(new Map());
  const [saved, setSaved] = useState<{ cells: number; users: number } | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/org/roles", {});
    if (response.status === 403) {
      setM({ roles: [], rows: [], can_edit: false });
      return;
    }
    if (response.ok && data) setM(data);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Froles");
      return;
    }
    void load().catch(() => setM({ roles: [], rows: [], can_edit: false }));
  }, [router, load]);

  const cellKey = (roleId: string, key: string) => `${roleId}:${key}`;
  const current = (row: RowT, c: Cell): Cell => draft.get(cellKey(c.role_id, row.key)) ?? c;
  const edit = (row: RowT, c: Cell, patch: Partial<Cell>) => {
    setSaved(null);
    setRejected(null);
    setDraft((d) => new Map(d).set(cellKey(c.role_id, row.key), { ...current(row, c), ...patch }));
  };

  const save = async () => {
    if (busy || !m) return;
    setBusy(true);
    setRejected(null);
    try {
      const changes = [...draft.entries()].map(([k, c]) => ({
        role_id: c.role_id,
        key: k.split(":")[1]!,
        value: c.value,
        limit_minor: c.value === "limit" ? c.limit_minor : null,
        period: c.value === "limit" ? c.period || "per_op" : "",
      }));
      const { data, error, response } = await api().PUT("/api/org/roles", { body: { changes } });
      if (!response.ok) {
        const e = error as unknown as { detail?: string } | undefined;
        setRejected(e?.detail ?? "failed");
        return;
      }
      const out = data as unknown as Matrix;
      setM(out);
      setDraft(new Map());
      setSaved({ cells: out.changed_cells ?? 0, users: out.affected_users ?? 0 });
    } finally {
      setBusy(false);
    }
  };

  const state: State = !m
    ? "ready"
    : !m.can_edit
      ? "permission_denied"
      : rejected
        ? "validation_error"
        : saved
          ? "success"
          : "ready";

  const rejectText =
    rejected === "owner_locked"
      ? "لا يمكن للمالك أن يسحب صلاحيته الأخيرة عن نفسه: المنشأة بلا مالك تصبح دفتراً لا يملك أحد حسم تعارضاته."
      : rejected === "limit_required"
        ? "الحدّ المالي يحتاج قيمة ونطاقاً (للعملية أو يومياً) قبل الحفظ."
        : rejected
          ? "تعذّر حفظ المصفوفة — لم يتغيّر شيء."
          : "";

  return (
    <Frame title="الأدوار" nav={<AppNav currentId="org-roles" />} footer={null}>
      <div className="sys" data-screen="ORG-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مصفوفة الأدوار والصلاحيات</h2>
            <span className="cat-head__hint">
              الفرع والحد المالي وفصل النشر عن الاعتماد. الحدود قابلة للتحرير والقيم تجريبية — قرار
              G-09.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="warning" title="المصفوفة للمالك وحده">
                <p className="acc-lead">
                  مدير الفرع يرى أدوار فريقه ولا يعدّل المصفوفة — تعديلها يُغيّر ما يستطيعه كل موظف
                  في المنشأة.
                </p>
                <p className="acc-choice__note">
                  <strong>لماذا لا حتى لفرعه</strong> · الأدوار معرّفة على مستوى المنشأة لا الفرع.
                  تعديلٌ «لفرعه» يسري على الجميع، وهذا ليس ما يقصده.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="error" title="لا يمكن إنشاء دور بلا مالك قادر على سحبه.">
                <p className="acc-lead">{rejectText}</p>
              </Notice>
            ) : null}

            {state === "success" && saved ? (
              <Notice kind="success" title="حُفظت المصفوفة">
                <p className="acc-lead">
                  نقول الأثر بالعدد: «تغيّرت صلاحيات{" "}
                  <span className="sting-mono">{saved.users}</span> موظفين». والحدود المالية بقيمها
                  ونطاقها (يومي أو للعملية).
                </p>
                <p className="acc-choice__note">
                  <strong>يسري فوراً</strong> · ومن كان في منتصف عمل يُطبَّق عليه عند فعله التالي لا
                  في لحظته. ولا يُقطع عليه بيعٌ جارٍ.
                </p>
              </Notice>
            ) : null}

            {m && m.rows.length > 0 ? (
              <>
                <div className="cat-head">
                  <div>
                    <h3 className="cat-head__title">الأدوار في {m.tenant_name ?? "المنشأة"}</h3>
                    <span className="cat-head__hint">
                      الصلاحية تُمنح للدور، والنطاق يُمنح للمستخدم في الفرع
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    disabledReason="الأدوار المخصَّصة في مرحلة لاحقة (§١١.٣)"
                  >
                    دور مخصَّص
                  </Button>
                </div>
                <div className="c-table" role="region" aria-label="مصفوفة الأدوار">
                  <table className="c-table__table">
                    <caption className="c-table__caption">مصفوفة الأدوار والصلاحيات</caption>
                    <thead>
                      <tr>
                        <th scope="col">الصلاحية</th>
                        {m.roles.map((r) => (
                          <th key={r.id} scope="col">
                            {r.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {m.rows.map((row) => (
                        <tr
                          key={row.key}
                          className={
                            row.financial
                              ? "org-matrix__financial"
                              : row.key === "campaign_approve"
                                ? "org-matrix__sep"
                                : undefined
                          }
                        >
                          <th scope="row">
                            <strong>{row.label}</strong>
                            <p className="acc-choice__note">
                              <MonoText text={row.note} />
                            </p>
                          </th>
                          {row.cells.map((c) => {
                            const role = m.roles.find((r) => r.id === c.role_id);
                            const cur = current(row, c);
                            const editable = m.can_edit && role && !role.locked;
                            return (
                              <td key={c.role_id}>
                                <span className="org-cell">
                                  <span className="org-badge org-badge--active">
                                    <MonoText
                                      text={
                                        cur.value === c.value && cur.limit_minor === c.limit_minor
                                          ? c.label
                                          : "—"
                                      }
                                    />
                                  </span>
                                  {editable ? (
                                    <>
                                      <select
                                        className="c-field__input"
                                        aria-label={`${row.label} — ${role.name}`}
                                        value={cur.value}
                                        onChange={(e) =>
                                          edit(row, c, {
                                            value: e.target.value as CellValue,
                                            period:
                                              e.target.value === "limit"
                                                ? cur.period || "per_op"
                                                : "",
                                          })
                                        }
                                      >
                                        {VALUE_OPTIONS.map((o) => (
                                          <option key={o.value} value={o.value}>
                                            {o.label}
                                          </option>
                                        ))}
                                      </select>
                                      {cur.value === "limit" ? (
                                        <span className="org-cell__limit">
                                          <input
                                            className="c-field__input sting-mono"
                                            inputMode="numeric"
                                            aria-label={`حدّ ${row.label} — ${role.name}`}
                                            value={
                                              cur.limit_minor
                                                ? String(Number(cur.limit_minor) / 100)
                                                : ""
                                            }
                                            onChange={(e) => {
                                              const n = Number(
                                                e.target.value.replace(/[^0-9.]/g, ""),
                                              );
                                              edit(row, c, {
                                                limit_minor: Number.isFinite(n)
                                                  ? String(Math.round(n * 100))
                                                  : null,
                                              });
                                            }}
                                          />
                                          <select
                                            className="c-field__input"
                                            aria-label={`نطاق ${row.label} — ${role.name}`}
                                            value={cur.period || "per_op"}
                                            onChange={(e) =>
                                              edit(row, c, { period: e.target.value })
                                            }
                                          >
                                            <option value="per_op">للعملية</option>
                                            <option value="daily">يومياً</option>
                                          </select>
                                        </span>
                                      ) : null}
                                    </>
                                  ) : null}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="acc-choice__note">
                  <strong>الحدود المالية قيم تجريبية.</strong> كل حد يقبل قيمة ووحدة ونطاقاً
                  (للعملية أو يومياً) ويُحرَّر هنا. لم تُعتمد أرقام فعلية بعد — G-09. وفصل «إنشاء
                  الحملة» عن «اعتمادها ونشرها» متعمَّد: من يكتب الرسالة لا يرسلها وحده.
                </p>
                {m.can_edit ? (
                  <div className="cat-form__actions">
                    <Button
                      pos
                      onClick={() => void save()}
                      loading={busy}
                      disabledReason={draft.size === 0 ? "لا تغيير بعد" : undefined}
                    >
                      حفظ المصفوفة
                    </Button>
                    {draft.size > 0 ? (
                      <Button variant="quiet" onClick={() => setDraft(new Map())}>
                        تراجع
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            <h3 className="cat-head__title">الأدوار والصلاحيات — ما يراه كل دور بالضبط</h3>
            <p className="acc-choice__note">
              الصلاحية ليست قائمة مربّعات. كل بند هنا يُقرأ كجملة: «يستطيع فلان أن يفعل كذا فيقع أثر
              كذا».
            </p>
            <p className="acc-choice__note">
              <strong>لا يمكن إنشاء دور بلا مالك قادر على سحبه.</strong> ولا يمكن للمالك أن يسحب
              صلاحيته الأخيرة عن نفسه: المنشأة بلا مالك تصبح دفتراً لا يملك أحد حسم تعارضاته. ودعوة
              المستخدم تنتهي بمهلة معلنة: الرابط المنتهي يقول «انتهت صلاحية الدعوة» ويطلب إعادة
              إرسالها، ولا يمنح دخولاً صامتاً.
            </p>
            <div className="org-effects">
              <div className="org-effects__row">
                <strong>الإجراء وأثره</strong>
                <span className="org-effects__roles">
                  {EFFECT_ROLES.map((r) => (
                    <span key={r}>{r}</span>
                  ))}
                </span>
              </div>
              {EFFECTS.map((e) => (
                <div key={e.action} className="org-effects__row">
                  <div>
                    <strong>{e.action}</strong>
                    <p className="acc-choice__note">{e.effect}</p>
                  </div>
                  <span className="org-effects__roles">
                    {e.roles.map((v, i) => (
                      <span key={i}>
                        {EFFECT_ROLES[i]}: {v}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>

            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/org/users")}>
                المستخدمون والدعوات
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
