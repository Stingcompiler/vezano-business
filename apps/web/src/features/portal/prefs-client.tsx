"use client";

import { Button, Dialog, Frame, Notice, Status, SwitchField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./portal.css";
import { listShops, readToken } from "@/features/portal/portal-store";
import { api } from "@/lib/api";

type State = "ready" | "validation_error" | "success";

interface Me {
  slug: string;
  shop_name: string;
  active: boolean;
  push_permission: string;
  push_enabled: boolean;
  channels: { push: boolean; sms: boolean; inbox: boolean };
  undo_until: string;
  undo_expired: boolean;
}

/** CUS-04 — التفضيلات وإلغاء الاشتراك (08-D4 ready · 37-D29 validation_error · 21-D16 success). */
export function PrefsClient() {
  const router = useRouter();
  const [shops, setShops] = useState<Me[] | null>(null);
  const [allOff, setAllOff] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [cancelled, setCancelled] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const out: Me[] = [];
    for (const slug of listShops()) {
      const t = readToken(slug);
      if (!t) continue;
      const { data, response } = await api().GET("/api/portal/{slug}/me", {
        params: { path: { slug }, query: { t } },
      });
      const body = data as unknown as { subscriber: Me } | undefined;
      if (response.ok && body) out.push({ ...body.subscriber, slug });
    }
    setShops(out);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const save = async (m: Me, channels: Me["channels"]) => {
    if (!channels.push && !channels.sms && !channels.inbox) {
      // أوقف كل قناة والاشتراك قائم — حالةٌ بلا معنى: نسأل عن القصد
      setAllOff(m.slug);
      return;
    }
    setAllOff(null);
    const { data, response } = await api().PUT("/api/portal/{slug}/me", {
      params: { path: { slug: m.slug }, query: { t: readToken(m.slug) } },
      body: { channels } as never,
    });
    const body = data as unknown as { subscriber: Me } | undefined;
    if (response.ok && body)
      setShops((list) =>
        (list ?? []).map((x) => (x.slug === m.slug ? { ...body.subscriber, slug: m.slug } : x)),
      );
  };

  const unsubscribe = async (m: Me) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, response } = await api().DELETE("/api/portal/{slug}/me", {
        params: { path: { slug: m.slug }, query: { t: readToken(m.slug) } },
      });
      const body = data as unknown as { subscriber: Me } | undefined;
      if (response.ok && body) {
        const updated = { ...body.subscriber, slug: m.slug };
        setShops((list) => (list ?? []).map((x) => (x.slug === m.slug ? updated : x)));
        setCancelled(updated);
        setAllOff(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const undo = async (m: Me) => {
    const { data, response } = await api().POST("/api/portal/{slug}/resubscribe", {
      params: { path: { slug: m.slug }, query: { t: readToken(m.slug) } },
    });
    const body = data as unknown as { subscriber: Me } | undefined;
    if (response.ok && body) {
      setShops((list) =>
        (list ?? []).map((x) => (x.slug === m.slug ? { ...body.subscriber, slug: m.slug } : x)),
      );
      setCancelled(null);
    }
  };

  const unsubscribeAll = async () => {
    setConfirmAll(false);
    for (const m of (shops ?? []).filter((x) => x.active)) await unsubscribe(m);
  };

  const state: State = cancelled ? "success" : allOff ? "validation_error" : "ready";
  const active = (shops ?? []).filter((x) => x.active);
  const others = cancelled ? active.filter((x) => x.slug !== cancelled.slug).length : 0;
  const shopsWord = (n: number) => (n === 1 ? "محل واحد" : n === 2 ? "محلين" : `${n} محال`);
  const othersWord = (n: number) =>
    n === 0
      ? "لا محال أخرى مُتابَعة"
      : n === 1
        ? "محلٌّ آخر ما زال مُتابَعاً"
        : n === 2
          ? "محلّان آخران ما زالا مُتابَعين"
          : `${n} محال أخرى ما زالت مُتابَعة`;

  return (
    <Frame title="فيزانو" footer={null}>
      <div className="sys cus" data-screen="CUS-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h1 className="cat-head__title">التفضيلات وإلغاء الاشتراك</h1>
            <span className="cat-head__hint">
              {shops
                ? `أنت مشترك في ${shopsWord(active.length)}. الإلغاء يخص ما تختاره وحده — لا زر واحد يُسكت كل شيء دون أن تعرف ماذا أسكت.`
                : "تُجلب اشتراكاتك…"}
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && cancelled ? (
              <Notice
                kind="success"
                title="تم إلغاء المتابعة"
                action={
                  cancelled.undo_expired ? undefined : (
                    <Button pos onClick={() => void undo(cancelled)}>
                      تراجع عن الإلغاء
                    </Button>
                  )
                }
              >
                <p className="acc-lead">
                  من {cancelled.shop_name} وحده. {othersWord(others)}.
                </p>
                <p className="acc-lead">
                  <strong>الإلغاء لا يطال ما لم تقصده</strong> · التراجع متاح 7 أيام — بعدها تحتاج
                  الرابط أو QR من جديد.
                </p>
                <p className="acc-lead">
                  <strong>لا يُحذف سجل رسائلك</strong> · يبقى معك للقراءة ولا تصلك رسائل جديدة.
                </p>
                <p className="acc-choice__note">
                  الإلغاء يميّز بين محل واحد وكل المحلات وبين قناة وأخرى — لا زر واحد يلغي كل شيء
                  بالخطأ.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice
                kind="error"
                title="ألغى كل القنوات وبقي مشتركاً"
                action={
                  <Button
                    pos
                    onClick={() => {
                      const m = (shops ?? []).find((x) => x.slug === allOff);
                      if (m) void unsubscribe(m);
                    }}
                  >
                    إلغاء الاشتراك
                  </Button>
                }
              >
                <p className="acc-lead">
                  أوقف كل قناة والاشتراك قائم — حالةٌ بلا معنى: مشتركٌ لا يصله شيء.
                </p>
                <p className="acc-choice__note">
                  <strong>نسأل عن القصد</strong> · «أوقفتَ كل القنوات — هل تريد إلغاء الاشتراك؟»
                  والإلغاء بضغطة. لا نُبقيه في سجلّ لا ينفعه ولا ينفع المحل.
                </p>
              </Notice>
            ) : null}

            {shops && !shops.length ? (
              <Notice kind="empty" title="لا اشتراكات من هذا المتصفح">
                <p className="acc-lead">افتح رابط المحل أو امسح QR لتشترك.</p>
              </Notice>
            ) : null}

            {(shops ?? []).map((m) => (
              <div className="acc-choice" key={m.slug}>
                <div className="acc-choice__head">
                  <strong>{m.shop_name}</strong>
                  <Status
                    state={m.active ? "success" : "expired"}
                    label={
                      !m.active
                        ? "أُلغي"
                        : m.push_enabled && m.channels.push
                          ? "مشترك · إشعار المتصفح مفعّل"
                          : "مشترك · صندوق وارد فقط"
                    }
                  />
                </div>
                {m.active ? (
                  <>
                    <SwitchField
                      label="إشعار المتصفح"
                      checked={m.channels.push}
                      onChange={(v) => void save(m, { ...m.channels, push: v })}
                      {...(m.push_permission === "denied"
                        ? { hint: "المتصفح رفض الإذن — لا يصل شيء هنا" }
                        : {})}
                    />
                    <SwitchField
                      label="رسالة نصية"
                      checked={m.channels.sms}
                      onChange={(v) => void save(m, { ...m.channels, sms: v })}
                      hint="موافقة منفصلة على القناة"
                    />
                    <SwitchField
                      label="صندوق الوارد في الصفحة"
                      checked={m.channels.inbox}
                      onChange={(v) => void save(m, { ...m.channels, inbox: v })}
                    />
                    <div className="acc-actions">
                      <Button onClick={() => void unsubscribe(m)} loading={busy}>
                        إلغاء اشتراك هذا المحل
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => router.push(`/portal/${m.slug}/inbox`)}
                      >
                        رسائل المحل
                      </Button>
                    </div>
                    <p className="acc-choice__note">
                      الإلغاء لا يمحو رسائلك السابقة من صندوق الوارد.
                    </p>
                  </>
                ) : (
                  <div className="acc-actions">
                    {m.undo_expired ? (
                      <Button onClick={() => router.push(`/portal/${m.slug}`)}>
                        تحتاج الرابط أو QR من جديد
                      </Button>
                    ) : (
                      <Button onClick={() => void undo(m)}>تراجع عن الإلغاء</Button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {active.length > 1 ? (
              <div className="acc-actions">
                <Button variant="danger" onClick={() => setConfirmAll(true)}>
                  إلغاء الكل
                </Button>
                <span className="acc-choice__note">
                  يعرض قائمة المحال المتأثرة ويطلب تأكيداً ثانياً. لا إلغاء عرضي بنقرة.
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <Dialog
          open={confirmAll}
          kind="danger"
          title="إلغاء الكل"
          primaryLabel="ألغِ كل الاشتراكات"
          onPrimary={() => void unsubscribeAll()}
          onClose={() => setConfirmAll(false)}
        >
          <p>المحال المتأثرة:</p>
          <ul>
            {active.map((m) => (
              <li key={m.slug}>{m.shop_name}</li>
            ))}
          </ul>
        </Dialog>
      </div>
    </Frame>
  );
}
