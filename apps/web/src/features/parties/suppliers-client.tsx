"use client";

import {
  type LocalParty,
  maskPhone,
  readLocalParties,
  type ServerParty,
  storeParties,
} from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/parties/parties.css";
import { PosNav } from "@/features/pos/pos-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "permission_denied";

interface ListData {
  readonly kind: "customers" | "suppliers";
  readonly can_see_balances: boolean;
  readonly role_name: string;
  readonly as_of: string;
  readonly rows: readonly ServerParty[];
  readonly summary: { readonly count: number; readonly total_owed_minor: string };
}

interface Row {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly owedMinor: string;
  readonly linked: boolean;
}

/**
 * PTY-02 — قائمة الموردين (04-D2 ready · 40-D32 loading/empty/permission_denied): سجلات داخلية
 * خاصة بك — المورد لا يصبح صفحة في السوق تلقائياً (ACC-118)؛ المستحقّ عليك لهم لمن يرى المال،
 * وأمين المخزن يرى الأسماء ليستلم منهم.
 */
export function SuppliersClient() {
  const router = useRouter();
  const app = useApp();
  const [local, setLocal] = useState<readonly LocalParty[] | null>(null);
  const [data, setData] = useState<ListData | null>(null);
  const [failed, setFailed] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fparties%2Fsuppliers");
      return;
    }
    void (async () => {
      const storage = getStorage();
      setLocal(await readLocalParties(storage));
      if (!navigator.onLine) {
        setFailed(true);
        return;
      }
      try {
        const { data, response } = await api().GET("/api/parties/list", {
          params: { query: { kind: "suppliers" } },
        });
        const body = data as unknown as ListData | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        await storeParties(storage, body.rows, body.as_of);
        setData(body);
        setLocal(await readLocalParties(storage));
      } catch {
        setFailed(true);
      }
    })();
  }, [router]);

  const canSee = data?.can_see_balances ?? false;
  const rows: Row[] = (local ?? [])
    .filter((p) => p.is_active !== false && p.is_supplier)
    .map((p) => {
      const sp = p as LocalParty & { supplier_owed_minor?: string; market_linked?: boolean };
      return {
        id: p.id,
        name: p.name,
        phone: p.phone,
        owedMinor: sp.supplier_owed_minor ?? "",
        linked: Boolean(sp.market_linked),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  const state: State =
    local === null || (data === null && !failed)
      ? "loading"
      : data && !data.can_see_balances
        ? "permission_denied"
        : rows.length === 0
          ? "empty"
          : "ready";

  const columns = [
    {
      key: "name",
      header: "المورد",
      render: (r: Row) => (
        <Button variant="quiet" className="shift-row__open" onClick={() => open(r)}>
          {r.name}
        </Button>
      ),
    },
    { key: "phone", header: "الهاتف", mono: true, render: (r: Row) => maskPhone(r.phone) || "—" },
    {
      key: "owed",
      header: "له علينا",
      mono: true,
      render: (r: Row) => (canSee && r.owedMinor ? formatMinor(r.owedMinor) : "—"),
    },
    {
      key: "link",
      header: "صلة السوق",
      render: (r: Row) => (
        <Status
          state={r.linked ? "synced" : "empty"}
          label={r.linked ? "مرتبط بمنشأة سوق" : "سجل داخلي فقط"}
          dot={false}
        />
      ),
    },
    {
      key: "statement",
      header: "كشف الحساب",
      render: (r: Row) => (
        <Button variant="secondary" onClick={() => open(r)}>
          كشف الحساب
        </Button>
      ),
    },
  ];

  const open = (r: Row) => router.push(`/parties/${r.id}/statement`);

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={canSee} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قائمة الموردين</h2>
            <span className="cat-head__hint">
              سجلات داخلية خاصة بك. المورد هنا لا يصبح صفحة في السوق تلقائياً — ACC-118.
            </span>
          </div>
          <div className="acc-card__body">
            <p className="acc-lead">
              هذه سجلات موردين داخلية في دفترك. نشر أي منها كمنشأة في السوق يحتاج موافقة صريحة
              وتحققاً منفصلاً في MP-08.
            </p>
            <div className="pty-actions">
              <Button variant="quiet" onClick={() => router.push("/parties")}>
                قائمة العملاء
              </Button>
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جلب الموردين">
                <p className="acc-lead">مع المستحقّ عليك لهم — وهو سبب فتح الشاشة غالباً.</p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا موردين">
                <p className="acc-lead">الشراء نقدي بلا حساب مفتوح.</p>
                <p className="acc-choice__note">
                  <strong>المسار</strong> · يُنشأ المورد عند أول استلام بضاعة (INV-04) أو أمر شراء.
                  لا نطلب تسجيلاً مسبقاً.
                </p>
              </Notice>
            ) : null}
            {state === "permission_denied" ? (
              <Notice kind="locked" title="أمين المخزن يرى الأسماء">
                <p className="acc-lead">يرى الموردين ليستلم منهم، ولا يرى ما لهم على المنشأة.</p>
                <p className="acc-choice__note">
                  <strong>الحدّ</strong> · عمله عدُّ ما وصل لا مطابقة المبالغ. والمستحقّ يقود إلى
                  التكلفة.
                </p>
              </Notice>
            ) : null}

            <Table
              caption="الموردون"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={state === "loading" && rows.length === 0 ? 3 : undefined}
              onOpenRow={open}
            />
          </div>
        </div>
      </div>
    </Frame>
  );
}
