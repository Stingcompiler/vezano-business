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
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "validation_error" | "permission_denied";

interface Tier {
  min: number;
  max: number | null;
  label: string;
  price_minor: string;
  unit_price_minor: string;
  base_unit_name: string;
  negotiable: boolean;
  pack_label: string;
}

interface Member {
  id: string;
  buyer_name: string;
  status: "invited" | "active" | "suspended";
  status_label: string;
  hint: string;
}

interface PriceList {
  id: string;
  name: string;
  offer_id: string;
  offer_name: string;
  pack_label: string;
  unit_name: string;
  tiers: Tier[];
  gaps: { from: number; to: number }[];
  members: Member[];
  active_count: number;
}

interface TierDraft {
  min: string;
  max: string;
  price: string;
}

const tiersToDraft = (ts: Tier[]): TierDraft[] =>
  ts.map((t) => ({
    min: String(t.min),
    max: t.max === null ? "" : String(t.max),
    price: t.price_minor ? formatMinor(t.price_minor).replace(/,/g, "") : "",
  }));

const localGaps = (ds: TierDraft[]) => {
  const rows = ds
    .map((d) => ({ min: Number(d.min || 0), max: d.max ? Number(d.max) : null }))
    .filter((r) => r.min > 0)
    .sort((a, b) => a.min - b.min);
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    if (a.max === null) break;
    if (b.min > a.max + 1) out.push({ from: a.max + 1, to: b.min - 1 });
  }
  return out;
};

const MEMBER_STATE = { invited: "pending_sync", active: "success", suspended: "stale" } as const;

