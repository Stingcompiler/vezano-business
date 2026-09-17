"use client";

/**
 * حلقة التهيئة الأولى (ACC-05): تسجيل الجهاز → نسخة مادية → صفحات النطاقات المسمّاة → التفعيل.
 * - الاستئناف من النسخة نفسها؛ الانتهاء (410) يبدأ نسخة جديدة ويقول ذلك (stale).
 * - خطأ في منتصف نطاق: ثلاث محاولات متباعدة ثم وقوف بزرّ يدوي — ما نزل يبقى (server_error/partial).
 * - بلا شبكة: توقّف بلا محو، والتقدّم محفوظ (offline).
 */
import { requestPersistentStorage, type PersistOutcome } from "@sting/platform/dexie";
import {
  activateBootstrap,
  applyBootstrapPage,
  beginBootstrap,
  type BootstrapImage,
  type BootstrapProgress,
  DOWNLOAD_ORDER,
  expireBootstrap,
  isExpired,
  readBootstrap,
} from "@sting/sync-core";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, setAccessToken } from "@/lib/api";
import { type DeviceTokens, useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

export type Phase = "idle" | "registering" | "downloading" | "activating" | "done" | "stopped";
export type StopReason = "error" | "expired" | "offline" | null;

const RETRY_DELAYS_MS = [1000, 3000, 7000] as const;
const DEVICE_META = "device.registration";

interface StoredDevice {
  readonly deviceId: string;
  readonly prefix: string;
  readonly branchId: string;
  readonly branchCode?: string | undefined;
  readonly registrationSecret: string;
}

export interface BootstrapUi {
  readonly phase: Phase;
  readonly stop: StopReason;
  readonly progress: BootstrapProgress | null;
  readonly persist: PersistOutcome | null;
  readonly expiredNotice: boolean;
  readonly retry: () => void;
}

export function useBootstrap(online: boolean): BootstrapUi {
  const app = useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [stop, setStop] = useState<StopReason>(null);
  const [progress, setProgress] = useState<BootstrapProgress | null>(null);
  const [persist, setPersist] = useState<PersistOutcome | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [run, setRun] = useState(0);
  const running = useRef(false);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const retry = useCallback(() => setRun((n) => n + 1), []);

  useEffect(() => {
    if (!app.tokens || !app.session.tenantId || running.current) return;
    if (!online) {
      setStop("offline");
      setPhase("stopped");
      return;
    }
    running.current = true;
    let cancelled = false;
    const tenantId = app.session.tenantId;
    const storage = getStorage();

    const ensureDevice = async (): Promise<DeviceTokens> => {
      if (app.device) return app.device;
      setPhase("registering");
      const raw = await storage.read((tx) => tx.getMeta(DEVICE_META));
      const stored = raw ? (JSON.parse(raw) as StoredDevice) : null;
      if (stored) {
        const { data, response } = await api().POST("/api/devices/renew", {
          body: { device_id: stored.deviceId, registration_secret: stored.registrationSecret },
        });
        if (response.ok && data) {
          const d: DeviceTokens = {
            deviceId: data.device_id,
            prefix: data.prefix,
            branchId: data.branch_id,
            access: data.access,
            refresh: data.refresh,
          };
          app.setDevice(d);
          return d;
        }
      }
      const { data, response } = await api().POST("/api/devices/register", {
        body: {
          name: deviceName(),
          ...(app.session.branchId ? { branch_id: app.session.branchId } : {}),
        },
      });
      if (!response.ok || !data) throw new Error("register_failed");
      await storage.transaction((tx) =>
        tx.putMeta(
          DEVICE_META,
          JSON.stringify({
            deviceId: data.device_id,
            prefix: data.prefix,
            branchId: data.branch_id,
            branchCode: data.branch_code,
            registrationSecret: data.registration_secret,
          } satisfies StoredDevice),
        ),
      );
      const d: DeviceTokens = {
        deviceId: data.device_id,
        prefix: data.prefix,
        branchId: data.branch_id,
        access: data.access,
        refresh: data.refresh,
      };
      app.setDevice(d);
      return d;
    };

    const startImage = async (): Promise<BootstrapImage> => {
      const { data, response } = await api().POST("/api/bootstrap/start");
      if (!response.ok || !data) throw new Error("start_failed");
      return data as BootstrapImage;
    };

    const withRetries = async <T>(fn: () => Promise<T>): Promise<T> => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (cancelled) throw new Error("cancelled");
        if (!onlineRef.current) throw new OfflineError();
        try {
          return await fn();
        } catch (e) {
          if (e instanceof ExpiredError || e instanceof OfflineError) throw e;
          lastError = e;
          const delay = RETRY_DELAYS_MS[attempt];
          if (delay === undefined) break;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("failed");
    };

    void (async () => {
      try {
        setStop(null);
        const device = await withRetries(ensureDevice);
        setAccessToken(device.access);
        let p = await readBootstrap(storage);
        if (p && isExpired(p)) {
          setExpiredNotice(true);
          p = null;
        }
        if (!p || p.tenantId !== tenantId) {
          const image = await withRetries(startImage);
          p = await beginBootstrap(storage, image, { tenantId, branchId: device.branchId });
        }
        setProgress(p);
        if (!p.activatedAt) {
          setPhase("downloading");
          const ordered = [...p.image.scopes].sort(
            (a, b) => DOWNLOAD_ORDER.indexOf(a.group) - DOWNLOAD_ORDER.indexOf(b.group),
          );
          for (const scope of ordered) {
            for (let n = (p.pagesDone[scope.group] ?? 0) + 1; n <= scope.pages; n++) {
              const page = await withRetries(async () => {
                const { data, response } = await api().GET("/api/bootstrap/{image_id}/page", {
                  params: {
                    path: { image_id: p!.image.image_id },
                    query: { group: scope.group, page: n },
                  },
                });
                if (response.status === 410) throw new ExpiredError();
                if (!response.ok || !data) throw new Error("page_failed");
                return data;
              });
              const applied = await applyBootstrapPage(
                storage,
                scope.group,
                n,
                page.entities as { entity: string; id: string; payload: Record<string, unknown> }[],
              );
              if (applied.progress) {
                p = applied.progress;
                setProgress(p);
              }
            }
          }
          setPhase("activating");
          const outcome = await activateBootstrap(storage);
          if (outcome.progress) {
            p = outcome.progress;
            setProgress(p);
          }
          await api()
            .POST("/api/bootstrap/{image_id}/complete", {
              params: { path: { image_id: p.image.image_id } },
            })
            .catch(() => undefined);
        }
        setPersist(await requestPersistentStorage());
        setPhase("done");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ExpiredError) {
          // النسخة انتهت في منتصف الصفحات: نبدأ مرشحاً جديداً ونقول ذلك (ACC-53)
          await expireBootstrap(storage);
          setExpiredNotice(true);
          setStop("expired");
        } else if (e instanceof OfflineError || !onlineRef.current) {
          setStop("offline");
        } else {
          setStop("error");
        }
        setPhase("stopped");
      } finally {
        running.current = false;
      }
    })();
    return () => {
      cancelled = true;
      running.current = false;
    };
    // run وonline محفّزا الإعادة عمداً؛ app يُقرأ عند التشغيل لا عند كل تغيير
  }, [app.tokens, app.session.tenantId, run, online]);

  return { phase, stop, progress, persist, expiredNotice, retry };
}

class ExpiredError extends Error {}
class OfflineError extends Error {}

/** اسم الجهاز كما يراه الخادم — بيانات لا نص واجهة (لاتيني من المتصفح). */
function deviceName(): string {
  const ua = navigator.userAgent;
  const m = /\((?<os>[^)]+)\)/.exec(ua);
  return `web · ${m?.groups?.os?.split(";")[0] ?? "browser"}`.slice(0, 200);
}
