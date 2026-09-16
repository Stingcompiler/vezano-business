"use client";

import { Button, Frame, Notice, SelectField, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "saving" | "success" | "server_error";

interface Option {
  readonly code: string;
  readonly name: string;
}
interface Created {
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly branch_id: string;
  readonly user_id: string;
  readonly created: { readonly items: number; readonly groups: number; readonly branches: number };
  readonly access: string;
  readonly refresh: string;
  readonly session_id: string;
}

/**
 * ACC-04. النموذج من `28-D21#ACC-04`؛ الحالات من `34-D26#ACC-04`. الإنشاء بهوية طلب ثابتة:
 * عند خطأ الخادم نستعلم عن الحالة أولاً ثم نُكمل — «إعادة الإرسال هنا تُنشئ منشأتين لمستخدمٍ أراد واحدة».
 * بيانات الحساب (معرّف/كلمة مرور) غير مرسومة هنا (0005 §٣): بلا هوية يعود إلى الدخول.
 */
export function CreateOrgClient() {
  const router = useRouter();
  const app = useApp();
  const [requestId] = useState(() => crypto.randomUUID());
  const [sectors, setSectors] = useState<readonly Option[]>([]);
  const [currencies, setCurrencies] = useState<readonly Option[]>([]);
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [currency, setCurrency] = useState("SDG");
  const [branchName, setBranchName] = useState("");
  const [errors, setErrors] = useState<{ name?: string; sector?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const headers = useCallback(
    () => (app.selection ? { "X-Select-Ticket": app.selection.ticket } : {}),
    [app.selection],
  );

  useEffect(() => {
    if (!app.selection && !app.tokens) {
      router.replace("/login?intent=create");
      return;
    }
    void api()
      .GET("/api/tenants/sectors")
      .then(({ data }) => {
        if (!data) return;
        setSectors(data.sectors);
        setCurrencies(data.currencies);
        if (data.currencies[0]) setCurrency(data.currencies[0].code);
      })
      .catch(() => undefined);
  }, [app.selection, app.tokens, router]);

  const adopt = (data: Created) => {
    setCreated(data);
    app.setTokens({ access: data.access, refresh: data.refresh, sessionId: data.session_id });
    app.setSession({
      ...app.session,
      userId: data.user_id,
      tenantId: data.tenant_id,
      branchId: data.branch_id,
      displayName: data.tenant_name,
    });
    app.setSelection(null);
  };

  const validate = () => {
    const e: { name?: string; sector?: string } = {};
    if (!name.trim()) e.name = "اسم المنشأة فارغ";
    if (!sector) e.sector = "القطاع غير مختار";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || created) return;
    if (!validate()) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data, error, response } = await api().POST("/api/tenants", {
        headers: headers(),
        body: {
          client_request_id: requestId,
          name,
          sector,
          currency,
          first_branch_name: branchName,
        },
      });
      if (response.status === 400 && error) {
        const f = error.invalid_fields;
        setErrors({
          ...(f.name ? { name: "اسم المنشأة فارغ" } : {}),
          ...(f.sector ? { sector: "القطاع غير مختار" } : {}),
        });
        return;
      }
      if (!response.ok || !data) {
        await probeStatus();
        return;
      }
      adopt(data);
    } catch {
      await probeStatus();
    } finally {
      setBusy(false);
    }
  };

  /** لا إعادة عمياء: نستعلم عن الحالة بهوية الطلب؛ إن وُجدت أُكمل من حيث توقّف. */
  const probeStatus = async () => {
    try {
      const { data, response } = await api().GET("/api/tenants/creation/{client_request_id}", {
        headers: headers(),
        params: { path: { client_request_id: requestId } },
      });
      if (response.ok && data) {
        adopt(data);
        return;
      }
    } catch {
      /* الخادم ما زال لا يردّ */
    }
    setFailed(true);
  };

  const state: State = created
    ? "success"
    : busy
      ? "saving"
      : failed
        ? "server_error"
        : Object.keys(errors).length
          ? "validation_error"
          : "ready";
  const bothMissing = Boolean(errors.name && errors.sector);

  return (
    <Frame title="Sting" footer={null}>
      <div className="acc-page" data-screen="ACC-04" data-state={state}>
        {state === "success" && created ? (
          <div className="acc-card">
            <div className="acc-card__body">
              <Notice kind="success" title="أُنشئت المنشأة">
                <p className="acc-lead">
                  ومعها ما أنشأته الوصفة:{" "}
                  <span className="sting-mono">{created.created.items}</span> صنفاً مبدئياً و
                  <span className="sting-mono">{created.created.groups}</span> مجموعات وفرعٌ واحد.
                </p>
              </Notice>
              <div className="acc-actions">
                <Button onClick={() => router.push("/setup-device")}>جهّز هذا الجهاز</Button>
              </div>
            </div>
          </div>
        ) : (
          <form className="acc-card" onSubmit={(e) => void submit(e)} noValidate>
            <div className="acc-card__body">
              <div>
                <h2 className="acc-card__title" style={{ fontSize: 19 }}>
                  إنشاء المنشأة
                </h2>
                <p className="acc-lead">
                  وصفة القطاع تُهيّئ لك أصنافاً ووحدات شائعة — كلها قابلة للتعديل.
                </p>
              </div>

              {state === "server_error" ? (
                <Notice kind="error" title="خطأ خادم أثناء الإنشاء">
                  <p className="acc-lead">
                    قد تكون المنشأة أُنشئت والوصفة لم تُطبَّق. نستعلم عن الحالة أولاً ثم نُكمل من
                    حيث توقّف.
                  </p>
                  <div className="acc-links">
                    <Button type="submit">أعد المحاولة</Button>
                  </div>
                </Notice>
              ) : null}

              {bothMissing ? (
                <Notice kind="error" title="حقلان يمنعان الإنشاء">
                  <p className="acc-lead">اسم المنشأة فارغ، والقطاع غير مختار.</p>
                </Notice>
              ) : null}

              {state === "saving" ? (
                <div role="status" aria-live="polite">
                  <p className="acc-card__sub">جارٍ الإنشاء</p>
                  <ol className="acc-steps">
                    <li>
                      <span>المنشأة</span>
                    </li>
                    <li>
                      <span>وصفة القطاع</span>
                    </li>
                    <li>
                      <span>الفرع الأول</span>
                    </li>
                  </ol>
                </div>
              ) : null}

              <TextField
                label="اسم المنشأة"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={errors.name}
                readOnly={busy}
                required
              />
              <SelectField
                label="النشاط — وصفة القطاع"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                options={[
                  { value: "", label: "" },
                  ...sectors.map((s) => ({ value: s.code, label: s.name })),
                ]}
                error={errors.sector}
                disabledReason={busy ? "جارٍ الإنشاء" : undefined}
                required
              />
              <SelectField
                label="العملة — لا تُبدَّل بعد أول معاملة"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                options={currencies.map((c) => ({ value: c.code, label: c.name }))}
                disabledReason={busy ? "جارٍ الإنشاء" : undefined}
                required
              />
              <TextField
                label="الفرع الأول"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                readOnly={busy}
              />
              <div className="acc-item acc-item--danger">
                <div className="acc-item__label">العملة قرار نهائي</div>
                <div className="acc-item__note">
                  بعد أول معاملة لا تُبدَّل العملة. تبديلها يعني إعادة تقييم كل مبلغ سابق برقم
                  نختاره نحن — وذلك تحريف دفترك لا إعداد.
                </div>
              </div>
              <div className="acc-actions">
                <Button type="submit" loading={busy}>
                  إنشاء المنشأة
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Frame>
  );
}
