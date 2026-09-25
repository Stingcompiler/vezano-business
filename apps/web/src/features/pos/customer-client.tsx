"use client";

import {
  type CartDraft,
  cartTotals,
  createPartyLocally,
  findSimilarLocal,
  type LocalParty,
  maskPhone,
  readCartDraft,
  readLocalParties,
  searchLocalParties,
  writeCartDraft,
} from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { PosNav } from "./pos-nav";

type State = "ready" | "empty" | "validation_error" | "permission_denied" | "offline";

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** «آخر بيع 08 سبتمبر» — الرقم في mono والشهر خارجه. */
function DayMonth({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <>
      <span className="sting-mono">{String(d.getDate()).padStart(2, "0")}</span>{" "}
      {MONTHS[d.getMonth()]}
    </>
  );
}

/** الرصيد كما يُقرأ: «120.00 عليه» / «0.00 لا رصيد». */
function Balance({ minor }: { minor: string }) {
  const v = BigInt(minor || "0");
  return (
    <span className="pos-party__balance">
      <span className="sting-mono">{formatMinor((v < 0n ? -v : v).toString())}</span>
      <span className="acc-choice__note">{v > 0n ? "عليه" : v < 0n ? "له" : "لا رصيد"}</span>
    </span>
  );
}

/**
 * POS-04 — اختيار عميل وإنشاء سريع (03-D2 ready/validation_error · 42-D34 empty/validation_error/
 * permission_denied/offline). العميل مطلوب للأثر الآجل فقط — لا عميل وهمي للبيع النقدي (ACC-12).
 * الإنشاء بالاسم فقط (§٧.٥) وفي المكان: حقلان لحظة البيع والبطاقة الكاملة لاحقاً (PTY-03).
 * التشابه المضلل (الاسم نفسه/الهاتف نفسه) يُعرض ويُسأل عنه قبل الإنشاء — لا يُمنع ولا يُدمج؛
 * والفحص الخادمي يكتمل عند المزامنة وقد ينتج مراجعة دمج (PTY-07).
 */
