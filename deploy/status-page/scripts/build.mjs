// يجمّع صفحة الحالة المستقلة لـGitHub Pages من بناء الإنتاج (0005 §١٥٧). يُشغَّل بعد:
//   NEXT_PUBLIC_API_URL=https://plus.vezano.app NEXT_DIST_DIR=.next-status pnpm --filter @sting/web build
// الصفحة تسأل الخادم الرئيسي من المتصفح مباشرةً (CORS لأصل status.vezano.app وحده)؛ لا خادم هنا.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const web = resolve(root, "../../apps/web");
const build = resolve(web, process.env.NEXT_DIST_DIR ?? ".next-status");
const dist = resolve(root, "dist");

const page = resolve(build, "server/app/status.html");
if (!existsSync(page)) throw new Error(`لا ${page} — ابنِ الويب أولاً`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(page, resolve(dist, "status.html"));
cpSync(resolve(build, "static"), resolve(dist, "_next/static"), { recursive: true });
cpSync(resolve(web, "public/icons"), resolve(dist, "icons"), { recursive: true });
cpSync(resolve(web, "public/og.png"), resolve(dist, "og.png"));
cpSync(resolve(web, "src/app/favicon.ico"), resolve(dist, "favicon.ico"));
cpSync(resolve(root, "sw.js"), resolve(dist, "sw.js"));
// الجذر → /status؛ وأي مسار آخر (الرئيسية، الباقات، الدخول…) → الموقع الرئيسي بمساره
const MAIN = "https://plus.vezano.app";
writeFileSync(
  resolve(dist, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/status"><link rel="canonical" href="/status"><title>حالة الخدمة · فيزانو بلص</title><a href="/status">حالة الخدمة</a>`,
);
writeFileSync(
  resolve(dist, "404.html"),
  `<!doctype html><meta charset="utf-8"><title>فيزانو بلص</title><script>location.replace(${JSON.stringify(MAIN)} + location.pathname + location.search)</script><a href="${MAIN}">فيزانو بلص</a>`,
);
// GitHub Pages: النطاق، ولا Jekyll (وإلا اختفى مجلد _next لأنه يبدأ بشرطة سفلية)
writeFileSync(resolve(dist, "CNAME"), "status.vezano.app\n");
writeFileSync(resolve(dist, ".nojekyll"), "");
console.log(`dist: ${dist}`);
