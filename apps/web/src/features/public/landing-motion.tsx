"use client";

/**
 * حركة صفحة الهبوط (0005 §١٣٧) — تسويق لا عمل يومي؛ كلها ساكنة بحالتها النهائية عند «تقليل الحركة»:
 *
 * - `WordReveal` (11/12): العنوان يظهر كلمةً كلمة — لا حرفاً حرفاً، فالعربية متصلة الحروف.
 * - `Odometer` (17): أرقام نموذج الواجهة تتدحرج مرة؛ عمود الأرقام من CSS (`::before`) فيبقى نصّ الرقم
 *   الحقيقي هو نصّ الصفحة (المواصفات والقارئ الصوتي يقرآنه كما هو).
 * - `FlowSection` (15): المسار من البيع على الجهاز إلى الدفتر والمورد — خطوط تُرسم ونقاط تجري.
 * - `ParticleMark` (16): جسيمات تتجمّع في شعار «ف» الدكّان مرة واحدة ثم تحلّ محلها العلامة.
 */
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { BrandMark } from "@/features/public/brand-mark";

const reduced = () =>
  typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** يضع `data-in` على العنصر حين يدخل مجال الرؤية (مرة، أو كل مرة مع `repeat`). */
function useInView<T extends HTMLElement>(repeat = false) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced() || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setInView(true);
          if (!repeat) io.disconnect();
        } else if (repeat) {
          setInView(false);
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [repeat]);
  return [ref, inView] as const;
}

export function WordReveal({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <h1 className="lp-words">
      {words.map((w, i) => (
        <span key={`${w}-${i}`}>
          <span className="lp-words__w" style={{ "--i": i } as CSSProperties}>
            {w}
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </h1>
  );
}

export function Odometer({ value, className }: { value: string; className?: string }) {
  const [ref, inView] = useInView<HTMLElement>();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!reduced()) setArmed(true);
  }, []);
  let pos = 0;
  return (
    <b
      ref={ref}
      className={`lp-odo${className ? ` ${className}` : ""}`}
      data-armed={armed || undefined}
      data-run={(armed && inView) || undefined}
    >
      {[...value].map((ch, i) =>
        /\d/.test(ch) ? (
          <span
            key={i}
            className="lp-odo__d"
            style={{ "--d": Number(ch), "--p": pos++ } as CSSProperties}
          >
            {ch}
          </span>
        ) : (
          <span key={i} className="lp-odo__s">
            {ch}
          </span>
        ),
      )}
    </b>
  );
}

/** عقدة المسار: عنوان ووصف قصير. */
function Node({ title, note, end }: { title: string; note: string; end?: boolean }) {
  return (
    <li className="lp-flow__node" data-end={end || undefined}>
      <strong>{title}</strong>
      <span>{note}</span>
    </li>
  );
}

function Link() {
  return (
    <li className="lp-flow__link" aria-hidden="true">
      <span className="lp-flow__line" />
      <span className="lp-flow__dot" />
    </li>
  );
}

export function FlowSection() {
  const [ref, inView] = useInView<HTMLElement>(true);
  return (
    <section
      ref={ref}
      id="lp-flow"
      className="lp__section"
      data-in={inView || undefined}
      aria-labelledby="lp-flow-title"
    >
      <div className="lp__wrap">
        <div className="lp__center">
          <div className="lp__kicker">كيف يعمل</div>
          <h2 id="lp-flow-title">البيع لا ينتظر الشبكة</h2>
          <p className="lp__lead">
            كل بيع يُحفظ على جهازك أولاً، ثم يلتقي بدفتر المنشأة وبموردك حين تعود الشبكة — بلا إدخال
            مكرَّر.
          </p>
        </div>
        <ol className="lp-flow">
          <Node title="الكاشير يبيع" note="نقد أو آجل أو بنكك" />
          <Link />
          <Node title="يُحفظ على الجهاز" note="ولو انقطعت الشبكة والكهرباء" />
          <Link />
          <Node title="يُزامَن عند العودة" note="بلا تكرار ولا ضياع" />
          <Link />
          <Node title="دفتر المنشأة" note="الذمم والمخزون والتقارير" end />
          <Link />
          <Node title="موردوك في السوق" note="طلب موثَّق يدخل مخزونك" end />
        </ol>
      </div>
    </section>
  );
}

/** نقاط الشعار: تُرسم العلامة على لوح خفي وتُؤخذ منها بكسلات ملوّنة كأهداف للجسيمات. */
function sampleMark(size: number): { x: number; y: number; c: string }[] {
  const off = document.createElement("canvas");
  off.width = off.height = size;
  const g = off.getContext("2d");
  if (!g) return [];
  const s = size / 120;
  const rr = (x: number, y: number, w: number, h: number, r: number, c: string) => {
    g.fillStyle = c;
    g.beginPath();
    g.roundRect(x * s, y * s, w * s, h * s, r * s);
    g.fill();
  };
  rr(0, 0, 120, 120, 28, "#12253B");
  rr(16, 78, 88, 14, 7, "#37B0B8");
  g.strokeStyle = "#37B0B8";
  g.lineWidth = 12 * s;
  g.beginPath();
  g.roundRect(58 * s, 44 * s, 44 * s, 48 * s, 11 * s);
  g.stroke();
  g.fillStyle = "#F6F8FB";
  g.beginPath();
  g.moveTo(50 * s, 42 * s);
  g.lineTo(57 * s, 28 * s);
  g.lineTo(103 * s, 28 * s);
  g.lineTo(110 * s, 42 * s);
  g.fill();
  rr(70, 58, 20, 5, 2.5, "#F6F8FB");
  rr(70, 68, 13, 5, 2.5, "#F6F8FB");
  g.fillStyle = "#E8A33D";
  g.beginPath();
  g.arc(80 * s, 15 * s, 7.5 * s, 0, Math.PI * 2);
  g.fill();
  const data = g.getImageData(0, 0, size, size).data;
  const pts: { x: number; y: number; c: string }[] = [];
  const step = 4;
  for (let y = 0; y < size; y += step)
    for (let x = 0; x < size; x += step) {
      const i = (y * size + x) * 4;
      if ((data[i + 3] ?? 0) > 200)
        pts.push({ x, y, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
  return pts;
}

export function ParticleMark({ size = 112 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!inView || done) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || reduced() || typeof ctx.roundRect !== "function") {
      setDone(true);
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const targets = sampleMark(size);
    const parts = targets.map((t) => ({
      ...t,
      sx: Math.random() * size,
      sy: Math.random() * size,
      delay: Math.random() * 250,
    }));
    const duration = 1100;
    const start = performance.now();
    let raf = 0;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const frame = (now: number) => {
      ctx.clearRect(0, 0, size, size);
      let all = true;
      for (const p of parts) {
        const t = Math.max(0, Math.min(1, (now - start - p.delay) / duration));
        if (t < 1) all = false;
        const k = ease(t);
        ctx.fillStyle = p.c;
        ctx.fillRect(p.sx + (p.x - p.sx) * k, p.sy + (p.y - p.sy) * k, 3.2, 3.2);
      }
      if (all) setDone(true);
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [inView, done, size]);
  return (
    <div
      ref={ref}
      className="lp-particles"
      style={{ inlineSize: size, blockSize: size }}
      data-done={done || undefined}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} style={{ inlineSize: size, blockSize: size }} />
      <span className="lp-particles__mark">
        <BrandMark />
      </span>
    </div>
  );
}
