"use client";

import {
  filterLocalItems,
  type LocalGroup,
  type LocalItem,
  readLocalGroups,
  readLocalItems,
} from "@sting/sync-core";
import { formatMinor, Frame, Notice, SelectField, Status, Table, TextField } from "@sting/ui-web";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "offline" | "stale";

/** «كغ · كرتونة = 12» — الوحدة الأساسية ثم الوحدات الإضافية بمعاملها (ميلي → عدد). */
function unitsText(i: LocalItem): React.ReactNode {
  const extra = i.units.map((u) => (
    <span key={u.unit_id}>
      {" "}
      · {u.name} = <span className="sting-mono">{Number(u.factor_milli) / 1000}</span>
    </span>
  ));
  return (
    <>
      {i.base_unit_name}
      {extra}
    </>
  );
}

/**
 * CAT-01. التخطيط من `05-D2#CAT-01`؛ الحالات من `38-D30#CAT-01`. المحلي أولاً: النسخة المحلية تُعرض
 * فوراً ثم تُطابَق؛ البحث فعّال أثناء التحميل؛ المعطَّل يبقى في الفواتير القديمة ولا يظهر افتراضياً (ACC-45).
 */
export function CatalogClient() {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const online = useOnline();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [groupId, setGroupId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [items, setItems] = useState<LocalItem[] | null>(null);
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [source, setSource] = useState<"local" | "server">("local");
  const [localAt, setLocalAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [skeletons, setSkeletons] = useState(7);
  const seq = useRef(0);

  useEffect(() => {
    if (!app.tokens && !app.expired) router.replace("/login?next=%2Fcatalog");
  }, [app.expired, app.tokens, router]);

  // المحلي أولاً
  useEffect(() => {
    void (async () => {
      const storage = getStorage();
      const [local, localGroups, cacheAt] = await Promise.all([
        readLocalItems(storage),
        readLocalGroups(storage),
        storage.read((tx) => tx.getMeta("home.cache")).catch(() => null),
      ]);
      if (local.length > 0) {
        setItems(local);
        setGroups(localGroups);
        setAllTotal(local.length);
        setSkeletons(Math.max(1, Math.min(local.length, 7)));
        if (cacheAt) setLocalAt((JSON.parse(cacheAt) as { savedAt: string }).savedAt);
      }
    })();
  }, []);

  // المطابقة مع الخادم — الكتابة تعيد الطلب لا تنتظره
  const fetchServer = useCallback(async () => {
    if (!online || !app.tokens) return;
    const mine = ++seq.current;
    try {
      const { data, response } = await api().GET("/api/catalog/items", {
        params: { query: { q, group_id: groupId, include_inactive: includeInactive } },
      });
      if (mine !== seq.current) return;
      if (!response.ok || !data) throw new Error("catalog_failed");
      const d = data as unknown as {
        items: (Omit<LocalItem, "id"> & { id: string })[];
        total: number;
        all_total: number;
        groups: { id: string; name: string }[];
      };
      setItems(d.items);
      setGroups(
        d.groups.map((g) => ({
          id: g.id,
          name: g.name,
          parent_id: "",
          parent_name: "",
          sort_order: 0,
          note: "",
        })),
      );
      setAllTotal(d.all_total);
      setSource("server");
      setFailed(false);
    } catch {
      if (mine === seq.current) setFailed(true);
    }
  }, [app.tokens, groupId, includeInactive, online, q]);

  useEffect(() => {
    void fetchServer();
  }, [fetchServer]);

  const shown = items
    ? source === "server"
      ? items
      : filterLocalItems(items, { q, groupId, includeInactive })
    : [];
  const state: State = !online
    ? "offline"
    : items === null
      ? "loading"
      : failed && source === "local"
        ? "stale"
        : shown.length === 0
          ? "empty"
          : "ready";
  const noItemsAtAll = allTotal === 0 && !q.trim();

  const columns = [
    {
      key: "name",
      header: "الصنف",
      render: (i: LocalItem) => (
        <div>
          <div style={{ fontWeight: 600 }}>{i.name}</div>
          <div className="acc-choice__note">{i.aliases.length ? i.aliases.join("، ") : "—"}</div>
        </div>
      ),
    },
    { key: "group", header: "المجموعة", render: (i: LocalItem) => i.group_name || "—" },
    { key: "units", header: "الوحدات", render: (i: LocalItem) => unitsText(i) },
    {
      key: "price",
      header: "سعر البيع",
      mono: true,
      render: (i: LocalItem) => (
        <>
          {formatMinor(i.sale_price_minor)}
          {state === "stale" && i.price_updated_at ? (
            <span className="acc-choice__note"> · {hhmm(i.price_updated_at)}</span>
          ) : null}
        </>
      ),
    },
    { key: "barcode", header: "الباركود", mono: true, render: (i: LocalItem) => i.barcode || "—" },
    {
      key: "status",
      header: "الحالة",
      render: (i: LocalItem) => (
        <Status
          state={i.is_active ? "ready" : "permission_denied"}
          label={i.is_active ? "نشط" : "معطَّل"}
          dot={false}
        />
      ),
    },
    {
      key: "open",
      header: "فتح",
      render: (i: LocalItem) => (
        <Link href={`/catalog/${i.id}`} className="c-btn c-btn--secondary">
          فتح
        </Link>
      ),
    },
  ];

  return (
    <Frame
      title="الكتالوج"
      nav={<AppNav currentId="catalog" />}
      footer={null}
      notice={
        !online ? (
          <Status state="offline" label="كتالوج محلي" />
        ) : state === "stale" ? (
          <Status state="stale" label="أسعار قد تكون قديمة" />
        ) : undefined
      }
    >
      <div className="home" data-screen="CAT-01" data-state={state}>
        <div className="cat-toolbar">
          <TextField
            label="بحث"
            placeholder="اسم الصنف أو الباركود"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            label="المجموعة"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            options={[
              { value: "", label: "كل المجموعات" },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
          <SelectField
            label="الحالة"
            value={includeInactive ? "all" : "active"}
            onChange={(e) => setIncludeInactive(e.target.value === "all")}
            options={[
              { value: "active", label: "النشط فقط" },
              { value: "all", label: "يشمل المعطَّل" },
            ]}
          />
          <Link href="/catalog/new" className="c-btn c-btn--primary">
            صنف جديد
          </Link>
          <Link href="/catalog/groups" className="c-btn c-btn--secondary">
            المجموعات
          </Link>
        </div>

        {state === "offline" ? (
          <Notice kind="offline" title="كتالوج محلي">
            <p className="acc-lead">
              الكتالوج مخزّن كاملاً على الجهاز، فالبحث والتصفّح يعملان بلا فرق.
            </p>
            <p className="acc-lead">
              <strong>ما لا يعمل</strong>: إنشاء صنف بصورة (الرفع يحتاج شبكة) — يُحفظ بلا صورة
              وتُرفع لاحقاً.
            </p>
          </Notice>
        ) : null}

        {state === "stale" ? (
          <Notice kind="warning" title="أسعار قد تكون قديمة">
            <p className="acc-lead">
              الكتالوج محلي من <span className="sting-mono">{localAt ? hhmm(localAt) : "—"}</span>،
              وقد يكون سعرٌ تغيّر في فرع آخر.
            </p>
          </Notice>
        ) : null}

        {state === "loading" ? (
          <p className="acc-card__sub" role="status">
            جلب الأصناف
          </p>
        ) : null}

        {state === "empty" ? (
          noItemsAtAll ? (
            <Notice
              kind="empty"
              title="كتالوج فارغ"
              action={
                <div className="acc-links">
                  <Link href="/catalog/new" className="c-btn c-btn--primary">
                    ابدأ بأصناف قطاعك
                  </Link>
                  <Link href="/catalog/import" className="c-btn c-btn--secondary">
                    استورد ملفاً
                  </Link>
                </div>
              }
            >
              <p className="acc-lead">محلٌّ جديد بلا أصناف</p>
            </Notice>
          ) : (
            <Notice
              kind="empty"
              title="بحث بلا تطابق"
              action={
                <Link
                  href={`/catalog/new?name=${encodeURIComponent(q)}`}
                  className="c-btn c-btn--primary"
                >
                  أنشئ صنفاً بهذا الاسم
                </Link>
              }
            >
              <p className="acc-lead">بحثٌ لم يطابق «{q}»</p>
            </Notice>
          )
        ) : null}

        <div className="cat-table">
          <Table
            caption="قائمة الأصناف"
            columns={columns}
            rows={shown}
            rowKey={(i) => i.id}
            loading={state === "loading" ? skeletons : undefined}
          />
          <div className="cat-foot">
            <span className="sting-mono">{allTotal}</span> صنفاً ·{" "}
            <span className="sting-mono">{shown.length}</span> معروضة · الصنف المعطَّل يبقى في
            الفواتير والتقارير القديمة ولا يظهر في البحث داخل نقطة البيع
          </div>
        </div>
      </div>
    </Frame>
  );
}
