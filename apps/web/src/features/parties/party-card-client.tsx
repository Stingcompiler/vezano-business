"use client";

import {
  maskPhone,
  readLocalParties,
  readPendingCreditByParty,
  storeParties,
} from "@sting/sync-core";
import { Button, SwitchField, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import { DayLabel } from "@/features/pos/invoices-client";
import { PosNav } from "@/features/pos/pos-nav";
import { parseAmount } from "@/features/pos/use-sale";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "saving" | "success" | "permission_denied" | "conflict";

export interface Card {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly aliases: readonly string[];
  readonly note: string;
  readonly credit_limit_minor: string;
  readonly is_customer: boolean;
  readonly is_supplier: boolean;
  readonly balance_minor: string;
  readonly supplier_owed_minor: string;
  readonly last_movement_at: string;
  readonly can_edit: boolean;
  readonly can_open_balance: boolean;
  readonly has_movements: boolean;
  readonly opening_balances: readonly { readonly side: string; readonly amount_minor: string }[];
  readonly potential_duplicates: readonly {
    readonly id: string;
    readonly name: string;
    readonly phone: string;
    readonly balance_minor: string;
  }[];
}

interface Form {
  name: string;
  phone: string;
  aliases: string;
  note: string;
  limit: string;
  isCustomer: boolean;
  isSupplier: boolean;
}

const formOf = (c: Card): Form => ({
  name: c.name,
  phone: c.phone,
  aliases: c.aliases.join("، "),
  note: c.note,
  limit:
    c.credit_limit_minor && c.credit_limit_minor !== "0"
      ? formatMinor(c.credit_limit_minor, 2, false)
      : "",
  isCustomer: c.is_customer,
  isSupplier: c.is_supplier,
});

/**
 * PTY-03 — بطاقة طرف (04-D2 ready · 40-D32 validation_error/saving/success/permission_denied ·
 * 15-D10 conflict): الشخص عميل ومورد معاً برصيدين منفصلين بلا مقاصة تلقائية (ACC-28)؛ الاسم فقط
 * إلزامي والهاتف اختياري والأسماء البديلة للبحث وحدّ الائتمان اختياري «غير محدد»؛ الكاشير يُنشئ
 * (POS-04) ولا يعدّل؛ التقارب يُعرض ولا يُدمج بالاسم (ACC-131).
 */
export function PartyCardClient({ partyId }: { partyId: string }) {
  const router = useRouter();
  const app = useApp();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [pending, setPending] = useState<bigint>(0n);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [denied, setDenied] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;
  const now = new Date();

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/${partyId}`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const pend = await readPendingCreditByParty(storage);
      setPending(pend.get(partyId)?.pendingMinor ?? 0n);
      try {
        const { data, response } = await api().GET("/api/parties/{party_id}", {
          params: { path: { party_id: partyId } },
        });
        const body = data as unknown as Card | undefined;
        if (!response.ok || !body) {
          // بلا خادم: البطاقة من الإسقاط المحلي بلا تعديل
          const local = (await readLocalParties(storage)).find((p) => p.id === partyId);
          setCard(
            local
              ? {
                  ...(local as unknown as Card),
                  aliases: (local as unknown as { aliases?: string[] }).aliases ?? [],
                  note: (local as unknown as { note?: string }).note ?? "",
                  supplier_owed_minor: "",
                  last_movement_at: local.last_sale_at,
                  can_edit: false,
                  can_open_balance: false,
                  has_movements: false,
                  opening_balances: [],
                  potential_duplicates: [],
                }
              : null,
          );
          return;
        }
        setCard(body);
        setForm(formOf(body));
        await storeParties(storage, [body as never], new Date().toISOString());
      } catch {
        setCard(null);
      }
    })();
  }, [partyId, router]);

  useEffect(() => {
    if (card === null) router.replace("/parties");
  }, [card, router]);

  const limitMinor = form ? (form.limit.trim() ? parseAmount(form.limit) : 0n) : 0n;
  const errors: Record<string, string> = { ...serverErrors };
  if (form && !form.name.trim()) errors["name"] = "الاسم إلزامي";
  if (form && form.limit.trim() && limitMinor === null) errors["limit"] = "مبلغ غير صالح";
  if (form && !form.isCustomer && !form.isSupplier) errors["role"] = "صفة واحدة على الأقل";
  const invalid = Object.keys(errors).length > 0;
  const dupes = card?.potential_duplicates ?? [];

  const state: State = denied
    ? "permission_denied"
    : phase === "saving"
      ? "saving"
      : phase === "saved"
        ? "success"
        : reviewing && dupes.length
          ? "conflict"
          : editing && attempted && invalid
            ? "validation_error"
            : "ready";

  const save = async () => {
    if (!card || !form || phase === "saving") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    setServerErrors({});
    try {
      const { data, response } = await api().PATCH("/api/parties/{party_id}", {
        params: { path: { party_id: card.id } },
        body: {
          name: form.name,
          phone: form.phone,
          aliases: form.aliases
            .split(/[،,]/)
            .map((a) => a.trim())
            .filter(Boolean),
          credit_limit_minor: (limitMinor ?? 0n).toString(),
          is_customer: form.isCustomer,
          is_supplier: form.isSupplier,
          note: form.note,
        },
      });
      if (response.status === 403) {
        setDenied(true);
        setPhase("idle");
        return;
      }
      const body = data as unknown as Card | undefined;
      if (response.status === 400) {
        const errs = (data as unknown as { errors?: { field: string; code: string }[] } | undefined)
          ?.errors;
        setServerErrors(Object.fromEntries((errs ?? []).map((e) => [e.field, e.code])));
        setPhase("idle");
        return;
      }
      if (!response.ok || !body) {
        setPhase("idle");
        return;
      }
      setCard(body);
      setForm(formOf(body));
      await storeParties(getStorage(), [body as never], new Date().toISOString());
      setEditing(false);
      setPhase("saved");
    } catch {
      setPhase("idle");
    }
  };

  const markDistinct = async (otherId: string) => {
    if (!card) return;
    const { response } = await api().POST("/api/parties/{party_id}/distinct", {
      params: { path: { party_id: otherId } },
      body: { other_id: card.id },
    });
    if (response.status === 403) {
      setDenied(true);
      return;
    }
    if (response.ok) {
      setCard({ ...card, potential_duplicates: dupes.filter((d) => d.id !== otherId) });
      if (dupes.length <= 1) setReviewing(false);
    }
  };

  const due = card ? BigInt(card.balance_minor || "0") + pending : 0n;

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={Boolean(card?.can_edit)} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {card?.is_customer && card.is_supplier
                ? "بطاقة طرف — الشخص عميل ومورد معاً"
                : "بطاقة طرف"}
            </h2>
            <span className="cat-head__hint">رصيدان منفصلان بلا مقاصة تلقائية.</span>
          </div>
          {card ? (
            <div className="acc-card__body">
              <div className="pty-card__head">
                <div>
                  <h3 className="pos-credit__title">{card.name}</h3>
                  {card.note ? <p className="acc-choice__note">{card.note}</p> : null}
                  {card.aliases.length ? (
                    <p className="acc-choice__note">{card.aliases.join(" · ")}</p>
                  ) : null}
                  {card.phone ? (
                    <p className="acc-choice__note">
                      <span className="sting-mono">{maskPhone(card.phone)}</span>
                    </p>
                  ) : null}
                </div>
                <div className="pos-chips" role="group" aria-label="الصفة">
                  {card.is_customer ? <span className="pos-chip pos-chip--on">عميل</span> : null}
                  {card.is_supplier ? <span className="pos-chip pos-chip--on">مورد</span> : null}
                </div>
              </div>

              {state === "permission_denied" ? (
                <Notice kind="locked" title="الكاشير يُنشئ ولا يعدّل">
                  <p className="acc-lead">
                    يُنشئ طرفاً سريعاً وقت البيع، ولا يعدّل بطاقة قائمة ولا حدّه الآجل.
                  </p>
                  <p className="acc-choice__note">
                    <strong>لماذا</strong> · تعديل البطاقة يمسّ طرفاً له دفتر. والإنشاء السريع حاجةُ
                    لحظة البيع.
                  </p>
                </Notice>
              ) : null}
              {state === "success" ? (
                <Notice kind="success" title="حُفظت البطاقة">
                  <p className="acc-lead">
                    نقول ما صار ممكناً: البيع الآجل له، والكشف، والسداد. أما رصيده الافتتاحي فبابه
                    «الرصيد الافتتاحي».
                  </p>
                  <p className="acc-choice__note">
                    <strong>لا رصيد ضمنياً</strong> · إنشاء الطرف لا يُنشئ رصيداً. الرصيد الافتتاحي
                    مستندٌ له شاشته وصلاحيته.
                  </p>
                </Notice>
              ) : null}
              {state === "saving" ? (
                <Notice kind="info" title="جارٍ الحفظ">
                  <p className="acc-lead">حفظٌ قصير. الأزرار معطّلة ولا تُغلق البطاقة.</p>
                </Notice>
              ) : null}
              {state === "validation_error" && errors["phone"] === "similar" ? (
                <Notice kind="warning" title="رقم هاتف يُشبه طرفاً قائماً">
                  <p className="acc-lead">
                    <strong>ننبّه ولا نمنع</strong> · قد يكون فرعاً ثانياً بنفس الرقم. نُظهر الطرف
                    القائم ونسأل: هذا هو أم جديد؟
                  </p>
                </Notice>
              ) : null}

              {state === "conflict" ? (
                <Notice kind="warning" title="طرفان باسم متقارب">
                  <p className="acc-lead">لا نقترح الدمج ولا نفعله تلقائياً.</p>
                  <p className="acc-choice__note">
                    الدمج يجمع ذمتين في رصيد واحد، فلو كانا شخصين طالبتَ أحدهما بدين غيره.
                  </p>
                  <ul className="pos-dup__list">
                    {dupes.map((d) => (
                      <li key={d.id} className="pty-dupe">
                        <span>
                          {d.name}
                          {d.phone ? (
                            <>
                              {" "}
                              · <span className="sting-mono">{maskPhone(d.phone)}</span>
                            </>
                          ) : null}
                        </span>
                        <span className="pty-actions">
                          <Button
                            variant="secondary"
                            onClick={() => void markDistinct(d.id)}
                            disabledReason={card.can_edit ? undefined : "لمدير الفرع أو المالك"}
                          >
                            وسمهما «مراجَعان ومنفصلان»
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => router.push(`/parties/${d.id}/merge?target=${card.id}`)}
                          >
                            دمج بتأكيد مزدوج
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="acc-choice__note">
                    <strong>لا دمج بالاسم</strong> · التقارب ليس دليل هوية. القرار للمستخدم والدمج
                    له شاشته.
                  </p>
                </Notice>
              ) : dupes.length && !editing ? (
                <Button variant="quiet" onClick={() => setReviewing(true)}>
                  تكرار محتمل: <span className="sting-mono">{dupes.length}</span>
                </Button>
              ) : null}

              {!editing ? (
                <>
                  {card.is_customer ? (
                    <div className="pty-side">
                      <div className="shift-facts">
                        <div>
                          <span className="shift-facts__k">بصفته عميلاً — عليه لنا</span>
                          <span className="shift-facts__v sting-mono">
                            {card.balance_minor === "" ? "—" : formatMinor(due.toString())}
                          </span>
                        </div>
                      </div>
                      <p className="acc-choice__note">
                        {card.last_movement_at ? (
                          <>
                            آخر بيع <DayLabel iso={card.last_movement_at} now={now} />
                          </>
                        ) : (
                          "لا بيع مسجَّل"
                        )}
                        {" · "}حد ائتمان مرن{" "}
                        {BigInt(card.credit_limit_minor || "0") > 0n ? (
                          <>
                            <span className="sting-mono">
                              {formatMinor(card.credit_limit_minor)}
                            </span>{" "}
                            — ينبّه عند التجاوز ولا يمنع البيع
                          </>
                        ) : (
                          "غير محدد"
                        )}
                      </p>
                      <Button
                        variant="secondary"
                        onClick={() => router.push(`/parties/${card.id}/statement`)}
                      >
                        كشف حساب العميل
                      </Button>
                    </div>
                  ) : null}
                  {card.is_supplier ? (
                    <div className="pty-side">
                      <div className="shift-facts">
                        <div>
                          <span className="shift-facts__k">بصفته مورداً — له علينا</span>
                          <span className="shift-facts__v sting-mono">
                            {card.supplier_owed_minor === ""
                              ? "—"
                              : formatMinor(card.supplier_owed_minor)}
                          </span>
                        </div>
                      </div>
                      <p className="acc-choice__note">
                        لا استلام مسجَّل بعد — الاستلام من «استلام البضاعة».
                      </p>
                      <Button
                        variant="secondary"
                        onClick={() => router.push(`/parties/${card.id}/statement?side=supplier`)}
                      >
                        كشف حساب المورد
                      </Button>
                    </div>
                  ) : null}
                  {card.is_customer && card.is_supplier ? (
                    <p className="acc-choice__note">
                      <strong>لا مقاصة تلقائية.</strong> الرصيدان مستقلان في دفترين. إن اتفقتَ معه
                      على خصم دينه من مستحقاته، سجّل ذلك بمستندَي سداد متقابلين بسبب واضح — لا يجري
                      النظام المقاصة نيابة عنك.
                    </p>
                  ) : null}
                  <div className="cat-form__actions">
                    <Button
                      onClick={() => {
                        if (!card.can_edit) {
                          setDenied(true);
                          return;
                        }
                        setPhase("idle");
                        setEditing(true);
                      }}
                    >
                      تعديل البطاقة
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/parties/${card.id}/opening`)}
                      disabledReason={card.can_open_balance ? undefined : "الافتتاحي للمالك"}
                    >
                      رصيد افتتاحي
                    </Button>
                    <Button variant="quiet" onClick={() => router.push("/parties")}>
                      قائمة العملاء
                    </Button>
                  </div>
                </>
              ) : form ? (
                <>
                  <TextField
                    label="الاسم"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    error={attempted ? errors["name"] : undefined}
                    required
                  />
                  <TextField
                    label="الهاتف"
                    kind="tel"
                    mono
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    hint="اختياري"
                  />
                  <TextField
                    label="أسماء بديلة"
                    value={form.aliases}
                    onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                    hint="للبحث — تُفصل بفاصلة"
                  />
                  <TextField
                    label="حد الائتمان"
                    mono
                    value={form.limit}
                    onChange={(e) => setForm({ ...form, limit: e.target.value })}
                    hint="اختياري · تنبيه لا منع — فارغ = غير محدد"
                    error={attempted ? errors["limit"] : undefined}
                  />
                  <TextField
                    label="ملاحظة"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                  />
                  <SwitchField
                    label="عميل"
                    checked={form.isCustomer}
                    onChange={(v) => setForm({ ...form, isCustomer: v })}
                  />
                  <SwitchField
                    label="مورد"
                    checked={form.isSupplier}
                    onChange={(v) => setForm({ ...form, isSupplier: v })}
                    {...(attempted && errors["role"] ? { hint: errors["role"] } : {})}
                  />
                  <div className="cat-form__actions">
                    <Button financial onClick={() => void save()} loading={phase === "saving"}>
                      حفظ البطاقة
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setEditing(false);
                        setForm(formOf(card));
                        setAttempted(false);
                      }}
                      disabledReason={phase === "saving" ? "جارٍ الحفظ" : undefined}
                    >
                      إلغاء
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="acc-card__body">
              <Status state="loading" label="جلب الأطراف" />
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
}
