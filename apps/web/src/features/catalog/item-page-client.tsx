"use client";

import { Frame } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

import {
  type GroupRow,
  type ItemCard,
  ItemForm,
  type ItemFormState,
  type UnitRow,
} from "./item-form";

/**
 * CAT-02 — إنشاء صنف وبطاقته (31-D23). أونلاين (§٨.١): الوحدات والمجموعات من الخادم؛ بطاقة صنف
 * قائم تُقرأ من `catalog/items/{id}` وتُعدَّل بالنموذج نفسه. الجذر يحمل الحالة الفعلية للنموذج.
 */
export function ItemPageClient({ itemId }: { itemId?: string | undefined }) {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [card, setCard] = useState<ItemCard | null>(null);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<ItemFormState>("ready");
  const next = itemId ? `/catalog/${itemId}` : "/catalog/new";

  useEffect(() => {
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    void (async () => {
      const [u, g] = await Promise.all([
        api().GET("/api/catalog/units"),
        api().GET("/api/catalog/groups"),
      ]);
      setUnits((u.data as unknown as { units?: UnitRow[] } | undefined)?.units ?? []);
      setGroups(
        ((g.data as unknown as { groups?: GroupRow[] } | undefined)?.groups ?? []).filter(
          (x) => x.id,
        ),
      );
      if (itemId) {
        const { data, response } = await api().GET("/api/catalog/items/{item_id}", {
          params: { path: { item_id: itemId } },
        });
        if (response.ok && data) setCard(data);
        else setMissing(true);
      }
    })().catch(() => setMissing(true));
  }, [app.expired, app.tokens, itemId, next, router]);

  const title = itemId ? (card ? card.name : "بطاقة الصنف") : "صنف جديد";
  const ready = units !== null && (!itemId || card !== null);

  return (
    <Frame title="الكتالوج" nav={<AppNav currentId="catalog" />} footer={null}>
      <div className="home" data-screen="CAT-02" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">{title}</h2>
          </div>
          <div className="acc-card__body">
            {missing ? (
              <p className="acc-lead">الصنف غير موجود</p>
            ) : ready ? (
              <ItemForm
                key={card?.id ?? "new"}
                mode={itemId ? "edit" : "create"}
                units={units}
                groups={groups}
                initial={card ?? undefined}
                initialName={params.get("name") ?? undefined}
                onState={setState}
              />
            ) : (
              <p className="acc-card__sub" role="status">
                جلب الأصناف
              </p>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
