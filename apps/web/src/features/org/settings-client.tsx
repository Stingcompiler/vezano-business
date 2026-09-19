"use client";

import { Button, Frame, Notice, Receipt, SelectField, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "success" | "conflict";

interface Payload {
  version: number;
  updated_at: string;
  updated_by_name: string;
  name: string;
  currency: string;
  currency_exponent: number;
  receipt: { header: string; footer: string; paper_width: string; max_chars: number };
  locale: { language: string; numerals: string };
  payment_methods: {
    id: string;
    code: string;
    name: string;
    is_cash: boolean;
    is_active: boolean;
  }[];
  can_edit: boolean;
  changed?: string[];
}

const CHARS: Record<string, number> = { "58": 32, "80": 48 };

/** نقل الملكية (20-D15): الطلب للمالك، التأكيد للمالك الجديد، والموانع تُعرض لا تُخفى. */
interface Ownership {
  current: {
    id: string;
    from_user_name: string;
    to_user_id: string;
    to_user_name: string;
    state: string;
    requested_at: string;
    expires_at: string;
  } | null;
  blockers: {
    open_shifts: { user_name: string; branch_name: string }[];
    pending_devices: { device_name: string; pending: number }[];
  };
  candidates: { id: string; display_name: string }[];
  can_request: boolean;
  can_confirm: boolean;
  ttl_hours: number;
}

/** أرقام عربية-هندية للمعاينة فقط حين يختار التاجر النمط (G-01 — الثمن معلن). */
function arabicDigits(s: string): string {
  return s
    .replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!)
    .replace(/\./g, "٫")
    .replace(/,/g, "٬");
}

/**
 * ORG-09 — إعدادات المنشأة واللغة والقوالب: لا محاسبة عامة ولا محرّر برمجي (27-D20 ready/
 * validation_error/success · 13-D8 نمط الأرقام · 20-D15 conflict): القوالب حقول مسمّاة بمعاينة
 * فورية؛ النص الأطول من عرض الورق يُمنع قبل الحفظ؛ التعديل المتزامن يُكشف بالإصدار؛ العملة لا تُبدَّل
 * (§١١.٣، §٦.٣؛ ACC-27؛ G-01).
 */
