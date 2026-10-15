// يجمّع صفحة الحالة المستقلة من بناء الإنتاج (0005 §١٥٧). يُشغَّل بعد:
//   NEXT_PUBLIC_API_URL="" NEXT_DIST_DIR=.next-status pnpm --filter @sting/web exec next build
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
cpSync(resolve(root, "_headers"), resolve(dist, "_headers"));
cpSync(resolve(root, "sw.js"), resolve(dist, "sw.js"));
console.log(`dist: ${dist}`);
