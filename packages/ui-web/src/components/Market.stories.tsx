import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Audience } from "./Audience";
import { Campaign } from "./Campaign";
import { TextField } from "./Field";
import { Compare, Listing } from "./Listing";
import { OrderTimeline } from "./OrderTimeline";
import { PhaseLocked, PhaseTag } from "./Phase";
import { Quote } from "./Quote";

const meta = { title: "السوق والحملات والمرحلة" } satisfies Meta;
export default meta;

const M3 =
  "هذه الوظيفة مصمَّمة وتُفعَّل في المرحلة M3 أو بعد اعتماد عقدها. ليست نقص صلاحية ولا عطلاً.";
export const Phase: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <PhaseTag
        kind="M3"
        explanation={M3}
        includes={["ربط الأطراف والأصناف", "تحويل الطلب إلى مستندات مستقلة لكل طرف"]}
      />
      <PhaseTag
        kind="conditional"
        explanation="تحتاج عقد التكلفة (G-03): لا تكلفة مفقودة تُعرض صفراً ولا ربح إجمالي كصافٍ."
      />
      <PhaseLocked kind="M3" explanation={M3}>
        <TextField label="ربط الصنف المحلي" defaultValue="سكر 50 كغ ← SKU-001" />
      </PhaseLocked>
    </div>
  ),
};

export const ListingCards: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
      <Listing
        title="سكر 50 كغ"
        seller="مخزن البركة — تجريبي"
        verified
        priceMinor="4500000"
        currency="ج.س"
        unitLabel="كيس 50 كغ"
        minOrderLabel="الحد الأدنى 10 أكياس"
        deliveryLabel="توصيل داخل الخرطوم"
        freshnessLabel="أُكد السعر 14 سبتمبر"
        href="#"
      />
      <Listing
        title="زيت 1 لتر"
        seller="مخزن النخيل — تجريبي"
        priceMinor={null}
        currency="ج.س"
        unitLabel="كرتونة 12"
        freshnessLabel="آخر تحديث 1 سبتمبر"
        expired
        href="#"
      />
      <Listing
        title="أرز"
        seller="متجر الأمان — تجريبي"
        priceMinor="9500000"
        currency="ج.س"
        unitLabel="كيس 25 كغ"
        freshnessLabel="أُكد اليوم"
        sponsored
        feesNote="رسوم التوصيل غير محسومة — تظهر قبل التأكيد"
        href="#"
      />
      <Listing
        title="عرض خاص"
        seller="مخزن البركة — تجريبي"
        verified
        priceMinor="1"
        currency="ج.س"
        unitLabel="كرتونة"
        freshnessLabel="أُكد اليوم"
        privatePrice
        href="#"
      />
    </div>
  ),
};
export const CompareUnits: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <Compare
        unitLabel="حبة"
        currency="ج.س"
        rows={[
          { seller: "البركة", unitPriceMinor: "9000", feesIncluded: true },
          { seller: "النخيل", unitPriceMinor: "8500", feesIncluded: true },
        ]}
      />
      <Compare
        unitLabel="حبة"
        currency="ج.س"
        rows={[
          { seller: "البركة (كرتونة 12)", unitPriceMinor: "9000", feesIncluded: true },
          { seller: "النخيل (كرتونة 24)", unitPriceMinor: null, feesIncluded: false },
        ]}
      />
    </div>
  ),
};

const lines = [
  {
    id: "1",
    item: "سكر 50 كغ",
    unitLabel: "كيس",
    qtyLabel: "10",
    unitPriceMinor: "4500000",
    lineTotalMinor: "45000000",
  },
  {
    id: "2",
    item: "زيت 1 لتر",
    unitLabel: "كرتونة",
    qtyLabel: "5",
    unitPriceMinor: "936000",
    lineTotalMinor: "4680000",
  },
];
const terms = [
  "البائع: مخزن البركة — موثّق الهوية؛ الشارة تخص الهوية ولا تضمن الجودة أو السداد",
  "التوصيل: البائع خلال يومين داخل الخرطوم",
  "التحصيل: نقداً عند الاستلام",
  "المرتجع: خلال 48 ساعة للتالف فقط",
];
export const QuoteEditable: StoryObj = {
  render: () => (
    <Quote
      revision={2}
      lines={lines}
      totalMinor="49680000"
      currency="ج.س"
      validUntilLabel="2026-09-20"
      onPrice={() => {}}
      onAddLine={() => {}}
      onRemoveLine={() => {}}
      onSend={() => {}}
      sendConfirmText="سيصل العرض للمشتري بالنسخة 2؛ أي تعديل لاحق ينشئ نسخة جديدة ولا يغيّر هذه."
      terms={terms}
    />
  ),
};
export const QuoteExpired: StoryObj = {
  render: () => (
    <Quote
      revision={1}
      lines={lines}
      totalMinor="49680000"
      currency="ج.س"
      validUntilLabel="2026-09-10"
      expired
      readOnly
      sendConfirmText=""
      terms={terms}
    />
  ),
};

export const Timeline: StoryObj = {
  render: () => (
    <OrderTimeline
      label="مسار الطلب 88"
      onOpen={() => {}}
      stages={[
        { id: "submitted", label: "أُرسل", state: "done", atLabel: "09-12" },
        { id: "quoted", label: "عرض سعر", state: "done", atLabel: "09-13", detail: "النسخة 2" },
        { id: "confirmed", label: "مؤكد", state: "done", atLabel: "09-14" },
        { id: "shipped", label: "مشحون", state: "partial", detail: "8 من 10" },
        { id: "received", label: "مستلم", state: "current", detail: "7 من 8" },
        { id: "closed", label: "مغلق", state: "upcoming" },
      ]}
    />
  ),
};

export const AudiencePicker: StoryObj = {
  render: function Demo() {
    const [k, setK] = useState<"all" | "segment" | "upload">("all");
    return (
      <Audience
        kind={k}
        onKind={setK}
        size={k === "all" ? 128 : 42}
        sizeLabel={(n) => `${n} مشتركاً`}
        scopeNote="الجمهور من مشتركي قناة هذا المحل فقط — لا يظهر جمهور محل آخر (§١١.٥)"
        segmentControls={<TextField label="اشترى خلال" defaultValue="30 يوماً" />}
      />
    );
  },
};

export const CampaignEditor: StoryObj = {
  render: function Demo() {
    const [t, setT] = useState("عرض نهاية الأسبوع");
    const [b, setB] = useState("مرحباً {name}، خصم 10% على السكر حتى الجمعة في {shop}.");
    return (
      <Campaign
        stage="draft"
        title={t}
        body={b}
        onTitle={setT}
        onBody={setB}
        onSave={() => {}}
        variables={{ name: "أحمد", shop: "بقالة النيل" }}
      />
    );
  },
};
export const CampaignDelivered: StoryObj = {
  render: () => (
    <Campaign
      stage="completed"
      title="عرض نهاية الأسبوع"
      body="مرحباً {name}"
      onTitle={() => {}}
      onBody={() => {}}
      variables={{ name: "أحمد" }}
      readOnly
      scheduleLabel="2026-09-12 18:00"
      delivery={{ accepted: 128, delivered: 97, read: null, failed: 3 }}
    />
  ),
};
