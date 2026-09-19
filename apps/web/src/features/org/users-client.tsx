"use client";

import { Button, Dialog, Frame, Notice, SelectField, Table, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { MonoText } from "@/features/org/mono";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "empty" | "validation_error" | "expired" | "success";

interface UserRow {
  id: string;
  display_name: string;
  is_owner: boolean;
  status: "active" | "disabled";
  roles: { code: string; name: string }[];
  branches: { id: string; name: string }[];
  all_branches: boolean;
  operations: number;
}
interface InvitationRow {
  id: string;
  identifier_masked: string;
  role_code: string;
  role_name: string;
  branch_id: string;
  branch_name: string;
  status: "sent" | "expired" | "accepted" | "revoked";
  sent_at: string;
  expires_at: string;
  inviter_name: string;
}
interface Payload {
  users: UserRow[];
  invitations: InvitationRow[];
  counts: { users: number; open_invitations: number };
  invite_ttl_hours: number;
  branches: { id: string; name: string }[];
  roles: { id: string; code: string; name: string }[];
  can_invite: boolean;
}
interface Sent {
  invitation: InvitationRow;
  link: string;
  grants: string[];
}

type Row =
  | { kind: "user"; key: string; user: UserRow }
  | { kind: "invitation"; key: string; inv: InvitationRow };

function ddmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  disabled: "معطَّل",
  sent: "دعوة مُرسَلة",
  expired: "منتهية",
  accepted: "مقبولة",
  revoked: "ملغاة",
};

/**
 * ORG-01 — المستخدمون والدعوات (27-D20 ready/expired · 39-D31 loading/empty/validation_error/
 * success): الدعوة ليست حساباً والتعطيل ليس حذفاً؛ القائمة من الخادم دائماً لا من كاش؛ لا دعوة
 * ثانية لرقم مدعوّ (نعرض القائمة ومخرجَين)؛ الدعوة المنتهية لا تُحيا بضغطة — نُصدر جديدة ويبقى
 * أثر الأولى؛ والصلاحية تُراجَع قبل الإرسال (§٩.٢، §١١.٨).
 */
