/**
 * إثبات المصدر: كل نص تتوقعه الاختبارات من شاشةٍ موجود حرفياً في إطارها المرجعي (states-matrix.csv).
 * يمنع أن يتسلّل نص مصوغ من عند المنفّذ إلى الشاشة ثم إلى الاختبار (القاعدة ٣ من الأمر).
 */
import { drawnStates, frameTextsAll } from "@sting/tools-frame-text";

// الاسم التجاري «فيزانو بلص» يحلّ محل «Sting» في الواجهة بقرار المالك (2026-09-20، ثم 2026-09-26 — 0005 §١٣١) — الإطارات تحمل الاسم القديم
const norm = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/فيزانو/g, "Sting")
    .trim();

export function fromFrame(screenId: string, state: string, texts: readonly string[]): string[] {
  // الشاشة الواحدة تُركَّب من كل إطاراتها المرسومة (حالة على قالب حالة أخرى)؛ الاسم للحالة المفحوصة
  const states = [...new Set([state, ...drawnStates(screenId).map((s) => s.state)])];
  const pool = states
    .flatMap((s) => frameTextsAll(screenId, s))
    .flatMap((f) => [...f.staticTexts, ...f.scriptTexts]);
  const haystack = pool.map(norm);
  const orphans = texts.filter((t) => !haystack.some((h) => h.includes(norm(t))));
  if (orphans.length) {
    throw new Error(`نصوص ليست في إطار ${screenId}/${state}: ${JSON.stringify(orphans)}`);
  }
  return [...texts];
}
