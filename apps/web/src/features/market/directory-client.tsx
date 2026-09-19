"use client";

import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { agoParts } from "@/features/home/format";
import type { SupplierCard } from "@/features/market/home-client";
import { readArea, readSnapshot, writeArea, writeSnapshot } from "@/features/market/market-store";
import { api } from "@/lib/api";
import { useOnline } from "@/lib/online";

type State = "loading" | "ready" | "empty" | "stale";

interface Directory {
  area: string;
  category: string;
  areas: { name: string; suppliers: number }[];
  categories: { name: string; suppliers: number }[];
  suppliers: SupplierCard[];
  total: number;
  alternatives: { all_areas: number; all_categories: number; everything: number };
  fetched_at: string;
}

const SNAP = "market.directory";
const countWord = (n: number) =>
  n === 1 ? "منشأة واحدة" : n === 2 ? "منشأتان" : n <= 10 ? `${n} منشآت` : `${n} منشأة`;
const resultsWord = (n: number) =>
  n === 1 ? "نتيجة واحدة" : n === 2 ? "نتيجتان" : n <= 10 ? `${n} نتائج` : `${n} نتيجة`;

/** MP-02 — دليل المخازن والمتاجر: تصفية بالخدمة لا بالعنوان الخاص (29-D22 ready/stale · 43-D35 loading/empty). */
export function DirectoryClient() {
  const router = useRouter();
  const online = useOnline();
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("");
  const [data, setData] = useState<Directory | null>(null);
  const [snapshot, setSnapshot] = useState<{ at: string; data: Directory } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setArea(readArea());
    setSnapshot(readSnapshot<Directory>(SNAP));
  }, []);

  const load = useCallback(async (a: string, c: string) => {
    setFailed(false);
    try {
      const { data, response } = await api().GET("/api/public/market/directory", {
        params: { query: { area: a, category: c } },
      });
      const body = data as unknown as Directory | undefined;
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
    void load(area, category);
  }, [area, category, online, load]);

  const shown = data ?? (failed || !online ? (snapshot?.data ?? null) : null);
  const state: State =
    !online || (failed && shown)
      ? "stale"
      : !shown
        ? "loading"
        : shown.total === 0
          ? "empty"
          : "ready";
  const ago = snapshot ? agoParts(snapshot.at) : null;

  const columns = [
    {
      key: "name",
      header: "المنشأة",
      render: (s: SupplierCard) => (
        <>
          <strong>{s.public_name}</strong>
          <div className="mp-check__hint">{s.category_line}</div>
        </>
      ),
    },
    { key: "cats", header: "الفئات", render: (s: SupplierCard) => s.categories.join(" · ") },
    {
      key: "areas",
      header: "مناطق الخدمة وطريقة التنفيذ",
      render: (s: SupplierCard) => `${s.service_areas.join(" و")} · ${s.fulfilment.join("، أو ")}`,
    },
    {
      key: "offers",
      header: "عروض منشورة",
      mono: true,
      render: (s: SupplierCard) => String(s.offers_count),
    },
    {
      key: "status",
      header: "الحالة",
      render: (s: SupplierCard) => (
        <Status state={s.badge === "verified" ? "success" : "stale"} label={s.badge_label} />
      ),
    },
  ];

  const chips = (
    items: { name: string; suppliers: number }[],
    value: string,
    set: (v: string) => void,
    label: string,
  ) => (
    <div className="pos-chips" role="group" aria-label={label}>
      <button
        type="button"
        className={`pos-chip${!value ? " pos-chip--on" : ""}`}
        onClick={() => set("")}
      >
        الكل
      </button>
      {items.map((i) => (
        <button
          key={i.name}
          type="button"
          className={`pos-chip${value === i.name ? " pos-chip--on" : ""}`}
          aria-pressed={value === i.name}
          onClick={() => set(i.name)}
        >
          {i.name} — <span className="sting-mono">{i.suppliers}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Frame title="السوق" footer={null}>
      <div className="sys mp" data-screen="MP-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              دليل المخازن والمتاجر — تصفية بالخدمة لا بالعنوان الخاص
            </h2>
            <span className="cat-head__hint">
              المشتري يبحث بمن يخدم منطقته وفئته. لا نعرض عنوان منشأة ولا هاتفها في الدليل — ذلك
              بيانها هي تُفصح عنه في ملفها متى شاءت.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="acc-choice__head">
              <strong>
                الدليل — {shown ? countWord(shown.total) : "…"}
                {area ? " تخدم منطقتك" : ""}
              </strong>
              {state === "stale" ? <Status state="stale" label="متقادم" /> : null}
            </div>
            {shown
              ? chips(
                  shown.areas,
                  area,
                  (v) => {
                    setArea(v);
                    writeArea(v);
                  },
                  "المنطقة",
                )
              : null}
            {shown ? chips(shown.categories, category, setCategory, "الفئة") : null}

            {state === "loading" ? (
              <Notice kind="info" title="جلب الدليل">
                <p className="acc-lead">بالمنطقة والفئة المختارتين، وعدّاد النتائج يظهر أولاً.</p>
              </Notice>
            ) : null}
            {state === "stale" && ago ? (
              <Notice kind="warning" title="متقادم">
                <p className="acc-lead">
                  قائمة الدليل محفوظة على جهازك من قبل <span className="sting-mono">{ago.n}</span>{" "}
                  {ago.unit === "minute" ? "دقيقة" : ago.unit === "hour" ? "ساعة" : "يوم"}. نعرض
                  الوقت ولا نُظهرها كأنها لحظية، لأن «عروض منشورة» قد تكون أقل الآن. عدد العروض ليس
                  سعراً مؤكَّداً — التأكيد في MP-05 وحده.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && shown ? (
              <Notice kind="empty" title="لا منشآت">
                <p className="acc-lead">
                  {category && area
                    ? `لا مخازن في هذه الفئة بمنطقتك.`
                    : shown.alternatives.everything === 0
                      ? "لا منشآت منشورة بعد."
                      : "لا مخازن في هذه الفئة بمنطقتك."}
                </p>
                <p className="acc-choice__note">
                  <strong>المخرج المعروض</strong> · وسّع المنطقة أو الفئة — بأزرار تحمل أثرها.
                </p>
                <div className="acc-actions">
                  {area ? (
                    <Button
                      onClick={() => {
                        setArea("");
                        writeArea("");
                      }}
                    >
                      كل المناطق ({resultsWord(shown.alternatives.all_areas)})
                    </Button>
                  ) : null}
                  {category ? (
                    <Button onClick={() => setCategory("")}>
                      كل الفئات ({resultsWord(shown.alternatives.all_categories)})
                    </Button>
                  ) : null}
                </div>
              </Notice>
            ) : null}

            {shown && shown.total ? (
              <Table
                caption="الدليل"
                columns={columns}
                rows={shown.suppliers}
                rowKey={(s) => s.tenant_id}
                onOpenRow={(s) => router.push(`/market/suppliers/${s.tenant_id}`)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
