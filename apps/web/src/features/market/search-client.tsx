"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { dayMonth } from "@/features/home/format";
import type { OfferCard } from "@/features/market/home-client";
import { readArea, readSnapshot, writeArea, writeSnapshot } from "@/features/market/market-store";
import { api } from "@/lib/api";
import { useOnline } from "@/lib/online";

type State = "loading" | "ready" | "empty" | "stale" | "partial";

interface Row extends OfferCard {
  unit_price_minor: string;
  base_unit_name: string;
  fees_decided: boolean;
  fees_label: string;
  min_order_label: string;
  expired: boolean;
  expired_yesterday: boolean;
  ranked: boolean;
}

interface Group {
  label: string;
  count: number;
  rankable: number;
  offers: Row[];
}

interface Result {
  q: string;
  area: string;
  groups: Group[];
  offers_count: number;
  suppliers_count: number;
  multi_unit: boolean;
  all_areas_count: number;
  fetched_at: string;
}

const SNAP = "market.search";
const offersWord = (n: number) =>
  n === 1 ? "عرض واحد" : n === 2 ? "عرضان" : n <= 10 ? `${n} عروض` : `${n} عرضاً`;
const suppliersWord = (n: number) =>
  n === 1 ? "مورد واحد" : n === 2 ? "موردين" : n <= 10 ? `${n} موردين` : `${n} مورداً`;
const untilWord = (dateIso: string) => {
  const { day, month } = dayMonth(`${dateIso}T12:00:00`);
  return `${day} ${month}`;
};

