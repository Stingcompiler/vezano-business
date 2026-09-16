"use client";

import { fromBaseQtyMilliForDisplay, parseUnitFactor, toBaseQtyMilli } from "@sting/domain";
import {
  Button,
  Dialog,
  formatQty,
  Frame,
  Notice,
  SelectField,
  Table,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

import { describeError, type ItemFieldError, type ServerFieldError } from "./item-errors";

type State = "ready" | "validation_error" | "success";

interface Change {
  readonly id: string;
  readonly old_factor_milli: string;
  readonly new_factor_milli: string;
  readonly prior_lines: number;
  readonly changed_by_name: string;
  readonly changed_at: string;
}
interface CardUnit {
  readonly id: string;
  readonly unit_id: string;
  readonly name: string;
  readonly decimal_places: number;
  readonly factor_milli: string;
  readonly barcode: string;
  readonly created_at: string;
  readonly prior_lines: number;
  readonly changes: readonly Change[];
}
interface Card {
  readonly id: string;
  readonly name: string;
  readonly base_unit_id: string;
  readonly base_unit_name: string;
  readonly base_unit_decimal_places: number;
  readonly barcode: string;
  readonly units: readonly CardUnit[];
}
interface UnitRow {
  readonly id: string;
  readonly name: string;
  readonly is_base: boolean;
}
interface Row {
  readonly key: string;
  readonly unit: CardUnit | null;
  readonly name: string;
  readonly factor: string;
  readonly barcode: string;
}

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
/** «من يناير 2025» — الشهر بالعربية والسنة رقماً لاتينياً في mono (القاعدة 2). */
function monthYear(iso: string): { month: string; year: string } {
  const d = new Date(iso);
  return { month: MONTHS[d.getMonth()] ?? "", year: String(d.getFullYear()) };
}
const factorText = (milli: string) => formatQty(milli, 3).replace(/\.?0+$/, "");

function parseFactorInput(text: string): string | null {
  const latin = text.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(latin);
  if (!m) return null;
  return (BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0"))).toString();
}

/**
 * CAT-03 — وحدات وتحويلات وباركود (05-D2 ready · 38-D30 validation_error/success). القاعدة الحرجة:
 * تغيير معامل التحويل لا يُعيد تفسير سطور البيع السابقة (ACC-19) — يسري من الآن ويُسجَّل في تاريخ
 * التغيير باسم من غيّره. الأمثلة المحسوبة من @sting/domain لا من الواجهة.
 */
export function UnitsClient({ itemId }: { itemId: string }) {
  const router = useRouter();
  const app = useApp();
  const [card, setCard] = useState<Card | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [addUnitId, setAddUnitId] = useState("");
  const [addFactor, setAddFactor] = useState("");
  const [addBarcode, setAddBarcode] = useState("");
  const [editing, setEditing] = useState<CardUnit | null>(null);
  const [newFactor, setNewFactor] = useState("");
  const [errors, setErrors] = useState<ItemFieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ unit: CardUnit; prior: number; old: string } | null>(null);

  const load = useCallback(async () => {
    const [c, u] = await Promise.all([
      api().GET("/api/catalog/items/{item_id}", { params: { path: { item_id: itemId } } }),
      api().GET("/api/catalog/units"),
    ]);
    if (c.data) setCard(c.data);
    setUnits((u.data as unknown as { units?: UnitRow[] } | undefined)?.units ?? []);
  }, [itemId]);

  useEffect(() => {
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/catalog/${itemId}/units`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [app.expired, app.tokens, itemId, load, router]);

  const errorFor = (key: string) => errors.find((e) => e.key === key)?.msg;
  const applyErrors = (error: unknown) =>
    setErrors(((error as { errors?: ServerFieldError[] }).errors ?? []).map(describeError));

  const addUnit = async () => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const { data, error, response } = await api().POST("/api/catalog/items/{item_id}/units", {
        params: { path: { item_id: itemId } },
        body: {
          unit_id: addUnitId,
          factor_milli: parseFactorInput(addFactor) ?? addFactor,
          barcode: addBarcode.trim(),
        },
      });
      if (response.status === 400 && error) {
        applyErrors(error);
        return;
      }
      if (response.ok && data) {
        const c = data as unknown as Card;
        setCard(c);
        const unit = c.units.find((u) => u.unit_id === addUnitId);
        if (unit) setSaved({ unit, prior: 0, old: "" });
        setAdding(false);
        setAddUnitId("");
        setAddFactor("");
        setAddBarcode("");
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmChange = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const { data, error, response } = await api().PATCH(
        "/api/catalog/items/{item_id}/units/{item_unit_id}",
        {
          params: { path: { item_id: itemId, item_unit_id: editing.id } },
          body: { factor_milli: parseFactorInput(newFactor) ?? newFactor },
        },
      );
      if (response.status === 400 && error) {
        applyErrors(error);
        return;
      }
      if (response.ok && data) {
        const c = data as unknown as Card;
        setCard(c);
        const unit = c.units.find((u) => u.id === editing.id);
        if (unit) setSaved({ unit, prior: editing.prior_lines, old: editing.factor_milli });
        setEditing(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = saved
    ? "success"
    : errors.length || (editing && editing.prior_lines > 0)
      ? "validation_error"
      : "ready";

  const rows: Row[] = card
    ? [
        {
          key: "base",
          unit: null,
          name: card.base_unit_name,
          factor: "1",
          barcode: card.barcode,
        },
        ...card.units.map((u) => ({
          key: u.id,
          unit: u,
          name: u.name,
          factor: factorText(u.factor_milli),
          barcode: u.barcode,
        })),
      ]
    : [];

  const examples = useMemo(() => {
    if (!card) return [];
    const base = card.base_unit_name;
    const sample = card.base_unit_decimal_places >= 3 ? "123" : "1000";
    return card.units.map((u) => {
      const f = parseUnitFactor(u.factor_milli, "1000");
      const one = factorText(toBaseQtyMilli(1000n, f).toString());
      let half: string | null = null;
      try {
        half = factorText(toBaseQtyMilli(500n, f).toString());
      } catch {
        half = null;
      }
      const inUnit = formatQty(fromBaseQtyMilliForDisplay(BigInt(sample), f), 3);
      return {
        u,
        base,
        one,
        half,
        sample: formatQty(sample, card.base_unit_decimal_places as 0 | 1 | 2 | 3),
        inUnit,
      };
    });
  }, [card]);

  const columns = [
    {
      key: "unit",
      header: "الوحدة",
      render: (r: Row) => (
        <>
          {r.name} {r.unit === null ? <span className="cat-chip">الأساس</span> : null}
        </>
      ),
    },
    {
      key: "factor",
      header: "المعامل",
      render: (r: Row) => (
        <>
          <span className="sting-mono">{r.factor}</span>
          {r.unit ? <> {card?.base_unit_name}</> : null}
        </>
      ),
    },
    {
      key: "barcode",
      header: "الباركود",
      render: (r: Row) => (r.barcode ? <span className="sting-mono">{r.barcode}</span> : "—"),
    },
    {
      key: "change",
      header: "تغيير",
      render: (r: Row) =>
        r.unit ? (
          <Button
            variant="secondary"
            onClick={() => {
              setSaved(null);
              setErrors([]);
              setNewFactor(factorText(r.unit!.factor_milli));
              setEditing(r.unit);
            }}
          >
            تغيير معامل ال{r.name}
          </Button>
        ) : null,
    },
  ];

  const editFrom = editing ? monthYear(editing.created_at) : null;

  return (
    <Frame title="الكتالوج" nav={<AppNav currentId="catalog" />} footer={null}>
      <div className="home" data-screen="CAT-03" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">{card ? `${card.name} — الوحدات` : "الوحدات"}</h2>
          </div>
          <Table
            caption="الوحدات"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            loading={card ? undefined : 2}
          />
          <div className="acc-card__body">
            {saved ? (
              <Notice kind="success" title="حُفظت الوحدات">
                <p className="acc-lead">
                  البيع بال{card?.base_unit_name} وبال{saved.unit.name} معاً
                  {saved.unit.barcode ? " · باركود لكل وحدة" : ""}
                </p>
                {saved.old ? (
                  <p className="acc-lead">
                    يسري من الآن · <span className="sting-mono">{saved.prior}</span> سطر بيع سابق
                    يستخدم المعامل <span className="sting-mono">{factorText(saved.old)}</span>
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {examples.length ? (
              <div className="cat-examples">
                <div className="cat-examples__title">أمثلة محسوبة</div>
                {examples.map((x) => (
                  <div key={x.u.id} className="cat-examples__body">
                    {x.u.name} واحدة = <span className="sting-mono">{x.one}</span> {x.base}
                    <br />
                    {x.half ? (
                      <>
                        نصف {x.u.name} = <span className="sting-mono">{x.half}</span> {x.base}
                        <br />
                      </>
                    ) : null}
                    <span className="sting-mono">{x.sample}</span> {x.base} ={" "}
                    <span className="sting-mono">{x.inUnit}</span> {x.u.name} — يُعرض بالوحدة الأساس
                  </div>
                ))}
              </div>
            ) : null}
            <div className="acc-links">
              <Button
                onClick={() => {
                  setSaved(null);
                  setErrors([]);
                  setAdding(true);
                }}
              >
                إضافة وحدة
              </Button>
            </div>
          </div>
        </div>

        <Dialog
          open={adding}
          kind="form"
          title="إضافة وحدة"
          primaryLabel="إضافة وحدة"
          onPrimary={() => void addUnit()}
          onClose={() => {
            setAdding(false);
            setErrors([]);
          }}
          saving={busy}
        >
          <div className="cat-alias-form">
            <SelectField
              label="الوحدة"
              value={addUnitId}
              onChange={(e) => setAddUnitId(e.target.value)}
              options={[
                { value: "", label: "" },
                ...units
                  .filter((u) => u.id !== card?.base_unit_id)
                  .map((u) => ({ value: u.id, label: u.name })),
              ]}
              error={errorFor("unit_id")}
              required
            />
            <TextField
              label="المعامل"
              mono
              value={addFactor}
              onChange={(e) => setAddFactor(e.target.value)}
              hint={card ? `بال${card.base_unit_name}` : undefined}
              error={errorFor("factor_milli")}
              required
            />
            <TextField
              label="الباركود"
              mono
              value={addBarcode}
              onChange={(e) => setAddBarcode(e.target.value)}
              error={errorFor("barcode")}
            />
          </div>
          {errors
            .filter((e) => e.key === "barcode" && e.why)
            .map((e) => (
              <p key={e.key} className="acc-lead">
                {e.why}
              </p>
            ))}
        </Dialog>

        <Dialog
          open={editing !== null}
          kind="form"
          title={editing ? `تغيير معامل ال${editing.name}` : ""}
          primaryLabel="تأكيد تغيير المعامل"
          onPrimary={() => void confirmChange()}
          onClose={() => {
            setEditing(null);
            setErrors([]);
          }}
          saving={busy}
        >
          {editing && card ? (
            <div className="cat-change">
              <div className="cat-change__pair">
                <div>
                  <div className="cat-change__k">المعامل الحالي</div>
                  <div className="cat-change__v sting-mono">{factorText(editing.factor_milli)}</div>
                </div>
                <div className="cat-change__arrow" aria-hidden="true">
                  ←
                </div>
                <div>
                  <TextField
                    label="المعامل الجديد"
                    mono
                    value={newFactor}
                    onChange={(e) => setNewFactor(e.target.value)}
                    error={errorFor("factor_milli")}
                    required
                  />
                </div>
              </div>
              {editing.prior_lines > 0 ? (
                <div className="cat-change__warn">
                  <div className="cat-change__warn-title">
                    <span className="sting-mono">{editing.prior_lines}</span> سطر بيع سابق يستخدم
                    المعامل <span className="sting-mono">{factorText(editing.factor_milli)}</span>
                  </div>
                  <div className="cat-change__warn-body">
                    لن تتغير. كل سطر بيع يحفظ معامله لحظة الحفظ، فتبقى فاتورة أمس «{editing.name} ={" "}
                    <span className="sting-mono">{factorText(editing.factor_milli)}</span>{" "}
                    {card.base_unit_name}» إلى الأبد. المعامل الجديد يسري على البيع من الآن فقط.
                  </div>
                </div>
              ) : null}
              <div className="cat-change__history">
                <div className="cat-change__k">تاريخ التغيير — يظهر في بطاقة الصنف</div>
                <div className="cat-change__lines">
                  {editing.changes.map((c) => {
                    const my = monthYear(c.changed_at);
                    return (
                      <div key={c.id}>
                        <span className="sting-mono">{factorText(c.old_factor_milli)}</span>{" "}
                        {card.base_unit_name} · حتى {my.month}{" "}
                        <span className="sting-mono">{my.year}</span> ·{" "}
                        <span className="sting-mono">{c.prior_lines}</span> سطراً
                      </div>
                    );
                  })}
                  <div>
                    <span className="sting-mono">{factorText(editing.factor_milli)}</span>{" "}
                    {card.base_unit_name} · من {editFrom?.month}{" "}
                    <span className="sting-mono">{editFrom?.year}</span> حتى اليوم ·{" "}
                    <span className="sting-mono">{editing.prior_lines}</span> سطراً
                  </div>
                  <div>
                    <span className="sting-mono">
                      {factorText(parseFactorInput(newFactor) ?? "0")}
                    </span>{" "}
                    {card.base_unit_name} · من اليوم — {app.session.displayName ?? ""}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </Dialog>
      </div>
    </Frame>
  );
}
