import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.33 — INV-10 استلام تحويل جزئي ومراجعة فرق (5). عمودان: المرسل كما ادّعاه المصدر وما تعدّه أنت؛
 * ما عُدّ يدخل مخزونك والفرق يبقى مفتوحاً على التحويل بسبب مكتوب — لا ترجيح؛ الزيادة لا تُقبل صامتة
 * (ACC-128)؛ الإشعار نفسه مرتين = استلام واحد (ACC-18)؛ الاستلام من الفرع المستقبل أو المالك.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function seed(page: Page, branch: "b1" | "b2", role: "owner" | "storekeeper") {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ branch, role }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      const name = branch === "b1" ? "الرئيسي" : "بحري";
      const code = branch === "b1" ? "KRT" : "BHR";
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections"], "readwrite");
        const meta = tx.objectStore("meta");
        const proj = tx.objectStore("projections");
        meta.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d2",
            prefix: "B1",
            branchId: branch,
            branchCode: code,
          }),
        });
        meta.put({ key: "sync_epoch", value: "epoch-A" });
        meta.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: branch,
            branchName: name,
            branchCode: code,
            deviceId: "d2",
            deviceName: "مخزن",
            devicePrefix: "B1",
            userId: "u2",
            userName: "أمين مخزن بحري",
            roleName: role === "owner" ? "مالك" : "أمين مخزن",
            roleCode: role,
          }),
        });
        proj.put({
          key: "entity:inventory.Balance:i5",
          value: { item_id: "i5", qty_milli: "20000", as_of: "2026-09-17T09:00:00.000Z" },
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { branch, role },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u2" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function pushRoute(page: Page, seen: Record<string, unknown>[]) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: {
        operation_id: string;
        kind: string;
        members: { entity: string; payload: Record<string, unknown> }[];
      }[];
      request_id: string;
    };
    seen.push(...body.operations);
    return route.fulfill(
      json(200, {
        protocol_version: 1,
        sync_epoch: "epoch-A",
        request_id: body.request_id,
        results: body.operations.map((o) => ({
          operation_id: o.operation_id,
          status: "accepted",
          member_receipts: [],
        })),
        server_seq_high: "9",
      }),
    );
  });
}

/** 10 سبتمبر 14:20 بالتوقيت المحلي للمتصفح — كما يُعرض. */
const sentAt = () => {
  const d = new Date();
  d.setMonth(8, 10);
  d.setHours(14, 20, 0, 0);
  return d.toISOString();
};

const transfer = (over: Record<string, unknown> = {}) => ({
  id: "t-71",
  transfer_number: "TRN-0071",
  branch_from_id: "b1",
  branch_from_name: "بحري",
  branch_to_id: "b2",
  branch_to_name: "الرئيسي",
  status: "sent",
  user_name: "عثمان ك.",
  note: "",
  sent_at: sentAt(),
  received_at: "",
  cancelled_at: "",
  late: false,
  in_transit_milli: "10000",
  in_transit_value_minor: "1200000",
  line_count: 1,
  lines: [
    {
      id: "ln-5",
      item_id: "i5",
      item_name: "دقيق 5 كغ",
      unit_name: "كيس",
      factor_milli: "1000",
      qty_milli: "10000",
      base_qty_milli: "10000",
      received_base_milli: "0",
      value_minor: "1200000",
    },
  ],
  ...over,
});

function detailRoute(page: Page, body: unknown) {
  return page.route("**/api/inventory/transfers/t-71", (route) =>
    route.fulfill(json(200, { transfer: body })),
  );
}

const PARTIAL_TEXTS = [
  "استلام تحويل",
  "TRN-0071",
  "من فرع بحري",
  "مُرسَل",
  "مستلم الآن",
  "فرق",
  "الصنف",
  "المستلم فعلياً",
  "دقيق 5 كغ",
  "سبب الفرق — إلزامي",
  "يدخل مخزونك",
  "فقط. الثلاثة الباقية تبقى مفتوحة على التحويل حتى يقرّ فرع بحري بالفرق أو يعترض — لا تُخصَم من مخزونه تلقائياً ولا تُضاف إلى مخزونك.",
  "إن وصل إشعار الاستلام نفسه مرتين — من جهازين أو بعد انقطاع — يُسجَّل استلام واحد. الباقي المفتوح لا يتضاعف.",
  "تأكيد استلام 7 وفتح مراجعة الفرق",
];

const CONFLICT_TEXTS = [
  "الفرعان يدّعيان رقمين",
  "لا ترجيح",
  "لا نأخذ رقم المرسل ولا المستلم. الفرق يُحجَز بقيمته ويُراجَع بقرار — والبضاعة قد تكون في الشاحنة أو سُرقت.",
  "من يقرّر",
  "المالك أو مدير أعلى من الفرعين. مديرُ أحدهما طرفٌ في الخلاف لا حكم.",
  "استُلم التحويل",
  "ما دخل رصيدك ومصير الفرق: مغلقٌ بتسوية، أو محجوز للمراجعة.",
  "مخزون الطريق يُصفّى",
  "ما استُلم يخرج من الطريق إلى الرصيد، وما بقي يبقى في الطريق موسوماً — لا يتبخّر ولا يُحتسب مرتين.",
];

