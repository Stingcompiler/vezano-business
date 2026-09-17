"use client";

import {
  addToCart,
  type CartCustomer,
  type CartDiscount,
  type CartDraftLine,
  type CatalogRow,
  cartTotals,
  catalogRows,
  filterLocalItems,
  type LocalBalance,
  type LocalItem,
  type LocalShift,
  looksLikeBarcode,
  nearestNames,
  readBalanceMatchedAt,
  readCartDraft,
  readLocalBalances,
  readLocalItems,
  readOpenShift,
  readShiftCash,
  holdCart,
  rowByBarcode,
  stepCartLine,
  storeBalances,
  writeCartDraft,
  readSaleCashRows,
} from "@sting/sync-core";
import {
  Button,
  Cart,
  type CartLine,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  Status,
  SyncIndicator,
  Table,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { hhmm } from "@/features/home/format";
import { readHomeCache } from "@/features/home/home-cache";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { countPending } from "@/lib/sync";
import { useMedia } from "@/lib/use-media";

import { EmptySearch } from "./empty-search";
import { PosNav } from "./pos-nav";
import { UnitSheet } from "./unit-sheet";

type State = "ready" | "loading" | "empty" | "offline" | "stale" | "permission_denied";
type Chip = { readonly id: string; readonly label: string };

const ALL = "__all";
const WEIGH = "__weigh";
const MAX_ROWS = 40;

/** عدد بصيغته: «3 عمليات معلقة من هذا الجهاز». */
function pendingLabel(n: number): string {
  return n === 1
    ? "عملية واحدة معلقة من هذا الجهاز"
    : n === 2
      ? "عمليتان معلقتان من هذا الجهاز"
      : `${n} ${n <= 10 ? "عمليات معلقة" : "عملية معلقة"} من هذا الجهاز`;
}

interface Sheet {
  readonly row: CatalogRow;
  /** تعديل سطر قائم: معرّفه؛ الإضافة: null. */
  readonly lineId: string | null;
  readonly qtyMilli?: string | undefined;
}

/**
 * POS-01 — نقطة البيع والسلة (03-D2 ready · 42-D34 loading/empty/offline/stale/permission_denied ·
 * 46-D37 S-01 على التابلت). CSR من الإسقاط المحلي (§١٢.٤): الكتالوج والبحث والباركود والحساب من
 * الجهاز بلا انتظار؛ ما يتأخر هو الأرصدة وتُوسم بآخر مطابقة (ACC-76). لا بيع نقدي بلا وردية مفتوحة
 * — الرسالة «افتح وردية» لا «ليست لديك صلاحية». الرصيد القديم تنبيه لا منع (ACC-17).
 * السلة مسودّة محلية تبقى بعد إغلاق التطبيق؛ الحفظ الفعلي خط `sale` مع POS-05.
 */
export function PosClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const tablet = useMedia("(max-width: 1199px)");
  const [items, setItems] = useState<LocalItem[] | null>(null);
  const [balances, setBalances] = useState<Map<string, LocalBalance>>(new Map());
  const [matchedAt, setMatchedAt] = useState<string | null>(null);
  const [balanceFetch, setBalanceFetch] = useState<"idle" | "pending" | "ok" | "failed">("idle");
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [expected, setExpected] = useState<bigint | null>(null);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [pending, setPending] = useState(0);
  const [lines, setLines] = useState<readonly CartDraftLine[]>([]);
  const [discount, setDiscount] = useState<CartDiscount | undefined>(undefined);
  const [customer, setCustomer] = useState<CartCustomer | undefined>(undefined);
  const [removed, setRemoved] = useState<CartDraftLine | null>(null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState(ALL);
  const [barcodeMiss, setBarcodeMiss] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [its, draft, bal, at, s, c, home, p] = await Promise.all([
        readLocalItems(storage),
        readCartDraft(storage),
        readLocalBalances(storage),
        readBalanceMatchedAt(storage),
        readOpenShift(storage),
        readShiftContext(storage, app),
        readHomeCache(),
        countPending(),
      ]);
      setItems(its);
      setLines(draft.lines);
      setDiscount(draft.discount);
      setCustomer(draft.customer);
      setBalances(bal);
      setMatchedAt(at);
      setShift(s);
      setCtx(c);
      setTenantName(home?.summary.tenant_name ?? "");
      setPending(p);
      if (s)
        setExpected(
          (await readShiftCash(storage, s, await readSaleCashRows(storage, s.id)))
            .expectedCashMinor,
        );
    })();
  }, [router]);

  // مطابقة الأرصدة مع الخادم حين يوجد اتصال — البيع لا ينتظرها
  useEffect(() => {
    if (!online || !appRef.current.tokens || items === null) return;
    let cancelled = false;
    setBalanceFetch("pending");
    void (async () => {
      try {
        const branchId = ctx?.branchId ?? appRef.current.session.branchId ?? "";
        const { data, response } = await api().GET("/api/catalog/balances", {
          params: { query: branchId ? { branch_id: branchId } : {} },
        });
        // العقد لا يصف الجسم (responses: None)
        const body = data as unknown as
          { as_of: string; balances: { item_id: string; qty_milli: string }[] } | undefined;
        if (cancelled) return;
        if (!response.ok || !body) {
          setBalanceFetch("failed");
          return;
        }
        await storeBalances(getStorage(), body.as_of, body.balances);
        setBalances(await readLocalBalances(getStorage()));
        setMatchedAt(body.as_of);
        setBalanceFetch("ok");
      } catch {
        if (!cancelled) setBalanceFetch("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, items, ctx?.branchId]);

  const persist = (next: readonly CartDraftLine[]) => {
    setLines(next);
    // السلة الفارغة تُسقط خصمها وعميلها — لا خصم على لا شيء
    const keep = next.length > 0;
    if (!keep) {
      setDiscount(undefined);
      setCustomer(undefined);
    }
    void writeCartDraft(getStorage(), {
      lines: next,
      discount: keep ? discount : undefined,
      customer: keep ? customer : undefined,
    });
  };

  const active = useMemo(() => (items ?? []).filter((i) => i.is_active), [items]);
  const allRows = useMemo(() => catalogRows(active), [active]);
  const chips: Chip[] = useMemo(() => {
    const groups = [...new Set(active.map((i) => i.group_name).filter(Boolean))];
    return [
      { id: ALL, label: "الكل" },
      ...groups.map((g) => ({ id: `g:${g}`, label: g })),
      { id: WEIGH, label: "وزن" },
    ];
  }, [active]);
  const visibleRows = useMemo(() => {
    const filtered = filterLocalItems(active, { q: query });
    const ids = new Set(filtered.map((i) => i.id));
    return allRows.filter(
      (r) =>
        ids.has(r.item.id) &&
        (chip === ALL ? true : chip === WEIGH ? r.weighable : r.item.group_name === chip.slice(2)),
    );
  }, [active, allRows, chip, query]);
  const shown = visibleRows.slice(0, MAX_ROWS);
  const totals = useMemo(() => cartTotals(lines, discount), [lines, discount]);
  const inCart = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const l of lines) {
      const k = `${l.item_id}:${l.unit_id}`;
      m.set(k, (m.get(k) ?? 0n) + BigInt(l.qty_milli));
    }
    return m;
  }, [lines]);

  const state: State =
    shift === null
      ? "permission_denied"
      : items !== null && active.length === 0
        ? "empty"
        : !online
          ? "offline"
          : balanceFetch === "failed"
            ? "stale"
            : items === null || balanceFetch === "pending"
              ? "loading"
              : "ready";
  const stale = state === "stale";

  const add = (row: CatalogRow) => {
    if (row.weighable) {
      setSheet({ row, lineId: null });
      return;
    }
    persist(addToCart(lines, row, "1000", () => crypto.randomUUID()));
  };
  const confirmSheet = (row: CatalogRow, qtyMilli: string) => {
    if (sheet?.lineId) {
      persist(
        lines.map((l) =>
          l.id === sheet.lineId
            ? {
                ...l,
                unit_id: row.unitId,
                unit_code: row.unitCode,
                unit_name: row.unitName,
                factor_milli: row.factorMilli,
                decimal_places: row.decimalPlaces,
                unit_price_minor: row.unitPriceMinor,
                qty_milli: qtyMilli,
              }
            : l,
        ),
      );
    } else {
      persist(addToCart(lines, row, qtyMilli, () => crypto.randomUUID()));
    }
    setSheet(null);
  };
  const editLine = (lineId: string) => {
    const l = lines.find((x) => x.id === lineId);
    const row = l && allRows.find((r) => r.item.id === l.item_id && r.unitId === l.unit_id);
    if (l && row) setSheet({ row, lineId, qtyMilli: l.qty_milli });
  };
  const submitSearch = () => {
    const row = rowByBarcode(allRows, query);
    if (row) {
      add(row);
      setQuery("");
      setBarcodeMiss(null);
      return;
    }
    if (looksLikeBarcode(query)) setBarcodeMiss(query.trim());
  };
  const hold = async () => {
    const n = await holdCart(getStorage(), lines);
    setLines([]);
    setDiscount(undefined);
    setCustomer(undefined);
    setHeld(n);
  };

  const cartLines: CartLine[] = lines.map((l) => ({
    id: l.id,
    name: l.item_name,
    qtyLabel: formatQty(l.qty_milli, l.decimal_places),
    unitLabel: l.unit_code,
    unitPriceMinor: l.unit_price_minor,
    lineTotalMinor: (totals.lineTotals.get(l.id) ?? 0n).toString(),
  }));

  const payDisabled = !lines.length ? "السلة فارغة" : shift ? undefined : "لا وردية مفتوحة";
  const emptyKind =
    items !== null && active.length === 0
      ? "catalog"
      : barcodeMiss
        ? "unknown_barcode"
        : query.trim() && visibleRows.length === 0
          ? "no_match"
          : null;

  const balanceCell = (row: CatalogRow) => {
    const b = balances.get(row.item.id);
    const inCartQty = inCart.get(`${row.item.id}:${row.unitId}`);
    const qty = b ? BigInt(b.qty_milli) : null;
    const tag = inCartQty
      ? `في السلة ×${formatQty(inCartQty, row.decimalPlaces)}`
      : stale && b
        ? "الرصيد قد يكون أقل"
        : qty !== null && qty < 0n
          ? "رصيد سالب"
          : qty === 0n
            ? "نفد"
            : "";
    return { qty, tag, negative: qty !== null && qty < 0n };
  };

  const columns = [
    {
      key: "item",
      header: "الصنف",
      render: (r: CatalogRow) => {
        const { tag } = balanceCell(r);
        return (
          <span>
            {r.label}{" "}
            {tag ? (
              <span className={`pos-tag${tag.startsWith("في السلة") ? " pos-tag--cart" : ""}`}>
                {tag.startsWith("في السلة") ? (
                  <>
                    في السلة ×<span className="sting-mono">{tag.slice("في السلة ×".length)}</span>
                  </>
                ) : (
                  tag
                )}
              </span>
            ) : null}
          </span>
        );
      },
    },
    { key: "unit", header: "الوحدة", render: (r: CatalogRow) => r.unitLabel },
    {
      key: "price",
      header: "السعر",
      mono: true,
      render: (r: CatalogRow) => formatMinor(r.unitPriceMinor),
    },
    {
      key: "avail",
      header: "المتاح",
      mono: true,
      render: (r: CatalogRow) => {
        const { qty, negative } = balanceCell(r);
        return (
          <span className={negative ? "pos-avail--neg" : undefined}>
            {qty === null ? "—" : formatQty(qty, r.item.base_unit_decimal_places ?? 0)}
          </span>
        );
      },
    },
    {
      // الإطار يترك رأس العمود فارغاً؛ axe يطلب نصاً — عنوان الزر نفسه
      key: "add",
      header: "إضافة",
      render: (r: CatalogRow) => (
        <Button variant="secondary" onClick={() => add(r)} pos={tablet}>
          إضافة
        </Button>
      ),
    },
  ];

  const cart = (
    <aside className="pos-cart" aria-label="السلة">
      <div className="pos-cart__head">
        <span className="pos-cart__title">السلة</span>
        <span className="acc-choice__note">فاتورة جديدة — لم تُحفظ</span>
      </div>
      <Cart
        lines={cartLines}
        totalMinor={totals.totalMinor.toString()}
        currency="ج.س"
        onRemove={(id) => {
          setRemoved(lines.find((l) => l.id === id) ?? null);
          persist(lines.filter((l) => l.id !== id));
        }}
        onUndoRemove={() => {
          if (removed) persist([...lines, removed]);
          setRemoved(null);
        }}
        onQty={editLine}
        onStep={(id, dir) => persist(stepCartLine(lines, id, dir))}
        summary={
          <>
            <div>
              <span>عدد الأسطر</span>
              <span className="sting-mono">{totals.lineCount}</span>
            </div>
            <div>
              <Button
                variant="quiet"
                className="pos-cart__link"
                onClick={() => router.push("/pos/discount")}
                disabledReason={lines.length ? undefined : "السلة فارغة"}
              >
                خصم
              </Button>
              <span className="sting-mono">
                {totals.discountMinor > 0n ? "−" : ""}
                {formatMinor(totals.discountMinor.toString())}
              </span>
            </div>
            <div>
              <Button
                variant="quiet"
                className="pos-cart__link"
                onClick={() => router.push("/pos/customer")}
                disabledReason={lines.length ? undefined : "السلة فارغة"}
              >
                اختيار العميل
              </Button>
              <span>{customer ? customer.name : "بيع نقدي بلا عميل"}</span>
            </div>
          </>
        }
        empty={<div className="pos-cart__empty" aria-hidden="true" />}
        footer={
          <div className="pos-cart__actions">
            <Button
              financial
              pos={tablet}
              onClick={() => router.push("/pos/pay")}
              disabledReason={payDisabled}
            >
              {tablet ? "تحصيل" : "متابعة إلى الدفع"}
            </Button>
            <div className="pos-cart__secondary">
              <Button
                variant="secondary"
                pos={tablet}
                onClick={() => void hold()}
                disabledReason={lines.length ? undefined : "السلة فارغة"}
              >
                تعليق الفاتورة
              </Button>
              <Button
                variant="secondary"
                pos={tablet}
                onClick={() => persist([])}
                disabledReason={lines.length ? undefined : "السلة فارغة"}
              >
                إلغاء السلة
              </Button>
            </div>
            {held ? (
              <p className="acc-choice__note" role="status">
                عُلّقت — <span className="sting-mono">{held}</span> في المعلّقات
              </p>
            ) : null}
          </div>
        }
      />
    </aside>
  );

  const search = (
    <div className="pos-search">
      <TextField
        ref={searchRef}
        label={tablet ? "ابحث أو امسح باركود…" : "ابحث عن صنف…"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setBarcodeMiss(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submitSearch();
        }}
        inputMode="search"
      />
      <Button
        variant="secondary"
        pos={tablet}
        onClick={() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        }}
      >
        {tablet ? "ماسح" : "مسح باركود"}
      </Button>
    </div>
  );

  const chipsRow = (
    <div className="pos-chips" role="group" aria-label="التصنيفات">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`pos-chip${chip === c.id ? " pos-chip--on" : ""}`}
          aria-pressed={chip === c.id}
          onClick={() => setChip(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  const results = emptyKind ? (
    <EmptySearch
      kind={emptyKind}
      query={barcodeMiss ?? query.trim()}
      total={active.length}
      nearest={nearestNames(active, query)}
    />
  ) : tablet ? (
    <div className="pos-tiles">
      {shown.map((r) => {
        const { tag } = balanceCell(r);
        return (
          <button key={r.key} type="button" className="pos-tile" data-pos onClick={() => add(r)}>
            <span className="pos-tile__name">{r.label}</span>
            <span className="pos-tile__price sting-mono">{formatMinor(r.unitPriceMinor)}</span>
            {tag ? <span className="pos-tag">{tag}</span> : null}
          </button>
        );
      })}
    </div>
  ) : (
    <Table
      caption="الأصناف"
      columns={columns}
      rows={shown}
      rowKey={(r) => r.key}
      loading={items === null ? 9 : undefined}
    />
  );

  const foot =
    items !== null && !emptyKind ? (
      <div className="pos-foot">
        <span>
          <span className="sting-mono">{new Set(shown.map((r) => r.item.id)).size}</span> من{" "}
          <span className="sting-mono">{active.length}</span> صنفاً — ضيّق البحث للوصول أسرع
        </span>
        <span>السعر والوحدة يُثبَّتان على سطر البيع لحظة الحفظ</span>
      </div>
    ) : null;

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="pos" canSeeReports={ctx?.roleName === "مالك"} />}
      footer={null}
      notice={state === "offline" ? <Status state="offline" label="بيع بلا اتصال" /> : undefined}
    >
      <div className="pos" data-screen="POS-01" data-state={state}>
        <div className="pos-head">
          <div className="pos-head__org">
            <strong>{tenantName || "—"}</strong>
            <span className="acc-choice__note"> / {ctx?.branchName || "—"}</span>
          </div>
          <SyncIndicator
            state={!online ? "offline" : pending > 0 ? "pending_sync" : "synced"}
            lastServerAt={matchedAt ? hhmm(matchedAt) : null}
            pendingCount={pending}
            pendingLabel={pendingLabel}
          />
          {shift ? (
            <div className="pos-head__shift">
              <span>
                وردية مفتوحة <span className="sting-mono">{hhmm(shift.opened_at)}</span> ·{" "}
                <span className="sting-mono">{formatMinor((expected ?? 0n).toString())}</span> نقداً
              </span>
              <span className="acc-choice__note">
                {shift.user_name} — {ctx?.roleName || "كاشير"}
              </span>
            </div>
          ) : null}
        </div>

        {state === "permission_denied" ? (
          <Notice
            kind="locked"
            title="لا وردية مفتوحة"
            action={<Button onClick={() => router.push("/shifts/open")}>افتح وردية</Button>}
          >
            <p className="acc-lead">البيع النقدي يحتاج صندوقاً مفتوحاً يستقبل النقد.</p>
          </Notice>
        ) : null}
        {state === "empty" ? (
          <Notice
            kind="empty"
            title="كتالوج فارغ"
            action={
              <>
                <Button onClick={() => router.push("/catalog/import")}>استورد قائمة الأصناف</Button>
                <Button variant="secondary" onClick={() => router.push("/catalog/new")}>
                  أنشئ صنفاً
                </Button>
              </>
            }
          >
            <p className="acc-lead">منشأة جديدة لم تُدخل أصنافها.</p>
          </Notice>
        ) : null}
        {state === "offline" ? (
          <Notice kind="offline" title="بيع بلا اتصال">
            <p className="acc-lead">
              البيع كامل الوظيفة: بحث وباركود وتسعير وحفظ محلي — الحالة الأصلية للنظام لا استثناؤه.
            </p>
            <p className="acc-lead">
              <strong>ما يتغيّر فقط</strong> · شارة «محفوظ محلياً» على كل فاتورة جديدة، وأرصدة
              موسومة بآخر مطابقة (ACC-76). لا وظيفة تُحجب.
            </p>
            {matchedAt ? (
              <p className="acc-choice__note">
                الأرصدة بآخر مطابقة <span className="sting-mono">{hhmm(matchedAt)}</span>
              </p>
            ) : null}
          </Notice>
        ) : null}
        {state === "stale" ? (
          <Notice kind="warning" title="أرصدة قديمة أثناء البيع">
            <p className="acc-lead">جهاز آخر يبيع من نفس المخزون.</p>
            <p className="acc-lead">
              <strong>تنبيه لا منع</strong> · آخر قطعة قد تُباع مرتين — نعرض «الرصيد قد يكون أقل»
              ولا نمنع البيع: البضاعة أمام الكاشير أصدق من الرقم (ACC-17).
            </p>
          </Notice>
        ) : null}
        {state === "loading" ? (
          <Notice kind="info" title="الكتالوج فوراً">
            <p className="acc-lead">
              البحث والباركود من قاعدة الجهاز بلا انتظار. ما يتأخر هو الأرصدة — وتُوسم حتى تصل.
            </p>
          </Notice>
        ) : null}

        <div className={`pos-body${tablet ? " pos-body--tablet" : ""}`}>
          {tablet ? cart : null}
          <section className="pos-panel" aria-label="الأصناف">
            {search}
            {chipsRow}
            {results}
            {foot}
          </section>
          {tablet ? null : cart}
        </div>
      </div>
      {sheet ? (
        <UnitSheet
          row={sheet.row}
          initialQtyMilli={sheet.qtyMilli}
          onConfirm={confirmSheet}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </Frame>
  );
}