/** MP-12 — أسعار شرائح وقوائم خاصة (10-D6 validation_error · 43-D35 ready/empty/permission_denied). */
export function PriceListsClient({ listId, offerId }: { listId?: string; offerId?: string }) {
  const router = useRouter();
  const app = useApp();
  const [lists, setLists] = useState<PriceList[] | null>(null);
  const [current, setCurrent] = useState<PriceList | null>(null);
  const [foreign, setForeign] = useState(false);
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<TierDraft[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [serverGaps, setServerGaps] = useState<{ from: number; to: number }[]>([]);
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const applyList = useCallback((pl: PriceList) => {
    setCurrent(pl);
    setName(pl.name);
    setDrafts(tiersToDraft(pl.tiers));
    setServerGaps([]);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    const here = listId
      ? `/market/lists/${listId}`
      : offerId
        ? `/market/lists/new?offer=${offerId}`
        : "/market/lists";
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    void (async () => {
      if (listId) {
        const { data, response } = await api().GET("/api/market/lists/{list_id}", {
          params: { path: { list_id: listId } },
        });
        if (response.status === 404) {
          // رابط قائمة خاصة وصل لغير أهله — الرسالة نفسها التي يراها من فتح رابطاً غير موجود
          setForeign(true);
          return;
        }
        const body = data as unknown as { list: PriceList; role: string } | undefined;
        if (response.ok && body && body.role === "seller") applyList(body.list);
        else if (response.ok) setForeign(true);
        return;
      }
      const { data, response } = await api().GET("/api/market/lists");
      const body = data as unknown as { lists: PriceList[] } | undefined;
      if (response.ok && body) setLists(body.lists);
      if (offerId) setDrafts([{ min: "", max: "", price: "" }]);
    })().catch(() => undefined);
  }, [router, listId, offerId, applyList]);

  const gaps = attempted ? (serverGaps.length ? serverGaps : localGaps(drafts)) : [];

  const save = async () => {
    setAttempted(true);
    if (localGaps(drafts).length) return;
    setBusy(true);
    try {
      const payload = {
        offer_id: current?.offer_id ?? offerId ?? "",
        name,
        tiers: drafts
          .filter((d) => d.min)
          .map((d) => ({
            min: d.min,
            max: d.max,
            price_minor: d.price ? String(Math.round(Number(d.price) * 100)) : "",
          })),
      };
      const r = current
        ? await api().PUT("/api/market/lists/{list_id}", {
            params: { path: { list_id: current.id } },
            body: payload as never,
          })
        : await api().POST("/api/market/lists", { body: payload as never });
      if (r.response.status === 400) {
        const e = r.data as unknown as
          { extra?: { gaps?: { from: number; to: number }[] } } | undefined;
        setServerGaps(e?.extra?.gaps ?? []);
        return;
      }
      const b = r.data as unknown as { list: PriceList } | undefined;
      if (r.response.ok && b) {
        if (!current) router.push(`/market/lists/${b.list.id}`);
        else applyList(b.list);
        setAttempted(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const inviteMember = async () => {
    if (!current || !invite.trim()) return;
    const { data, response } = await api().POST("/api/market/lists/{list_id}/members", {
      params: { path: { list_id: current.id } },
      body: { buyer_tenant_id: invite.trim() } as never,
    });
    const b = data as unknown as { member: Member } | undefined;
    if (response.ok && b) {
      setCurrent({ ...current, members: [...current.members, b.member] });
      setInvite("");
    }
  };

  const memberAction = async (m: Member, action: "suspend" | "resume") => {
    if (!current) return;
    const { data, response } = await api().POST(
      "/api/market/lists/{list_id}/members/{member_id}/{action}",
      { params: { path: { list_id: current.id, member_id: m.id, action } } },
    );
    const b = data as unknown as { member: Member } | undefined;
    if (response.ok && b)
      setCurrent({
        ...current,
        members: current.members.map((x) => (x.id === m.id ? b.member : x)),
      });
  };

  const state: State = foreign
    ? "permission_denied"
    : gaps.length
      ? "validation_error"
      : !listId && !offerId && lists && lists.length === 0
        ? "empty"
        : "ready";

  const setDraft = (i: number, patch: Partial<TierDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-lists" />} footer={null}>
      <div className="sys mp" data-screen="MP-12" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              قوائم الأسعار الخاصة — الشريحة بوحدتها والمشترون بأسمائهم
            </h2>
            <span className="cat-head__hint">
              الشرائح بحدودها: كل شريحة: منشآت مسمّاة بعلاقة مخوَّلة، وأسعار بوحداتها، وحدود كمية.
              العلاقة أولاً — لا سعر خاص لمنشأة بلا علاقة قائمة (متابعة مقبولة أو تعامل سابق). السعر
              الخاص امتيازُ علاقة لا إعلان.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice
                kind="error"
                title="الرابط لم يعد صالحاً"
                action={
                  <Button pos onClick={() => router.push("/market/offers")}>
                    عودة إلى الصفحة الرئيسية
                  </Button>
                }
              >
                <p className="acc-lead">
                  هذا الرابط منتهٍ أو غير متاح لك. لا نقول إن كان موجوداً أصلاً، ولا لمن يخص، ولا ما
                  نوعه.
                </p>
                <p className="acc-choice__note">
                  <strong>منشأة ثالثة تطلب القائمة</strong> · رابط قائمة خاصة وصل لغير أهله.{" "}
                  <strong>رفض عام</strong> · كأنها غير موجودة. وتبديل الحساب على نفس الجهاز لا يُظهر
                  كاش الحساب السابق — العزل بالحساب لا بالجهاز.
                </p>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا قوائم خاصة"
                action={
                  <Button pos onClick={() => router.push("/market/offers")}>
                    ابدأ من عرض
                  </Button>
                }
              >
                <p className="acc-lead">كل الأسعار عامة — حالة سويّة لأغلب الباعة.</p>
              </Notice>
            ) : null}

            {!listId && !offerId && lists && lists.length ? (
              <ul className="mp-check">
                {lists.map((pl) => (
                  <li key={pl.id}>
                    <span>
                      <Button variant="quiet" onClick={() => router.push(`/market/lists/${pl.id}`)}>
                        قائمة «{pl.name}» — {pl.offer_name}
                      </Button>
                      <div className="mp-check__hint">
                        <span className="sting-mono">{pl.active_count}</span> مشترين مخوَّلين ·
                        الوحدة: {pl.pack_label || pl.unit_name}
                      </div>
                    </span>
                    <Status state="success" label="قائمة خاصة" />
                  </li>
                ))}
              </ul>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="error" title="فجوة بين شريحتين تمنع الحفظ">
                <p className="acc-lead">
                  {gaps
                    .map(
                      (g) =>
                        `فجوة: ${g.from} – ${g.to} ${current?.unit_name ?? "وحدة"} بلا سعر معلن`,
                    )
                    .join("، ")}
                  . طلب في الفجوة لا يجد سعراً، فيقع على سعر افتراضي لا أحد اتفق عليه. أغلق الفجوة
                  أو صرّح بالسعر الساري فيها.
                </p>
              </Notice>
            ) : null}

            {(current || offerId) && !foreign ? (
              <>
                <div className="acc-choice__head">
                  <strong>
                    قائمة «{name || "…"}»{current ? ` — ${current.offer_name}` : ""}
                  </strong>
                  {current ? (
                    <span className="acc-choice__note">
                      <span className="sting-mono">{current.active_count}</span> مشترين مخوَّلين ·
                      الوحدة: {current.pack_label || current.unit_name}
                    </span>
                  ) : null}
                </div>
                <TextField
                  label="اسم القائمة"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الشريحة</th>
                      <th scope="col">سعر العبوة</th>
                      <th scope="col">سعر الوحدة</th>
                      <th scope="col">التحقق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d, i) => {
                      const t = current?.tiers[i];
                      const gap = gaps.find((g) => Number(d.min) === g.to + 1);
                      return (
                        <tr key={i} className={gap ? "pur-line--error" : undefined}>
                          <td>
                            {t ? <div>{t.label}</div> : null}
                            <TextField
                              label={`من — شريحة ${i + 1}`}
                              mono
                              value={d.min}
                              onChange={(e) => setDraft(i, { min: e.target.value })}
                            />
                            <TextField
                              label={`إلى — شريحة ${i + 1}`}
                              mono
                              value={d.max}
                              onChange={(e) => setDraft(i, { max: e.target.value })}
                              hint="فارغ = أكثر من"
                            />
                          </td>
                          <td>
                            <TextField
                              label={`سعر العبوة — شريحة ${i + 1}`}
                              mono
                              value={d.price}
                              onChange={(e) => setDraft(i, { price: e.target.value })}
                              hint="فارغ = بالتفاوض"
                            />
                            {t?.pack_label ? (
                              <div className="mp-check__hint">{t.pack_label}</div>
                            ) : null}
                          </td>
                          <td>
                            {t?.unit_price_minor ? (
                              <>
                                <span className="sting-mono">
                                  {formatMinor(t.unit_price_minor)}
                                </span>{" "}
                                /{t.base_unit_name}
                              </>
                            ) : d.price ? (
                              "—"
                            ) : (
                              "بالتفاوض"
                            )}
                          </td>
                          <td>
                            {gap ? (
                              <Status
                                state="validation_error"
                                label={`فجوة: ${gap.from} – ${gap.to}`}
                              />
                            ) : d.price ? (
                              <Status state="success" label="سليمة" />
                            ) : (
                              <Status state="stale" label="بالتفاوض" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="acc-choice__note">
                  «بالتفاوض» مقبول ويمنع الطلب الفوري ويفتح طلب عرض سعر
                </p>
                <div className="acc-actions">
                  <Button
                    onClick={() => setDrafts((ds) => [...ds, { min: "", max: "", price: "" }])}
                  >
                    أضف شريحة
                  </Button>
                  <Button pos onClick={() => void save()} loading={busy}>
                    احفظ القائمة
                  </Button>
                </div>

                {current ? (
                  <>
                    <h3 className="cat-head__title">المشترون المخوَّلون — بأسمائهم لا بوصف عام</h3>
                    <ul className="mp-check">
                      {current.members.map((m) => (
                        <li key={m.id}>
                          <span>
                            <strong>{m.buyer_name}</strong>
                            <div className="mp-check__hint">{m.hint}</div>
                          </span>
                          <span>
                            <Status state={MEMBER_STATE[m.status]} label={m.status_label} />
                            {m.status === "active" ? (
                              <Button
                                variant="quiet"
                                onClick={() => void memberAction(m, "suspend")}
                              >
                                أوقف
                              </Button>
                            ) : m.status === "suspended" ? (
                              <Button
                                variant="quiet"
                                onClick={() => void memberAction(m, "resume")}
                              >
                                استأنف
                              </Button>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <TextField
                      label="معرّف منشأة مشترية لدعوتها"
                      mono
                      value={invite}
                      onChange={(e) => setInvite(e.target.value)}
                      hint="الدعوة تُقبل بحساب المشتري — لا تسجيل نيابةً عنه"
                    />
                    <div className="acc-actions">
                      <Button onClick={() => void inviteMember()}>أرسل دعوة</Button>
                    </div>
                    <p className="acc-choice__note">
                      <strong>تسريب محجوب</strong> · منشأة غير مخوَّلة تفتح رابط هذه القائمة فترى
                      صفحة «الرابط لم يعد صالحاً» نفسها التي يراها من فتح رابطاً غير موجود. لا رسالة
                      «لا تملك صلاحية لهذه القائمة»، لأنها تخبره أن القائمة موجودة ومن يملكها.
                    </p>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
