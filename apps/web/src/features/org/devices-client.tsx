"use client";

import { Frame, Notice, Status, Table } from "@sting/ui-web";
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
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "offline" | "stale";

export interface DeviceRow {
  id: string;
  name: string;
  prefix: string;
  branch_id: string;
  branch_name: string;
  status: string;
  connectivity: "connected" | "offline" | "stale" | "silent" | "revoked";
  last_seen_at: string;
  pending: number;
  pending_at: string;
  users: string[];
  registered_at: string;
  sells: boolean;
}
interface Payload {
  devices: DeviceRow[];
  counts: { total: number; active: number; pending_total: number };
  device_limit: number | null;
  as_of: string;
}

export const DEVICES_CACHE_META = "org.devices_cache";
const STALE_MS = 10 * 60_000;

const CONN_LABEL: Record<DeviceRow["connectivity"], string> = {
  connected: "متصل",
  offline: "غير متصل",
  stale: "متقادم",
  silent: "صامت",
  revoked: "مسحوب",
};

/** «غير مرفوع»: عدد ما لم يُرفع بعد ومعناه — لا وصف «متصل» كاذب. */
function unsynced(d: DeviceRow): string {
  if (!d.sells) return "عرض ومتابعة فقط — لا بيع من هذا الجهاز";
  if (d.pending === 0 && d.connectivity === "connected") return "يرفع فوراً";
  if (d.connectivity === "stale" && d.pending > 0)
    return `السحب قبل الرفع يفقد ${d.pending} عملية.`;
  if (d.connectivity === "offline") return "يبيع محلياً الآن على الأرجح — غير متصل لا يعني متوقفاً";
  if (d.pending > 0) return `${d.pending} عمليات محفوظة محلياً لم تُرفع.`;
  return "لا معلّق";
}

/**
 * ORG-04 — الأجهزة: «آخر اتصال» رقم لا حالة وهمية (27-D20 ready/offline/stale · 39-D31 loading/
 * empty): الجهاز غير المتصل ليس معطّلاً؛ نعرض آخر اتصال ناجح وعدد ما لم يُرفع بعد. سحب الجهاز
 * فعل منفصل عن تعطيل مستخدم (ORG-05) ولا يُسحب جهاز له معلّق قبل عرض عدده (§٩.٣، §٨.١٣).
 */
export function DevicesClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [data, setData] = useState<Payload | null>(null);
  const [cached, setCached] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    const raw = await storage.read((tx) => tx.getMeta(DEVICES_CACHE_META));
    if (raw) {
      try {
        setCached(JSON.parse(raw) as Payload);
      } catch {
        /* كاش تالف — يُتجاهل */
      }
    }
    if (!navigator.onLine) {
      setLoaded(true);
      return;
    }
    try {
      const { data: d, response } = await api().GET("/api/org/devices", {});
      if (response.ok && d) {
        const p = d as unknown as Payload;
        setData(p);
        setFailed(false);
        const json = JSON.stringify(p);
        await storage.transaction((tx) => tx.putMeta(DEVICES_CACHE_META, json));
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fdevices");
      return;
    }
    void load();
  }, [router, load, online]);

  const shown = data ?? cached;
  const asOfOld = shown ? Date.now() - new Date(shown.as_of).getTime() > STALE_MS : false;
  const state: State = !loaded
    ? "loading"
    : !online
      ? "offline"
      : !data && (failed || asOfOld) && cached
        ? "stale"
        : shown && shown.devices.length === 0
          ? "empty"
          : "ready";

  const columns = [
    {
      key: "device",
      header: "الجهاز",
      render: (d: DeviceRow) => (
        <div>
          <strong>{d.name}</strong>
          <p className="acc-choice__note">
            بادئة <span className="sting-mono">{d.prefix}</span>
          </p>
        </div>
      ),
    },
    {
      key: "branch",
      header: "الفرع والمستخدمون",
      render: (d: DeviceRow) => (
        <div>
          <span>{d.branch_name}</span>
          <p className="acc-choice__note">{d.users.join(" · ") || "—"}</p>
        </div>
      ),
    },
    {
      key: "seen",
      header: "آخر اتصال ناجح",
      render: (d: DeviceRow) => <Ago iso={d.last_seen_at} />,
    },
    {
      key: "pending",
      header: "غير مرفوع",
      render: (d: DeviceRow) => {
        const t = unsynced(d);
        const parts = t.split(/([0-9]+)/);
        return (
          <span>
            {parts.map((p, i) =>
              /^[0-9]+$/.test(p) ? (
                <span key={i} className="sting-mono">
                  {p}
                </span>
              ) : (
                p
              ),
            )}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "الحالة",
      render: (d: DeviceRow) => (
        <span
          className={`org-badge org-badge--${d.connectivity === "connected" ? "active" : d.connectivity === "stale" ? "expired" : "disabled"}`}
        >
          {CONN_LABEL[d.connectivity]}
        </span>
      ),
    },
  ];

  return (
    <Frame title="الأجهزة" nav={<AppNav currentId="org-devices" />} footer={null}>
      <div className="sys" data-screen="ORG-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قائمة الأجهزة وتفاصيلها</h2>
            <span className="cat-head__hint">حالتان ناقصتان. الجهاز عهدةٌ عليها عمل.</span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الأجهزة">
                <p className="acc-lead">مع حالة المزامنة لكل جهاز — وهي سبب فتح الشاشة غالباً.</p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا أجهزة مسجّلة">
                <p className="acc-lead">منشأة أُنشئت ولم يُهيّأ عليها جهاز بعد.</p>
                <p className="acc-choice__note">
                  <strong>المسار</strong> · «جهّز هذا الجهاز» (ACC-05). والأغلب أن من يقرأ هذا يقرؤه
                  على الجهاز الذي يريد تهيئته.
                </p>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Status
                state="offline"
                label={
                  cached
                    ? "بلا اتصال — القائمة كما كانت عند آخر تحديث"
                    : "بلا اتصال — لا قائمة مخزَّنة بعد"
                }
              />
            ) : null}
            {state === "stale" ? (
              <Status state="stale" label="القائمة قديمة — تعذّر التحديث من الخادم" />
            ) : null}

            {shown && shown.devices.length > 0 ? (
              <>
                <div className="cat-head">
                  <h3 className="cat-head__title">
                    الأجهزة — <span className="sting-mono">{shown.counts.total}</span>
                    {shown.device_limit !== null ? (
                      <>
                        {" "}
                        من حدّ الباقة <span className="sting-mono">{shown.device_limit}</span>
                      </>
                    ) : null}
                  </h3>
                  <span className="cat-head__hint">
                    الوقت المعروض بتوقيت المنشأة · آخر تحديث <Ago iso={shown.as_of} />
                  </span>
                </div>
                <Table
                  caption="الأجهزة"
                  columns={columns}
                  rows={shown.devices}
                  rowKey={(d) => d.id}
                />
                <p className="acc-choice__note">
                  <strong>سحب الجهاز فعل منفصل عن تعطيل مستخدم (ORG-05).</strong> ولا نسحب جهازاً له
                  عمليات لم تُرفع قبل أن نعرض عددها ونحذّر: السحب قبل الرفع يعني فقد تلك العمليات،
                  والقرار للمالك بعد أن يراه مكتوباً.
                </p>
                <p className="acc-choice__note">
                  الجهاز غير المتصل ليس معطّلاً؛ لعله يبيع محلياً الآن. نعرض آخر اتصال ناجح وعدد ما
                  لم يُرفع بعد، بلا وصف «متصل» كاذب.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
