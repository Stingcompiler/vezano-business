"use client";

import { Button, Frame, Notice, Status, Upload, type UploadItem } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State = "ready" | "empty" | "partial" | "validation_error" | "offline" | "success";

interface Onboarding {
  readonly tenant_name: string;
  readonly currency_name: string;
  readonly branches: number;
  readonly dismissed: boolean;
  readonly steps: Record<string, Record<string, unknown>>;
}

const LOGO_MAX = 2 * 1024 * 1024;

interface Step {
  readonly key: string;
  readonly title: string;
  readonly detail: React.ReactNode;
  readonly action: string;
  readonly href: string;
  readonly mark: "done" | "partial" | number;
  /** يحتاج الخادم (34-D26 offline): الشعار والدعوة. */
  readonly needsServer: boolean;
}

/** يصغّر الصورة على الجهاز حتى تدخل الحدّ — «الضغط عمليةٌ نملكها». */
async function shrinkImage(file: File, maxBytes: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let scale = 1;
  for (let i = 0; i < 8; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.82);
    if (url.length <= maxBytes) return url;
    scale *= 0.7;
  }
  throw new Error("cannot_shrink");
}

/**
 * ACC-10. التخطيط من `06-D2#ACC-10` (partial)؛ بقية الحالات من `34-D26#ACC-10`. الخطوات كلّها تخطّي،
 * التقدّم يُعرض ولا يُلاحَق، والمعالج يُستأنف؛ الصرف النهائي يُحفظ خادمياً فلا يعود على أي جهاز.
 */
