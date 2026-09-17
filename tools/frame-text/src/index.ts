/**
 * مستخرج النصوص الحرفية للإطارات — مصدر الحقيقة لمساعد المطابقة (القسم ٣ من الأمر):
 * «النصوص الحرفية تُطابَق في كل مقاس».
 *
 * الحزمة تعلّم كل شاشة بعنصر يحمل id="SCREEN-ID" (section/div/article) وداخله سطر مراجع الإطارات
 * (P/SCREEN/VP/state · …) وبطاقات لكل حالة. في دفعات «All-States» تُرسم الشاشات من قالب وتعيش
 * نصوصها في بيانات السكربت: mk('SCREEN', name, intro, phase, [ S('state', title, …, body,
 * [r(k, v)], note) ]). لذلك نجمع: (١) عقد النص الثابتة داخل القسم، (٢) سلاسل كتلة الحالة ثم كتلة
 * الشاشة من السكربت. ونُصفّي القوالب ({{ x }}) وسطور المراجع.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface MatrixRow {
  readonly frame_id: string;
  readonly screen_id: string;
  readonly platform: string;
  readonly viewport_px: string;
  readonly state_code: string;
  readonly design_status: string;
  readonly frame_ref: string;
}

export interface FrameTexts {
  readonly screenId: string;
  readonly state: string;
  readonly file: string;
  /** نصوص ثابتة في ماركب القسم (بعد فك HTML وتطبيع المسافات). */
  readonly staticTexts: readonly string[];
  /** سلاسل من بيانات السكربت: كتلة الحالة أولاً ثم كتلة الشاشة. */
  readonly scriptTexts: readonly string[];
}

/** جذر الحزمة: يُبحث عنه صعوداً من مجلد التشغيل — يعمل من Vitest (الجذر) وPlaywright (apps/web) وCJS. */
function findPackageDir(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = resolve(dir, "design_handoff_sting_systems");
    if (existsSync(resolve(candidate, "handoff/states-matrix.csv"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("design_handoff_sting_systems غير موجود فوق " + process.cwd());
    dir = parent;
  }
}

export const PACKAGE_DIR = findPackageDir();

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

const norm = (s: string) => decodeHtml(s).replace(/\s+/g, " ").trim();
const isTemplate = (s: string) => /\{\{.*\}\}/.test(s);
const isRefLine = (s: string) =>
  /^[WMDAC]\/[A-Z]+-\d+\/\d+\/\w+/.test(s) || /^[WMDAC]\/\d+\/\w+$/.test(s);

/** يقرأ صفوف المصفوفة (CSV بقيم بين علامتي اقتباس). */
export function readMatrix(): MatrixRow[] {
  const raw = readFileSync(resolve(PACKAGE_DIR, "handoff/states-matrix.csv"), "utf8");
  const [head, ...lines] = raw.split(/\r?\n/).filter(Boolean);
  const cols = head!.split(",").map((c) => c.replace(/^"|"$/g, ""));
  return lines.map((line) => {
    const vals = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]!.replace(/""/g, '"'));
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = vals[i] ?? ""));
    return row as unknown as MatrixRow;
  });
}

/** يعيد الصف المرسوم للزوج (screen, state) عند التركيبة الأساسية. */
export function frameRefFor(
  screenId: string,
  state: string,
  matrix: MatrixRow[] = readMatrix(),
): MatrixRow | undefined {
  return matrix.find(
    (r) => r.screen_id === screenId && r.state_code === state && r.design_status === "drawn",
  );
}

/** القسم الثابت لشاشة: <section|div|article id="SCREEN"> حتى وسم الإغلاق المطابق. */
function sectionOf(htmlText: string, screenId: string): string | null {
  const re = new RegExp(`<(section|div|article)[^>]*\\sid="${screenId}"[^>]*>`);
  const m = re.exec(htmlText);
  if (!m) return null;
  const tag = m[1]!;
  const tokens = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "g");
  tokens.lastIndex = m.index;
  let depth = 0;
  let tk: RegExpExecArray | null;
  while ((tk = tokens.exec(htmlText))) {
    depth += tk[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return htmlText.slice(m.index, tk.index);
  }
  return htmlText.slice(m.index);
}