test.describe("INV-10", () => {
  test("partial → conflict: عدّ 7 من 10 بسبب؛ السبعة تدخل الرصيد والثلاثة تبقى على التحويل؛ إعادة الضغط لا تضاعف", async ({
    page,
  }, info) => {
    await seed(page, "b2", "storekeeper");
    await detailRoute(page, transfer());
    const seen: Record<string, unknown>[] = [];
    await pushRoute(page, seen);
    await login(page, "/inventory/transfers/t-71/receive");
    const root = page.locator('[data-screen="INV-10"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("أُرسل 10 سبتمبر 14:20 · عثمان ك.");

    const minus = page.getByRole("button", { name: "نقص — دقيق 5 كغ" });
    await minus.click();
    await minus.click();
    await minus.click();
    await expectFrame(page, info, {
      screenId: "INV-10",
      state: "partial",
      texts: fromFrame("INV-10", "partial", PARTIAL_TEXTS),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(root).toContainText("−3");
    await expect(page.getByLabel("المستلم فعلياً — دقيق 5 كغ")).toHaveValue("7");

    // بلا سبب: لا يمرّ — الفرق لا يُسجَّل صامتاً
    await page.getByRole("button", { name: "تأكيد استلام 7 وفتح مراجعة الفرق" }).click();
    await expect(page.getByLabel("سبب الفرق — إلزامي")).toHaveAttribute("aria-invalid", "true");
    expect(seen).toHaveLength(0);

    await page.getByLabel("سبب الفرق — إلزامي").fill("ثلاثة أكياس لم تصل مع الشاحنة");
    await page.getByRole("button", { name: "تأكيد استلام 7 وفتح مراجعة الفرق" }).click();
    await expectFrame(page, info, {
      screenId: "INV-10",
      state: "conflict",
      texts: fromFrame("INV-10", "conflict", CONFLICT_TEXTS),
    });
    await expect(root).toContainText(
      "المصدر يقول أرسل 10 والمستقبل عدّ 7. 3 كيس مفقودة بين المخزنين.",
    );
    await expect(root).toContainText("الفرق المحجوز −3 كيس · بقيمة 3,600.00");
    await expect(root).toContainText("TRR-BHR-B1-");
    await expect(root).toContainText("محجوز للمراجعة");

    expect(seen).toHaveLength(1);
    const op = seen[0] as {
      kind: string;
      members: { entity: string; payload: Record<string, unknown> }[];
    };
    expect(op.kind).toBe("transfer_receipt");
    const head = op.members.find((m) => m.entity === "inventory.TransferReceipt")!;
    expect(head.payload["transfer_id"]).toBe("t-71");
    expect(head.payload["branch_id"]).toBe("b2");
    expect(head.payload["reason"]).toBe("ثلاثة أكياس لم تصل مع الشاحنة");
    const ln = op.members.find((m) => m.entity === "inventory.TransferReceiptLine")!;
    expect(ln.payload["sent_base_milli"]).toBe("10000");
    expect(ln.payload["received_base_milli"]).toBe("7000");
    const mv = op.members.filter((m) => m.entity === "inventory.StockMovement");
    expect(mv).toHaveLength(1);
    expect(mv[0]!.payload["reason"]).toBe("transfer_in");
    expect(mv[0]!.payload["delta_base_qty_milli"]).toBe("7000");
    expect(mv[0]!.payload["source_entity"]).toBe("inventory.TransferReceipt");

    // رصيد الجهاز: 20 + 7 = 27 — لا 30
    const qty = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const v = await new Promise<{ qty_milli: string } | undefined>((res) => {
        const r = db
          .transaction("projections")
          .objectStore("projections")
          .get("entity:inventory.Balance:i5");
        r.onsuccess = () => res((r.result as { value?: { qty_milli: string } })?.value);
      });
      db.close();
      return v?.qty_milli;
    });
    expect(qty).toBe("27000");
  });

  test("validation_error: عدُّ 12 والمرسل 10 — لا تُقبل صامتة؛ بسبب مكتوب تُحال إلى مراجعة الفرق", async ({
    page,
  }, info) => {
    await seed(page, "b2", "storekeeper");
    await detailRoute(page, transfer());
    const seen: Record<string, unknown>[] = [];
    await pushRoute(page, seen);
    await login(page, "/inventory/transfers/t-71/receive");
    const plus = page.getByRole("button", { name: "زيادة — دقيق 5 كغ" });
    await plus.click();
    await plus.click();
    await expectFrame(page, info, {
      screenId: "INV-10",
      state: "validation_error",
      texts: fromFrame("INV-10", "validation_error", [
        "استلام يتجاوز المرسل",
        "لا نقبل الزيادة صامتين",
        "قد يكون خطأ عدٍّ أو إرسالاً زائداً. تُسجَّل بسبب مكتوب وتُحال إلى مراجعة الفرق لا تُقبل بالسكوت (ACC-128).",
      ]),
    });
    const root = page.locator('[data-screen="INV-10"]');
    await expect(root).toContainText("عدُّ 12 والمرسل 10.");
    await expect(root).toContainText("+2");
    await page.getByLabel("سبب الفرق — إلزامي").fill("كيسان زائدان عن أمر التحويل");
    await expect(root).toHaveAttribute("data-state", "partial");
    await page.getByRole("button", { name: "تأكيد استلام 12 وفتح مراجعة الفرق" }).click();
    await expect(root).toHaveAttribute("data-state", "conflict");
    await expect(root).toContainText(
      "المصدر يقول أرسل 10 والمستقبل عدّ 12. 2 كيس زائدة بين المخزنين.",
    );
    const op = seen[0] as { members: { entity: string; payload: Record<string, unknown> }[] };
    const mv = op.members.filter((m) => m.entity === "inventory.StockMovement");
    expect(mv[0]!.payload["delta_base_qty_milli"]).toBe("12000");
  });

  test("ready → success: العدّ مطابق — يدخل الرصيد كاملاً ومخزون الطريق يُصفّى؛ التحويل المستلَم لا يُستلم ثانية", async ({
    page,
  }, info) => {
    await seed(page, "b2", "storekeeper");
    await detailRoute(page, transfer());
    const seen: Record<string, unknown>[] = [];
    await pushRoute(page, seen);
    await login(page, "/inventory/transfers/t-71/receive");
    await expectFrame(page, info, {
      screenId: "INV-10",
      state: "ready",
      texts: fromFrame("INV-10", "ready", [
        "استلام تحويل",
        "TRN-0071",
        "مُرسَل",
        "مستلم الآن",
        "فرق",
      ]),
    });
    const root = page.locator('[data-screen="INV-10"]');
    await expect(page.getByLabel("سبب الفرق — إلزامي")).toHaveCount(0);
    await page.getByRole("button", { name: "تأكيد استلام 10" }).click();
    await expectFrame(page, info, {
      screenId: "INV-10",
      state: "success",
      texts: fromFrame("INV-10", "success", [
        "استُلم التحويل",
        "ما دخل رصيدك ومصير الفرق: مغلقٌ بتسوية، أو محجوز للمراجعة.",
        "مخزون الطريق يُصفّى",
        "ما استُلم يخرج من الطريق إلى الرصيد، وما بقي يبقى في الطريق موسوماً — لا يتبخّر ولا يُحتسب مرتين.",
      ]),
    });
    await expect(root).not.toContainText("الفرعان يدّعيان رقمين");
    await expect(root).toContainText("دخل رصيدك");
    expect(seen).toHaveLength(1);

    // تحويل مستلَم سلفاً: لا زر مفعّل — الإشعار نفسه مرتين استلام واحد
    await page.unroute("**/api/inventory/transfers/t-71");
    await detailRoute(
      page,
      transfer({
        status: "received",
        in_transit_milli: "0",
        lines: [{ ...transfer().lines[0]!, received_base_milli: "10000" }],
      }),
    );
    await page.getByRole("button", { name: "أرصدة المخزون" }).click();
    await page.goto("/inventory/transfers/t-71/receive");
    await expect(root).toContainText("إن وصل إشعار الاستلام نفسه مرتين");
    await expect(page.getByRole("button", { name: /تأكيد استلام/ })).toBeDisabled();
  });

  test("INV-08: زر الاستلام مفعّل للفرع المستقبل وللمالك ويفتح INV-10؛ معطّل بسبب للمرسِل", async ({
    page,
  }) => {
    await seed(page, "b2", "storekeeper");
    await page.route(/\/api\/inventory\/transfers(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          branch_id: "b2",
          branches: [
            { id: "b1", name: "بحري" },
            { id: "b2", name: "الرئيسي" },
          ],
          can_send: true,
          awaiting_count: 1,
          partial_count: 0,
          transfers: [transfer()],
          as_of: new Date().toISOString(),
        }),
      ),
    );
    await detailRoute(page, transfer());
    await login(page, "/inventory/transfers?id=t-71");
    await page.getByRole("button", { name: "تسجيل استلام الرئيسي" }).click();
    await expect(page).toHaveURL(/\/inventory\/transfers\/t-71\/receive$/);
    await expect(page.locator('[data-screen="INV-10"]')).toHaveAttribute("data-state", "ready");
  });
});
