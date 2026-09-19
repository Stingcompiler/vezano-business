"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
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
import { dayMonth, hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "permission_denied" | "success";

interface Follow {
  id: string;
  supplier_tenant_id: string;
  supplier_name: string;
  status: "active" | "cancelled";
  status_label: string;
  hint: string;
  suspended: boolean;
  followed_at: string;
  cancelled_at: string;
}

interface Payload {
  follows: Follow[];
  active_count: number;
  can_follow: boolean;
  what_stops: string[];
  what_stays: string[];
}

const STOPPED = ["إشعارات عروضه الجديدة وتخفيضاته", "ظهور عروضه في قسم «متابعاتك»"];
const KEPT = [
  "طلباتك السابقة معه وسجلّها كامل",
  "إشعارات الطلبات القائمة: رد، شحنة، خلاف",
  "ذمتك وذمته وكل مستند بينكما",
];

const CancelledWhen = ({ iso }: { iso: string }) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay)
    return (
      <>
        اليوم <span className="sting-mono">{hhmm(iso)}</span>
      </>
    );
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

/** MP-06 — متابعة مورد (29-D22 ready/empty · 43-D35 permission_denied · 10-D6 success): اشتراك تسويقي مستقلّ يُلغى وحده. */
export function FollowingClient() {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("follow") ?? "";
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<Follow | null>(null);
  const [followError, setFollowError] = useState("");
  const appRef = useRef(app);
  appRef.current = app;
  const followedRef = useRef("");

  const load = useCallback(async (): Promise<Payload | null> => {
    const { data, response } = await api().GET("/api/market/following");
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) {
      setData(body);
      return body;
    }
    return null;
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(
        `/login?next=${encodeURIComponent(`/market/following${wanted ? `?follow=${wanted}` : ""}`)}`,
      );
      return;
    }
    void (async () => {
      const body = await load();
      if (!wanted || !body?.can_follow || followedRef.current === wanted) return;
      followedRef.current = wanted;
      // رابط «تابع هذا المورد» من ملفه (MP-03): المتابعة فعل صريح باسم المنشأة — تُنفَّذ مرة ثم يُنظَّف الرابط
      const r = await api().POST("/api/market/following", {
        body: { supplier_tenant_id: wanted } as never,
      });
      if (!r.response.ok) {
        const d = (r.data ?? r.error) as unknown as { detail?: string } | undefined;
        setFollowError(
          d?.detail === "supplier_is_self"
            ? "لا تتابع منشأتك نفسها."
            : "المورد غير منشور أو الرابط غير صالح — لم تُضَف متابعة.",
        );
      }
      await load();
      router.replace("/market/following");
    })().catch(() => undefined);
  }, [router, load, wanted]);

  const unfollow = async (f: Follow) => {
    if (busy) return;
    setBusy(f.id);
    try {
      const r = await api().POST("/api/market/following/{follow_id}/unfollow", {
        params: { path: { follow_id: f.id } },
        body: {} as never,
      });
      const b = r.data as unknown as { follow: Follow } | undefined;
      if (r.response.ok && b) {
        setCancelled(b.follow);
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  const refollow = async (f: Follow) => {
    if (busy) return;
    setBusy(f.id);
    try {
      await api().POST("/api/market/following", {
        body: { supplier_tenant_id: f.supplier_tenant_id } as never,
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const state: State = cancelled
    ? "success"
    : data && !data.can_follow
      ? "permission_denied"
      : data && data.follows.length === 0
        ? "empty"
        : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-following" />} footer={null}>
      <div className="sys mp cus" data-screen="MP-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">متابعة مورد — اشتراك تسويقي مستقلّ يُلغى وحده</h2>
            <span className="cat-head__hint">
              إلغاء المتابعة يوقف رسائل المورد التسويقية ولا يمسّ أحداث طلباتك المخوَّلة: تأكيد
              الطلب والشحنة والمرتجع تبقى (ACC-134).
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && cancelled ? (
              <Notice
                kind="success"
                title={`أُلغيت متابعة ${cancelled.supplier_name}`}
                action={<Button onClick={() => setCancelled(null)}>حسناً</Button>}
              >
                <p className="acc-lead">تم بنجاح</p>
                <div className="pub-cols">
                  <div>
                    <strong>توقف</strong>
                    <ul className="pub-list">
                      {STOPPED.map((t) => (
                        <li key={t}>
                          <span className="pub-mark">لا</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>لم يتوقف ولن يتوقف</strong>
                    <ul className="pub-list">
                      {KEPT.map((t) => (
                        <li key={t}>
                          <span className="pub-mark">نعم</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="acc-choice__note">
                  إلغاء المتابعة قرار تسويقي. علاقتكما التجارية وسجلّها ليست إعلاناً حتى تُلغى معه.
                </p>
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="warning" title="المتابعة باسم المنشأة بصلاحية">
                <p className="acc-lead">
                  المتابعة اشتراك B2B يصل تسويق المورد إلى المنشأة — قرارها لمن يملك ملفها لا لكل
                  مستخدم.
                </p>
                <p className="acc-choice__note">
                  <strong>الإلغاء بحدوده</strong> · إلغاء المتابعة يوقف التسويق ولا يمحو أحداث
                  الطلبات القائمة المخوَّلة (ACC-134). فعلان مختلفان لا زرّ واحد.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/directory")}>
                    دليل المخازن والمتاجر
                  </Button>
                </div>
              </Notice>
            ) : null}

            {followError ? (
              <Notice kind="warning" title="لم تُضَف المتابعة">
                <p className="acc-lead">{followError}</p>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title="لا تتابع أحداً بعد">
                <p className="acc-lead">
                  المتابعة اختيارية بالكامل — الشراء لا يشترطها، ولا نضيف موردين تلقائياً لأنك طلبت
                  منهم مرة.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/directory")}>
                    دليل المخازن والمتاجر
                  </Button>
                </div>
              </Notice>
            ) : null}

            {data && data.can_follow && data.follows.length ? (
              <>
                <div className="acc-choice__head">
                  <strong>
                    الموردون الذين أتابعهم — <span className="sting-mono">{data.active_count}</span>
                  </strong>
                  <span className="acc-choice__note">
                    قائمة خاصة بك. لا يرى المورد قائمة من يتابعه كأسماء بل عدداً.
                  </span>
                </div>
                <ul className="cus-list">
                  {data.follows.map((f) => (
                    <li
                      key={f.id}
                      className={f.status === "cancelled" ? "cus-item--expired" : undefined}
                    >
                      <Button
                        variant="quiet"
                        onClick={() => router.push(`/market/suppliers/${f.supplier_tenant_id}`)}
                      >
                        {f.supplier_name}
                      </Button>
                      <div className="cus-sub">
                        {f.status === "cancelled" ? (
                          <>
                            أُلغيت المتابعة <CancelledWhen iso={f.cancelled_at} /> — {f.hint}
                          </>
                        ) : (
                          f.hint
                        )}
                      </div>
                      <div className="acc-actions">
                        <Status
                          state={
                            f.status === "cancelled" ? "expired" : f.suspended ? "stale" : "success"
                          }
                          label={f.status_label}
                        />
                        {f.status === "active" ? (
                          <Button loading={busy === f.id} onClick={() => void unfollow(f)}>
                            إلغاء المتابعة
                          </Button>
                        ) : (
                          <Button loading={busy === f.id} onClick={() => void refollow(f)}>
                            تابع من جديد
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <h3 className="cat-head__title">ما يتوقّف وما يبقى بعد الإلغاء</h3>
                <div className="pub-cols">
                  <div>
                    <strong>يتوقف</strong>
                    <ul className="pub-list">
                      {data.what_stops.map((t) => (
                        <li key={t}>
                          <span className="pub-mark">لا</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>يبقى</strong>
                    <ul className="pub-list">
                      {data.what_stays.map((t) => (
                        <li key={t}>
                          <span className="pub-mark">نعم</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
