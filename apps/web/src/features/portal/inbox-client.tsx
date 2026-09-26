"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./portal.css";
import { readToken, saveToken } from "@/features/portal/portal-store";
import { validWord, whenWord } from "@/features/portal/shop-client";
import { api } from "@/lib/api";

type State = "loading" | "ready" | "empty" | "expired" | "permission_denied";

interface Msg {
  id: string;
  title: string;
  message: string;
  shop_name: string;
  sent_at: string;
  valid_until: string;
  expired: boolean;
  read_at: string;
}

interface Me {
  shop_name: string;
  unread: number;
  active: boolean;
}

/** CUS-03 — قائمة رسائل المحل وتفاصيل (21-D16 ready · 37-D29 loading/empty/expired/permission_denied). */
export function InboxClient({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("m") ?? "";
  const [me, setMe] = useState<Me | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [foreign, setForeign] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    const t = params.get("t") || readToken(slug);
    if (params.get("t")) saveToken(slug, params.get("t") ?? "");
    setToken(t);
    if (!t) {
      router.replace(`/portal/${slug}/subscribe`);
      return;
    }
    let cancelled = false;
    void api()
      .GET("/api/portal/{slug}/messages", { params: { path: { slug }, query: { t } } })
      .then(({ data, response }) => {
        if (cancelled) return;
        if (response.status === 404) {
          router.replace("/link-expired");
          return;
        }
        const body = data as unknown as { subscriber: Me; messages: Msg[] } | undefined;
        if (response.ok && body) {
          setMe(body.subscriber);
          setMsgs(body.messages);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, params, router]);

  const opened = msgs?.find((m) => m.id === openId) ?? null;

  const markRead = useCallback(
    async (id: string) => {
      const { response } = await api().POST("/api/portal/{slug}/messages/{message_id}/read", {
        params: { path: { slug, message_id: id }, query: { t: token } },
      });
      if (response.status === 403) setForeign(true);
      else if (response.ok)
        setMsgs((list) =>
          (list ?? []).map((m) =>
            m.id === id && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m,
          ),
        );
    },
    [slug, token],
  );

  useEffect(() => {
    if (!openId || !msgs || !token) return;
    // رابط رسالة فُتح بجهاز ليس صاحب الاشتراك: الخادم يقول 403 ولا يُظهر شيئاً
    void markRead(openId).catch(() => undefined);
  }, [openId, msgs, token, markRead]);

  const state: State = !msgs
    ? "loading"
    : openId && (foreign || !opened)
      ? "permission_denied"
      : opened?.expired
        ? "expired"
        : msgs.length
          ? "ready"
          : "empty";
  const expiredCount = (msgs ?? []).filter((m) => m.expired).length;
  const countWord = (n: number) =>
    n === 1 ? "رسالة واحدة" : n === 2 ? "رسالتان" : n === 3 ? "ثلاث رسائل" : `${n} رسائل`;

  return (
    <Frame title={me?.shop_name ?? "فيزانو بلص"} footer={null}>
      <div className="sys cus" data-screen="CUS-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h1 className="cat-head__title">رسائل المحل</h1>
            <span className="cat-head__hint">
              {msgs && msgs.length
                ? `${countWord(msgs.length)}${expiredCount ? ` · ${expiredCount === 1 ? "واحدة انتهت" : `${expiredCount} انتهت`}` : ""}`
                : "ما وصلك من هذا المحل"}
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الرسائل">
                <p className="acc-lead">خفيفة كسابقتها. الزبون على بيانات الجوال غالباً.</p>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title="لا رسائل بعد">
                <p className="acc-lead">اشترك للتوّ ولم يُرسل المحل شيئاً.</p>
                <p className="acc-choice__note">
                  <strong>لا نعتذر</strong> · «لم يرسل المحل رسائل بعد — ستصلك هنا» وكفى. الفراغ هنا
                  انتظارٌ لا عطب.
                </p>
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice
                kind="locked"
                title="رسالة لمشترك آخر"
                action={
                  <Button pos onClick={() => router.push(`/portal/${slug}/inbox`)}>
                    رسائلي
                  </Button>
                }
              >
                <p className="acc-lead">رابط رسالة فُتح بجهاز ليس صاحب الاشتراك.</p>
                <p className="acc-choice__note">
                  <strong>لا نُظهر المحتوى</strong> · ولا اسم المشترك. الرسالة قد تحمل عرضاً خاصاً
                  به.
                </p>
              </Notice>
            ) : null}

            {opened && state !== "permission_denied" ? (
              <Notice
                kind={opened.expired ? "warning" : "info"}
                title={opened.title}
                action={
                  <Button onClick={() => router.push(`/portal/${slug}/inbox`)}>كل الرسائل</Button>
                }
              >
                <p className="cus-sub">
                  من {opened.shop_name} · {whenWord(opened.sent_at)}
                  {opened.valid_until && !opened.expired
                    ? ` · ${validWord(opened.valid_until)}`
                    : ""}
                  {opened.expired ? " · انتهى" : ""}
                </p>
                <p className="acc-lead">{opened.message}</p>
                {opened.expired ? (
                  <p className="acc-choice__note">
                    <strong>لا نمحو</strong> · رسالة عن خصم انتهى. تبقى مقروءةً موسومة «انتهى».
                    الزبون قد يأتي بالورقة أو بالرسالة. وجودها موسومةً يجعل الحوار في المحل ممكناً.
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {msgs && msgs.length && state !== "permission_denied" ? (
              <>
                <ul className="cus-list">
                  {msgs.map((m) => (
                    <li key={m.id} className={m.expired ? "cus-item--expired" : undefined}>
                      <div>
                        <Button
                          variant="quiet"
                          onClick={() => router.push(`/portal/${slug}/inbox?m=${m.id}`)}
                        >
                          {m.title}
                        </Button>{" "}
                        {m.expired ? <Status state="expired" label="انتهى" /> : null}
                        {!m.read_at && !m.expired ? (
                          <Status state="pending_sync" label="جديدة" />
                        ) : null}
                      </div>
                      <div className="cus-sub">
                        من {m.shop_name} · {whenWord(m.sent_at)}
                        {m.valid_until && !m.expired ? ` · ${validWord(m.valid_until)}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  كل رسالة تحمل اسم مرسلها. لا رسالة من محل لم يتابعه، ولا رسالة من المنصة تتنكّر
                  باسم المحل. يظهر المنتهي رماديّاً بكلمة «انتهى» لا يختفي فجأة.
                </p>
              </>
            ) : null}

            <div className="acc-actions">
              <Button onClick={() => router.push(`/portal/${slug}`)}>صفحة المحل</Button>
              <Button onClick={() => router.push("/portal/prefs")}>
                التفضيلات وإلغاء الاشتراك
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
