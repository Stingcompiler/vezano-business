"use client";

import { itemMatches, type LocalItem } from "@sting/sync-core";
import { Button, Frame, Notice, SelectField, Table, TextField } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "validation_error" | "success";

interface GroupRow {
  readonly id: string;
  readonly name: string;
  readonly parent_name: string;
  readonly items: number;
  readonly aliases: readonly string[];
  readonly note: string;
}
interface Overview {
  readonly groups: readonly GroupRow[];
  readonly group_count: number;
  readonly total_items: number;
}
interface Taken {
  readonly alias: string;
  readonly owner_item_id: string;
  readonly owner_item_name: string;
}

/**
 * CAT-06. الجدول من `31-D23#CAT-06`. المجموعة تصنيف للعرض والتقرير لا تحمل سعراً؛ الاسم البديل مفتاح
 * بحث يفتح صنفاً واحداً — إن كان مأخوذاً نُسمّي الصنف المالك ونضع رابطاً إليه؛ النجاح يُثبت بالتجربة.
 */
export function GroupsClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [groupName, setGroupName] = useState("");
  const [taken, setTaken] = useState<Taken | null>(null);
  const [added, setAdded] = useState<{ aliases: string[]; item: string } | null>(null);
  const [tryQ, setTryQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [g, it] = await Promise.all([
      api().GET("/api/catalog/groups"),
      api().GET("/api/catalog/items", { params: { query: { include_inactive: false } } }),
    ]);
    if (g.data) setData(g.data as unknown as Overview);
    if (it.data) setItems((it.data as unknown as { items: LocalItem[] }).items);
  }, []);

  useEffect(() => {
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fcatalog%2Fgroups");
      return;
    }
    void load().catch(() => undefined);
  }, [app.expired, app.tokens, load, router]);

  const addAliases = async () => {
    const aliases = aliasText
      .split(/[،,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!itemId || aliases.length === 0 || busy) return;
    setBusy(true);
    setTaken(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api().POST("/api/catalog/items/{item_id}/aliases", {
        params: { path: { item_id: itemId } },
        body: { aliases },
      });
      if (response.status === 409 && error) {
        setTaken(error);
        return;
      }
      if (response.ok && d) {
        const item = items.find((i) => i.id === itemId);
        setAdded({ aliases, item: item?.name ?? "" });
        setAliasText("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim() || busy) return;
    setBusy(true);
    try {
      const { response } = await api().POST("/api/catalog/groups", {
        body: { name: groupName.trim() },
      });
      if (response.ok) {
        setGroupName("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = taken
    ? "validation_error"
    : added
      ? "success"
      : data && data.group_count === 0
        ? "empty"
        : "ready";
  const tried = tryQ.trim() ? items.filter((i) => itemMatches(i, tryQ)).slice(0, 5) : [];
  // اقتراح مجموعات شائعة يُبنى من أسماء الأصناف الموجودة فعلاً (أول كلمة متكرّرة)
  const suggestions = [...new Set(items.map((i) => i.name.split(" ")[0] ?? ""))]
    .filter((w) => w.length > 2 && items.filter((i) => i.name.startsWith(w)).length > 1)
    .slice(0, 4);

  const columns = [
    {
      key: "name",
      header: "المجموعة",
      render: (g: GroupRow) => (
        <div>
          <div style={{ fontWeight: 600 }}>{g.name}</div>
          <div className="acc-choice__note">{g.parent_name ? <>ضمن: {g.parent_name}</> : "—"}</div>
        </div>
      ),
    },
    { key: "items", header: "أصناف", mono: true, render: (g: GroupRow) => String(g.items) },
    {
      key: "aliases",
      header: "أسماء بديلة مسجّلة",
      render: (g: GroupRow) => (
        <div>
          {g.aliases.map((a) => (
            <span key={a} className="cat-chip">
              {a}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "note",
      header: "ملاحظة",
      render: (g: GroupRow) => (
        <span className="acc-choice__note">
          {g.note ||
            (g.id
              ? ""
              : "الأصناف تعمل وتُباع بلا مجموعة. المجموعة راحةٌ في العرض والتقرير، لا شرطُ صحّة.")}
        </span>
      ),
    },
  ];

  return (
    <Frame title="الكتالوج" nav={<AppNav currentId="catalog" />} footer={null}>
      <div className="home" data-screen="CAT-06" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">
              المجموعات — <span className="sting-mono">{data?.group_count ?? 0}</span> مجموعات ·{" "}
              <span className="sting-mono">{data?.total_items ?? 0}</span> صنفاً
            </h2>
            <span className="cat-head__hint">الترتيب يغيّر العرض في نقطة البيع فقط</span>
          </div>

          {state === "empty" && data ? (
            <div className="acc-card__body">
              <Notice
                kind="empty"
                title="لا مجموعات بعد"
                action={
                  <Button
                    onClick={() => void createGroup()}
                    disabledReason={groupName.trim() ? undefined : "المجموعة"}
                  >
                    مجموعة جديدة
                  </Button>
                }
              >
                <p className="acc-lead">
                  كتالوج فيه <span className="sting-mono">{data.total_items}</span> صنفاً وصفر
                  مجموعة. هذه ليست حالة عطب: البيع يعمل والبحث يعمل والجرد يعمل.
                </p>
                <p className="acc-lead">
                  ما الذي ستكسبه: عرضٌ أسرع للكاشير، وتقرير مبيعات بالفئة بدل قائمة أصناف طويلة.
                </p>
                <div className="cat-alias-form">
                  <TextField
                    label="المجموعة"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                  />
                </div>
                {suggestions.length ? (
                  <div className="acc-links">
                    {suggestions.map((s) => (
                      <Button key={s} variant="secondary" onClick={() => setGroupName(s)}>
                        {s}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </Notice>
            </div>
          ) : (
            <Table
              caption="المجموعات"
              columns={columns}
              rows={data?.groups ?? []}
              rowKey={(g) => g.id || "ungrouped"}
              loading={data ? undefined : 6}
            />
          )}
        </div>

        <div className="acc-card" style={{ inlineSize: "100%" }}>
          <div className="acc-card__body">
            {state === "validation_error" && taken ? (
              <Notice kind="error" title="الاسم البديل مأخوذ">
                <p className="acc-lead">
                  «{taken.alias}» مسجّل على «{taken.owner_item_name}».
                </p>
                <div className="acc-links">
                  <Link href={`/catalog/${taken.owner_item_id}`} className="c-btn c-btn--secondary">
                    {taken.owner_item_name}
                  </Link>
                </div>
                <p className="acc-lead"></p>
                <p className="acc-lead">انقل الاسم من الصنف الآخر، أو اكتب اسماً يميّز</p>
              </Notice>
            ) : null}
            {state === "success" && added ? (
              <Notice
                kind="success"
                title={added.aliases.length === 2 ? "أُضيف اسمان بديلان" : "أُضيف اسم بديل"}
              >
                <p className="acc-lead">
                  سُجّل {added.aliases.map((a) => `«${a}»`).join(" و")} على «{added.item}». الأثر
                  فوري في بحث نقطة البيع وفي البحث العام معاً.
                </p>
                <p className="acc-lead">اسم الصنف على الفاتورة يبقى «{added.item}».</p>
                <div className="cat-alias-form">
                  <TextField
                    label="جرّبه الآن"
                    value={tryQ}
                    onChange={(e) => setTryQ(e.target.value)}
                  />
                </div>
                {tried.length ? (
                  <ul className="acc-steps">
                    {tried.map((i) => (
                      <li key={i.id}>
                        <span>{i.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}
            <div className="cat-alias-form">
              <SelectField
                label="الصنف"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                options={[
                  { value: "", label: "" },
                  ...items.map((i) => ({ value: i.id, label: i.name })),
                ]}
              />
              <TextField
                label="أسماء بديلة"
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
                hint="افصل بينها بفاصلة"
              />
              <Button
                onClick={() => void addAliases()}
                loading={busy}
                disabledReason={itemId && aliasText.trim() ? undefined : "الصنف"}
              >
                تسجيل اسم بديل
              </Button>
            </div>
            {state !== "empty" ? (
              <div className="cat-alias-form">
                <TextField
                  label="مجموعة جديدة"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => void createGroup()}
                  loading={busy}
                  disabledReason={groupName.trim() ? undefined : "المجموعة"}
                >
                  مجموعة جديدة
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
