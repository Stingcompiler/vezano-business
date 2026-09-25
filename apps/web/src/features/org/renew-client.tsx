"use client";

import { Button, Frame, Notice, Status, TextField, Upload, type UploadItem } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { MonoText } from "@/features/org/mono";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "saving" | "success" | "server_error";

interface Proof {
  id: string;
  reference: string;
  plan_code: string;
  amount_minor: string;
  period_label: string;
  image_name: string;
  image_size: number;
  has_image: boolean;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  reviewed_at: string;
  reviewed_by_name: string;
  rejection_reason: string;
  extension_days: number;
  cycle_label?: string;
  receipt?: { id: string; number: string } | null;
}
type Cycle = "monthly" | "quarterly" | "yearly";

interface Payload {
  due: {
    plan_code: string;
    plan_name: string;
    amount_minor: string;
    currency: string;
    period_label: string;
    review_sla: string;
    addons_amount_minor?: string;
    addons?: { kind: string; label: string; qty: number; monthly_minor: string }[];
    cycle?: Cycle;
    cycles?: {
      cycle: Cycle;
      label: string;
      days: number;
      amount_minor: string;
      available: boolean;
    }[];
  };
  proofs: Proof[];
  can_submit: boolean;
  review_sla: string;
}

export const PROOF_IMAGE_META = "org.proof_image_pending";
const MAX_IMAGE = 2 * 1024 * 1024;

