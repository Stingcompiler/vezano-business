"use client";

import { useEffect } from "react";

import "./motion.css";

/**
 * 04 — مؤشر ينزلق بين الشرائح (0005 §١٣٧) لكل مجموعة `.pos-chips` في التطبيق بلا تعديل أيٍّ منها
 * (48 مجموعة): حين تتبدّل الشريحة المفعّلة تنزلق كبسولة بلون العلامة من موضع السابقة إلى الجديدة، ثم
 * تعود الشريحة إلى مظهرها العادي. الحالة الساكنة هي التصميم الأصلي نفسه — لا تغيّر في الألوان ولا
 * التباين، ولا شيء عند «تقليل الحركة».
 */
const MOVE_MS = 260;

export function ChipSlider() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const last = new WeakMap<Element, HTMLElement | null>();
    let frame = 0;

    // الكبسولة مثبّتة في بداية السطر (يمين في RTL): الإزاحة من تلك الحافة، سالبة في RTL
    const rectIn = (group: HTMLElement, el: HTMLElement) => {
      const rtl = getComputedStyle(group).direction === "rtl";
      return {
        x: rtl ? -(group.clientWidth - el.offsetLeft - el.offsetWidth) : el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
    };

    const slide = (group: HTMLElement, from: HTMLElement, to: HTMLElement) => {
      let pill = group.querySelector<HTMLElement>(":scope > .chip-slider");
      if (!pill) {
        pill = document.createElement("span");
        pill.className = "chip-slider";
        pill.setAttribute("aria-hidden", "true");
        group.appendChild(pill);
      }
      const a = rectIn(group, from);
      const b = rectIn(group, to);
      pill.style.transition = "none";
      pill.style.transform = `translate(${a.x}px, ${a.y}px)`;
      pill.style.inlineSize = `${a.w}px`;
      pill.style.blockSize = `${a.h}px`;
      group.dataset.moving = "";
      // إعادة الحساب قبل الانتقال حتى يبدأ من موضع السابقة
      void pill.offsetWidth;
      pill.style.transition = "";
      pill.style.transform = `translate(${b.x}px, ${b.y}px)`;
      pill.style.inlineSize = `${b.w}px`;
      pill.style.blockSize = `${b.h}px`;
      window.setTimeout(() => {
        delete group.dataset.moving;
      }, MOVE_MS);
    };

    const scan = () => {
      frame = 0;
      for (const group of document.querySelectorAll<HTMLElement>(".pos-chips")) {
        const on = group.querySelector<HTMLElement>(":scope > .pos-chip--on");
        const prev = last.get(group);
        last.set(group, on);
        if (reduce.matches || prev === undefined || !on || !prev || prev === on) continue;
        if (!prev.isConnected || prev.parentElement !== group) continue;
        slide(group, prev, on);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(scan);
    };

    scan();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      mo.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