export function UsersClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [roleId, setRoleId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<InvitationRow | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [focus, setFocus] = useState<InvitationRow | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    try {
      const { data: d, response } = await api().GET("/api/org/users", {});
      if (!response.ok || !d) {
        setFailed(true);
        return;
      }
      const p = d as unknown as Payload;
      setData(p);
      setFailed(false);
      setRoleId((r) => r || p.roles[0]?.id || "");
      setBranchId((b) => b || p.branches[0]?.id || "");
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fusers");
      return;
    }
    void load();
  }, [router, load]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setInvalid(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api().POST("/api/org/invitations", {
        body: { identifier, role_id: roleId, branch_id: branchId },
      });
      if (response.status === 409) {
        const e = error as unknown as { existing?: InvitationRow } | undefined;
        setDup(e?.existing ?? null);
        setOpen(false);
        return;
      }
      if (!response.ok || !d) {
        const e = error as unknown as { detail?: string } | undefined;
        setInvalid(
          e?.detail === "identifier_invalid"
            ? "اكتب رقم هاتف أو بريداً صالحاً"
            : e?.detail === "already_member"
              ? "هذا المعرّف مستخدم في المنشأة أصلاً"
              : "تعذّر إرسال الدعوة",
        );
        return;
      }
      setSent(d);
      setOpen(false);
      setIdentifier("");
      setFocus(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const act = async (inv: InvitationRow, action: "resend" | "revoke") => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: d, response } = await api().POST(
        "/api/org/invitations/{invitation_id}/{action}",
        {
          params: { path: { invitation_id: inv.id, action } },
        },
      );
      if (response.ok && action === "resend" && d) setSent(d);
      setDup(null);
      setFocus(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const users = data?.users ?? [];
  const invitations = data?.invitations ?? [];
  const alone = users.length <= 1 && invitations.length === 0;
  const state: State = !data
    ? "loading"
    : sent
      ? "success"
      : dup
        ? "validation_error"
        : focus?.status === "expired"
          ? "expired"
          : alone
            ? "empty"
            : "ready";

  const rows: Row[] = [
    ...users.map((u): Row => ({ kind: "user", key: `u-${u.id}`, user: u })),
    ...invitations.map((i): Row => ({ kind: "invitation", key: `i-${i.id}`, inv: i })),
  ];

  const note = (r: Row): string => {
    if (r.kind === "user") {
      if (r.user.is_owner)
        return "الحساب الوحيد الذي يرى الاشتراك والمبالغ. لا يُعطَّل إلا بنقل ملكية موثَّق.";
      if (r.user.status === "disabled")
        return `معطَّل. لا يدخل ولا يبيع، ويبقى اسمه فاعلاً على ${r.user.operations.toLocaleString("en-US")} عملية نفّذها. التعطيل ليس حذفاً.`;
      return "الصلاحية تُمنح للدور، والنطاق يُمنح للمستخدم في الفرع.";
    }
    switch (r.inv.status) {
      case "sent":
        return `الرابط صالح ${data?.invite_ttl_hours ?? 72} ساعة. حتى قبولها لا يوجد حساب ولا صلاحية ولا اسم في سجل التدقيق.`;
      case "expired":
        return "انتهت المدة. لا تُحيا: نُصدر دعوة جديدة برابط جديد ويبقى أثر الأولى.";
      case "accepted":
        return "قُبلت — صار للمدعوّ حساب بالدور والفرع المذكورين.";
      default:
        return "أُلغيت قبل قبولها. يبقى أثرها ومن أرسلها.";
    }
  };

  const columns = [
    {
      key: "who",
      header: "المستخدم",
      render: (r: Row) => (
        <div>
          <strong>
            {r.kind === "user" ? r.user.display_name : `دعوة — ${r.inv.identifier_masked}`}
          </strong>
          <p className="acc-choice__note">
            {r.kind === "user" ? (
              r.user.is_owner ? (
                "مالك المنشأة"
              ) : (
                ""
              )
            ) : (
              <>
                أُرسلت <span className="sting-mono">{ddmm(r.inv.sent_at)}</span>
              </>
            )}
          </p>
        </div>
      ),
    },
    {
      key: "role",
      header: "الدور والفرع",
      render: (r: Row) => (
        <div>
          <span>
            {r.kind === "user"
              ? `${r.user.roles.map((x) => x.name).join("، ") || "—"}${r.user.status === "disabled" ? " — سابقاً" : ""}`
              : r.inv.role_name}
          </span>
          <p className="acc-choice__note">
            {r.kind === "user"
              ? r.user.all_branches
                ? "كل الفروع"
                : r.user.branches.map((b) => b.name).join("، ") || "—"
              : r.inv.branch_name}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r: Row) => {
        const st = r.kind === "user" ? r.user.status : r.inv.status;
        return <span className={`org-badge org-badge--${st}`}>{STATUS_LABEL[st]}</span>;
      },
    },
    {
      key: "note",
      header: "ما يعنيه ذلك عملياً",
      render: (r: Row) => (
        <div>
          <p className="acc-choice__note">
            <MonoText text={note(r)} />
          </p>
          {r.kind === "invitation" && r.inv.status === "sent" ? (
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => void act(r.inv, "resend")} loading={busy}>
                أعد إرسالها
              </Button>
              <Button variant="quiet" onClick={() => void act(r.inv, "revoke")} loading={busy}>
                ألغِها
              </Button>
            </div>
          ) : null}
          {r.kind === "user" && !r.user.is_owner && r.user.status === "active" ? (
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push(`/org/users/${r.user.id}/revoke`)}>
                سحب الوصول
              </Button>
            </div>
          ) : null}
          {r.kind === "invitation" && r.inv.status === "expired" ? (
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => setFocus(r.inv)}>
                دعوة منتهية
              </Button>
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  const inviteButton = (
    <Button
      pos
      onClick={() => {
        setSent(null);
        setDup(null);
        setFocus(null);
        setOpen(true);
      }}
      disabledReason={data && !data.can_invite ? "الدعوة للمالك ومدير الفرع" : undefined}
    >
      دعوة مستخدم
    </Button>
  );

  return (
    <Frame title="المستخدمون" nav={<AppNav currentId="org-users" />} footer={null}>
      <div className="sys" data-screen="ORG-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">المستخدمون والدعوات</h2>
            <span className="cat-head__hint">من يدخل منشأتك وبأي دور. أربع حالات ناقصة.</span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب المستخدمين">
                <p className="acc-lead">
                  القائمة من الخادم دائماً لا من كاش — من يفتحها يسأل «من يدخل الآن؟».
                </p>
                {failed ? (
                  <Button variant="secondary" onClick={() => void load()}>
                    أعد المحاولة
                  </Button>
                ) : null}
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title="أنت وحدك">
                <p className="acc-lead">منشأة بمستخدم واحد. حالةٌ شائعة لا نقص.</p>
                <p className="acc-choice__note">
                  <strong>لا نُلحّ بالدعوة</strong> · «أنت المستخدم الوحيد» ومدخل الدعوة حاضر. كثير
                  من المحلات يديرها صاحبها وحده، ودعوة موظفٍ ليست هدفاً.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" && dup ? (
              <Notice
                kind="warning"
                title="دعوة لرقم مدعوّ أصلاً"
                action={
                  <>
                    <Button onClick={() => void act(dup, "resend")} loading={busy}>
                      أعد إرسالها
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void act(dup, "revoke")}
                      loading={busy}
                    >
                      ألغِها
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">الرقم عليه دعوة معلّقة لم تُقبل بعد.</p>
                <p className="acc-choice__note">
                  <strong>لا دعوة ثانية</strong> · نعرض الدعوة القائمة وتاريخها ومخرجَين: أعد
                  إرسالها أو ألغِها. دعوتان لرقم واحد تُربكان من يستقبلهما.
                </p>
                <p className="acc-choice__note">
                  دعوة — {dup.identifier_masked} · {dup.role_name} · {dup.branch_name} · أُرسلت{" "}
                  <span className="sting-mono">{ddmm(dup.sent_at)}</span>
                </p>
              </Notice>
            ) : null}

            {state === "expired" && focus ? (
              <Notice
                kind="warning"
                title="دعوة منتهية"
                action={
                  <Button onClick={() => void act(focus, "resend")} loading={busy}>
                    إصدار دعوة جديدة
                  </Button>
                }
              >
                <p className="acc-lead">
                  <strong>الدعوة المنتهية لا تُحيا بضغطة.</strong> نُصدر دعوة جديدة برابط جديد
                  وصلاحية جديدة، ويبقى أثر الدعوة الأولى ومن أرسلها. الرابط المنتهي لو استُعمل يعرض
                  «انتهت صلاحية الدعوة — اطلب دعوة جديدة من المالك» ولا يُنشئ حساباً معلّقاً.
                </p>
                <p className="acc-choice__note">
                  دعوة — {focus.identifier_masked} · {focus.role_name} · {focus.branch_name} ·
                  أُرسلت <span className="sting-mono">{ddmm(focus.sent_at)}</span>
                </p>
              </Notice>
            ) : null}

            {state === "success" && sent ? (
              <Notice
                kind="success"
                title="أُرسلت الدعوة"
                action={
                  <Button variant="secondary" onClick={() => setSent(null)}>
                    حسناً
                  </Button>
                }
              >
                <p className="acc-lead">
                  نقول ما سيملكه المدعوّ حين يقبل: الدور والفرع وما يستطيع فعله.
                </p>
                <p className="acc-choice__note">
                  دعوة — {sent.invitation.identifier_masked} · {sent.invitation.role_name} ·{" "}
                  {sent.invitation.branch_name} · الرابط صالح{" "}
                  <span className="sting-mono">{data?.invite_ttl_hours ?? 72}</span> ساعة
                </p>
                <ul className="acc-choice__note">
                  {sent.grants.map((g) => (
                    <li key={g}>
                      <MonoText text={g} />
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  <strong>الصلاحية تُراجَع قبل الإرسال</strong> · لا بعد القبول. تصحيحُ دورٍ بعد أن
                  دخل الموظف أصعب من ضبطه الآن.
                </p>
                <p className="acc-choice__note">
                  رابط الدعوة: <span className="sting-mono">{sent.link}</span>
                </p>
              </Notice>
            ) : null}

            {data ? (
              <div className="cat-head">
                <h3 className="cat-head__title">
                  المستخدمون — <span className="sting-mono">{data.counts.users}</span> · دعوات
                  مفتوحة <span className="sting-mono">{data.counts.open_invitations}</span>
                </h3>
                {inviteButton}
              </div>
            ) : null}
            {data && !alone ? (
              <>
                <Table
                  caption="المستخدمون والدعوات"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.key}
                />
                <p className="acc-choice__note">
                  <strong>الدعوة المنتهية لا تُحيا بضغطة.</strong> نُصدر دعوة جديدة برابط جديد
                  وصلاحية جديدة، ويبقى أثر الدعوة الأولى ومن أرسلها. الرابط المنتهي لو استُعمل يعرض
                  «انتهت صلاحية الدعوة — اطلب دعوة جديدة من المالك» ولا يُنشئ حساباً معلّقاً.
                </p>
              </>
            ) : null}

            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/org/roles")}>
                مصفوفة الأدوار والصلاحيات
              </Button>
            </div>
          </div>
        </div>

        <Dialog
          open={open}
          kind="form"
          title="دعوة مستخدم"
          onClose={() => setOpen(false)}
          primaryLabel="إرسال الدعوة"
          onPrimary={() => void submit()}
          saving={busy}
          error={invalid ?? undefined}
        >
          <TextField
            label="رقم الهاتف أو البريد"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <SelectField
            label="الدور"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            options={(data?.roles ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
          <SelectField
            label="الفرع"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={(data?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
          />
          <p className="acc-choice__note">
            الرابط صالح <span className="sting-mono">{data?.invite_ttl_hours ?? 72}</span> ساعة. حتى
            قبولها لا يوجد حساب ولا صلاحية ولا اسم في سجل التدقيق.
          </p>
        </Dialog>
      </div>
    </Frame>
  );
}
