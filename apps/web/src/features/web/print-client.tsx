"use client";

import {
  Button,
  Frame,
  Notice,
  Receipt,
  SelectField,
  Status,
  Table,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/sys/sys.css";
import { AppNav } from "@/features/home/app-nav";
import { useApp } from "@/lib/app-context";
import { bleAvailable, loadModels, type ModelsData, pairPrinter } from "@/lib/print/ble";
import {
  type Conn,
  connLabel,
  type DevicePrinter,
  listPrinters,
  receiptWidth,
  savePrinters,
  sendTestPage,
  setReceiptWidth,
  type TestMode,
} from "@/lib/print/printers";
import { type PaperWidth, renderCanvas, testPage } from "@/lib/print/raster";

type State = "ready" | "validation_error" | "server_error" | "success";

const CHECKS = [
  "الحروف متصلة كما تُكتب، غير مقطّعة",
  "السطر يبدأ من اليمين",
  "الأرقام والمبلغ مقروءان وغير مقلوبين",
  "لا مربعات فارغة مكان أي حرف",
] as const;

function when(iso: string): { word: string; time: string } {
  const d = new Date(iso);
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (day(d) === day(now)) return { word: "اليوم", time };
  if (day(d) === day(y)) return { word: "أمس", time };
  return { word: "", time: `${d.toISOString().slice(0, 10)} ${time}` };
}

/**
 * WEB-03 — ربط طابعة ويب وتجربة عربية (09-D5 لوحة الطابعات · 37-D29 ready/validation_error/
 * success): Web Bluetooth لطابعات BLE فقط والقدرة تُفحص قبل الزر (R-09)؛ Classic/USB/شبكة بتعريف
 * النظام. نطبع صفحة تجربة عربية ونسأل عن النتيجة — المتصفح لا يعرف ما خرج؛ قياس ورق لا يناسب
 * يُمنع قبل الطباعة؛ الطرازات (G-10) من بيانات خارجية ولا نَعِد بكل طابعة (§١٢.٢–١٢.٣؛ ACC-83).
 */
export function PrintClient() {
  const router = useRouter();
  const app = useApp();
  const [printers, setPrinters] = useState<DevicePrinter[]>([]);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [ble, setBle] = useState(false);
  const [width, setWidth] = useState<PaperWidth>(80);
  const [pending, setPending] = useState<{ id: string; mode: TestMode } | null>(null);
  const [checks, setChecks] = useState<boolean[]>(CHECKS.map(() => false));
  const [blocked, setBlocked] = useState<DevicePrinter | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [transportFail, setTransportFail] = useState<"failed" | "unknown" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newConn, setNewConn] = useState<Conn>("usb");
  const [newWidth, setNewWidth] = useState<"58" | "80" | "a4">("80");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const [list, w, avail, m] = await Promise.all([
      listPrinters(),
      receiptWidth(),
      bleAvailable(),
      loadModels(),
    ]);
    setPrinters(list);
    setWidth(w);
    setBle(avail);
    setModels(m);
    const last = list
      .filter((p) => p.lastTest?.result === "failed")
      .sort((a, b) => (a.lastTest!.at < b.lastTest!.at ? 1 : -1))[0];
    setFailedId(last?.id ?? null);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fprint");
      return;
    }
    void load();
  }, [router, load]);

  useEffect(() => {
    try {
      setPreview(renderCanvas(testPage(width)).toDataURL("image/png"));
    } catch {
      setPreview(null);
    }
  }, [width]);

  const state: State = pending
    ? "success"
    : blocked
      ? "validation_error"
      : transportFail || failedId
        ? "server_error"
        : "ready";

  const persist = async (list: DevicePrinter[]) => {
    setPrinters(list);
    await savePrinters(list);
  };

  const startTest = async (p: DevicePrinter, mode: TestMode) => {
    if (busy) return;
    setBlocked(null);
    setTransportFail(null);
    if (p.width === "a4") {
      // نمنع قبل الطباعة: الإيصال معدٌّ لعرض ٨٠/٥٨ ملم والمختار A4
      setBlocked(p);
      return;
    }
    setBusy(true);
    try {
      const r = await sendTestPage(p, mode, p.width);
      const at = new Date().toISOString();
      if (r === "failed" || r === "unknown") {
        setTransportFail(r);
        await persist(
          printers.map((x) => (x.id === p.id ? { ...x, lastTest: { at, mode, result: r } } : x)),
        );
        return;
      }
      if (p.conn !== "ble") {
        // تعريف النظام: حوار المتصفح — نص HTML أو صورة raster
        printSystem(mode);
      }
      setFailedId(null);
      setChecks(CHECKS.map(() => false));
      setPending({ id: p.id, mode });
      await persist(
        printers.map((x) => (x.id === p.id ? { ...x, lastTest: { at, mode, result: "sent" } } : x)),
      );
    } finally {
      setBusy(false);
    }
  };

  const printSystem = (mode: TestMode) => {
    const el = document.getElementById("web03-print-area");
    if (el) el.dataset.mode = mode;
    window.print();
  };

  const verdict = async (ok: boolean) => {
    if (!pending) return;
    const at = new Date().toISOString();
    const list = printers.map((x) =>
      x.id === pending.id
        ? {
            ...x,
            lastTest: {
              at,
              mode: pending.mode,
              result: ok ? ("ok" as const) : ("failed" as const),
            },
          }
        : x,
    );
    setPending(null);
    setFailedId(ok ? null : pending.id);
    await persist(list);
  };

  const pair = async () => {
    if (busy || !models) return;
    setBusy(true);
    try {
      const d = await pairPrinter(models.profiles);
      if (!d) return;
      if (printers.some((p) => p.ble?.id === d.id)) return;
      await persist([...printers, { id: `ble-${d.id}`, name: d.name, conn: "ble", width, ble: d }]);
    } finally {
      setBusy(false);
    }
  };

  const addSystem = async () => {
    const name = newName.trim();
    if (!name) return;
    await persist([
      ...printers,
      {
        id: `sys-${Date.now()}`,
        name,
        conn: newConn,
        width: newWidth === "a4" ? "a4" : newWidth === "58" ? 58 : 80,
      },
    ]);
    setNewName("");
    setAdding(false);
  };

  const remove = async (p: DevicePrinter) => {
    await persist(printers.filter((x) => x.id !== p.id));
    if (failedId === p.id) setFailedId(null);
  };

  const resultCell = (p: DevicePrinter) => {
    const t = p.lastTest;
    if (!t || t.result === "sent")
      return (
        <div>
          <Status state="empty" label="غير مجرَّبة" />
          <p className="acc-choice__note">
            متاحة للنظام ولم نطبع عليها تجربة عربية بعد. لن نصفها بمدعومة قبل ورقة.
          </p>
        </div>
      );
    if (t.result === "ok")
      return (
        <div>
          <Status state="success" label="تجربتك: سليمة" />
          <p className="acc-choice__note">
            التشكيل والاتجاه صحيحان على ورقة التجربة، وأكّدها أمين الصندوق بعينه.
          </p>
        </div>
      );
    if (t.result === "unknown")
      return (
        <div>
          <Status state="stale" label="لم تتأكد الطباعة" />
          <p className="acc-choice__note">
            انقطع الاتصال بعد الإرسال — لا نعيد تلقائياً كي لا تتكرر ورقة. أعد التجربة بيدك.
          </p>
        </div>
      );
    return (
      <div>
        <Status state="server_error" label="تجربتك: فشلت" />
        <p className="acc-choice__note">
          {t.mode === "text"
            ? "الحروف ظهرت مقطّعة ومعكوسة الاتجاه. هذه مشكلة خطوط الطابعة لا مشكلة نصك."
            : "لم تخرج الورقة أو خرجت ناقصة — تحقّق من الطاقة والورق ثم أعد التجربة."}
        </p>
      </div>
    );
  };

  const actionCell = (p: DevicePrinter) => {
    const t = p.lastTest;
    if (t?.result === "failed" && t.mode === "text")
      return (
        <Button variant="secondary" onClick={() => void startTest(p, "image")} loading={busy}>
          تجربة نمط صورة
        </Button>
      );
    if (t && t.result !== "sent")
      return (
        <Button variant="secondary" onClick={() => void startTest(p, t.mode)} loading={busy}>
          إعادة التجربة
        </Button>
      );
    return (
      <Button
        pos
        onClick={() => void startTest(p, p.conn === "ble" ? "image" : "text")}
        loading={busy}
      >
        طباعة صفحة تجربة
      </Button>
    );
  };

  const columns = [
    {
      key: "printer",
      header: "الطابعة",
      render: (p: DevicePrinter) => (
        <div>
          <strong>{p.name}</strong>
          <p className="acc-choice__note">
            {connLabel(p)} ·{" "}
            {p.width === "a4" ? "A4" : <span className="sting-mono">{p.width}mm</span>}
          </p>
        </div>
      ),
    },
    { key: "result", header: "نتيجة التجربة العربية", render: resultCell },
    {
      key: "when",
      header: "آخر تجربة",
      render: (p: DevicePrinter) => {
        if (!p.lastTest) return <span>لم تُجرَّب</span>;
        const w = when(p.lastTest.at);
        return (
          <span>
            {w.word ? `${w.word} ` : ""}
            <span className="sting-mono">{w.time}</span>
          </span>
        );
      },
    },
    {
      key: "action",
      header: "الإجراء",
      render: (p: DevicePrinter) => (
        <div className="cat-form__actions">
          {actionCell(p)}
          <Button variant="quiet" onClick={() => void remove(p)}>
            إزالة
          </Button>
        </div>
      ),
    },
  ];

  const testedRows = models?.tested ?? [];

  return (
    <Frame title="الطابعة" nav={<AppNav currentId="print" />} footer={null}>
      <div className="sys" data-screen="WEB-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">ربط طابعة ويب وتجربة عربية</h2>
            <span className="cat-head__hint">
              الطباعة من المتصفح أضعف من الأصلية. ثلاث حالات ناقصة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "validation_error" && blocked ? (
              <Notice
                kind="warning"
                title="قياس الورق لا يناسب"
                action={
                  <Button variant="secondary" onClick={() => setBlocked(null)}>
                    اختر طابعة أخرى
                  </Button>
                }
              >
                <p className="acc-lead">
                  الإيصال معدٌّ لعرض <span className="sting-mono">{width}</span> ملم والمختار A4.
                </p>
                <p className="acc-choice__note">
                  <strong>نمنع قبل الطباعة</strong> · الطباعة الخاطئة تُتلف ورقاً ووقتاً أمام
                  الزبون، ولا تُكتشف إلا بعد خروجها.
                </p>
              </Notice>
            ) : null}

            {state === "success" && pending ? (
              <Notice kind="success" title="طُبعت التجربة">
                <p className="acc-lead">
                  نسأل عن النتيجة: هل اتصلت الحروف؟ هل ظهر الباركود؟ الجواب يضبط الإعداد.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نفترض</strong> · المتصفح يقول «أُرسل للطباعة» ولا يعرف ما خرج. سؤالٌ
                  واحد أصدق من ادّعاء.
                </p>
                <ul className="acc-choice__note">
                  {CHECKS.map((c, i) => (
                    <li key={c}>
                      <label className="web03-check">
                        <input
                          type="checkbox"
                          checked={checks[i]}
                          onChange={(e) =>
                            setChecks((prev) =>
                              prev.map((v, j) => (j === i ? e.target.checked : v)),
                            )
                          }
                        />{" "}
                        {c}
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => void verdict(true)}
                    disabledReason={
                      checks.every(Boolean) ? undefined : "أكّد البنود الأربعة على الورقة أولاً"
                    }
                  >
                    تجربتك: سليمة
                  </Button>
                  <Button variant="secondary" onClick={() => void verdict(false)}>
                    تجربتك: فشلت
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice kind="error" title={transportFail ? "لم تتأكد الطباعة" : "تجربتك: فشلت"}>
                <p className="acc-lead">
                  {transportFail === "failed"
                    ? "تعذّر الاتصال بالطابعة أو رُفضت الكتابة — تحقّق من تشغيلها وقربها ثم أعد التجربة."
                    : transportFail === "unknown"
                      ? "انقطع الاتصال بعد الإرسال — لا نعيد تلقائياً كي لا تتكرر ورقة."
                      : "الحروف ظهرت مقطّعة ومعكوسة الاتجاه. هذه مشكلة خطوط الطابعة لا مشكلة نصك."}
                </p>
              </Notice>
            ) : null}

            <h3 className="cat-head__title">طابعات هذا الجهاز</h3>
            <p className="acc-lead">
              نطبع صفحة تجربة عربية ونسألك عن النتيجة. الحكم حكمك لا حكمنا.
            </p>
            <Table
              caption="طابعات هذا الجهاز"
              columns={columns}
              rows={printers}
              rowKey={(p) => p.id}
              empty={
                <p className="acc-choice__note">
                  لا طابعة مضافة بعد — اربط طابعة BLE أو أضف طابعة بتعريف النظام.
                </p>
              }
            />
            <div className="cat-form__actions">
              {ble ? (
                <Button
                  onClick={() => void pair()}
                  loading={busy}
                  disabledReason={
                    models && models.profiles.length > 0 ? undefined : "قائمة الطرازات لم تُحمَّل"
                  }
                >
                  ربط طابعة بلوتوث (BLE)
                </Button>
              ) : (
                <p className="acc-choice__note">
                  Web Bluetooth غير متاح هنا (المتصفح لا يدعمه أو البلوتوث مطفأ) — لا نعرض زراً
                  لقدرة لا نملكها. طابعات Bluetooth الكلاسيكية وUSB والشبكة تُطبع بتعريف النظام.
                </p>
              )}
              <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
                إضافة طابعة بتعريف النظام
              </Button>
            </div>
            {adding ? (
              <div className="cat-form">
                <TextField
                  label="اسم الطابعة"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <SelectField
                  label="الاتصال"
                  value={newConn}
                  onChange={(e) => setNewConn(e.target.value as Conn)}
                  options={[
                    { value: "usb", label: "USB · تعريف النظام" },
                    { value: "network", label: "شبكة" },
                  ]}
                />
                <SelectField
                  label="قياس الورق"
                  value={newWidth}
                  onChange={(e) => setNewWidth(e.target.value as "58" | "80" | "a4")}
                  options={[
                    { value: "80", label: "80 ملم" },
                    { value: "58", label: "58 ملم" },
                    { value: "a4", label: "A4" },
                  ]}
                />
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => void addSystem()}
                    disabledReason={newName.trim() ? undefined : "اكتب اسم الطابعة"}
                  >
                    إضافة
                  </Button>
                </div>
              </div>
            ) : null}

            <SelectField
              label="قياس الإيصال المعدّ على هذا الجهاز"
              value={String(width)}
              onChange={(e) => {
                const w: PaperWidth = e.target.value === "58" ? 58 : 80;
                setWidth(w);
                void setReceiptWidth(w);
              }}
              options={[
                { value: "80", label: "80 ملم" },
                { value: "58", label: "58 ملم" },
              ]}
            />

            <h3 className="cat-head__title">لماذا لا نقول «مدعومة»؟</h3>
            <p className="acc-choice__note">
              تشكيل العربية واتجاهها يعتمدان على خطوط الطابعة ومعيار التحكم فيها، وطابعتان بنفس
              الاسم التجاري قد تختلفان. الحرف المقطّع لا يُكتشف برمجياً — يُكتشف بعينك على ورقة. حتى
              يُحسم G-10 نعرض نتيجة تجربتك على جهازك، لا قائمة توافق مخترعة.
            </p>

            <h3 className="cat-head__title">طرازات مثبتة بالاختبار</h3>
            <p className="acc-choice__note">نعرض ما جُرّب فعلاً ولا نَعِد بكل طابعة (G-10).</p>
            {testedRows.length === 0 ? (
              <p className="acc-choice__note">
                لم يُثبَّت طراز بعد — الاعتماد بعد ورقة على جهازين تُسجَّل في ملف الأدلة.
              </p>
            ) : (
              <ul className="acc-choice__note">
                {testedRows.map((t) => (
                  <li key={`${t.model}-${t.device}`}>
                    {t.model} · {t.device} · {t.os} · {t.browser} ·{" "}
                    {t.result === "ok" ? "سليمة" : "فشلت"}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="cat-head__title">الطابعة والتجربة العربية</h3>
            <p className="acc-choice__note">
              تجربةٌ بنصّ عربي متصل ورقم لاتيني وباركود معاً — لأن العطب يظهر في أحدها لا في كلّها.
            </p>
            <h3 className="cat-head__title">صفحة التجربة — ما نطبعه ونسألك أن تتحققه</h3>
            <div id="web03-print-area" className="web03-print" data-mode="text">
              <div className="web03-print__text">
                <Receipt
                  shopName="بقالة النيل — تجريبي"
                  title="تجربة"
                  number="000123"
                  dateLabel="2026-09-18"
                  width={width}
                  lines={[
                    { label: "سكر أبيض · 2 كغ", value: "200.00", mono: true },
                    { label: "الإجمالي", value: "200.00", mono: true, strong: true },
                  ]}
                  footer={<span>شكراً لتعاملكم معنا</span>}
                />
              </div>
              {preview ? (
                <img
                  className="web03-print__image"
                  src={preview}
                  alt="صفحة التجربة منقّطة: نص عربي متصل ومختلط وأرقام وباركود وكشف طويل"
                />
              ) : null}
            </div>
            <ul className="acc-choice__note">
              {CHECKS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>

            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/install")}>
                التثبيت
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
