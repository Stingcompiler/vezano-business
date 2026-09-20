"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { PhaseScreenClient } from "@/features/phase/phase-screen-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface Link {
  id: string;
  party_id: string;
  counterparty_tenant_id: string;
  counterparty_name: string;
  status: "requested" | "accepted" | "rejected" | "cancelled";
  status_label: string;
  requested_at: string;
  decided_at: string;
  decided_by_name: string;
}
interface PartyRow {
  party_id: string;
  party_name: string;
  created_at: string;
  documents: number;
  balance_minor: string;
  link: Link | null;
}
interface Candidate {
  tenant_id: string;
  public_name: string;
  badge: string;
  badge_label: string;
  offers: number;
  category_line: string;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_link: boolean;
  parties: PartyRow[];
  linked_count: number;
}

const docsWord = (n: number) =>
  n === 1 ? "مستند واحد" : n === 2 ? "مستندان" : n <= 10 ? `${n} مستندات` : `${n} مستنداً`;
const offersWord = (n: number) =>
  n === 1 ? "عرض واحد" : n === 2 ? "عرضان" : n <= 10 ? `${n} عروض` : `${n} عرضاً`;
const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d ?? ""}/${m ?? ""}`;
};

/** LINK-01 — ربط الطرف المحلي بمنشأة (29-D22 ready/validation_error · 38-D30 permission_denied/success): موافقة وهوية، لا دمج بالاسم (ACC-131). */
export function LinkPartiesClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [current, setCurrent] = useState<PartyRow | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Link | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/link/parties");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Flink%2Fparties");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const search = async (text: string) => {
    setQ(text);
    const { data, response } = await api().GET("/api/market/link/parties", {
      params: { query: { q: text } },
    });
    const b = data as unknown as { candidates: Candidate[] } | undefined;
    if (response.ok && b) setCandidates(b.candidates);
  };

  const open = async (p: PartyRow) => {
    setCurrent(p);
    setErr("");
    setChosen("");
    setDone(null);
    await search(p.party_name);
  };

  const request = async (p: PartyRow) => {
    if (busy) return;
    setBusy("request");
    setErr("");
    try {
      const r = await api().POST("/api/market/link/parties/{party_id}/{action}", {
        params: { path: { party_id: p.party_id, action: "request" } },
        body: { counterparty_tenant_id: chosen } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { link?: Link; detail?: string; extra?: { candidates?: Candidate[] } } | undefined;
      if (r.response.ok && b?.link) {
        setDone(b.link);
        await load();
        return;
      }
      if (b?.detail === "ambiguous_name") setCandidates(b.extra?.candidates ?? []);
      setErr(b?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const cancel = async (p: PartyRow) => {
    if (busy) return;
    setBusy("cancel");
    try {
      const r = await api().POST("/api/market/link/parties/{party_id}/{action}", {
        params: { path: { party_id: p.party_id, action: "cancel" } },
        body: {} as never,
      });
      if (r.response.ok) {
        setCurrent(null);
        await load();
      }
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="LINK-01" />;

  const state: State =
    err === "permission_denied" || (data && !data.can_link)
      ? "permission_denied"
      : done
        ? "success"
        : err === "ambiguous_name"
          ? "validation_error"
          : "ready";
  const chosenCand = candidates?.find((c) => c.tenant_id === chosen) ?? null;

  return (
    <Frame title="الربط" nav={<AppNav currentId="parties" />} footer={null}>
      <div className="sys mp cus" data-screen="LINK-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              ربط الطرف المحلي بمنشأة — موافقة وهوية، لا دمج بالاسم
            </h2>
            <span className="cat-head__hint">
              «مخزن البركة» في دفترك اسم كتبته أنت. ربطه بمنشأة حقيقية في السوق يحتاج موافقتها —
              التشابه في الاسم ليس هوية.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="الربط للمالك">
                <p className="acc-lead">
                  الربط يجعل مستندات السوق تدخل دفتر طرفٍ محلي — أثرٌ مالي مباشر.
                </p>
                <p className="acc-choice__note">
                  <strong>لا ربط بالاسم</strong> · حتى للمالك: التطابق بالاسم ليس دليل هوية
                  (ACC-131). الربط يحتاج تأكيداً من الطرفين.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" && candidates ? (
              <Notice kind="warning" title="اسمان متشابهان ليسا طرفاً واحداً">
                <p className="acc-lead">
                  في السوق{" "}
                  {candidates.length === 3 ? (
                    "ثلاث منشآت"
                  ) : candidates.length === 2 ? (
                    "منشأتان"
                  ) : candidates.length === 1 ? (
                    "منشأة"
                  ) : (
                    <>
                      <span className="sting-mono">{candidates.length}</span> منشأة
                    </>
                  )}{" "}
                  باسم قريب. لا نختار عنك ولا نقترح «الأرجح» — نعرض{" "}
                  {candidates.length === 3 ? "الثلاث" : "المرشّحات"} بمعرّفاتها وننتظر اختيارك، لأن
                  ربطاً خاطئاً يُرسل ذمّتك إلى غير صاحبها.
                </p>
              </Notice>
            ) : null}
            {state === "success" && done ? (
              <Notice
                kind="success"
                title={
                  done.status === "accepted"
                    ? "رُبط الطرفان"
                    : "أُرسل طلب الربط — بانتظار موافقة المنشأة"
                }
                action={
                  <Button
                    onClick={() => {
                      setDone(null);
                      setCurrent(null);
                    }}
                  >
                    التالي
                  </Button>
                }
              >
                <p className="acc-lead">
                  {done.status === "accepted"
                    ? "نقول ما صار ممكناً وما لم يتغيّر: مستندات السوق تقترح دخول دفتره، ورصيده لم يتغيّر بالربط."
                    : "بلا قبولها لا ربط — ولو تطابق الاسم حرفاً بحرف. رصيد الطرف لم يتغيّر."}
                </p>
                <p className="acc-choice__note">
                  <strong>الربط مطابقة لا دمج</strong> · دفتر كل طرف يبقى دفتره. الربط جسرٌ يعبر
                  عليه المستند بموافقتك، لا دمجُ رصيدين.
                </p>
              </Notice>
            ) : null}
            {err && !["ambiguous_name", "permission_denied"].includes(err) ? (
              <Notice kind="warning" title="لم يُرسل">
                <p className="acc-lead">
                  {err === "link_exists"
                    ? "لهذا الطرف طلب ربط قائم."
                    : err === "counterparty_not_published"
                      ? "المنشأة المختارة لم تنشر صفحتها بعد."
                      : err}
                </p>
              </Notice>
            ) : null}

            {data && !current ? (
              <>
                <h3 className="cat-head__title">
                  الموردون في دفترك — مربوط <span className="sting-mono">{data.linked_count}</span>{" "}
                  من <span className="sting-mono">{data.parties.length}</span>
                </h3>
                {data.parties.length === 0 ? (
                  <p className="acc-choice__note">
                    لا موردين في دفترك بعد — الأطراف في دفترك (PTY-01).
                  </p>
                ) : null}
                <ul className="cus-list">
                  {data.parties.map((p) => (
                    <li key={p.party_id}>
                      <Button
                        variant="quiet"
                        onClick={() => void open(p)}
                        disabledReason={data.can_link ? undefined : "الربط للمالك"}
                      >
                        {p.party_name}
                      </Button>
                      <div className="cus-sub">
                        أنشأته <span className="sting-mono">{dm(p.created_at)}</span> ·{" "}
                        {docsWord(p.documents)} ·{" "}
                        {Number(p.balance_minor) !== 0 ? "ذمّة قائمة" : "بلا ذمّة"}
                      </div>
                      {p.link ? (
                        <Status
                          state={p.link.status === "accepted" ? "success" : "stale"}
                          label={
                            p.link.status === "accepted"
                              ? `مربوط بـ${p.link.counterparty_name}`
                              : p.link.status_label
                          }
                        />
                      ) : (
                        <Status state="saved_local" label="غير مربوط" />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {current ? (
              <>
                <h3 className="cat-head__title">الطرف في دفترك</h3>
                <p className="acc-choice__note">
                  <strong>{current.party_name}</strong> · أنشأته{" "}
                  <span className="sting-mono">{dm(current.created_at)}</span> ·{" "}
                  {docsWord(current.documents)} ·{" "}
                  {Number(current.balance_minor) !== 0 ? "ذمّة قائمة" : "بلا ذمّة"}
                  {Number(current.balance_minor) !== 0 ? (
                    <>
                      {" "}
                      (<span className="sting-mono">{formatMinor(current.balance_minor)}</span>)
                    </>
                  ) : null}
                </p>
                {current.link &&
                current.link.status !== "cancelled" &&
                current.link.status !== "rejected" ? (
                  <>
                    <h3 className="cat-head__title">المنشأة في السوق</h3>
                    <p className="acc-choice__note">
                      <strong>{current.link.counterparty_name}</strong> ·{" "}
                      {current.link.status_label}
                    </p>
                    <div className="acc-actions">
                      <Button
                        variant="quiet"
                        loading={busy === "cancel"}
                        onClick={() => void cancel(current)}
                      >
                        {current.link.status === "accepted" ? "فكّ الربط" : "إلغاء الطلب"}
                      </Button>
                      <Button variant="quiet" onClick={() => setCurrent(null)}>
                        رجوع
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="cat-head__title">المنشأة في السوق</h3>
                    <TextField
                      label="ابحث باسم المنشأة"
                      value={q}
                      onChange={(e) => void search(e.target.value)}
                    />
                    <ul className="cus-list">
                      {(candidates ?? []).map((c) => (
                        <li key={c.tenant_id}>
                          <button
                            type="button"
                            className={`pos-chip${chosen === c.tenant_id ? " pos-chip--on" : ""}`}
                            aria-pressed={chosen === c.tenant_id}
                            onClick={() => setChosen(c.tenant_id)}
                          >
                            {c.public_name}
                          </button>
                          <div className="cus-sub">
                            {c.badge_label} · {offersWord(c.offers)} ·{" "}
                            <span className="sting-mono">{c.tenant_id.slice(0, 8)}</span>
                          </div>
                        </li>
                      ))}
                      {candidates && candidates.length === 0 ? (
                        <li className="acc-choice__note">لا منشأة منشورة بهذا الاسم.</li>
                      ) : null}
                    </ul>
                    <dl className="mp-preview">
                      <dt>مطلوب</dt>
                      <dd>
                        <strong>موافقة المنشأة على الربط</strong>
                        <div className="mp-reason">
                          يُرسل طلب ربط تراه المنشأة وتقبله. بلا قبولها لا ربط — ولو تطابق الاسم
                          حرفاً بحرف.
                        </div>
                      </dd>
                      <dt>يبقى</dt>
                      <dd>
                        <strong>دفترك كما هو</strong>
                        <div className="mp-reason">
                          الاسم الذي كتبته، و{docsWord(current.documents)}، والذمّة القائمة — كلها
                          ملكك ولا تُستبدل ببيانات المنشأة العامة.
                        </div>
                      </dd>
                      <dt>يُضاف</dt>
                      <dd>
                        <strong>قناة مستندات بين الطرفين</strong>
                        <div className="mp-reason">
                          هذا كل ما يفعله الربط: طلباتك معها تصبح قابلة للتحويل إلى مستندات في دفترك
                          بموافقتك (LINK-03).
                        </div>
                      </dd>
                    </dl>
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy === "request"}
                        onClick={() => void request(current)}
                      >
                        {chosenCand
                          ? `أرسل طلب الربط إلى ${chosenCand.public_name}`
                          : "أرسل طلب الربط"}
                      </Button>
                      <Button variant="quiet" onClick={() => setCurrent(null)}>
                        رجوع
                      </Button>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
