import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./Button";
import { Cart } from "./Cart";
import { LedgerLines } from "./LedgerLine";
import { Money, MoneyInput, Settlement } from "./Money";
import { Notice } from "./Notice";
import { PrintControls, Receipt } from "./Print";
import { QtyUnit } from "./QtyUnit";
import { ReceiveLine } from "./Receive";
import { SyncIndicator, SyncQueue } from "./Sync";

const meta = { title: "المكوّنات المالية" } satisfies Meta;
export default meta;

export const MoneyDisplay: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 8 }}>
      <Money minor="10000" currency="ج.س" />
      <Money minor="-4000" currency="ج.س" />
      <Money minor="126000" currency="ج.س" ledger size="title" />
      <Money minor="-4000" currency="ج.س" ledger />
    </div>
  ),
};
export const MoneyInputStates: StoryObj = {
  render: function Demo() {
    const [v, setV] = useState("4000");
    return (
      <div style={{ display: "grid", gap: 12, maxWidth: 320 }}>
        <MoneyInput
          label="المبلغ النقدي"
          value={v}
          onChange={(m) => m && setV(m)}
          currency="ج.س"
          hint="الأسهم تزيد وتنقص بجنيه"
        />
        <MoneyInput
          label="المبلغ الآجل"
          value="7000"
          onChange={() => {}}
          currency="ج.س"
          error="مجموع التسوية 110.00 يتجاوز الإجمالي 100.00 — عدّل أحد المبلغين."
        />
        <MoneyInput
          label="سعر الصنف"
          value="78000"
          onChange={() => {}}
          currency="ج.س"
          disabledReason="تعديل السعر يحتاج اتصالاً"
        />
      </div>
    );
  },
};
export const SettlementMixed: StoryObj = {
  render: function Demo() {
    const [s, setS] = useState({ cash: "4000", credit: "6000", bank: "0" });
    return (
      <Settlement
        totalMinor="10000"
        cashMinor={s.cash}
        creditMinor={s.credit}
        bankMinor={s.bank}
        currency="ج.س"
        onChange={(part, m) => m !== null && setS((x) => ({ ...x, [part]: m }))}
      />
    );
  },
};
export const SettlementMismatch: StoryObj = {
  render: () => (
    <Settlement
      totalMinor="10000"
      cashMinor="4000"
      creditMinor="7000"
      bankMinor="0"
      currency="ج.س"
      onChange={() => {}}
    />
  ),
};
export const SettlementNoParty: StoryObj = {
  render: () => (
    <Settlement
      totalMinor="10000"
      cashMinor="10000"
      creditMinor="0"
      bankMinor="0"
      currency="ج.س"
      onChange={() => {}}
      creditDisabledReason="اختر عميلاً أولاً — الآجل يحتاج طرفاً"
    />
  ),
};

const units = [
  { id: "pc", label: "حبة", decimalPlaces: 0 as const, factorNum: "1" },
  { id: "ctn", label: "كرتونة", decimalPlaces: 0 as const, factorNum: "24" },
  { id: "kg", label: "كغ", decimalPlaces: 3 as const, factorNum: "1" },
];
export const QtyWithConversion: StoryObj = {
  render: function Demo() {
    const [v, setV] = useState({ qtyMilli: "2000", unitId: "ctn" });
    return (
      <QtyUnit
        label="الكمية"
        qtyMilli={v.qtyMilli}
        unitId={v.unitId}
        units={units}
        baseUnitLabel="حبة"
        onChange={(n) => setV({ qtyMilli: n.qtyMilli ?? v.qtyMilli, unitId: n.unitId })}
      />
    );
  },
};
export const QtyWeight: StoryObj = {
  render: () => (
    <QtyUnit
      label="الوزن"
      qtyMilli="123"
      unitId="kg"
      units={units}
      baseUnitLabel="كغ"
      onChange={() => {}}
    />
  ),
};
export const QtyUnresolved: StoryObj = {
  render: () => (
    <QtyUnit
      label="الكمية"
      qtyMilli="1000"
      unitId="pc"
      units={units}
      baseUnitLabel="حبة"
      onChange={() => {}}
      unresolvedUnit
    />
  ),
};

const pendingLabel = (n: number) =>
  n === 1
    ? "عملية معلقة من هذا الجهاز"
    : n === 2
      ? "عمليتان معلقتان من هذا الجهاز"
      : `${n} عمليات معلقة من هذا الجهاز`;
export const SyncStates: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 10 }}>
      <SyncIndicator
        state="synced"
        lastServerAt="10:30"
        pendingCount={0}
        pendingLabel={pendingLabel}
        onOpen={() => {}}
        onSyncNow={() => {}}
      />
      <SyncIndicator
        state="pending_sync"
        lastServerAt="10:30"
        pendingCount={3}
        pendingLabel={pendingLabel}
        onOpen={() => {}}
        onSyncNow={() => {}}
      />
      <SyncIndicator
        state="offline"
        lastServerAt="10:30"
        pendingCount={3}
        pendingLabel={pendingLabel}
        onOpen={() => {}}
        onSyncNow={() => {}}
      />
      <SyncIndicator
        state="conflict"
        lastServerAt="10:30"
        pendingCount={1}
        conflictCount={1}
        pendingLabel={pendingLabel}
        onOpen={() => {}}
      />
      <SyncIndicator
        state="saved_local"
        lastServerAt={null}
        pendingCount={1}
        pendingLabel={pendingLabel}
      />
    </div>
  ),
};
export const Queue: StoryObj = {
  render: () => (
    <SyncQueue
      empty="كل العمليات مؤكَّدة خادمياً — لا معلّق على هذا الجهاز"
      items={[
        {
          id: "1",
          title: "فاتورة 1043 — بيع آجل",
          state: "pending_sync",
          atLabel: "10:31",
          amountLabel: "60.00",
        },
        {
          id: "2",
          title: "سداد أحمد الطيب",
          state: "saved_local",
          atLabel: "10:32",
          amountLabel: "40.00",
        },
        {
          id: "3",
          title: "فاتورة 1041",
          state: "conflict",
          atLabel: "09:58",
          amountLabel: "120.00",
        },
      ]}
    />
  ),
};