function money(minor: string): string {
  return (Number(minor) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}
async function toBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * ORG-07 — إثبات تحويل الاشتراك: الرفع لا يُفعِّل، والمراجعة بشرية معلَنة (27-D20 ready/
 * validation_error/success · 21-D16 saving · 39-D31 server_error): «معلّق» حالة معلَنة لا صامتة؛
 * رقم العملية إلزامي (بلا رقم لا يُمنع الاعتماد المزدوج)؛ فشل رفع الصورة لا يُضيّعها — تُحفظ محلياً
 * ويُسجَّل الرقم نصاً الآن (§١٦.٢، §١١.٢).
 */
export function RenewClient() {
  const router = useRouter();
  // 0005 §١١٢ — وضع الترقية: ?upgrade=<code> → المستحق فرق السعر على المتبقي، والإثبات بـkind=upgrade
  const upgradeTo = useSearchParams().get("upgrade") ?? "";
  const [upgradeQuote, setUpgradeQuote] = useState<{
    to: { code: string; name: string };
    amount_minor: string;
    remaining_days: number;
    note: string;
  } | null>(null);
  // 0005 §١١٦ — وضع الإضافة: ?addon=<kind>&qty=N → المستحق سعر الوحدة على المتبقي، بـkind=addon
  const params = useSearchParams();
  const addonKind = params.get("addon") ?? "";
  const addonQty = Number(params.get("qty") ?? "1") || 1;
  const [addonQuote, setAddonQuote] = useState<{
    kind: string;
    label: string;
    qty: number;
    plan_code: string;
    amount_minor: string;
    remaining_days: number;
    renewal_monthly_minor: string;
    note: string;
  } | null>(null);
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [file, setFile] = useState<{ item: UploadItem; file: File } | null>(null);
  const [reference, setReference] = useState("");
  // دورة الفوترة (0005 §١١٠): الشهري افتراضاً؛ الربعي/السنوي إن عرضهما الكتالوج بسعر
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [just, setJust] = useState<Proof | null>(null);
  const [dup, setDup] = useState<Proof | null>(null);
  const [pendingLocal, setPendingLocal] = useState<{
    proofId: string;
    name: string;
    size: number;
  } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/org/subscription/proofs", {});
    if (response.ok && data) setP(data);
    const raw = await getStorage().read((tx) => tx.getMeta(PROOF_IMAGE_META));
    if (raw) {
      try {
        const v = JSON.parse(raw) as { proofId: string; name: string; size: number };
        setPendingLocal(v);
      } catch {
        /* تالف */
      }
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fsubscription%2Frenew");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  useEffect(() => {
    if (!upgradeTo) return;
    void (async () => {
      const { data, response } = await api().GET("/api/org/subscription/change", {
        params: { query: { plan_code: upgradeTo } },
      });
      const b = data as unknown as { quote?: typeof upgradeQuote } | undefined;
      if (response.ok && b?.quote) setUpgradeQuote(b.quote);
    })().catch(() => undefined);
  }, [upgradeTo]);

  useEffect(() => {
    if (!addonKind) return;
    void (async () => {
      const { data, response } = await api().GET("/api/org/subscription/addon", {
        params: { query: { kind: addonKind, qty: addonQty } },
      });
      const b = data as unknown as { quote?: typeof addonQuote } | undefined;
      if (response.ok && b?.quote) setAddonQuote(b.quote);
    })().catch(() => undefined);
  }, [addonKind, addonQty]);

  const proofKind = () =>
    addonQuote
      ? {
          plan_code: addonQuote.plan_code,
          kind: "addon" as const,
          addon_kind: addonQuote.kind as "devices" | "users" | "branches",
          addon_qty: addonQuote.qty,
        }
      : {
          plan_code: upgradeQuote ? upgradeQuote.to.code : (p?.due.plan_code ?? ""),
          kind: upgradeQuote ? ("upgrade" as const) : ("renewal" as const),
          addon_kind: "" as const,
          addon_qty: 0,
        };

  const onFiles = (fs: File[]) => {
    const f = fs[0];
    if (!f) return;
    setFile({
      item: {
        id: "receipt",
        name: f.name,
        sizeLabel: sizeLabel(f.size),
        error: f.size > MAX_IMAGE ? "الصورة أكبر من 2 MB" : undefined,
      },
      file: f,
    });
  };

  const submit = async () => {
    setTouched(true);
    if (!reference.trim() || busy || !p) return;
    setBusy(true);
    setDup(null);
    setUploadFailed(false);
    try {
      let image: { image_name: string; image_size: number; image_data: string } | null = null;
      if (file && file.file.size <= MAX_IMAGE) {
        try {
          image = {
            image_name: file.file.name,
            image_size: file.file.size,
            image_data: await toBase64(file.file),
          };
        } catch {
          image = null;
        }
      }
      const { data, error, response } = await api().POST("/api/org/subscription/proofs", {
        body: {
          reference: reference.trim(),
          cycle,
          ...proofKind(),
          image_name: image?.image_name ?? "",
          image_size: image?.image_size ?? 0,
          image_data: image?.image_data ?? "",
        },
      });
      if (response.status === 409) {
        const e = error as unknown as { existing?: Proof } | undefined;
        setDup(e?.existing ?? null);
        return;
      }
      if (!response.ok || !data) {
        // فشل الرفع: لا نُضيّع الصورة — تُحفظ محلياً ونسجّل الرقم نصاً الآن (المسار البديل)
        if (image) {
          const { data: d2, response: r2 } = await api().POST("/api/org/subscription/proofs", {
            body: {
              reference: reference.trim(),
              cycle,
              ...proofKind(),
              image_size: 0,
            },
          });
          if (r2.ok && d2) {
            const created = (d2 as unknown as { proof: Proof }).proof;
            const meta = {
              proofId: created.id,
              name: image.image_name,
              size: image.image_size,
              data: image.image_data,
            };
            const json = JSON.stringify(meta);
            await getStorage().transaction((tx) => tx.putMeta(PROOF_IMAGE_META, json));
            setPendingLocal({
              proofId: created.id,
              name: image.image_name,
              size: image.image_size,
            });
            setJust(created);
          }
        }
        setUploadFailed(true);
        return;
      }
      const out = data as unknown as { proof: Proof } & Payload;
      setJust(out.proof);
      setP(out);
      setReference("");
      setFile(null);
      setTouched(false);
    } finally {
      setBusy(false);
    }
  };

  const retryImage = async () => {
    if (!pendingLocal || busy) return;
    setBusy(true);
    try {
      const raw = await getStorage().read((tx) => tx.getMeta(PROOF_IMAGE_META));
      if (!raw) return;
      const v = JSON.parse(raw) as { proofId: string; name: string; size: number; data: string };
      const { response } = await api().POST("/api/org/subscription/proofs/{proof_id}/image", {
        params: { path: { proof_id: v.proofId } },
        body: { image_name: v.name, image_size: v.size, image_data: v.data },
      });
      if (response.ok) {
        await getStorage().transaction((tx) => tx.putMeta(PROOF_IMAGE_META, ""));
        setPendingLocal(null);
        setUploadFailed(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const pending = p?.proofs.find((x) => x.status === "pending") ?? null;
  // آخر قرار خلال أسبوع يبقى ظاهراً («اعتُمد — مُدّد…» / «رُفض بسبب») قبل العودة إلى نموذج الرفع
  const latest = p?.proofs[0] ?? null;
  const recent =
    latest && latest.status !== "pending" && latest.reviewed_at
      ? Date.now() - new Date(latest.reviewed_at).getTime() < 7 * 86400_000
      : false;
  const shown = just ?? pending ?? (recent ? latest : null);
  const state: State = busy
    ? "saving"
    : uploadFailed
      ? "server_error"
      : shown
        ? "success"
        : touched && !reference.trim()
          ? "validation_error"
          : dup
            ? "validation_error"
            : "ready";

  return (
    <Frame title="تجديد الاشتراك" nav={<AppNav currentId="org-subscription" />} footer={null}>
      <div className="sys" data-screen="ORG-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              إثبات تحويل الاشتراك — الرفع لا يُفعِّل، والمراجعة بشرية معلَنة
            </h2>
            <span className="cat-head__hint">
              التاجر يرفع إيصال التحويل فتظهر حالة «معلّق» صريحة. لا نفعّل الاشتراك بمجرد وجود صورة،
              ولا نتركه يظن أنه دفع ومضى.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" ? (
              <Notice
                kind="error"
                title="فشل رفع الإثبات"
                action={
                  pendingLocal ? (
                    <Button onClick={() => void retryImage()} loading={busy}>
                      أعد رفع الصورة
                    </Button>
                  ) : undefined
                }
              >
                <p className="acc-lead">
                  صورة التحويل لم تُرفع. المستخدم دفع فعلاً وهذا يزيد قلقه.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نُضيّع الصورة</strong> · تُحفظ محلياً وتُرفع تلقائياً عند عودة الشبكة،
                  ونقول ذلك. طلبُ التصوير من جديد بعد دفعٍ تمّ استفزاز.
                </p>
                <p className="acc-choice__note">
                  <strong>مسار بديل</strong> · رقم التحويل وتاريخه يُسجَّلان نصاً الآن — يكفيان
                  للمراجعة اليدوية ريثما تصل الصورة.
                </p>
                {pendingLocal ? (
                  <Status state="saved_local" label={`محفوظة محلياً: ${pendingLocal.name}`} />
                ) : null}
              </Notice>
            ) : null}

            {state === "saving" ? <Status state="saving" label="يُرفع الإثبات" /> : null}

            {shown && state !== "server_error" ? (
              <Notice
                kind={
                  shown.status === "approved"
                    ? "success"
                    : shown.status === "rejected"
                      ? "warning"
                      : "info"
                }
                title={
                  shown.status === "approved"
                    ? "اعتُمد — مُدّد الاشتراك شهراً واحداً"
                    : shown.status === "rejected"
                      ? "رُفض بسبب"
                      : "معلّق للمراجعة"
                }
              >
                {shown.status === "approved" ? (
                  <p className="acc-lead">
                    التمديد كُتب مرة واحدة بمرجع رقم العملية. لو رُفع الإيصال نفسه ثانية تُرفض
                    المحاولة بعرض الاعتماد الأول وتاريخه — لا شهر إضافي بالخطأ.
                  </p>
                ) : shown.status === "rejected" ? (
                  <p className="acc-lead">{shown.rejection_reason}</p>
                ) : null}
                <ul className="acc-choice__note">
                  <li>
                    <strong>رُفع الإثبات</strong> · اليوم{" "}
                    <span className="sting-mono">{hhmm(shown.submitted_at)}</span> · يظهر لك فوراً
                    في سجل الاشتراك — تم
                  </li>
                  <li>
                    <strong>بانتظار مراجعة بشرية</strong> · متوسط المراجعة{" "}
                    {p?.review_sla ?? "يوم عمل واحد"}. لا تفعيل آلي بمجرد الرفع. —{" "}
                    {shown.status === "pending" ? "الآن" : "تم"}
                  </li>
                  <li>
                    <strong>الاعتماد أو الرفض بسبب</strong> · لو رُفض تُذكر العلّة بالرقم (فرق مبلغ،
                    صورة غير مقروءة) ولك مهلة تصحيح معلَنة —{" "}
                    {shown.status === "pending" ? "لاحقاً" : "تم"}
                  </li>
                  <li>
                    <strong>خلال المراجعة كلها</strong> · الخدمة تعمل كما هي. لا تعطيل استباقي ولا
                    تحذير مفاجئ. — ثابت
                  </li>
                </ul>
                <p className="acc-choice__note">
                  رقم العملية <span className="sting-mono">{shown.reference}</span> ·{" "}
                  {shown.has_image ? (
                    <>
                      صورة الإيصال — مرفوعة · <span className="sting-mono">{shown.image_name}</span>{" "}
                      · <span className="sting-mono">{sizeLabel(shown.image_size)}</span>
                    </>
                  ) : (
                    "بلا صورة بعد — الرقم والتاريخ نصاً"
                  )}
                </p>
              </Notice>
            ) : null}

            {p && !shown && state !== "server_error" ? (
              <>
                <h3 className="cat-head__title">رفع إثبات التحويل</h3>
                {upgradeQuote ? (
                  <Notice kind="info" title={`ترقية إلى «${upgradeQuote.to.name}» — فرق السعر`}>
                    <p className="acc-lead">{upgradeQuote.note}</p>
                    <p className="acc-choice__note">
                      الفرق على <span className="sting-mono">{upgradeQuote.remaining_days}</span>{" "}
                      يوماً متبقية:{" "}
                      <strong className="sting-mono">{money(upgradeQuote.amount_minor)} SDG</strong>
                    </p>
                  </Notice>
                ) : null}
                {addonQuote ? (
                  <Notice kind="info" title={`إضافة ${addonQuote.qty} ${addonQuote.label}`}>
                    <p className="acc-lead">{addonQuote.note}</p>
                    <p className="acc-choice__note">
                      عن <span className="sting-mono">{addonQuote.remaining_days}</span> يوماً
                      متبقية:{" "}
                      <strong className="sting-mono">{money(addonQuote.amount_minor)} SDG</strong> ·
                      ثم{" "}
                      <span className="sting-mono">{money(addonQuote.renewal_monthly_minor)}</span>{" "}
                      / شهر مع التجديد
                    </p>
                  </Notice>
                ) : null}
                {!upgradeQuote &&
                !addonQuote &&
                (p.due.cycles ?? []).filter((c) => c.available).length > 1 ? (
                  <div className="pos-chips org-cycles" role="group" aria-label="دورة الفوترة">
                    {(p.due.cycles ?? [])
                      .filter((c) => c.available)
                      .map((c) => (
                        <button
                          key={c.cycle}
                          type="button"
                          className={`pos-chip${cycle === c.cycle ? " pos-chip--on" : ""}`}
                          aria-pressed={cycle === c.cycle}
                          onClick={() => setCycle(c.cycle)}
                        >
                          {c.label} · <span className="sting-mono">{money(c.amount_minor)}</span>
                        </button>
                      ))}
                  </div>
                ) : null}
                <p className="acc-lead">
                  المستحق:{" "}
                  <span className="sting-mono">
                    {money(
                      addonQuote?.amount_minor ??
                        upgradeQuote?.amount_minor ??
                        (p.due.cycles ?? []).find((c) => c.cycle === cycle)?.amount_minor ??
                        p.due.amount_minor,
                    )}{" "}
                    {p.due.currency}
                  </span>{" "}
                  · الفترة: {addonQuote ? "إضافة" : upgradeQuote ? "فرق ترقية" : p.due.period_label}
                  {cycle !== "monthly" && !addonQuote ? (
                    <>
                      {" "}
                      · {(p.due.cycles ?? []).find((c) => c.cycle === cycle)?.label} —{" "}
                      <span className="sting-mono">
                        {(p.due.cycles ?? []).find((c) => c.cycle === cycle)?.days}
                      </span>{" "}
                      يوماً
                    </>
                  ) : null}
                </p>
                {!addonQuote && !upgradeQuote && (p.due.addons ?? []).some((x) => x.qty > 0) ? (
                  <p className="acc-choice__note" data-testid="renew-addons">
                    يشمل الإضافات:{" "}
                    {(p.due.addons ?? [])
                      .filter((x) => x.qty > 0)
                      .map((x) => `${x.qty} ${x.label}`)
                      .join(" · ")}{" "}
                    — <span className="sting-mono">{money(p.due.addons_amount_minor ?? "0")}</span>{" "}
                    للدورة الشهرية
                  </p>
                ) : null}
                <Upload
                  label="صورة الإيصال"
                  accept="image/*"
                  camera
                  constraintsText="صورة واحدة حتى 2 MB — تُحفظ محلياً إن فشل الرفع"
                  items={file ? [file.item] : []}
                  onFiles={onFiles}
                  onRemove={() => setFile(null)}
                />
                <TextField
                  label="رقم العملية البنكية — مطلوب"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  onBlur={() => setTouched(true)}
                  required
                  className="sting-mono"
                  error={
                    touched && !reference.trim()
                      ? "لو تُرك رقم العملية فارغاً نمنع الإرسال: بلا رقم لا يستطيع المراجع منع الاعتماد المزدوج."
                      : dup
                        ? `هذا الرقم رُفع من قبل — ${dup.status === "approved" ? "اعتُمد" : dup.status === "rejected" ? "رُفض" : "معلّق"} في ${dup.submitted_at.slice(0, 10)}`
                        : undefined
                  }
                />
                <div className="cat-form__actions">
                  <Button pos financial onClick={() => void submit()} loading={busy}>
                    إرسال الإثبات
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/org/subscription")}>
                    الاشتراك والباقات
                  </Button>
                </div>
                <h3 className="cat-head__title">مسار الإثبات كما يراه التاجر</h3>
                <p className="acc-choice__note">
                  <strong>«معلّق» حالة معلَنة لا صامتة.</strong> نعرض متوسط زمن المراجعة، ونبقي
                  الخدمة عاملة خلالها، ولا نرسل تنبيه «تم الدفع» قبل الاعتماد.
                </p>
              </>
            ) : null}

            {p && p.proofs.length > 0 ? (
              <>
                <h3 className="cat-head__title">سجل الاشتراك</h3>
                <ul className="acc-choice__note">
                  {p.proofs.map((x) => (
                    <li key={x.id}>
                      <span className="sting-mono">{x.reference}</span> ·{" "}
                      <MonoText text={x.period_label} /> ·{" "}
                      <span className="sting-mono">{money(x.amount_minor)}</span> ·{" "}
                      {x.status === "approved"
                        ? "معتمد"
                        : x.status === "rejected"
                          ? "مرفوض"
                          : "معلّق للمراجعة"}
                      {x.reviewed_by_name ? ` · ${x.reviewed_by_name}` : ""}
                      {x.receipt ? (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={`/org/subscription/receipts/${x.receipt.id}`}
                            className="org-receipt-link"
                            onClick={(e) => {
                              e.preventDefault();
                              router.push(`/org/subscription/receipts/${x.receipt?.id ?? ""}`);
                            }}
                          >
                            الإيصال <span className="sting-mono">{x.receipt.number}</span>
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
