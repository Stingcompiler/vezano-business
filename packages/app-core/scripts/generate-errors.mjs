// يولّد `src/errors.generated.ts` من رموز الأخطاء المرصودة في `backend/core/api_contract.json`
// (0005 §١٦١) — قائمة الرموز لكل عملية، يستعملها الويب والجوال لتسمية الأخطاء بنصّ واحد.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  readFileSync(resolve(here, "../../../backend/core/api_contract.json"), "utf8"),
);
const byOp = {};
const all = new Set();
// رموز الخادم snake_case وحدها — رسائل DRF الإنجليزية الافتراضية (مصادقة) ليست رموزاً
const isCode = (c) => /^[a-z][a-z0-9_]*$/.test(c);
for (const [op, entries] of Object.entries(contract.errors)) {
  const list = entries
    .map((e) => {
      const i = e.indexOf(":");
      return { status: Number(e.slice(0, i)), code: e.slice(i + 1) };
    })
    .filter((e) => isCode(e.code));
  for (const e of list) all.add(e.code);
  if (list.length) byOp[op] = list;
}
const codes = [...all].sort();
const out = `/* مولَّد آلياً من backend/core/api_contract.json (pnpm --filter @sting/app-core generate) — لا يُحرَّر يدوياً. */

/** كل رموز \`detail\` التي رُصدت من الخادم (${codes.length} رمزاً). */
export const API_ERROR_CODES = ${JSON.stringify(codes, null, 2)} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** الرموز المرصودة لكل عملية مع حالتها: «POST /api/x» ← [{status, code}]. */
export const API_ERRORS_BY_OPERATION: Readonly<
  Record<string, readonly { readonly status: number; readonly code: ApiErrorCode }[]>
> = ${JSON.stringify(byOp, null, 2)};
`;
writeFileSync(resolve(here, "../src/errors.generated.ts"), out);
console.log(`${codes.length} رمزاً في ${Object.keys(byOp).length} عملية`);