export const Ledger: StoryObj = {
  render: () => (
    <LedgerLines
      caption="كشف حساب — أحمد الطيب"
      currency="ج.س"
      onOpen={() => {}}
      rows={[
        {
          id: "1",
          dateLabel: "10 سبتمبر",
          document: "فاتورة 1042",
          direction: "debit",
          amountMinor: "12000",
          runningBalanceMinor: "12000",
          state: "synced",
        },
        {
          id: "2",
          dateLabel: "11 سبتمبر",
          document: "فاتورة 1043",
          direction: "debit",
          amountMinor: "6000",
          runningBalanceMinor: "18000",
          state: "pending_sync",
        },
        {
          id: "3",
          dateLabel: "11 سبتمبر",
          document: "سداد نقدي",
          direction: "credit",
          amountMinor: "4000",
          runningBalanceMinor: "14000",
          state: "synced",
        },
      ]}
    />
  ),
};

export const PosCart: StoryObj = {
  render: function Demo() {
    const all = [
      {
        id: "a",
        name: "سكر",
        qtyLabel: "1",
        unitLabel: "حبة",
        unitPriceMinor: "10000",
        lineTotalMinor: "10000",
      },
      {
        id: "b",
        name: "أرز",
        qtyLabel: "0.123",
        unitLabel: "كغ",
        unitPriceMinor: "78000",
        lineTotalMinor: "9594",
      },
    ];
    const [removed, setRemoved] = useState<string[]>([]);
    const lines = all.filter((l) => !removed.includes(l.id));
    return (
      <Cart
        lines={lines}
        totalMinor={lines.reduce((a, l) => a + BigInt(l.lineTotalMinor), 0n).toString()}
        currency="ج.س"
        onRemove={(id) => setRemoved((r) => [...r, id])}
        onUndoRemove={(id) => setRemoved((r) => r.filter((x) => x !== id))}
        onQty={() => {}}
        empty={<Notice kind="empty" title="السلة فارغة" children="اختر صنفاً من اللوحة" />}
        footer={<Button financial>احفظ البيع</Button>}
      />
    );
  },
};
export const EmptyCart: StoryObj = {
  render: () => (
    <Cart
      lines={[]}
      totalMinor="0"
      currency="ج.س"
      onRemove={() => {}}
      empty={<Notice kind="empty" title="السلة فارغة" children="اختر صنفاً من اللوحة" />}
    />
  ),
};

export const Receive: StoryObj = {
  render: function Demo() {
    const [r, setR] = useState("7000");
    return (
      <ReceiveLine
        item="سكر 50 كغ"
        unitLabel="كيس"
        decimalPlaces={0}
        requestedMilli="10000"
        confirmedMilli="8000"
        shippedMilli="8000"
        receivedMilli={r}
        onReceived={(m) => m && setR(m)}
      />
    );
  },
};
export const ReceiveOver: StoryObj = {
  render: () => (
    <ReceiveLine
      item="زيت"
      unitLabel="كرتونة"
      decimalPlaces={0}
      requestedMilli="10000"
      confirmedMilli="8000"
      receivedMilli="9000"
      onReceived={() => {}}
      error="المستلم 9 يتجاوز المؤكد 8 — لا استلام يتجاوز الشحنة (§٧.٨)"
    />
  ),
};

const receipt = (copy: boolean) => (
  <Receipt
    shopName="بقالة النيل — تجريبي"
    title="فاتورة"
    number="INV-KRT-A2-26-000043"
    dateLabel="2026-09-15 10:31"
    copy={copy}
    lines={[
      { label: "سكر × 1", value: "100.00", mono: true },
      { label: "أرز × 0.123 كغ", value: "95.94", mono: true },
      { label: "الإجمالي", value: "195.94", mono: true, strong: true },
      { label: "نقداً", value: "100.00", mono: true },
      { label: "آجل على أحمد الطيب", value: "95.94", mono: true },
    ]}
    footer="شكراً — الكاشير: أحمد"
  />
);
export const ReceiptOriginal: StoryObj = { render: () => receipt(false) };
export const ReceiptCopy: StoryObj = { render: () => receipt(true) };
export const PrintStates: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <PrintControls
        outcome="idle"
        printerAvailable
        onPrint={() => {}}
        onReprint={() => {}}
        onPreview={() => {}}
        number="1043"
      />
      <PrintControls
        outcome="failed"
        printerAvailable
        onPrint={() => {}}
        onReprint={() => {}}
        number="1043"
      />
      <PrintControls
        outcome="unknown"
        printerAvailable
        onPrint={() => {}}
        onReprint={() => {}}
        number="1043"
      />
      <PrintControls outcome="idle" printerAvailable={false} onPrint={() => {}} number="1043" />
    </div>
  ),
};