/** قسم مشترك بلا id: أقرب <section> يحتوي سطر المرجع P/SCREEN/VP/state. */
function sectionByRefLine(htmlText: string, screenId: string, row: MatrixRow): string | null {
  const ref = `${row.platform}/${screenId}/${row.viewport_px}/${row.state_code}`;
  const at = htmlText.indexOf(ref);
  if (at === -1) return null;
  const start = htmlText.lastIndexOf("<section", at);
  if (start === -1) return null;
  const end = htmlText.indexOf("</section>", at);
  return htmlText.slice(start, end === -1 ? undefined : end);
}

/** نهاية استدعاء يبدأ عند أول '(' بعد from — بعدّ الأقواس مع تجاهل السلاسل. */
function findCallEnd(src: string, from: number): number {
  const i = src.indexOf("(", from);
  return i === -1 ? src.length : findBlockEnd(src, i);
}

/** نهاية كتلة تبدأ بقوس فاتح عند open ('(' أو '[' أو '{') — بعدّ الأقواس مع تجاهل السلاسل. */
function findBlockEnd(src: string, open: number): number {
  let i = open;
  let depth = 0;
  let quote: string | null = null;
  for (; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

function scripts(htmlText: string): string[] {
  return [...htmlText.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]!)
    .filter((s) => !s.includes("support.js") && s.length > 100);
}

/** كتلة الشاشة في السكربت القالبي mk('SCREEN', …)؛ مع state تُعاد كتلة S('state', …) داخلها فقط. */
function templateBlockOf(htmlText: string, screenId: string, state?: string): string | null {
  for (const sc of scripts(htmlText)) {
    // mk('SCREEN', …) أو mk('GROUP', 'SCREEN', …)
    const m = new RegExp(`mk\\((?:'[^']*',\\s*)?'${screenId}'`).exec(sc);
    if (!m) continue;
    const i = m.index;
    const block = sc.slice(i, findCallEnd(sc, i));
    if (!state) return block;
    const j = block.indexOf(`S('${state}'`);
    return j === -1 ? null : block.slice(j, findCallEnd(block, j));
  }
  return null;
}

/** بيانات الشاشة المسماة بمفتاحها (مثل acc08: [ … ]). */
function keyedBlockOf(htmlText: string, screenId: string): string | null {
  const key = `${screenId.toLowerCase().replace("-", "")}:`;
  for (const sc of scripts(htmlText)) {
    const i = sc.indexOf(key);
    if (i === -1) continue;
    const open = sc.indexOf("[", i);
    return open === -1 ? null : sc.slice(open, findBlockEnd(sc, open));
  }
  return null;
}

/**
 * القوائم التي يعرضها القسم عبر sc-for list="{{ name }}" وتعيش بياناتها في السكربت كـ
 * `const name = [ … ]` أو `name: [ … ]` (مثل welcomeChoices في 28-D21 وverifyScreens في 13-D8).
 */
function listedBlocksOf(htmlText: string, section: string): string[] {
  const names = new Set(
    [...section.matchAll(/list="\{\{\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+)*\s*\}\}"/g)].map(
      (m) => m[1]!,
    ),
  );
  const out: string[] = [];
  for (const name of names) {
    for (const sc of scripts(htmlText)) {
      const m = new RegExp(`(?:const\\s+${name}\\s*=|\\b${name}\\s*:)\\s*\\[`).exec(sc);
      if (!m) continue;
      const open = sc.indexOf("[", m.index);
      let end = findBlockEnd(sc, open);
      // `[ … ].map(c => { … })`: وسوم الصفوف تُصاغ في التحويل لا في المصفوفة (04-D2 PTY-01)
      const chained = /^\s*\.map\(/.exec(sc.slice(end));
      if (chained) end = findCallEnd(sc, end + chained[0].length - 1);
      const block = sc.slice(open, end);
      out.push(block, ...helperBlocksOf(sc, block));
      break;
    }
  }
  return out;
}

/**
 * المساعدات التي تبني صفوف القائمة (مثل `inv(...)` وخريطة `st` لوسوم المزامنة في 03-D2 POS-09):
 * كائن `const name = { … }` أو دالة سهمية `const name = (…) => { … }` يستدعيها الكتلة — تُتبع
 * حتى ثلاث طبقات حتى تصل نصوص الوسوم المعرَّفة خارج القائمة نفسها.
 */
function helperBlocksOf(sc: string, block: string, depth = 0, seen = new Set<string>()): string[] {
  if (depth >= 3) return [];
  const out: string[] = [];
  for (const m of block.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    const def = new RegExp(`const\\s+${name}\\s*=\\s*(\\{|\\([^)]*\\)\\s*=>\\s*\\{)`).exec(sc);
    if (!def) continue;
    seen.add(name);
    const open = sc.indexOf("{", def.index + def[0].length - 1);
    const body = sc.slice(open, findBlockEnd(sc, open));
    out.push(body, ...helperBlocksOf(sc, body, depth + 1, seen));
  }
  return out;
}

function stringLiterals(block: string): string[] {
  const out = new Set<string>();
  for (const m of block.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const t = norm((m[1] ?? m[2] ?? m[3] ?? "").replace(/\\'/g, "'").replace(/\\"/g, '"'));
    if (t.length >= 2 && /[؀-ۿ]/.test(t) && !isTemplate(t) && !isRefLine(t)) out.add(t);
  }
  return [...out];
}

function staticTextsOf(section: string): string[] {
  const noScript = section
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
  const parts = noScript
    .split(/<[^>]+>/)
    .map(norm)
    .filter((t) => t.length >= 2 && !isTemplate(t) && !isRefLine(t));
  return [...new Set(parts)];
}

export function frameTexts(
  screenId: string,
  state: string,
  matrix: MatrixRow[] = readMatrix(),
): FrameTexts {
  const row = frameRefFor(screenId, state, matrix);
  if (!row) throw new Error(`لا إطار مرسوم للزوج ${screenId} × ${state} في states-matrix.csv`);
  const [file] = row.frame_ref.split("#");
  const htmlText = readFileSync(resolve(PACKAGE_DIR, file!), "utf8");
  const section = sectionOf(htmlText, screenId) ?? sectionByRefLine(htmlText, screenId, row);
  const stateBlock = templateBlockOf(htmlText, screenId, state);
  const screenBlock = templateBlockOf(htmlText, screenId);
  const keyed = keyedBlockOf(htmlText, screenId);
  if (!section && !screenBlock && !keyed) {
    throw new Error(`القسم ${screenId} غير موجود في ${file}`);
  }
  const listed = section ? listedBlocksOf(htmlText, section) : [];
  const scriptTexts = [
    ...new Set([
      ...(stateBlock ? stringLiterals(stateBlock) : []),
      ...(screenBlock ? stringLiterals(screenBlock) : []),
      ...(keyed ? stringLiterals(keyed) : []),
      ...listed.flatMap(stringLiterals),
    ]),
  ];
  return {
    screenId,
    state,
    file: file!,
    staticTexts: section ? staticTextsOf(section) : [],
    scriptTexts,
  };
}

/** كل الأزواج المرسومة لشاشة: الحالات وملفاتها. */
export function drawnStates(
  screenId: string,
  matrix: MatrixRow[] = readMatrix(),
): { state: string; file: string }[] {
  return matrix
    .filter((r) => r.screen_id === screenId && r.design_status === "drawn")
    .map((r) => ({ state: r.state_code, file: r.frame_ref.split("#")[0]! }));
}

/**
 * كل الإطارات المرسومة للزوج (شاشة × حالة) عبر المنصات — الزوج قد يُرسم مرتين لخطوتين مختلفتين
 * (ACC-02 ready: نموذج الدخول في 06-D2 وإدخال الرمز في 13-D8). يعيد النصوص لكل ملف مرجعي.
 */
export function frameTextsAll(
  screenId: string,
  state: string,
  matrix: MatrixRow[] = readMatrix(),
): FrameTexts[] {
  const rows = matrix.filter(
    (r) => r.screen_id === screenId && r.state_code === state && r.design_status === "drawn",
  );
  const seen = new Set<string>();
  const out: FrameTexts[] = [];
  for (const row of rows) {
    const file = row.frame_ref.split("#")[0]!;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(frameTexts(screenId, state, [row, ...matrix.filter((r) => r !== row)]));
  }
  // رسمة ثانية للزوج نفسه في ملف آخر: قسم يحمل id الشاشة وسطر مرجع الزوج (15-D10 يرسم
  // W/SHIFT-05/1440/conflict وسجل الورديات معه بينما المصفوفة تحيل conflict إلى 06-D2)
  for (const row of rows) {
    for (const file of secondaryFrameFiles(screenId, row)) {
      if (seen.has(file)) continue;
      seen.add(file);
      out.push(frameTexts(screenId, state, [{ ...row, frame_ref: `${file}#${screenId}` }]));
    }
  }
  // الأسطح الستة (46-D37/47-D38) غير موسومة في المصفوفة؛ مرجعها الملفان مباشرة (القسم ٣ من
  // الأمر): قسم S-nn يحمل مرجع الشاشة (W/POS-01/834) يدخل نصوصه في حوض الشاشة
  for (const f of surfaceFrames(screenId, state)) {
    if (seen.has(f.file)) continue;
    seen.add(f.file);
    out.push(f);
  }
  return out;
}

const SURFACE_FILES = /^(46-D37|47-D38).*\.dc\.html$/;

/** أقسام الأسطح (S-01…S-06) التي تذكر الشاشة بمرجع `P/SCREEN/VP` — تركيبة عرض لا حالة مستقلة. */
export function surfaceFrames(screenId: string, state: string): FrameTexts[] {
  const out: FrameTexts[] = [];
  for (const file of readdirSync(PACKAGE_DIR)
    .filter((f) => SURFACE_FILES.test(f))
    .sort()) {
    const text = readPackageFile(file);
    if (!text.includes(`/${screenId}/`)) continue;
    for (const m of text.matchAll(/<section[^>]*\sid="(S-\d+)"[^>]*>/g)) {
      const section = sectionOf(text, m[1]!);
      if (!section || !new RegExp(`[WMDAC]/${screenId}/\\d+`).test(section)) continue;
      out.push({
        screenId,
        state,
        file,
        staticTexts: staticTextsOf(section),
        scriptTexts: [...new Set(listedBlocksOf(text, section).flatMap(stringLiterals))],
      });
    }
  }
  return out;
}

const fileCache = new Map<string, string>();
function readPackageFile(file: string): string {
  let text = fileCache.get(file);
  if (text === undefined) {
    text = readFileSync(resolve(PACKAGE_DIR, file), "utf8");
    fileCache.set(file, text);
  }
  return text;
}

/** ملفات الحزمة التي ترسم الزوج ثانيةً: قسم `id="SCREEN"` يحوي سطر المرجع P/SCREEN/VP/state. */
export function secondaryFrameFiles(screenId: string, row: MatrixRow): string[] {
  const primary = row.frame_ref.split("#")[0]!;
  const ref = `${row.platform}/${screenId}/${row.viewport_px}/${row.state_code}`;
  const out: string[] = [];
  for (const file of readdirSync(PACKAGE_DIR)
    .filter((f) => f.endsWith(".dc.html"))
    .sort()) {
    if (file === primary) continue;
    const text = readPackageFile(file);
    if (!text.includes(ref)) continue;
    const section = sectionOf(text, screenId);
    if (section && section.includes(ref)) out.push(file);
  }
  return out;
}
