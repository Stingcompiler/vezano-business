"use client";

import { Button, formatMinor, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { dayMonth, hhmm } from "@/features/home/format";
import { MonoText } from "@/features/org/mono";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "loading" | "ready" | "permission_denied" | "empty";

interface Receipt {
  id: string;
  number: string;
  tenant_name: string;
  plan_code: string;
  plan_name: string;
  cycle: string;
  cycle_label: string;
  description?: string;
  amount_minor: string;
  currency: string;
  reference: string;
  period_from: string;
  period_to: string;
  issued_at: string;
  issued_by_name: string;
  proof_id: string;
  issuer: { name: string; legal: string; contact: string };
  note: string;
}

const Day = ({ iso }: { iso: string }) => {
  if (!iso) return <>—</>;
  const { day, month } = dayMonth(iso);
  const year = iso.slice(0, 4);
  return (
    <>
      <span className="sting-mono">{day}</span> {month} <span className="sting-mono">{year}</span>
    </>
  );
};

/** إيصال اشتراك مرقَّم — يُطبع أو يُحفظ PDF من المتصفح (0005 §١١١). */
export function ReceiptClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [r, setR] = useState<Receipt | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!app.tokens) {
      router.replace("/login");
      return;
    }
    void (async () => {
      const { data, response } = await api().GET("/api/org/subscription/receipts/{receipt_id}", {
        params: { path: { receipt_id: id } },
      });
      if (response.status === 403) return setState("permission_denied");
      if (response.status === 404) return setState("empty");
      const b = data as unknown as { receipt: Receipt } | undefined;
      if (response.ok && b) {
        setR(b.receipt);
        setState("ready");
      }
    })().catch(() => undefined);
  }, [app.tokens, id, router]);

  return (
    <Frame title="إيصال الاشتراك" nav={<AppNav currentId="org-subscription" />} footer={null}>
      <div className="sys org-receipt-page" data-screen="ORG-07" data-state={state}>
        {state === "loading" ? (
          <Notice kind="info" title="جلب الإيصال">
            <p className="acc-lead">الإيصال يُقرأ من الخادم بمرقّمه.</p>
          </Notice>
        ) : null}
        {state === "permission_denied" ? (
          <Notice kind="warning" title="للمالك فقط">
            <p className="acc-lead">إيصالات الاشتراك يراها مالك المنشأة.</p>
          </Notice>
        ) : null}
        {state === "empty" ? (
          <Notice kind="empty" title="لا إيصال بهذا المعرّف">
            <p className="acc-lead">قد يكون الرابط قديماً — افتح سجل الاشتراك.</p>
            <div className="acc-actions">
              <Button onClick={() => router.push("/org/subscription/renew")}>سجل الاشتراك</Button>
            </div>
          </Notice>
        ) : null}
        {r ? (
          <>
            <div className="acc-actions org-receipt__tools">
              <Button pos onClick={() => window.print()}>
                اطبع / احفظ PDF
              </Button>
              <Button variant="quiet" onClick={() => router.push("/org/subscription/renew")}>
                سجل الاشتراك
              </Button>
            </div>
            <article className="org-receipt" aria-label={`إيصال ${r.number}`}>
              <header className="org-receipt__head">
                <div>
                  <div className="org-receipt__brand">
                    <span className="acc-logo" aria-hidden="true">
                      ف
                    </span>
                    <strong>{r.issuer.name}</strong>
                  </div>
                  <div className="org-receipt__legal">
                    {r.issuer.legal} · <MonoText text={r.issuer.contact} />
                  </div>
                </div>
                <div className="org-receipt__title">
                  <h2>إيصال اشتراك</h2>
                  <div className="sting-mono org-receipt__number">{r.number}</div>
                  <div className="cus-sub">
                    صدر <Day iso={r.issued_at} />{" "}
                    <span className="sting-mono">{hhmm(r.issued_at)}</span>
                  </div>
                </div>
              </header>
              <dl className="org-receipt__grid">
                <dt>المنشأة</dt>
                <dd>{r.tenant_name}</dd>
                <dt>الباقة</dt>
                <dd>
                  {r.plan_name} · {r.cycle_label}
                  {r.description ? (
                    <>
                      {" "}
                      — <MonoText text={r.description} />
                    </>
                  ) : null}
                </dd>
                <dt>الفترة</dt>
                <dd>
                  من <Day iso={r.period_from} /> إلى <Day iso={r.period_to} />
                </dd>
                <dt>رقم التحويل</dt>
                <dd className="sting-mono">{r.reference}</dd>
                <dt>اعتمده</dt>
                <dd>{r.issued_by_name}</dd>
              </dl>
              <div className="org-receipt__total">
                <span>المبلغ المستلم</span>
                <strong className="sting-mono">
                  {formatMinor(r.amount_minor)} {r.currency}
                </strong>
              </div>
              <p className="org-receipt__note">{r.note}</p>
            </article>
          </>
        ) : null}
      </div>
    </Frame>
  );
}