export function CustomerClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [parties, setParties] = useState<LocalParty[]>([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [similar, setSimilar] = useState<{ byName: LocalParty | null; byPhone: LocalParty | null }>(
    { byName: null, byPhone: null },
  );
  const [overLimit, setOverLimit] = useState<LocalParty | null>(null);
  const [busy, setBusy] = useState(false);
  const opIds = useRef({ operationId: "", partyId: "" });
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos%2Fcustomer");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [d, c, p] = await Promise.all([
        readCartDraft(storage),
        readShiftContext(storage, app),
        readLocalParties(storage),
      ]);
      setDraft(d);
      setCtx(c);
      setParties(p);
    })();
  }, [router]);

  const totals = draft ? cartTotals(draft.lines, draft.discount) : null;
  const results = searchLocalParties(parties, q);

  const choose = async (p: LocalParty) => {
    if (!draft) return;
    const limit = BigInt(p.credit_limit_minor || "0");
    if (limit > 0n && BigInt(p.balance_minor || "0") + (totals?.totalMinor ?? 0n) > limit) {
      // آجل فوق حدّ ائتمان العميل: الكاشير لا يرفع الحدّ — يطلب تفويضاً أو يقبض نقداً
      setOverLimit(p);
      return;
    }
    await writeCartDraft(getStorage(), { ...draft, customer: { id: p.id, name: p.name } });
    router.push("/pos");
  };
  const cashOnly = async () => {
    if (!draft) return;
    await writeCartDraft(getStorage(), { ...draft, customer: undefined });
    router.push("/pos");
  };
  const startCreate = (prefill: string) => {
    setCreating(true);
    setName(prefill);
    setPhone("");
    setSimilar({ byName: null, byPhone: null });
  };
  const create = async (distinctFromId?: string) => {
    if (!name.trim() || busy) return;
    if (!distinctFromId) {
      const sim = findSimilarLocal(parties, name, phone);
      if (sim.byName[0] || sim.byPhone[0]) {
        setSimilar({ byName: sim.byName[0] ?? null, byPhone: sim.byPhone[0] ?? null });
        return;
      }
    }
    setBusy(true);
    try {
      if (!opIds.current.operationId)
        opIds.current = { operationId: crypto.randomUUID(), partyId: crypto.randomUUID() };
      const { party } = await createPartyLocally(getStorage(), {
        ...opIds.current,
        name,
        phone,
        distinctFromPartyId: distinctFromId,
        occurredAt: new Date().toISOString(),
      });
      if (online) void pushPending();
      await choose(party);
    } finally {
      setBusy(false);
    }
  };

  const state: State = overLimit
    ? "permission_denied"
    : similar.byName || similar.byPhone
      ? "validation_error"
      : q.trim() && results.length === 0 && !creating
        ? "empty"
        : !online
          ? "offline"
          : "ready";

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="pos" canSeeReports={ctx?.roleName === "مالك"} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">{creating ? "عميل جديد" : "اختيار العميل"}</h2>
            {totals ? (
              <span className="cat-head__hint">
                الإجمالي{" "}
                <span className="sting-mono">{formatMinor(totals.totalMinor.toString())}</span>
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {state === "offline" ? (
              <Notice kind="offline" title="اختيار عميل بلا اتصال">
                <p className="acc-lead">البحث في أطراف الجهاز، والإنشاء السريع محلي.</p>
                <p className="acc-lead">
                  <strong>التشابه يُفحص لاحقاً</strong> · فحص «الرقم مسجَّل على طرف آخر» يكتمل عند
                  المزامنة، وقد ينتج مراجعة دمج. نقولها عند الإنشاء لا نفاجئ بها بعده.
                </p>
              </Notice>
            ) : null}

            {overLimit ? (
              <Notice
                kind="locked"
                title="آجل فوق حدّ ائتمان العميل"
                action={
                  <>
                    <Button onClick={() => void cashOnly()}>بيع نقدي بلا عميل</Button>
                    <Button variant="secondary" onClick={() => setOverLimit(null)}>
                      اختيار العميل
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">البيع يرفع الرصيد فوق الحدّ المضبوط في بطاقته.</p>
                <p className="acc-lead">
                  <strong>الكاشير لا يرفع الحدّ</strong> · يطلب تفويضاً أو يقبض نقداً. رفع الحدّ
                  قرار على بطاقة الطرف بصلاحيته لا في لحظة البيع.
                </p>
                <p className="acc-choice__note">
                  {overLimit.name} · عليه{" "}
                  <span className="sting-mono">{formatMinor(overLimit.balance_minor)}</span> · الحدّ{" "}
                  <span className="sting-mono">{formatMinor(overLimit.credit_limit_minor)}</span>
                </p>
              </Notice>
            ) : null}

            {!creating ? (
              <>
                <TextField
                  label="اختيار العميل"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  inputMode="search"
                />
                {state === "empty" ? (
                  <Notice
                    kind="empty"
                    title="لا نتائج بحث"
                    action={<Button onClick={() => startCreate(q.trim())}>أنشئ: {q.trim()}</Button>}
                  >
                    <p className="acc-lead">الاسم المكتوب لا يطابق أحداً.</p>
                    <p className="acc-choice__note">
                      باسمٍ وهاتف — حقلان لحظة البيع، والبطاقة الكاملة لاحقاً.
                    </p>
                  </Notice>
                ) : (
                  <ul className="pos-parties" aria-label="العملاء">
                    {results.slice(0, 20).map((p) => (
                      <li key={p.id}>
                        <button type="button" className="pos-party" onClick={() => void choose(p)}>
                          <span className="pos-party__main">
                            <span className="pos-party__name">{p.name}</span>
                            <span className="acc-choice__note">
                              {p.phone ? (
                                <span className="sting-mono">{maskPhone(p.phone)}</span>
                              ) : null}
                              {p.phone && p.last_sale_at ? " · " : null}
                              {p.last_sale_at ? (
                                <>
                                  آخر بيع <DayMonth iso={p.last_sale_at} />
                                </>
                              ) : null}
                            </span>
                          </span>
                          <Balance minor={p.balance_minor} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="cat-form__actions">
                  <Button variant="secondary" onClick={() => startCreate(q.trim())}>
                    إنشاء عميل جديد
                  </Button>
                  <Button variant="secondary" onClick={() => void cashOnly()}>
                    بيع نقدي بلا عميل
                  </Button>
                </div>
              </>
            ) : (
              <>
                <TextField
                  label="الاسم"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSimilar({ byName: null, byPhone: null });
                  }}
                  required
                />
                <TextField
                  label="الهاتف"
                  mono
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setSimilar({ byName: null, byPhone: null });
                  }}
                />
                {similar.byName ? (
                  <Notice
                    kind="error"
                    title="يوجد عميل بنفس الاسم"
                    action={
                      <>
                        <Button onClick={() => void choose(similar.byName!)}>
                          استخدام العميل الموجود
                        </Button>
                        <Button variant="secondary" onClick={() => void create(similar.byName!.id)}>
                          إنشاء منفصل مع تمييز
                        </Button>
                      </>
                    }
                  >
                    <p className="acc-lead">
                      «{similar.byName.name}» عليه{" "}
                      <span className="sting-mono">
                        {formatMinor(similar.byName.balance_minor)}
                      </span>
                      . إنشاء ثانٍ بنفس الاسم يفصل الرصيدين ويصعّب التحصيل لاحقاً.
                    </p>
                  </Notice>
                ) : similar.byPhone ? (
                  <Notice
                    kind="error"
                    title="هاتف مسجَّل على طرف قائم"
                    action={
                      <>
                        <Button onClick={() => void choose(similar.byPhone!)}>هذا هو</Button>
                        <Button
                          variant="secondary"
                          onClick={() => void create(similar.byPhone!.id)}
                        >
                          طرف جديد بنفس الرقم
                        </Button>
                      </>
                    }
                  >
                    <p className="acc-lead">الرقم المدخل رقم «{similar.byPhone.name}».</p>
                  </Notice>
                ) : null}
                <div className="cat-form__actions">
                  <Button
                    financial
                    onClick={() => void create()}
                    loading={busy}
                    disabledReason={name.trim() ? undefined : "الاسم"}
                  >
                    أنشئ: {name.trim() || "—"}
                  </Button>
                  <Button variant="secondary" onClick={() => setCreating(false)}>
                    اختيار العميل
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
