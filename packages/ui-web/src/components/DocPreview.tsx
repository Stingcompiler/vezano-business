/**
 * C-DOCPRV — معاينة صورة/PDF/إيصال، أو تنزيل بلا معاينة. الحالات: ready, loading, empty,
 * server_error, permission_denied. شريط الأدوات في البداية؛ أسهم لتصفح الصفحات، +/- للتكبير،
 * Esc للخروج من ملء الشاشة. بديل نصي ومسار تنزيل دائم — المعاينة ليست المسار الوحيد.
 */
import { Download, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "./Button";

export interface DocPreviewProps {
  readonly title: string;
  /** المحتوى المعروض (صورة، iframe، إيصال مُنسَّق). */
  readonly children?: ReactNode;
  /** بديل نصي للمستند — إلزامي. */
  readonly textAlternative: string;
  readonly downloadHref?: string | undefined;
  readonly downloadLabel?: string;
  readonly pageCount?: number | undefined;
  readonly page?: number | undefined;
  readonly onPage?: ((page: number) => void) | undefined;
  readonly loading?: boolean | undefined;
  /** empty/server_error/permission_denied: C-NOTICE بنص الإطار بدل المحتوى. */
  readonly notice?: ReactNode;
}

export function DocPreview({
  title,
  children,
  textAlternative,
  downloadHref,
  downloadLabel = "تنزيل",
  pageCount,
  page = 1,
  onPage,
  loading,
  notice,
}: DocPreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const paged = pageCount !== undefined && pageCount > 1 && onPage;
  // اختصارات المعاينة (+/-، أسهم الصفحات، Esc) — مستمع على المستند ما دام التركيز داخل المعاينة أو الشاشة ممتلئة
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const inside = rootRef.current?.contains(document.activeElement) ?? false;
      if (!inside && !full) return;
      if (e.key === "Escape" && full) setFull(false);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(3, z + 0.25));
      else if (e.key === "-") setZoom((z) => Math.max(0.5, z - 0.25));
      else if (paged && e.key === "ArrowLeft") onPage(Math.min(pageCount, page + 1));
      else if (paged && e.key === "ArrowRight") onPage(Math.max(1, page - 1));
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full, paged, pageCount, page, onPage]);
  return (
    <section
      ref={rootRef}
      className={`c-docprv${full ? " c-docprv--full" : ""}`}
      aria-label={title}
    >
      <div className="c-docprv__toolbar" role="toolbar" aria-label={`أدوات ${title}`}>
        <Button
          variant="icon"
          iconLabel="تكبير"
          icon={<ZoomIn size={18} />}
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
        />
        <Button
          variant="icon"
          iconLabel="تصغير"
          icon={<ZoomOut size={18} />}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        />
        <Button
          variant="icon"
          iconLabel={full ? "الخروج من ملء الشاشة" : "ملء الشاشة"}
          icon={full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          onClick={() => setFull((f) => !f)}
        />
        {paged ? (
          <span className="c-docprv__pages">
            <Button
              variant="secondary"
              onClick={() => onPage(page - 1)}
              disabledReason={page <= 1 ? "الصفحة الأولى" : undefined}
            >
              السابقة
            </Button>
            <span>
              <span className="sting-mono">{page}</span> /{" "}
              <span className="sting-mono">{pageCount}</span>
            </span>
            <Button
              variant="secondary"
              onClick={() => onPage(page + 1)}
              disabledReason={page >= pageCount ? "الصفحة الأخيرة" : undefined}
            >
              التالية
            </Button>
          </span>
        ) : null}
        {downloadHref ? (
          <a className="c-btn c-btn--secondary" href={downloadHref} download>
            <Download size={18} aria-hidden="true" />
            {downloadLabel}
          </a>
        ) : null}
      </div>
      <div
        className="c-docprv__stage"
        style={{ "--c-docprv-zoom": zoom } as React.CSSProperties}
        aria-busy={loading || undefined}
      >
        {notice ?? (loading ? <p role="status">جارٍ الجلب</p> : children)}
      </div>
      <p className="visually-hidden">{textAlternative}</p>
    </section>
  );
}
