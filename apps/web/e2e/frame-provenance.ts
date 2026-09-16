/**
 * إثبات المصدر: كل نص تتوقعه الاختبارات من شاشةٍ موجود حرفياً في إطارها المرجعي (states-matrix.csv).
 * يمنع أن يتسلّل نص مصوغ من عند المنفّذ إلى الشاشة ثم إلى الاختبار (القاعدة ٣ من الأمر).
 */
import { frameTextsAll } from "@sting/tools-frame-text";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function fromFrame(screenId: string, state: string, texts: readonly string[]): string[] {
  const pool = frameTextsAll(screenId, state).flatMap((f) => [...f.staticTexts, ...f.scriptTexts]);
  const haystack = pool.map(norm);
  const orphans = texts.filter((t) => !haystack.some((h) => h.includes(norm(t))));
  if (orphans.length) {
    throw new Error(`نصوص ليست في إطار ${screenId}/${state}: ${JSON.stringify(orphans)}`);
  }
  return [...texts];
}
