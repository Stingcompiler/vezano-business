"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
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
import { dayMonth } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "expired" | "permission_denied" | "success";

export interface Preview {
  kind: "offer" | "supplier";
  title: string;
  subtitle: string;
  price_minor: string;
  price_line: string;
  path: string;
}

interface Invite {
  id: string;
  kind: "share" | "invite" | "authorization";
  kind_label: string;
  target_name: string;
  message: string;
  status: "sent" | "accepted" | "declined" | "revoked" | "expired";
  status_label: string;
  expires_at: string;
  created_at: string;
  counts: { visits: number; signups: number; publishes: number; first_orders: number };
}

interface Payload {
  invites: Invite[];
  can_invite: boolean;
  share_days: number;
  reaches: string[];
  not_reaches: string[];
}

const Day = ({ iso }: { iso: string }) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}
    </>
  );
};

/** MP-07 — مشاركة رابط ودعوة منشأة (43-D35 ready/expired/permission_denied · 12-D7 success): الرابط يخرج عن سيطرتك لحظة إرساله. */
export function ShareClient() {
  const router = useRouter();
  const params = useSearchParams();
  const offer = params.get("offer") ?? "";
  const supplier = params.get("supplier") ?? "";
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [link, setLink] = useState<{ path: string; expires_at: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [requested, setRequested] = useState<Invite | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/invites");
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) setData(body);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      const next = `/market/share${offer ? `?offer=${offer}` : supplier ? `?supplier=${supplier}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    void load().catch(() => undefined);
    if (!offer && !supplier) return;
    void (async () => {
      const { data, response } = await api().GET("/api/market/share/preview", {
        params: { query: { offer, supplier } },
      });
      const body = data as unknown as { preview: Preview } | undefined;
      if (response.ok && body) setPreview(body.preview);
    })().catch(() => undefined);
  }, [router, load, offer, supplier]);

  const create = async (kind: "share" | "invite" | "authorization") => {
    if (busy) return;
    setBusy(kind);
    setCopied(false);
    try {
      const body: Record<string, unknown> = { kind, message };
      if (kind !== "invite") {
        if (offer) body.offer_id = offer;
        if (supplier) body.supplier_tenant_id = supplier;
      }
      const r = await api().POST("/api/market/invites", { body: body as never });
      const b = r.data as unknown as
        { invite: Invite; path?: string; preview?: Preview } | undefined;
      if (r.response.ok && b) {
        if (kind === "authorization") setRequested(b.invite);
        else if (b.path) setLink({ path: b.path, expires_at: b.invite.expires_at });
        await load();
      }
    } finally {
      setBusy("");
    }
  };

  const revoke = async (i: Invite) => {
    if (busy) return;
    setBusy(i.id);
    try {
      await api().POST("/api/market/invites/{invite_id}/revoke", {
        params: { path: { invite_id: i.id } },
        body: {} as never,
      });
      await load();
    } finally {
      setBusy("");
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${link.path}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const state: State = requested
    ? "success"
    : data && !data.can_invite
      ? "permission_denied"
      : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-share" />} footer={null}>
      <div className="sys mp cus" data-screen="MP-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مشاركة رابط ودعوة منشأة</h2>
            <span className="cat-head__hint">
              الرابط يخرج عن سيطرتك لحظة إرساله. قبل الإرسال تُعرض المعاينة حرفياً: الاسم والصنف
              والسعر العام — ولا سعر خاص فيها أبداً.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="warning" title="الدعوة باسم المنشأة">
                <p className="acc-lead">دعوة منشأة أخرى إلى علاقة تجارية فعلٌ باسم منشأتك.</p>
                <p className="acc-choice__note">
                  <strong>لا نشر تلقائياً</strong> · قبول المدعوّ لا ينشر ملفه ولا كتالوجه — الدعوة
                  تفتح باباً ولا تدخل أحداً منه. المشاركة والدعوة بصلاحية النشر من مالك المنشأة.
                </p>
              </Notice>
            ) : null}

            {state === "success" && requested ? (
              <Notice
                kind="success"
                title="طلب تخويل مرسَل — بانتظار المورد"
                action={<Button onClick={() => setRequested(null)}>حسناً</Button>}
              >
                <p className="acc-lead">
                  {requested.target_name} · قرار المورد بشري ولا مهلة نفرضها عليه. الانتظار معلن
                  وليس دوّارة.
                </p>
                <h3 className="cat-head__title">ما يصل المورد عنك</h3>
                <div className="pub-cols">
                  <div>
                    <strong>يصله</strong>
                    <ul className="pub-list">
                      {(data?.reaches ?? []).map((t) => (
                        <li key={t}>
                          <span className="pub-mark">نعم</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>لا يصله</strong>
                    <ul className="pub-list">
                      {(data?.not_reaches ?? []).map((t) => (
                        <li key={t}>
                          <span className="pub-mark">لا</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="acc-choice__note">
                  لو رفض المورد فلا سبب يُعرض لك: السبب قراره الخاص، وإظهاره قد يكشف سياسته التجارية
                  أو علاقته بمنافسيك. الرفض عام بلا تسريب.
                </p>
              </Notice>
            ) : null}

            {state === "ready" && preview ? (
              <>
                <div className="acc-choice__head">
                  <strong>معاينة ما سيراه المستلم</strong>
                  <span className="acc-choice__note">
                    المعاينة عامة دوماً — ولو كان المرسل يرى سعرَ شريحته؛ الرابط يُعاد توجيهه ولا
                    يعرف من يفتحه. ما يخرج من المنشأة يُفترض عاماً.
                  </span>
                </div>
                <div className="mp-preview-card pos-card">
                  <strong>{preview.title}</strong>
                  <div className="cus-sub">{preview.subtitle}</div>
                  <div>
                    {preview.price_minor ? (
                      <span className="sting-mono">{formatMinor(preview.price_minor)}</span>
                    ) : (
                      preview.price_line
                    )}
                  </div>
                </div>
                <div className="acc-actions">
                  <Button pos loading={busy === "share"} onClick={() => void create("share")}>
                    أنشئ رابط مشاركة
                  </Button>
                  {supplier ? (
                    <Button
                      loading={busy === "authorization"}
                      onClick={() => void create("authorization")}
                    >
                      اطلب تخويلاً من هذا المورد
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}

            {state === "ready" && link ? (
              <Notice kind="info" title="رابط بعمر">
                <p className="acc-lead">
                  <span className="sting-mono" dir="ltr">
                    {link.path}
                  </span>
                </p>
                <p className="acc-choice__note">
                  يسري حتى {link.expires_at ? <Day iso={link.expires_at} /> : "—"} ·{" "}
                  <strong>جديدٌ لا إحياء</strong> · يُنشأ رابط جديد بعمر جديد؛ القديم لا يُمدَّد —
                  تمديد رابطٍ خرج يفتح باباً لا يُعرف من وراءه.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => void copy()}>انسخ الرابط</Button>
                  {copied ? <Status state="success" label="نُسخ" /> : null}
                </div>
              </Notice>
            ) : null}

            {state === "ready" && data ? (
              <>
                <div className="acc-choice__head">
                  <strong>الدعوة باسم المنشأة</strong>
                  <span className="acc-choice__note">
                    دعوة منشأة أخرى إلى علاقة تجارية فعلٌ باسم منشأتك. لا نشر تلقائياً: قبول المدعوّ
                    لا ينشر ملفه ولا كتالوجه — الدعوة تفتح باباً ولا تدخل أحداً منه.
                  </span>
                </div>
                <TextField
                  label="رسالة قصيرة للمدعوّ (اختيارية)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div className="acc-actions">
                  <Button loading={busy === "invite"} onClick={() => void create("invite")}>
                    أنشئ رابط دعوة
                  </Button>
                </div>

                <h3 className="cat-head__title">روابطي ودعواتي</h3>
                {data.invites.length ? (
                  <table className="pur-lines">
                    <thead>
                      <tr>
                        <th scope="col">الرابط</th>
                        <th scope="col">الحالة</th>
                        <th scope="col">زيارات</th>
                        <th scope="col">تسجيل</th>
                        <th scope="col">نشر</th>
                        <th scope="col">أول طلب</th>
                        <th scope="col">
                          <span className="visually-hidden">إجراء</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.invites.map((i) => (
                        <tr key={i.id}>
                          <td>
                            {i.kind_label} · {i.target_name}
                          </td>
                          <td>
                            <Status
                              state={
                                i.status === "sent"
                                  ? "success"
                                  : i.status === "accepted"
                                    ? "synced"
                                    : "expired"
                              }
                              label={i.status_label}
                            />
                          </td>
                          <td className="sting-mono">{i.counts.visits}</td>
                          <td className="sting-mono">{i.counts.signups}</td>
                          <td className="sting-mono">{i.counts.publishes}</td>
                          <td className="sting-mono">{i.counts.first_orders}</td>
                          <td>
                            {i.status === "sent" && i.kind !== "authorization" ? (
                              <Button loading={busy === i.id} onClick={() => void revoke(i)}>
                                ألغِ
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="acc-choice__note">لا روابط بعد.</p>
                )}
                <p className="acc-choice__note">
                  القياس بأقل بيانات: زيارة وتسجيل ونشر وأول طلب أعدادٌ مفصولة بلا هوية من فتح
                  الرابط.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}

interface Opened {
  id: string;
  kind: "share" | "invite";
  message: string;
  expires_at: string;
  preview: Preview;
}

/** MP-07 (رابط مفتوح) — `/market/i/{token}`: ما يُرى عامّ دوماً؛ المنتهي «جديدٌ لا إحياء». */
export function InviteOpenClient({ token }: { token: string }) {
  const router = useRouter();
  const app = useApp();
  const signedIn = Boolean(app.tokens && app.session.tenantId);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [expired, setExpired] = useState(false);
  const [accepted, setAccepted] = useState<"" | "ok" | "self">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, response } = await api().GET("/api/public/market/invite/{token}", {
        params: { path: { token } },
      });
      if (response.status === 410) {
        setExpired(true);
        return;
      }
      if (response.status === 404) {
        router.replace("/link-expired");
        return;
      }
      const body = data as unknown as { invite: Opened } | undefined;
      if (response.ok && body) setOpened(body.invite);
    })().catch(() => undefined);
  }, [token, router]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api().POST("/api/market/invite/{token}/accept", {
        params: { path: { token } },
        body: {} as never,
      });
      if (r.response.status === 410) setExpired(true);
      else if (r.response.status === 400) setAccepted("self");
      else if (r.response.ok) setAccepted("ok");
    } finally {
      setBusy(false);
    }
  };

  const state: State = expired ? "expired" : "ready";

  return (
    <Frame title="السوق" footer={null}>
      <div className="sys mp cus" data-screen="MP-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مشاركة رابط ودعوة منشأة</h2>
          </div>
          <div className="acc-card__body">
            {state === "expired" ? (
              <Notice kind="warning" title="دعوة منتهية">
                <p className="acc-lead">رابط الدعوة له عمر وانقضى.</p>
                <p className="acc-choice__note">
                  <strong>جديدٌ لا إحياء</strong> · يُنشأ رابط جديد بعمر جديد؛ القديم لا يُمدَّد —
                  تمديد رابطٍ خرج يفتح باباً لا يُعرف من وراءه. اطلب من مرسله رابطاً جديداً.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market")}>السوق</Button>
                </div>
              </Notice>
            ) : null}
            {opened ? (
              <>
                <div className="mp-preview-card pos-card">
                  <strong>{opened.preview.title}</strong>
                  <div className="cus-sub">{opened.preview.subtitle}</div>
                  <div>
                    {opened.preview.price_minor ? (
                      <span className="sting-mono">{formatMinor(opened.preview.price_minor)}</span>
                    ) : (
                      opened.preview.price_line
                    )}
                  </div>
                  {opened.message ? <p className="acc-choice__note">«{opened.message}»</p> : null}
                </div>
                {opened.kind === "invite" ? (
                  <>
                    <p className="acc-choice__note">
                      <strong>لا نشر تلقائياً</strong> · قبول الدعوة لا ينشر ملفك ولا كتالوجك —
                      الدعوة تفتح باباً ولا تدخل أحداً منه.
                    </p>
                    <div className="acc-actions">
                      {accepted === "ok" ? (
                        <Status
                          state="success"
                          label="قُبلت الدعوة — لا نشر ولا اشتراك نيابةً عنك"
                        />
                      ) : accepted === "self" ? (
                        <Status state="stale" label="هذه دعوة منشأتك نفسها" />
                      ) : signedIn ? (
                        <Button pos loading={busy} onClick={() => void accept()}>
                          اقبل الدعوة باسم منشأتك
                        </Button>
                      ) : (
                        <Button pos onClick={() => router.push("/welcome")}>
                          أنشئ حساباً لقبول الدعوة
                        </Button>
                      )}
                      {opened.preview.path ? (
                        <Button onClick={() => router.push(opened.preview.path)}>
                          ملف المنشأة الداعية
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="acc-actions">
                    <Button pos onClick={() => router.push(opened.preview.path)}>
                      افتح في السوق
                    </Button>
                  </div>
                )}
                <p className="acc-choice__note">
                  الرابط يسري حتى {opened.expires_at ? <Day iso={opened.expires_at} /> : "—"} ·
                  المعاينة عامة دوماً ولا سعر خاص فيها.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