export function OnboardingClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [data, setData] = useState<Onboarding | null>(null);
  const [bigLogo, setBigLogo] = useState<File | null>(null);
  const [logoItems, setLogoItems] = useState<readonly UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  const load = useCallback(async () => {
    const { data: d, response } = await api().GET("/api/tenants/onboarding");
    if (response.ok && d) setData(d);
  }, []);

  useEffect(() => {
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fonboarding");
      return;
    }
    void load().catch(() => undefined);
  }, [app.expired, app.tokens, load, router]);

  const patch = async (body: { dismissed?: boolean; logo_data_url?: string }) => {
    setBusy(true);
    try {
      const { data: d, response } = await api().PATCH("/api/tenants/onboarding", { body });
      if (response.ok && d) setData(d);
      return response.status;
    } finally {
      setBusy(false);
    }
  };

  const onLogoFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > LOGO_MAX) {
      setBigLogo(f);
      return;
    }
    const url = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(typeof r.result === "string" ? r.result : "");
      r.readAsDataURL(f);
    });
    setLogoItems([{ id: f.name, name: f.name, sizeLabel: `${(f.size / 1024).toFixed(0)} KB` }]);
    await patch({ logo_data_url: url });
  };

  const shrinkAndUpload = async () => {
    if (!bigLogo) return;
    const url = await shrinkImage(bigLogo, LOGO_MAX);
    setLogoItems([
      { id: bigLogo.name, name: bigLogo.name, sizeLabel: `${(url.length / 1024).toFixed(0)} KB` },
    ]);
    setBigLogo(null);
    await patch({ logo_data_url: url });
  };

  const finish = async () => {
    await patch({ dismissed: true });
    setCompleted(true);
  };

  const s = data?.steps ?? {};
  const items = s.items ?? {};
  const imported = Number(items.imported ?? 0);
  const rejected = Number(items.rejected ?? 0);
  const sales = Number(items.sales ?? 0);
  const steps: Step[] = data
    ? [
        {
          key: "org",
          title: "بيانات المنشأة والعملة",
          detail: (
            <>
              {data.tenant_name} · {data.currency_name} ·{" "}
              {data.branches === 1 ? (
                "فرع واحد"
              ) : (
                <>
                  <span className="sting-mono">{data.branches}</span> فروع
                </>
              )}
            </>
          ),
          action: "تعديل",
          href: "/org/settings",
          mark: "done",
          needsServer: true,
        },
        {
          key: "items",
          title: rejected > 0 ? "استيراد الأصناف — جزئي" : "استيراد الأصناف",
          detail:
            imported > 0 || rejected > 0 ? (
              <>
                <span className="sting-mono">{imported}</span> صنفاً دخلت ·{" "}
                <span className="sting-mono">{rejected}</span> سطراً مرفوضاً ينتظر التصحيح
              </>
            ) : sales === 0 ? (
              "نقترح أصنافك بعد أول أسبوع بيع"
            ) : (
              "لم تبدأ"
            ),
          action: rejected > 0 ? "تصحيح المرفوض" : "ابدأ",
          href: "/catalog/import",
          mark: rejected > 0 ? "partial" : imported > 0 ? "done" : 2,
          needsServer: false,
        },
        {
          key: "balances",
          title: "أرصدة العملاء الافتتاحية",
          detail:
            Number(s.balances?.count ?? 0) > 0 ? (
              <span className="sting-mono">{String(s.balances?.count)}</span>
            ) : (
              "لم تبدأ — يمكن إضافتها عند أول بيع آجل"
            ),
          action: "ابدأ",
          href: "/parties/opening",
          mark: Number(s.balances?.count ?? 0) > 0 ? "done" : 3,
          needsServer: false,
        },
        {
          key: "printer",
          title: "ربط الطابعة وتجربة إيصال",
          detail: s.printer?.linked ? "تم" : "لم تبدأ — البيع يعمل بلا طابعة",
          action: "ابدأ",
          href: "/settings/printer",
          mark: s.printer?.linked ? "done" : 4,
          needsServer: false,
        },
        {
          key: "logo",
          title: "شعار",
          detail: s.logo?.present ? "تم" : "لم تبدأ",
          action: "ابدأ",
          href: "#logo",
          mark: s.logo?.present ? "done" : 5,
          needsServer: true,
        },
        {
          key: "invite",
          title: "دعوة موظف",
          detail:
            Number(s.invite?.sent ?? 0) > 0 ? (
              <span className="sting-mono">{String(s.invite?.sent)}</span>
            ) : (
              "لم تبدأ"
            ),
          action: "ابدأ",
          href: "/org/team",
          mark: Number(s.invite?.sent ?? 0) > 0 ? "done" : 6,
          needsServer: true,
        },
      ]
    : [];
  const doneCount = steps.filter((x) => x.mark === "done").length;
  const startedBeyondOrg =
    steps.some((x) => x.key !== "org" && x.mark !== "done" && x.mark === "partial") ||
    doneCount > 1;

  const state: State =
    completed || data?.dismissed
      ? "success"
      : bigLogo
        ? "validation_error"
        : !online
          ? "offline"
          : !data
            ? "ready"
            : startedBeyondOrg
              ? "partial"
              : sales === 0 && imported === 0
                ? "empty"
                : "ready";

  return (
    <Frame title="فيزانو بلص" footer={null}>
      <div className="acc-page" data-screen="ACC-10" data-state={state}>
        <div className="acc-card" style={{ inlineSize: "min(100%, 720px)" }}>
          {state === "success" ? (
            <div className="acc-card__body">
              <Notice kind="success" title="اكتمل المعالج">
                <p className="acc-lead">
                  المعالج لم يعد يظهر. وما تُخطّيه يبقى متاحاً في الإعدادات بمكانه المعروف لا
                  مخبوءاً.
                </p>
              </Notice>
              <div className="acc-actions">
                <Button onClick={() => router.push("/shifts/open")}>افتح وردية وابدأ البيع</Button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="acc-card__head"
                style={{ justifyContent: "space-between", flexWrap: "wrap" }}
              >
                <div>
                  <h2 className="acc-card__title" style={{ fontSize: 17 }}>
                    تجهيز {data?.tenant_name ?? ""}
                  </h2>
                  <p className="acc-card__sub" style={{ color: "var(--color-ink-muted)" }}>
                    <span className="sting-mono">{doneCount}</span> من{" "}
                    <span className="sting-mono">{steps.length}</span> · تستطيع البيع الآن
                  </p>
                </div>
                <Button onClick={() => router.push("/shifts/open")}>ابدأ البيع</Button>
              </div>

              {state === "offline" ? (
                <div className="acc-card__body" style={{ paddingBlockEnd: 0 }}>
                  <Notice kind="offline" title="المعالج بلا اتصال">
                    <p className="acc-lead">
                      المحليّتان تعملان الآن، والأخريان موسومتان «تحتاج اتصالاً» ومحفوظتان لتُنفَّذا
                      تلقائياً عند عودة الشبكة.
                    </p>
                  </Notice>
                </div>
              ) : null}

              {state === "validation_error" && bigLogo ? (
                <div className="acc-card__body" style={{ paddingBlockEnd: 0 }}>
                  <Notice kind="error" title="الشعار كبير">
                    <p className="acc-lead">
                      ملفٌ{" "}
                      <span className="sting-mono">
                        {(bigLogo.size / (1024 * 1024)).toFixed(1)}
                      </span>{" "}
                      ميجابايت والحدّ <span className="sting-mono">2</span>.
                    </p>
                    <div className="acc-links">
                      <Button onClick={() => void shrinkAndUpload()} loading={busy}>
                        سنصغّره لك
                      </Button>
                      <Button variant="secondary" onClick={() => setBigLogo(null)}>
                        إلغاء
                      </Button>
                    </div>
                  </Notice>
                </div>
              ) : null}

              <ol className="acc-wizard">
                {steps.map((st) => (
                  <li key={st.key} className="acc-wizard__step">
                    <span
                      className={`acc-wizard__mark sting-mono${st.mark === "done" ? " acc-wizard__mark--done" : st.mark === "partial" ? " acc-wizard__mark--partial" : ""}`}
                      aria-hidden="true"
                    >
                      {st.mark === "done" ? "✓" : st.mark === "partial" ? "!" : st.mark}
                    </span>
                    <div className="acc-wizard__body">
                      <div className="acc-wizard__title">{st.title}</div>
                      <div className="acc-choice__note">{st.detail}</div>
                      {st.needsServer && !online ? (
                        <Status state="offline" label="تحتاج اتصالاً" />
                      ) : null}
                    </div>
                    {st.key === "logo" ? (
                      <Upload
                        label="شعار"
                        accept="image/*"
                        constraintsText="الحدّ 2 ميجابايت"
                        items={logoItems}
                        onFiles={(fs) => void onLogoFiles(fs)}
                        onRemove={() => setLogoItems([])}
                      />
                    ) : (
                      <Link
                        href={st.href}
                        className={`c-btn ${st.mark === "partial" ? "c-btn--primary" : "c-btn--secondary"}`}
                      >
                        {st.action}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>

              {state === "partial" ? (
                <div className="acc-wizard__foot">
                  لا تُشترط الخطوات الأربع لبدء البيع. الاستيراد نصفه منتهٍ —{" "}
                  <span className="sting-mono">{imported}</span> صنفاً دخلت و
                  <span className="sting-mono">{rejected}</span> رُفضت، ويمكنك تصحيحها لاحقاً دون
                  إعادة البقية.
                </div>
              ) : null}

              <div className="acc-card__body">
                <div className="acc-links">
                  <Button variant="quiet" onClick={() => void finish()} loading={busy}>
                    اكتمل المعالج
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}
