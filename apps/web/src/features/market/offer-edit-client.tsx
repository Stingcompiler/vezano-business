"use client";

import {
  Button,
  formatMinor,
  Frame,
  Notice,
  RadioGroupField,
  SelectField,
  TextAreaField,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import type { Offer } from "@/features/market/offers-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "saving" | "permission_denied" | "success";

interface ItemOpt {
  id: string;
  name: string;
  base_unit_code: string;
  base_unit_name: string;
  units: { code: string; name: string; factor_milli: string }[];
}

interface Preview {
  card: { title: string; seller_line: string; price_minor: string; price_line: string };
  published_fields: { title: string; hint: string }[];
  missing: { key: string; title: string; hint: string }[];
  hidden_fields: { title: string; hint: string }[];
  can_publish: boolean;
  seller_verified: boolean;
  plan_allows: boolean;
}

interface Form {
  item_id: string;
  public_name: string;
  description: string;
  unit_code: string;
  pack_label: string;
  price: string;
  min_order_qty: string;
  max_order_qty: string;
  fulfilment_note: string;
  audience: "public" | "private" | "followers";
  valid_until: string;
}

const EMPTY: Form = {
  item_id: "",
  public_name: "",
  description: "",
  unit_code: "",
  pack_label: "",
  price: "",
  min_order_qty: "",
  max_order_qty: "",
  fulfilment_note: "",
  audience: "public",
  valid_until: "",
};

const countWord = (n: number) =>
  n === 1 ? "حقل ناقص" : n === 2 ? "حقلان ناقصان" : `${n} حقول ناقصة`;

/** MP-11 — إنشاء عرض ونشره (08-D4 validation_error · 43-D35 ready/saving/permission_denied/success). */
export function OfferEditClient({ id }: { id?: string }) {
  const router = useRouter();
  const app = useApp();
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [published, setPublished] = useState<Offer | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(
        `/login?next=${encodeURIComponent(id ? `/market/offers/${id}` : "/market/offers/new")}`,
      );
      return;
    }
    void (async () => {
      const i = await api().GET("/api/catalog/items", { params: { query: {} } });
      const ib = i.data as unknown as { items: ItemOpt[] } | undefined;
      if (ib) setItems(ib.items);
      if (id) {
        const { data, response } = await api().GET("/api/market/offers/{offer_id}", {
          params: { path: { offer_id: id } },
        });
        const body = data as unknown as { offer: Offer } | undefined;
        if (response.ok && body) {
          const o = body.offer;
          setForm({
            item_id: o.item_id,
            public_name: o.public_name,
            description: o.description,
            unit_code: o.unit_code,
            pack_label: o.pack_label,
            price: o.price_minor ? formatMinor(o.price_minor).replace(/,/g, "") : "",
            min_order_qty: o.min_order_qty ? String(o.min_order_qty) : "",
            max_order_qty: o.max_order_qty ? String(o.max_order_qty) : "",
            fulfilment_note: o.fulfilment_note,
            audience: o.audience,
            valid_until: o.valid_until,
          });
        }
      }
    })().catch(() => undefined);
  }, [router, id]);

  const body = useCallback(
    (f: Form) => ({
      item_id: f.item_id,
      public_name: f.public_name,
      description: f.description,
      unit_code: f.unit_code,
      unit_name: (() => {
        const it = items.find((x) => x.id === f.item_id);
        if (!it) return "";
        if (it.base_unit_code === f.unit_code) return it.base_unit_name;
        return it.units.find((u) => u.code === f.unit_code)?.name ?? "";
      })(),
      pack_label: f.pack_label,
      price_minor: f.price ? String(Math.round(Number(f.price) * 100)) : "",
      min_order_qty: f.min_order_qty,
      max_order_qty: f.max_order_qty,
      fulfilment_note: f.fulfilment_note,
      audience: f.audience,
      valid_until: f.valid_until,
    }),
    [items],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      void api()
        .POST("/api/market/offers/preview", { body: body(form) as never })
        .then(({ data, response }) => {
          const p = data as unknown as Preview | undefined;
          if (response.ok && p) setPreview(p);
        })
        .catch(() => undefined);
    }, 150);
    return () => clearTimeout(t);
  }, [form, body]);

  const save = async (publish: boolean) => {
    if (saving) return;
    setAttempted(publish);
    if (publish && preview && preview.missing.length) return;
    setSaving(true);
    try {
      const payload = { ...body(form), publish };
      const r = id
        ? await api().PUT("/api/market/offers/{offer_id}", {
            params: { path: { offer_id: id } },
            body: payload as never,
          })
        : await api().POST("/api/market/offers", { body: payload as never });
      const b = r.data as unknown as { offer: Offer } | undefined;
      if (r.response.ok && b) {
        if (publish) setPublished(b.offer);
        else router.push("/market/offers");
      }
    } finally {
      setSaving(false);
    }
  };

  const item = items.find((x) => x.id === form.item_id);
  const missingCount = preview?.missing.length ?? 0;
  const state: State = published
    ? "success"
    : saving
      ? "saving"
      : preview && !preview.can_publish
        ? "permission_denied"
        : attempted && missingCount
          ? "validation_error"
          : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-offers" />} footer={null}>
      <div className="sys mp" data-screen="MP-11" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">إنشاء عرض — النشر اختيار حقول لا تصدير مخزون</h2>
            <span className="cat-head__hint">
              صنف يُختار لا مخزون يُنشر: العرض يبدأ باختيار صنفٍ من كتالوجك، وتُعرض قائمة الحقول
              التي ستُنشر منه حرفياً.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && published ? (
              <Notice
                kind="success"
                title="نُشر العرض"
                action={
                  <Button pos onClick={() => router.push("/market/offers")}>
                    كما يراه المشتري — عروضي
                  </Button>
                }
              >
                <p className="acc-lead">بسعرٍ وصلاحية معلنة وجمهور — ورابط «كما يراه المشتري».</p>
                <p className="acc-choice__note">
                  <strong>الصلاحية تبدأ الآن</strong> · وتنتهي بتاريخها ما لم تُجدَّد صريحاً. النشر
                  ليس التزاماً أبدياً — وانتهاؤه ليس عطلاً.
                </p>
              </Notice>
            ) : null}

            {state === "saving" ? (
              <Notice kind="info" title="حفظ المسودة">
                <p className="acc-lead">المسودة عندك ولا يراها السوق حتى تُنشر صريحاً.</p>
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="locked" title="التحرير غير النشر">
                <p className="acc-lead">
                  ناشر الكتالوج يحرّر المسودة، والنشر النهائي بصلاحية أعلى إن ضُبط كذلك في «الأدوار
                  والصلاحيات».
                </p>
                <p className="acc-choice__note">
                  <strong>فصل مقصود</strong> · سعرٌ يخرج للسوق باسم المنشأة التزامٌ تجاري — الفصل
                  بين من يكتب ومن يعتمد قاعدةُ السجل نفسها.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" && preview ? (
              <Notice kind="error" title={`${countWord(missingCount)} يمنعان النشر`}>
                <p className="acc-lead">
                  {preview.missing.map((m) => m.title).join(" و")}. بدونهما يصل المشتري إلى سلة لا
                  يعرف فيها ما يشتري، ويصل إليك طلب لا تستطيع تنفيذه.
                </p>
              </Notice>
            ) : null}

            {state !== "success" ? (
              <>
                <h3 className="cat-head__title">
                  عرض جديد{form.public_name ? ` — ${form.public_name}` : ""}
                </h3>
                <p className="acc-choice__note">
                  <strong>لا نشر كل المخزون</strong> · زرّ «انشر الكتالوج كله» غير موجود عمداً —
                  النشر قرارٌ صنفاً صنفاً بسعرٍ مقصود. والرصيد الداخلي لا يُنشر أبداً.
                </p>
                <SelectField
                  label="الصنف من كتالوجك"
                  value={form.item_id}
                  onChange={(e) => {
                    const it = items.find((x) => x.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      item_id: e.target.value,
                      public_name: f.public_name || (it?.name ?? ""),
                      unit_code: "",
                    }));
                  }}
                  options={[
                    { value: "", label: "— اختر —" },
                    ...items.map((i) => ({ value: i.id, label: i.name })),
                  ]}
                />
                <TextField
                  label="الاسم المصرَّح به"
                  value={form.public_name}
                  onChange={(e) => setForm((f) => ({ ...f, public_name: e.target.value }))}
                  hint="نص منفصل عن اسمك الداخلي — تعدّله للسوق دون تغيير بطاقتك"
                />
                <TextAreaField
                  label="الوصف المصرَّح به"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
                <SelectField
                  label="وحدة البيع"
                  value={form.unit_code}
                  onChange={(e) => setForm((f) => ({ ...f, unit_code: e.target.value }))}
                  options={[
                    { value: "", label: "— الوحدة —" },
                    ...(item
                      ? [
                          { value: item.base_unit_code, label: item.base_unit_name },
                          ...item.units.map((u) => ({ value: u.code, label: u.name })),
                        ]
                      : []),
                  ]}
                  error={
                    attempted && !form.unit_code
                      ? "مطلوب — بدونها لا تظهر البطاقة في المقارنة"
                      : undefined
                  }
                />
                <TextField
                  label="العبوة"
                  value={form.pack_label}
                  onChange={(e) => setForm((f) => ({ ...f, pack_label: e.target.value }))}
                  hint="مثال: كرتونة 12×1كغ"
                />
                <TextField
                  label="السعر للوحدة"
                  mono
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  hint="اتركه فارغاً ليظهر «اطلب تأكيد سعر»"
                />
                <TextField
                  label="حد أدنى للطلب"
                  mono
                  value={form.min_order_qty}
                  onChange={(e) => setForm((f) => ({ ...f, min_order_qty: e.target.value }))}
                  error={
                    attempted && !form.min_order_qty
                      ? "مطلوب — يحدد ما تستطيع تنفيذه فعلاً"
                      : undefined
                  }
                />
                <TextField
                  label="حد أقصى للطلب"
                  mono
                  value={form.max_order_qty}
                  onChange={(e) => setForm((f) => ({ ...f, max_order_qty: e.target.value }))}
                  hint="اختياري — يُعرض بدل الكمية الفعلية"
                />
                <TextField
                  label="المنطقة وطريقة التنفيذ"
                  value={form.fulfilment_note}
                  onChange={(e) => setForm((f) => ({ ...f, fulfilment_note: e.target.value }))}
                  hint="توصيل داخل المنطقة أو استلام من المخزن"
                />
                <TextField
                  label="سارٍ حتى"
                  kind="date"
                  mono
                  value={form.valid_until}
                  onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
                  hint="فارغ = 14 يوماً من النشر"
                />
                <RadioGroupField
                  label="الجمهور"
                  name="audience"
                  value={form.audience}
                  onChange={(v) => setForm((f) => ({ ...f, audience: v as Form["audience"] }))}
                  options={[
                    {
                      value: "public",
                      label: "عام — كل من يبحث في السوق",
                      hint: "السعر يظهر فقط إن اخترت سعراً عاماً. غير ذلك يظهر «اطلب تأكيد سعر».",
                    },
                    {
                      value: "private",
                      label: "قائمة خاصة — مشترون مخوَّلون",
                      hint: "منشأة ثالثة لا ترى هذا السعر ولا تعرف بوجوده. الرفض عام بلا تسريب.",
                    },
                    {
                      value: "followers",
                      label: "متابعو منشأتك فقط",
                      hint: "المتابعة اشتراك B2B مستقل، وإلغاؤه لا يمحو أحداث الطلبات السابقة.",
                    },
                  ]}
                />

                {preview ? (
                  <div className="mp-preview" aria-label="معاينة البطاقة العامة">
                    <div className="acc-choice__head">
                      <strong>معاينة البطاقة العامة</strong>
                      <span className="acc-choice__note">معاينة عامة.</span>
                    </div>
                    <p className="acc-choice__note">
                      ما يراه غير المدعوّ: الصنف والوحدة والمنطقة وشروط الخدمة. لا يرى سعرك الخاص
                      ولا اسم المشتري المخوَّل ولا رصيد مخزونك.
                    </p>
                    <h3 className="cat-head__title">{preview.card.title || "—"}</h3>
                    <div className="cus-sub">{preview.card.seller_line}</div>
                    <div>
                      {preview.card.price_minor ? (
                        <span className="sting-mono">{formatMinor(preview.card.price_minor)}</span>
                      ) : (
                        preview.card.price_line
                      )}
                    </div>
                    <div className="acc-choice__head">
                      <strong>ما يُنشر من بطاقة الصنف الداخلية</strong>
                    </div>
                    <ul className="mp-check">
                      {preview.published_fields.map((f) => (
                        <li key={f.title}>
                          <span>
                            <strong>{f.title}</strong>
                            <div className="mp-check__hint">{f.hint}</div>
                          </span>
                          <span className="acc-choice__note">يُنشر</span>
                        </li>
                      ))}
                      {preview.missing.map((f) => (
                        <li key={f.key}>
                          <span>
                            <strong>{f.title}</strong>
                            <div className="mp-check__hint">{f.hint}</div>
                          </span>
                          <span className="mp-reason">ناقص</span>
                        </li>
                      ))}
                      {preview.hidden_fields.map((f) => (
                        <li key={f.title}>
                          <span>
                            <strong>{f.title}</strong>
                            <div className="mp-check__hint">{f.hint}</div>
                          </span>
                          <span className="acc-choice__note">محجوب</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="acc-actions">
                  <Button
                    pos
                    onClick={() => void save(true)}
                    loading={saving}
                    disabledReason={
                      preview && !preview.can_publish
                        ? "النشر النهائي بصلاحية أعلى — ناشر الكتالوج يحرّر المسودة"
                        : preview && !preview.seller_verified
                          ? "النشر بعد اعتماد دور البائع"
                          : undefined
                    }
                  >
                    {missingCount ? `نشر — ${countWord(missingCount)}` : "نشر"}
                  </Button>
                  <Button onClick={() => void save(false)} loading={saving}>
                    حفظ كمسودة
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/market/offers")}>
                    رجوع
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
