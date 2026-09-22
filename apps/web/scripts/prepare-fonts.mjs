// يولّد src/app/fonts.generated.css: يستورد @font-face فقط إن وُجدت ملفات الخطوط محلياً.
// بغيابها يعمل التطبيق بـ system-ui (fallback) ويُسجَّل تحذير — الملفات بانتظار إذن التنزيل (fonts/README.md).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(here, "../../../packages/design/fonts");
const required = [
  "Tajawal-Regular.ttf",
  "Inter[opsz,wght].ttf",
  "Cairo[slnt,wght].ttf",
  "IBMPlexSansArabic-Regular.ttf",
  "IBMPlexMono-Regular.ttf",
];
const present = required.every((f) => existsSync(resolve(fontsDir, f)));
const out = resolve(here, "../src/app/fonts.generated.css");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  present
    ? '@import "@sting/design/fonts.faces.css";\n'
    : "/* الخطوط المحلية غير موجودة بعد — fallback system-ui (packages/design/fonts/README.md) */\n",
);
console.log(
  present
    ? "fonts: local @font-face enabled"
    : "fonts: WARNING local font files missing — using fallback",
);
