"use client";

/**
 * PWA (WEB-01؛ §١٢.٥، §١٣.٢): تسجيل عامل الخدمة، التقاط طلب التثبيت، كشف البيئة (مدعوم / iOS
 * يدوي / متصفح داخل تطبيق)، والتحديث الآمن: العامل الجديد لا يُطبَّق ما دام معلّقٌ لم يُرفع أو بلا
 * إذن — «نسخة جديدة جاهزة — أعد التحميل» (ACC-93).
 */
import { countPending } from "@/lib/sync";

export type InstallEnv = "installable" | "ios_manual" | "in_app_browser" | "installed" | "unknown";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let dismissedThisSession = false;
let installedThisSession = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function onPwaChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** يُستدعى مرة من الجذر: يلتقط `beforeinstallprompt` (لا نطلب قبل تفاعل) و`appinstalled`. */
export function setupPwa(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installedThisSession = true;
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

const IN_APP = /FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp|Snapchat|TikTok|; wv\)|WebView/i;
const IOS = /iPhone|iPad|iPod/i;

/** كشف البيئة — تعليمات حسب البيئة لا زر وهمي. */
export function installEnv(): InstallEnv {
  if (typeof navigator === "undefined") return "unknown";
  if (isStandalone() || installedThisSession) return "installed";
  const ua = navigator.userAgent;
  if (IN_APP.test(ua)) return "in_app_browser";
  if (IOS.test(ua)) return "ios_manual";
  if (deferredPrompt) return "installable";
  return "unknown";
}

export function canPrompt(): boolean {
  return deferredPrompt !== null && !dismissedThisSession;
}

export function wasDismissed(): boolean {
  return dismissedThisSession;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const p = deferredPrompt;
  await p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === "dismissed")
    dismissedThisSession = true; // لا تكرار للطلب في الجلسة نفسها
  else installedThisSession = true;
  deferredPrompt = null;
  notify();
  return outcome;
}

let waiting: ServiceWorker | null = null;

/** يسجّل العامل في الإنتاج أو بطلب صريح (`?sw=1`) — لا في التطوير كي لا تُخزَّن حزم متغيّرة. */
export async function registerServiceWorker(
  force = false,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const wanted = force || process.env.NODE_ENV === "production" || location.search.includes("sw=1");
  if (!wanted) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          waiting = w;
          notify();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      waiting = reg.waiting;
      notify();
    }
    track(reg.installing);
    reg.addEventListener("updatefound", () => track(reg.installing));
    return reg;
  } catch {
    return null;
  }
}

export function updateReady(): boolean {
  return waiting !== null;
}

export type ApplyUpdateOutcome = "applied" | "pending_work" | "none";

/** يطبّق العامل الجديد بإذن المستخدم — ويرفض إن كان على الجهاز معلّق لم يُرفع (ACC-93). */
export async function applyUpdate(): Promise<ApplyUpdateOutcome> {
  if (!waiting) return "none";
  if ((await countPending()) > 0) return "pending_work";
  const w = waiting;
  waiting = null;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  w.postMessage({ type: "SKIP_WAITING" });
  return "applied";
}

/** للاختبار (لا في الإنتاج): محاكاة عامل جديد بانتظار الإذن. */
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __stingSwWaiting?: (fake: boolean) => void }).__stingSwWaiting = (
    fake,
  ) => {
    waiting = fake ? ({ postMessage: () => undefined } as unknown as ServiceWorker) : null;
    notify();
  };
}
