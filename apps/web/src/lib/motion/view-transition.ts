"use client";

/**
 * 01/03 — انتقال العنصر المشترك بين القائمة والتفصيل (0005 §١٣٧) بواجهة View Transitions في المتصفح
 * نفسه (Chrome/Android تدعمها): رقم الفاتورة في القائمة ينتقل إلى مكانه في رأس التفصيل. حيث لا دعم أو
 * عند «تقليل الحركة» ينتقل كما كان تماماً. الاسم يُعطى للعنصر المنقور وحده لحظة النقر — لا مئة لقطة
 * لقائمة طويلة.
 */
export function vtName(key: string): string {
  return `vt-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

type Router = { push: (href: string) => void };
type VTDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => unknown;
};

export function pushWithTransition(
  router: Router,
  href: string,
  shared?: { el: HTMLElement | null; name: string },
): void {
  const doc = document as VTDocument;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    router.push(href);
    return;
  }
  const target = new URL(href, window.location.href).pathname;
  if (shared?.el) shared.el.style.viewTransitionName = shared.name;
  doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        router.push(href);
        const started = performance.now();
        // الصفحة الجديدة جاهزة حين يتغيّر المسار ويظهر العنصر المشترك (أو بعد مهلة قصيرة)
        const ready = () =>
          window.location.pathname === target &&
          (!shared || document.querySelector(`[data-vt="${shared.name}"]`) !== null);
        const tick = () => {
          if (ready() || performance.now() - started > 700) {
            requestAnimationFrame(() => resolve());
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
  );
}