/** MP-04 — نتائج بحث المنتجات والمقارنة (43-D35 ready/loading/empty/stale · 08-D4 partial): بوحدة واحدة أو لا مقارنة. */
export function SearchClient() {
  const router = useRouter();
  const params = useSearchParams();
  const online = useOnline();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [area, setArea] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [snapshot, setSnapshot] = useState<{ at: string; data: Result } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setArea(readArea());
    setSnapshot(readSnapshot<Result>(SNAP));
  }, []);

  const load = useCallback(async (query: string, a: string) => {
    setFailed(false);
    try {
      const { data, response } = await api().GET("/api/public/market/search", {
        params: { query: { q: query, area: a } },
      });
      const body = data as unknown as Result | undefined;
      if (response.ok && body) {
        setData(body);
        writeSnapshot(SNAP, body);
        setSnapshot({ at: new Date().toISOString(), data: body });
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => void load(q, area), 150);
    return () => clearTimeout(t);
  }, [q, area, online, load]);

  const shown = data ?? (failed || !online ? (snapshot?.data ?? null) : null);
  const state: State =
    !online || (failed && shown)
      ? "stale"
      : !shown
        ? "loading"
        : shown.offers_count === 0
          ? "empty"
          : shown.multi_unit
            ? "partial"
            : "ready";

  return (
    <Frame title="السوق" footer={null}>
      <div className="sys mp cus" data-screen="MP-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              نتائج البحث والمقارنة — لا «الأرخص» عند اختلاف الوحدة
            </h2>
            <span className="cat-head__hint">
              كرتونة ١٢ عند مورد وكرتونة ٢٤ عند آخر. من يقارن سعرَي الكرتونتين يشتري الأغلى وهو يظن
              أنه وفّر — الشاشة تحسب سعر الوحدة الأساسية وتسمّي ما لا يُعرف.
            </span>
          </div>
          <div className="acc-card__body">
            <TextField
              label="ابحث عن صنف أو مورد"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {shown ? (
              <p className="acc-choice__note">
                {area ? `${area} · ` : ""}
                {offersWord(shown.offers_count)} منشوراً من {suppliersWord(shown.suppliers_count)}
              </p>
            ) : null}

            {state === "loading" ? (
              <Notice kind="info" title="النتائج تُجمع">
                <p className="acc-lead">
                  العدّ والمرشّحات أولاً، والعروض تلحق — ولا يُعرض ترتيبٌ قبل اكتمال ما سيُرتَّب.
                </p>
                <p className="acc-choice__note">
                  <strong>لا ترتيب جزئي</strong> · «الأوفر» من نصف النتائج ادعاءٌ يتغيّر بعد ثانية.
                  الترتيب يُعلن مكتملاً أو لا يُعلن.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && shown ? (
              <Notice kind="empty" title="لا عروض مطابقة">
                <p className="acc-lead">الصنف غير معروض في منطقتك أو الفئة أضيق من اللازم.</p>
                <p className="acc-choice__note">
                  <strong>التوسيع بعدده</strong> · أزرار بأثر معدود لا نصيحة عامة.
                </p>
                <div className="acc-actions">
                  {area ? (
                    <Button
                      onClick={() => {
                        setArea("");
                        writeArea("");
                      }}
                    >
                      كل المناطق ({offersWord(shown.all_areas_count)})
                    </Button>
                  ) : null}
                  <Button onClick={() => setQ("")}>
                    فئة أوسع ({offersWord(shown.all_areas_count)})
                  </Button>
                </div>
              </Notice>
            ) : null}
            {state === "stale" ? (
              <Notice kind="warning" title="نتائج من آخر جلب">
                <p className="acc-lead">الاتصال تقطّع بعد البحث.</p>
                <p className="acc-choice__note">
                  <strong>المنتهي يسقط أولاً</strong> · كل عرض تجاوزت صلاحيتُه وقتَ الكاش يُستبعد من
                  الترتيب فوراً — نعرض أقلّ ولا نعرض ميتاً (ACC-143).
                </p>
              </Notice>
            ) : null}
            {state === "partial" && shown ? (
              <Notice kind="warning" title="ترتيب موقوف">
                <p className="acc-lead">
                  {shown.groups.length === 2
                    ? "نتائجك بوحدتين مختلفتين، فلا يوجد «الأرخص»."
                    : "نتائجك بثلاث وحدات مختلفة، فلا يوجد «الأرخص»."}
                </p>
                <p className="acc-choice__note">
                  {shown.groups.map((g) => g.label).join(" و")} لا تُقارن برقم واحد، والرسوم غير
                  محسومة في بعض العروض. الترتيب بسعر الوحدة متاح داخل كل مجموعة وحدة على حدة.
                </p>
              </Notice>
            ) : null}
            {state === "ready" ? (
              <p className="acc-choice__note">
                <strong>الترتيب: سعر العبوة الواحدة</strong> · لا شارة «الأرخص» في الشاشة كلها حين
                تكون رسوم النقل غير محسومة — نرتّب بسعر العبوة ونسمّي المجهول «رسوم تُحدَّد عند
                الطلب» بدل أن نطمسه في مجموعٍ مُدّعى (ACC-122). والسعر المعروض من آخر تأكيد خادمي —
                والمنتهي لا يدخل الترتيب أصلاً.
              </p>
            ) : null}

            {shown && shown.offers_count
              ? shown.groups.map((g) => (
                  <div key={g.label}>
                    <div className="acc-choice__head">
                      <strong>{g.label}</strong>
                      <span className="acc-choice__note">
                        {offersWord(g.count)} ·{" "}
                        {g.rankable
                          ? shown.multi_unit
                            ? "قابلة للترتيب"
                            : "الترتيب داخل المجموعة"
                          : "خارج الترتيب"}
                        {shown.multi_unit && !g.rankable ? " · مجموعة مستقلة" : ""}
                      </span>
                    </div>
                    <table className="pur-lines">
                      <thead>
                        <tr>
                          <th scope="col">المورد والعرض</th>
                          <th scope="col">سعر الوحدة</th>
                          <th scope="col">سعر العبوة</th>
                          <th scope="col">الرسوم والتوصيل</th>
                          <th scope="col">تأكيد السعر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.offers.map((o) => (
                          <tr key={o.id} className={o.expired ? "cus-item--expired" : undefined}>
                            <td>
                              <Button
                                variant="quiet"
                                onClick={() =>
                                  router.push(`/market/suppliers/${o.seller_tenant_id}`)
                                }
                              >
                                {o.seller_name}
                              </Button>
                              <div className="mp-check__hint">
                                {o.public_name} · {o.pack_label || o.unit_name} ·{" "}
                                {o.min_order_label}
                              </div>
                            </td>
                            <td>
                              {o.unit_price_minor && !o.expired ? (
                                <>
                                  <span className="sting-mono">
                                    {formatMinor(o.unit_price_minor)}
                                  </span>{" "}
                                  /{o.base_unit_name}
                                  {!o.fees_decided ? (
                                    <div className="mp-reason">قبل الرسوم</div>
                                  ) : null}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              {o.price_minor ? (
                                <>
                                  <span className="sting-mono">{formatMinor(o.price_minor)}</span> /{" "}
                                  {o.unit_name || "عبوة"}
                                </>
                              ) : (
                                o.price_line
                              )}
                            </td>
                            <td>
                              {o.fees_label} · {o.min_order_label}
                              {!o.fees_decided && !o.expired ? (
                                <div>
                                  <Status state="stale" label="خارج الترتيب" />
                                </div>
                              ) : null}
                            </td>
                            <td>
                              {o.expired ? (
                                <Status
                                  state="expired"
                                  label={
                                    o.expired_yesterday
                                      ? "انتهى أمس — خارج الترتيب، معروض للسياق"
                                      : "منتهٍ — خارج الترتيب، معروض للسياق"
                                  }
                                />
                              ) : (
                                <span>
                                  مؤكد خادمياً حتى{" "}
                                  {o.confirmed_until ? untilWord(o.confirmed_until) : "—"}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              : null}
            {shown && shown.multi_unit ? (
              <p className="acc-choice__note">
                سعر الوحدة للعروض ذات الرسوم غير المحسومة يظهر بعلامة «قبل الرسوم» ولا يدخل الترتيب.
                تحويل 500غ إلى كغ حساب صريح نعرضه؛ تحويل «كرتونة» إلى «كيس» ليس تحويلاً بل تخمين
                تغليف ولن نفعله.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
