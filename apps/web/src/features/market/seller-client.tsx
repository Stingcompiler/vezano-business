"use client";

import {
  Button,
  Frame,
  Notice,
  Status,
  SwitchField,
  TextField,
  Upload,
  type UploadItem,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "validation_error" | "permission_denied" | "success";

interface Item {
  key: "identity" | "service_area" | "terms" | "registry_doc";
  title: string;
  hint: string;
  done: boolean;
  reason: string;
}

interface Account {
  shop_name: string;
  role: string;
  verification: "none" | "draft" | "pending" | "needs_more" | "verified" | "rejected";
  verification_label: string;
  checklist: Item[];
  done: number;
  total: number;
  submitted_at: string;
  days_since_submitted: number | null;
  usual_review_days: number;
  review_reasons: Record<string, string>;
  badge_limits: string;
  can_submit: boolean;
  registry_doc_name: string;
}

const MAX_DOC = 2 * 1024 * 1024;
async function toBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const daysWord = (n: number) =>
  n === 0 ? "اليوم" : n === 1 ? "يوم" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوماً`;
const wasYesterday = (iso: string) => {
  const d = new Date(iso);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString();
};

/** MP-08 — تهيئة بائع وتحقق الهوية (08-D4 ready/permission_denied · 43-D35 loading/validation_error/success). */
export function SellerClient() {
  const router = useRouter();
  const app = useApp();
  const [acc, setAcc] = useState<Account | null>(null);
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [terms, setTerms] = useState(false);
  const [file, setFile] = useState<{ item: UploadItem; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/account");
    const body = data as unknown as { account: Account } | undefined;
    if (response.ok && body) {
      setAcc(body.account);
      const sa = body.account.checklist.find((i) => i.key === "service_area");
      if (sa?.done && sa.hint.includes(" · ")) {
        const [a, b] = sa.hint.split(" · ");
        setAddress((cur) => cur || (a ?? ""));
        setArea((cur) => cur || (b ?? ""));
      }
      setTerms(body.account.checklist.find((i) => i.key === "terms")?.done ?? false);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Fseller");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        business_address: address,
        service_area_note: area,
        accept_terms: terms,
      };
      if (file && file.file.size <= MAX_DOC)
        body.registry_doc = {
          name: file.file.name,
          data_url: `data:${file.file.type || "image/jpeg"};base64,${await toBase64(file.file)}`,
        };
      const { data, response } = await api().PUT("/api/market/account", { body: body as never });
      const b = data as unknown as { account: Account } | undefined;
      if (response.ok && b) setAcc(b.account);
      return response.ok;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setAttempted(true);
    if (!(await save())) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/market/account/verification/submit");
      const b = data as unknown as { account: Account } | undefined;
      if (response.ok && b) setAcc(b.account);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile({
      file: f,
      item: {
        id: "doc",
        name: f.name,
        sizeLabel:
          f.size >= 1024 * 1024
            ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.ceil(f.size / 1024)} KB`,
        error: f.size > MAX_DOC ? "أكبر من 2 MB" : undefined,
      },
    });
  };

  const state: State = !acc
    ? "ready"
    : acc.verification === "verified"
      ? "success"
      : acc.verification === "needs_more" || (attempted && acc.done < acc.total)
        ? "validation_error"
        : acc.verification === "pending"
          ? "loading"
          : !acc.can_submit
            ? "permission_denied"
            : "ready";
  const missing = acc ? acc.checklist.filter((i) => !i.done) : [];

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-seller" />} footer={null}>
      <div className="sys mp" data-screen="MP-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تفعيل دور البائع — طلب تحقق قبل أول نشر</h2>
            <span className="cat-head__hint">
              {acc?.shop_name ?? ""} تريد النشر في السوق. حسابك يبقى واحداً ودفترك واحداً. ما يُضاف
              هو دور بائع بعد تحقق منفصل يراجعه مشرف السوق.
            </span>
          </div>
          <div className="acc-card__body">
            {acc ? (
              <div className="acc-choice__head">
                <strong>
                  طلب تحقق البائع — <span className="sting-mono">{acc.done}</span> من{" "}
                  <span className="sting-mono">{acc.total}</span> مكتملة
                </strong>
                <Status
                  state={
                    acc.verification === "verified"
                      ? "success"
                      : acc.verification === "pending"
                        ? "pending_sync"
                        : acc.verification === "needs_more"
                          ? "validation_error"
                          : "ready"
                  }
                  label={
                    acc.verification === "pending" ? "بانتظار المراجعة" : acc.verification_label
                  }
                />
              </div>
            ) : null}
            {acc?.submitted_at ? (
              <p className="acc-choice__note">
                قُدِّم{" "}
                {wasYesterday(acc.submitted_at)
                  ? "أمس"
                  : daysWord(acc.days_since_submitted ?? 0) === "اليوم"
                    ? "اليوم"
                    : `قبل ${daysWord(acc.days_since_submitted ?? 0)}`}{" "}
                <span className="sting-mono">{hhmm(acc.submitted_at)}</span> · متوسط المراجعة يوم
                عمل واحد · لا نشر قبل الاعتماد
              </p>
            ) : null}

            {state === "loading" && acc ? (
              <Notice
                kind="info"
                title="قيد مراجعة المشرف"
                action={
                  <Button onClick={() => void load().catch(() => undefined)}>
                    تحقّق من الحالة
                  </Button>
                }
              >
                <p className="acc-lead">الطلب مرفوع وأدلته عند مشرف السوق.</p>
                <p className="acc-choice__note">
                  <strong>الحالة لا العجلة</strong> · «قيد المراجعة منذ{" "}
                  {daysWord(acc.days_since_submitted ?? 0)} — المدة المعتادة{" "}
                  <span className="sting-mono">{acc.usual_review_days}</span> أيام». طلبٌ بلا أفق
                  زمني يولّد تذاكر دعم لا صبراً.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="error" title="أدلة ناقصة">
                <p className="acc-lead">سجل تجاري غير مقروء أو نشاط لا يطابق الفئة المطلوبة.</p>
                <p className="acc-choice__note">
                  <strong>النقص مسمّى</strong> · حقلاً حقلاً مع سبب الرفض السابق إن وُجد. «طلبك
                  مرفوض» بلا سبب يعيد نفس الملف ثانيةً.
                </p>
              </Notice>
            ) : null}

            {state === "success" ? (
              <Notice
                kind="success"
                title="فُعِّل دور البائع"
                action={
                  <Button pos onClick={() => router.push("/market/profile")}>
                    صفحة المنشأة
                  </Button>
                }
              >
                <p className="acc-lead">الترقية من مشترٍ إلى بائع على الحساب نفسه.</p>
                <p className="acc-choice__note">
                  <strong>التفعيل لا ينشر</strong> · لا ملف عام ولا عرض ولا صنف يُنشر تلقائياً.
                  الباب فُتح والدخول قرارات لاحقة كلٌّ بشاشته.
                </p>
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="locked" title="طلب التحقق للمالك">
                <p className="acc-lead">
                  هوية المنشأة ومسؤوليتها في السوق تمثّل المنشأة كلها — يقدّمها المالك ويوقّع شروط
                  البائع.
                </p>
              </Notice>
            ) : null}

            {acc ? (
              <ul className="mp-check">
                {acc.checklist.map((i) => (
                  <li key={i.key}>
                    <span>
                      <strong>{i.title}</strong>
                      <div className="mp-check__hint">{i.hint}</div>
                      {i.reason ? <div className="mp-reason">{i.reason}</div> : null}
                      {attempted && !i.done && !i.reason ? (
                        <div className="mp-reason">ناقص — أكمله قبل التقديم</div>
                      ) : null}
                    </span>
                    <Status
                      state={i.done ? "success" : "validation_error"}
                      label={i.done ? "مكتمل" : "مطلوب"}
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            {acc && acc.can_submit && state !== "success" && state !== "loading" ? (
              <>
                <TextField
                  label="عنوان النشاط"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  hint="المنطقة والحيّ — يراجعه المشرف ولا يُنشر"
                />
                <TextField
                  label="منطقة الخدمة وطريقة الاستلام"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  hint="مثال: استلام من المخزن وتوصيل داخل المنطقة"
                />
                <SwitchField
                  label="أوافق على شروط البائع"
                  checked={terms}
                  onChange={setTerms}
                  hint="مسؤولية الوصف والسعر والتسليم على المنشأة لا على فيزانو"
                />
                <Upload
                  label="مستند السجل التجاري"
                  accept="image/*,application/pdf"
                  camera
                  constraintsText="صورة واضحة حتى 2 MB · يراجعها مشرف السوق ولا تُنشر في ملفك العام"
                  items={
                    file
                      ? [file.item]
                      : acc.registry_doc_name
                        ? [{ id: "saved", name: acc.registry_doc_name, sizeLabel: "محفوظ" }]
                        : []
                  }
                  onFiles={onFiles}
                  onRemove={() => setFile(null)}
                />
                <div className="acc-actions">
                  <Button pos onClick={() => void submit()} loading={busy}>
                    {acc.verification === "needs_more" ? "أعد التقديم" : "قدّم طلب التحقق"}
                  </Button>
                  <Button onClick={() => void save()} loading={busy}>
                    احفظ ما اكتمل
                  </Button>
                </div>
                {attempted && missing.length ? (
                  <p className="acc-choice__note">
                    ناقص: {missing.map((m) => m.title).join("، ")}.
                  </p>
                ) : null}
              </>
            ) : null}

            <p className="acc-lead">
              <strong>حدود الشارة</strong> · {acc?.badge_limits ?? ""} هذا النص يظهر حرفياً في ملف
              منشأتك المنشور بجوار الشارة.
            </p>
            <div className="mp-paths">
              <p className="acc-choice__note">
                <strong>قرار معتمد</strong> · تحقق الهوية الذي يكفي للشراء لا يكفي للبيع: من ينشر
                سعراً يبني عليه غيره قراراً مالياً. فحساب واحد، ودور بائع يُفتح بطلب تحقق منفصل
                يراجعه مشرف السوق قبل أول عرض — بانتظار بشري صريح لا إخفاء له. المسارات المرفوضة
                موثقة أدناه.
              </p>
              <p className="acc-choice__note">
                <strong>المسار أ — مرفوض</strong> · تفعيل تلقائي داخل نفس المنشأة: زر في إعدادات
                المنشأة يمنح النشر فوراً بنفس هوية المشترٍ المتحققة. الثمن: تحقق الهوية للشراء أضعف
                مما يلزم للبيع. مورّد غير مؤهل ينشر أسعاراً يعتمد عليها غيره.
              </p>
              <p className="acc-choice__note">
                <strong>المسار ج — مرفوض</strong> · حساب سوق منفصل مرتبط بتخويل: كيان بائع مستقل
                يُربط بالمنشأة المشترية بموافقة مالكها، ودفتراهما منفصلان. الثمن: محوّل منشأة أعقد،
                وخطر أن يظن المستخدم أن لديه شركتين ودفترين.
              </p>
              <p className="acc-choice__note">
                مورّد سجّلته في دفترك المحلي لا يحصل على ملف عام في السوق ولا يُدعى إليه. سجلّك
                الخاص ليس إعلاناً عن غيرك.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