export function SettingsClient() {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [name, setName] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [width, setWidth] = useState("80");
  const [numerals, setNumerals] = useState("latin");
  const [methods, setMethods] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState<{
    version: number;
    updated_at: string;
    updated_by_name: string;
  } | null>(null);
  const [rejected, setRejected] = useState<{ field: string; cut: string } | null>(null);
  const [own, setOwn] = useState<Ownership | null>(null);
  const [toUser, setToUser] = useState("");
  const [blocked, setBlocked] = useState<Ownership["blockers"] | null>(null);
  const [ownBusy, setOwnBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const apply = (d: Payload) => {
    setP(d);
    setName(d.name);
    setHeader(d.receipt.header);
    setFooter(d.receipt.footer);
    setWidth(d.receipt.paper_width);
    setNumerals(d.locale.numerals);
    setMethods(Object.fromEntries(d.payment_methods.map((m) => [m.id, m.is_active])));
  };

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/org/settings", {});
    if (response.ok && data) apply(data);
    const o = await api().GET("/api/org/ownership", {});
    if (o.response.ok && o.data) setOwn(o.data);
  }, []);

  const requestTransfer = async () => {
    if (!toUser || ownBusy) return;
    setOwnBusy(true);
    setBlocked(null);
    try {
      const { data, error, response } = await api().POST("/api/org/ownership", {
        body: { to_user_id: toUser } as never,
      });
      if (response.status === 409) {
        setBlocked((error as unknown as { extra: Ownership["blockers"] }).extra);
        return;
      }
      if (response.ok && data) setOwn(data);
    } finally {
      setOwnBusy(false);
    }
  };

  const transferAction = async (action: "confirm" | "cancel") => {
    if (!own?.current || ownBusy) return;
    setOwnBusy(true);
    setBlocked(null);
    try {
      const { data, error, response } = await api().POST(
        "/api/org/ownership/{transfer_id}/{action}",
        { params: { path: { transfer_id: own.current.id, action } } },
      );
      if (response.status === 409) {
        setBlocked((error as unknown as { extra: Ownership["blockers"] }).extra);
        return;
      }
      if (response.ok && data) setOwn(data);
    } finally {
      setOwnBusy(false);
    }
  };

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fsettings");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const max = CHARS[width] ?? 48;
  const tooWide = [
    ["name", name],
    ["header", header],
    ["footer", footer],
  ].find(([, v]) => v!.trim().length > max);

  const save = async () => {
    if (!p || busy) return;
    setBusy(true);
    setSaved(null);
    setConflict(null);
    setRejected(null);
    try {
      const { data, error, response } = await api().PUT("/api/org/settings", {
        body: {
          version: p.version,
          name,
          header,
          footer,
          paper_width: width,
          numerals,
          payment_methods: Object.entries(methods).map(([id, is_active]) => ({ id, is_active })),
        },
      });
      if (response.status === 409) {
        const e = error as unknown as {
          extra: { version: number; updated_at: string; updated_by_name: string };
        };
        setConflict(e.extra);
        return;
      }
      if (!response.ok || !data) {
        const e = error as unknown as
          { detail?: string; field?: string; extra?: { cut?: string } } | undefined;
        setRejected({ field: e?.field ?? "", cut: e?.extra?.cut ?? "" });
        return;
      }
      const d = data as unknown as Payload;
      apply(d);
      setSaved(d.changed ?? []);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setConflict(null);
    await load();
  };

  const state: State =
    conflict || blocked
      ? "conflict"
      : tooWide || rejected
        ? "validation_error"
        : saved
          ? "success"
          : "ready";

  const fmt = (s: string) => (numerals === "arabic" ? arabicDigits(s) : s);
  const cut = (s: string) => (s.trim().length > max ? `${s.trim().slice(0, max)}…` : s);

  return (
    <Frame title="الإعدادات" nav={<AppNav currentId="org-settings" />} footer={null}>
      <div className="sys" data-screen="ORG-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              إعدادات المنشأة واللغة والقوالب — لا محاسبة عامة ولا محرّر برمجي
            </h2>
            <span className="cat-head__hint">
              القوالب تُحرَّر بحقول مسمّاة ومعاينة فورية. لا صندوق شيفرة يكتب فيه التاجر منطقاً، ولا
              إعدادات محاسبية عامة تتجاوز الدفتر.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "conflict" && conflict ? (
              <Notice
                kind="warning"
                title="تعديل متزامن"
                action={<Button onClick={() => void reload()}>أعد التحميل ثم عدّل</Button>}
              >
                <p className="acc-lead">
                  حُفظت نسخة أحدث بواسطة {conflict.updated_by_name || "مستخدم آخر"} في{" "}
                  <span className="sting-mono">{hhmm(conflict.updated_at)}</span> — لا نكتب فوق ما
                  لم تقرأه. أعد التحميل وطبّق تعديلك عليها.
                </p>
              </Notice>
            ) : null}

            {state === "success" && saved ? (
              <Notice kind="success" title="حُفظ">
                <p className="acc-lead">
                  {saved.length ? saved.join("، ") : "لا تغيير"} — يسري على الشاشات والإيصالات
                  والتقارير معاً.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="warning" title="نص أطول من عرض الورق">
                <p className="acc-lead">
                  {tooWide?.[0] === "name" || rejected?.field === "name"
                    ? "اسم المنشأة"
                    : tooWide?.[0] === "header" || rejected?.field === "header"
                      ? "سطر الترويسة"
                      : "سطر الختام"}{" "}
                  يتجاوز عرض <span className="sting-mono">{width}mm</span>. نُعلم قبل الحفظ ونعرض
                  كيف سيُقطع فعلياً — لا نحفظ ثم نتركه يكتشف ذلك عند أول طباعة.
                </p>
                <p className="acc-choice__note">
                  سيُطبع: <strong>{rejected?.cut || cut(String(tooWide?.[1] ?? ""))}</strong>
                </p>
              </Notice>
            ) : null}

            {p ? (
              <div className="org-effects__row">
                <div className="cat-form">
                  <h3 className="cat-head__title">قالب الإيصال — حقول مسمّاة</h3>
                  <p className="acc-choice__note">
                    <strong>لا حقل شيفرة هنا.</strong> التخصيص عبر حقول وقوائم فقط. أي منطق يحتاجه
                    التاجر يُصبح ميزة نبنيها، لا نصاً يكتبه ويكسر إيصاله بلا من يصلحه.
                  </p>
                  <TextField
                    label="اسم المنشأة"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setSaved(null);
                    }}
                    disabledReason={p.can_edit ? undefined : "للمالك"}
                    required
                  />
                  <TextField
                    label="سطر الترويسة"
                    value={header}
                    onChange={(e) => {
                      setHeader(e.target.value);
                      setSaved(null);
                    }}
                    disabledReason={p.can_edit ? undefined : "للمالك"}
                  />
                  <TextField
                    label="سطر الختام"
                    value={footer}
                    onChange={(e) => {
                      setFooter(e.target.value);
                      setSaved(null);
                    }}
                    disabledReason={p.can_edit ? undefined : "للمالك"}
                  />
                  <SelectField
                    label="عرض الورق"
                    value={width}
                    onChange={(e) => {
                      setWidth(e.target.value);
                      setSaved(null);
                    }}
                    disabledReason={p.can_edit ? undefined : "للمالك"}
                    options={[
                      { value: "58", label: "58mm (حرارية)" },
                      { value: "80", label: "80mm (حرارية)" },
                    ]}
                  />
                  <SelectField
                    label="اللغة وأرقام الإيصال"
                    value={numerals}
                    onChange={(e) => {
                      setNumerals(e.target.value);
                      setSaved(null);
                    }}
                    disabledReason={p.can_edit ? undefined : "للمالك"}
                    options={[
                      { value: "latin", label: "العربية · أرقام لاتينية" },
                      { value: "arabic", label: "العربية · أرقام عربية" },
                    ]}
                  />
                  <p className="acc-choice__note">
                    <strong>إعداد المنشأة — نمط الأرقام</strong> · مبدّل واحد للنظام كله · لا إعداد
                    لكل شاشة. التبديل يشمل الشاشات والإيصالات والتقارير المصدَّرة معاً. لا نسمح
                    بنمطين في نفس الشاشة. تغيير النمط لا يُعدّل بيانات: هو عرض فقط. الأرقام
                    المخزَّنة واحدة، والتصدير يحمل قيماً عددية لا نصاً.
                  </p>
                  <ul className="acc-choice__note">
                    <li>
                      <strong>لاتيني بعرض ثابت — المعتمد</strong> · المبالغ والكميات والمعرفات
                      وأرقام الفواتير. النص ووصف الأصناف والتواريخ الطويلة بالعربية. مثال:{" "}
                      <span className="sting-mono">1,180.00 SDG · INV-1047 · 12×1</span>كغ
                    </li>
                    <li>
                      <strong>أرقام عربية في كل شيء</strong> · متاح لمن يفضّله، ويُطبَّق على الشاشات
                      والإيصالات والتقارير معاً. الثمن المعلن: ضعف المحاذاة العمودية في الجداول
                      المالية الكثيفة.
                    </li>
                  </ul>
                  <p className="acc-choice__note">
                    العملة: <span className="sting-mono">{p.currency}</span> — لا تُبدَّل بعد أول
                    عملية (§٦.٣).
                  </p>
                  {p.payment_methods.length ? (
                    <fieldset className="cat-form">
                      <legend className="acc-choice__note">
                        <strong>طرق الدفع الفعّالة</strong>
                      </legend>
                      {p.payment_methods.map((m) => (
                        <label key={m.id} className="web03-check">
                          <input
                            type="checkbox"
                            checked={methods[m.id] ?? m.is_active}
                            disabled={!p.can_edit || m.is_cash}
                            onChange={(e) => {
                              setMethods((prev) => ({ ...prev, [m.id]: e.target.checked }));
                              setSaved(null);
                            }}
                          />{" "}
                          {m.name}
                          {m.is_cash ? " — لا يُعطَّل" : ""}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  {p.can_edit ? (
                    <div className="cat-form__actions">
                      <Button
                        pos
                        onClick={() => void save()}
                        loading={busy}
                        disabledReason={tooWide ? "نص أطول من عرض الورق" : undefined}
                      >
                        حفظ
                      </Button>
                    </div>
                  ) : (
                    <p className="acc-choice__note">
                      الإعدادات للمالك — القراءة متاحة لمدير الفرع.
                    </p>
                  )}
                </div>
                <div>
                  <h3 className="cat-head__title">معاينة فورية</h3>
                  <p className="acc-choice__note">
                    <span className="sting-mono">{width}mm</span> · حرارية
                  </p>
                  <Receipt
                    shopName={cut(name)}
                    title="فاتورة"
                    number={fmt("1047")}
                    dateLabel={fmt("2026-09-19 10:14")}
                    width={width === "58" ? 58 : 80}
                    lines={[
                      {
                        label: `سكر 1كغ ×${fmt("2")}`,
                        value: fmt("240.00"),
                        mono: numerals === "latin",
                      },
                      { label: "شاي 250غ", value: fmt("180.00"), mono: numerals === "latin" },
                      {
                        label: "الإجمالي",
                        value: fmt("420.00"),
                        mono: numerals === "latin",
                        strong: true,
                      },
                    ]}
                    footer={<span>{cut(footer)}</span>}
                  />
                  <p className="acc-choice__note">{cut(header)}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {own && (own.can_request || own.can_confirm || own.current) ? (
          <div className="cat-table pos-card">
            <div className="cat-head">
              <h2 className="cat-head__title">نقل ملكية المنشأة — ORG-09</h2>
              <span className="cat-head__hint">
                أخطر إجراء في النظام: ينقل الدفتر كله ومعه الذمم والأجهزة والاشتراك. لا نقل أثناء
                وردية مفتوحة أو معلّق غير مرفوع.
              </span>
            </div>
            <div className="acc-card__body">
              <p className="acc-lead">
                المالك الجديد يجب أن يستلم دفتراً مغلق الحساب، لا نصف وردية لا يعرف من عدّها.
              </p>
              {blocked ? (
                <Notice kind="warning" title="مانع">
                  <ul className="acc-choice__note">
                    {blocked.open_shifts.map((x, i) => (
                      <li key={`s${i}`}>
                        وردية مفتوحة باسم {x.user_name} — {x.branch_name} · تُقفل إدارياً بعدّ حاضر
                        قبل النقل، وإلا بقي صندوق بلا شهادة
                      </li>
                    ))}
                    {blocked.pending_devices.map((x, i) => (
                      <li key={`p${i}`}>
                        معلّق غير مرفوع على {x.device_name}:{" "}
                        <span className="sting-mono">{x.pending}</span>
                      </li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              {own.current ? (
                <Notice kind="info" title="طلب نقل قائم">
                  <p className="acc-lead">
                    من {own.current.from_user_name} إلى {own.current.to_user_name} · ينقضي في{" "}
                    <span className="sting-mono">{hhmm(own.current.expires_at)}</span>
                  </p>
                  <p className="acc-choice__note">
                    تأكيد من الطرفين خلال 24 ساعة؛ انقضاؤها يلغي الطلب تلقائياً ويُسجَّل الإلغاء.
                  </p>
                  <div className="cat-form__actions">
                    {own.can_confirm ? (
                      <Button pos onClick={() => void transferAction("confirm")} loading={ownBusy}>
                        أؤكّد استلام الملكية
                      </Button>
                    ) : null}
                    <Button onClick={() => void transferAction("cancel")} loading={ownBusy}>
                      إلغاء الطلب
                    </Button>
                  </div>
                </Notice>
              ) : own.can_request ? (
                <div className="cat-form">
                  <SelectField
                    label="المالك الجديد"
                    value={toUser}
                    onChange={(e) => setToUser(e.target.value)}
                    options={[
                      { value: "", label: "— اختر —" },
                      ...own.candidates.map((c) => ({ value: c.id, label: c.display_name })),
                    ]}
                  />
                  <p className="acc-choice__note">
                    المالك الجديد يجب أن يكون له حساب قائم ومُثبَت برقمه — لا نقل إلى بريد أو رقم
                    غير مؤكَّد.
                  </p>
                  <div className="cat-form__actions">
                    <Button
                      onClick={() => void requestTransfer()}
                      loading={ownBusy}
                      disabledReason={toUser ? undefined : "اختر المالك الجديد"}
                    >
                      اطلب نقل الملكية
                    </Button>
                  </div>
                </div>
              ) : null}
              <ul className="acc-choice__note">
                <li>
                  تأكيد من الطرفين خلال 24 ساعة؛ انقضاؤها يلغي الطلب تلقائياً ويُسجَّل الإلغاء.
                </li>
                <li>
                  المالك السابق يبقى في السجل بصفة «مالك سابق» بتاريخ انتهاء ولايته، ولا يُمحى من
                  الأفعال التي فعلها.
                </li>
                <li>
                  الاشتراك والأجهزة والذمم تنتقل كما هي. لا يُعاد ترقيم فاتورة ولا يُعاد حساب رصيد
                  بسبب النقل.
                </li>
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}
