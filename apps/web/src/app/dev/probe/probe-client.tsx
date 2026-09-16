"use client";

import { saveOperation } from "@sting/sync-core";
import { Button, Frame, Nav, Notice, Status, SyncIndicator } from "@sting/ui-web";
import { useEffect, useState } from "react";

import { getStorage } from "@/lib/storage";

type Kind = "ready" | "offline" | "error";

export function ProbeClient() {
  const [kind, setKind] = useState<Kind>("ready");
  const [stored, setStored] = useState<string>("—");
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("state");
    if (k === "offline" || k === "error") setKind(k);
  }, []);

  const saveProbe = async () => {
    const storage = getStorage("sting-probe");
    const id = crypto.randomUUID();
    await saveOperation(storage, {
      operationId: id,
      kind: "probe",
      opVersion: 1,
      dependencies: [],
      members: [
        {
          entity: "probe.Head",
          id: crypto.randomUUID(),
          schemaVersion: 1,
          payload: { value: "9007199254740993" },
        },
      ],
    });
    const back = await storage.read((tx) => tx.getOperation(id));
    setStored(
      `${back?.operationId === id ? "محفوظ" : "مفقود"} · seq ${back?.createdLocalSeq ?? "?"} · ${String(back?.members[0]?.payload.value)}`,
    );
  };

  return (
    <Frame
      title="بقالة النيل — تجريبي"
      nav={
        <Nav
          label="التنقل الرئيسي"
          currentId="probe"
          items={[
            { id: "home", label: "الرئيسية", href: "/" },
            { id: "probe", label: "الفحص", href: "/dev/probe" },
          ]}
        />
      }
      footer={<span data-testid="version">الإصدار 0.0.0 · الجهاز A2</span>}
      notice={
        kind === "offline" ? (
          <Status state="offline" label="بلا اتصال — البيع والوردية يعملان محلياً" />
        ) : undefined
      }
    >
      <div data-screen="PROBE" data-state={kind} style={{ display: "grid", gap: 16 }}>
        <SyncIndicator
          state={kind === "offline" ? "offline" : "synced"}
          lastServerAt="10:30"
          pendingCount={kind === "offline" ? 3 : 0}
          pendingLabel={(n) => `${n} عمليات معلقة من هذا الجهاز`}
        />
        {kind === "ready" ? (
          <Notice kind="empty" title="لا عملاء بعد" action={<Button>إضافة عميل</Button>}>
            يُنشأ العميل عند أول بيع آجل، أو أضفه الآن.
          </Notice>
        ) : null}
        {kind === "offline" ? (
          <Notice kind="warning" title="حُفظ البيع محلياً — لم تتم الطباعة">
            الفاتورة 1043 مسجَّلة. الطابعة غير متصلة؛ أعد طباعة نسخة بنفس الرقم دون تسجيل بيع جديد.
          </Notice>
        ) : null}
        {kind === "error" ? (
          <Notice kind="error" title="لم يُحفظ البيع">
            امتلأ تخزين الجهاز. صدّر نسخة محلية أو احذف نسخاً قديمة ثم أعد المحاولة. لا تعتبر هذه
            الفاتورة مُسجَّلة.
          </Notice>
        ) : null}
        <div>
          <Button onClick={() => void saveProbe()} data-testid="save-probe">
            احفظ عملية فحص في IndexedDB
          </Button>
          <p data-testid="stored" className="sting-mono">
            {stored}
          </p>
        </div>
      </div>
    </Frame>
  );
}
