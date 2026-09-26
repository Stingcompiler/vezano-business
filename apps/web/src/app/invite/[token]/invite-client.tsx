"use client";

import { Button, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "expired" | "permission_denied" | "success" | "server_error";

interface Invite {
  readonly status: "valid" | "expired" | "accepted" | "not_for_you" | "not_found";
  readonly tenant_name: string;
  readonly inviter_name: string;
  readonly role_name: string;
  readonly branch_name: string;
  readonly expires_at: string;
  readonly tenant_id: string;
  readonly user_id: string;
}

/**
 * ACC-06. النموذج من `28-D21#ACC-06` (ready · expired)؛ بقية الحالات من `34-D26#ACC-06`.
 * القبول يمنح عضوية داخل هذه المنشأة فقط (§١٤.٦)؛ لا نُفشي لمن كانت الدعوة؛ القبول لا يُستهلك بالفشل.
 */
export function InviteClient({ token }: { token: string }) {
  const router = useRouter();
  const app = useApp();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const headers = useCallback(
    () => (app.selection ? { "X-Select-Ticket": app.selection.ticket } : {}),
    [app.selection],
  );

  useEffect(() => {
    if (!app.selection && !app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
      return;
    }
    let cancelled = false;
    void api()
      .GET("/api/invites/{token}", { headers: headers(), params: { path: { token } } })
      .then(({ data }) => {
        if (!cancelled && data) setInvite(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [app.selection, app.tokens, headers, router, token]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data, response } = await api().POST("/api/invites/{token}/accept", {
        headers: headers(),
        params: { path: { token } },
      });
      if (response.ok && data) {
        setInvite(data);
        return;
      }
      if (response.status === 403 || response.status === 410) {
        if (data) setInvite(data);
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = failed
    ? "server_error"
    : invite?.status === "accepted"
      ? "success"
      : invite?.status === "not_for_you" || invite?.status === "not_found"
        ? "permission_denied"
        : invite?.status === "expired"
          ? "expired"
          : "ready";
  const hoursLeft = invite?.expires_at
    ? Math.max(0, Math.floor((new Date(invite.expires_at).getTime() - Date.now()) / 3_600_000))
    : 0;

  return (
    <Frame title="فيزانو بلص" footer={null}>
      <div className="acc-page" data-screen="ACC-06" data-state={state}>
        <div className="acc-card">
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="error" title="الدعوة ليست لك">
                <p className="acc-lead">هذه الدعوة لحسابٍ آخر</p>
                <div className="acc-links">
                  <Button
                    onClick={() => {
                      app.setTokens(null);
                      app.setSelection(null);
                      router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
                    }}
                  >
                    بدّل الحساب
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "success" && invite ? (
              <>
                <Notice kind="success" title="قُبلت الدعوة">
                  <p className="acc-lead">
                    أنت الآن {invite.role_name} في {invite.branch_name}
                  </p>
                </Notice>
                <dl className="acc-facts">
                  <div>
                    <dt>الدور الممنوح</dt>
                    <dd>{invite.role_name}</dd>
                  </div>
                  <div>
                    <dt>النطاق</dt>
                    <dd>{invite.branch_name} فقط</dd>
                  </div>
                </dl>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/select-org")}>دخول</Button>
                </div>
              </>
            ) : null}

            {(state === "ready" || state === "expired" || state === "server_error") && invite ? (
              <>
                <div>
                  <h2 className="acc-card__title" style={{ fontSize: 19 }}>
                    دعوة من «{invite.tenant_name}»
                  </h2>
                  <p className="acc-lead">
                    دعاك {invite.inviter_name} للانضمام بدور <strong>{invite.role_name}</strong> على{" "}
                    {invite.branch_name}.
                  </p>
                </div>
                <dl className="acc-facts">
                  <div>
                    <dt>الدور الممنوح</dt>
                    <dd>{invite.role_name}</dd>
                  </div>
                  <div>
                    <dt>النطاق</dt>
                    <dd>{invite.branch_name} فقط</dd>
                  </div>
                  <div>
                    <dt>صلاحية الرابط</dt>
                    <dd>
                      {state === "expired" ? (
                        "رابط منتهٍ"
                      ) : (
                        <>
                          تنتهي بعد <span className="sting-mono">{hoursLeft}</span> ساعة
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="acc-item acc-item--ok">
                  <div className="acc-item__note">
                    القبول يمنحك <strong>عضوية داخل هذه المنشأة فقط</strong>. لا يُنشئ لك ملفاً
                    عاماً في السوق ولا ينشر اسمك لأحد.
                  </div>
                </div>
                {state === "expired" ? (
                  <Notice kind="warning" title="رابط منتهٍ">
                    <p className="acc-lead">
                      انتهت صلاحية الدعوة — اطلب دعوة جديدة من مالك المنشأة
                    </p>
                  </Notice>
                ) : null}
                {state === "server_error" ? (
                  <Notice kind="error" title="خطأ أثناء القبول">
                    <p className="acc-lead">
                      الدعوة تبقى صالحة حتى يُسجَّل القبول فعلاً. إعادة المحاولة آمنة
                    </p>
                  </Notice>
                ) : null}
                {state !== "expired" ? (
                  <div className="acc-actions">
                    <Button onClick={() => void accept()} loading={busy}>
                      {state === "server_error" ? "أعد المحاولة" : "قبول الدعوة"}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {state === "server_error" && !invite ? (
              <Notice kind="error" title="خطأ أثناء القبول">
                <p className="acc-lead">
                  الدعوة تبقى صالحة حتى يُسجَّل القبول فعلاً. إعادة المحاولة آمنة
                </p>
                <div className="acc-links">
                  <Button onClick={() => router.refresh()}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
