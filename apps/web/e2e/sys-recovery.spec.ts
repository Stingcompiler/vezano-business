import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.38 — SYS-07 استرداد جهاز مسحوب (5) + SYS-08 تغيّر جيل الخادم والمصالحة (4). الاسترداد للمالك
 * بتفصيله والمدير يرى العدد والقيمة؛ الجهاز يبقى مسحوباً؛ التعارض إلى SYS-03؛ لا محو قبل إنقاذ
 * المعلّق. الجيل الجديد يُسجَّل ولا يُعتمد تلقائياً؛ الردّ القديم يُهمل؛ المصالحة بالهويات الأصلية.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface OpSeed {
  readonly id: string;
  readonly state: "local" | "synced";
  readonly number: string;
  readonly amount: string;
}

async function seed(
  page: Page,
  role: "owner" | "manager",
  ops: readonly OpSeed[],
  meta: Record<string, string> = {},
) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, ops, meta }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "operations"], "readwrite");
        const m = tx.objectStore("meta");
        const o = tx.objectStore("operations");
        m.clear();
        o.clear();
        m.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "POS1",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        m.put({ key: "sync_epoch", value: "epoch-G17" });
        m.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "حاسوب الكاشير 1",
            devicePrefix: "POS1",
            userId: "u1",
            userName: role === "owner" ? "سالم" : "مدير الفرع",
            roleName: role === "owner" ? "مالك" : "مدير فرع",
            roleCode: role,
          }),
        });
        for (const [k, v] of Object.entries(meta)) m.put({ key: k, value: v });
        let seq = 1;
        for (const s of ops) {
          o.put({
            operationId: s.id,
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [
              {
                entity: "sales.Sale",
                id: `${s.id}-h`,
                schemaVersion: 1,
                serverSeq: s.state === "synced" ? "5" : null,
                payload: { invoice_number: s.number, total_minor: s.amount },
              },
              {
                entity: "sales.Payment",
                id: `${s.id}-p`,
                schemaVersion: 1,
                serverSeq: null,
                payload: { method: "cash", amount_minor: s.amount },
              },
            ],
            state: s.state,
            createdLocalSeq: seq++,
            snapshotRelation: "none",
          });
          m.put({
            key: `sync.attempts:${s.id}`,
            value: JSON.stringify([{ at: new Date().toISOString(), event: "saved" }]),
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role, ops, meta },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

const member = (id: string, number: string, amount: string) => [
  { entity: "sales.Sale", id: `${id}-h`, payload: { invoice_number: number, total_minor: amount } },
  { entity: "sales.Payment", id: `${id}-p`, payload: { method: "cash", amount_minor: amount } },
];

const device = (over: Record<string, unknown> = {}) => ({
  id: "dev-9",
  name: "هاتف المخزن",
  prefix: "STK",
  branch_name: "الرئيسي",
  status: "revoked",
  revoked_at: new Date().toISOString(),
  frozen_at: "",
  wiped_at: "",
  held_count: 2,
  held_value_minor: "240000",
  reported_pending: 2,
  reported_pending_at: new Date().toISOString(),
  last_seen_at: new Date(Date.now() - 86_400_000).toISOString(),
  actor_names: ["عثمان ك."],
  items: [
    {
      id: "q-1",
      operation_id: "op-1",
      kind: "sale",
      members: member("op-1", "INV-KRT-STK-26-000041", "100000"),
      received_at: new Date().toISOString(),
      effect_minor: "100000",
    },
    {
      id: "q-2",
      operation_id: "op-2",
      kind: "sale",
      members: member("op-2", "INV-KRT-STK-26-000042", "140000"),
      received_at: new Date().toISOString(),
      effect_minor: "140000",
    },
  ],
  ...over,
});

test.describe("SYS-07", () => {
  test("ready → success: ما على الجهاز المسحوب بتفصيله؛ الاسترداد منسوب لمن أنشأه والجهاز يبقى مسحوباً", async ({
    page,
  }, info) => {
    await seed(page, "owner", []);
    const actions: string[] = [];
    await page.route(/\/api\/sync\/recovery(\?.*)?$/, (route) =>
      route.fulfill(json(200, { is_owner: true, devices: [device()] })),
    );
    await page.route("**/api/sync/recovery/dev-9/restore", (route) => {
      actions.push("restore");
      return route.fulfill(
        json(200, {
          device_id: "dev-9",
          status: "revoked",
          restored: 2,
          duplicate: 0,
          conflicted: 0,
          rejected: 0,
        }),
      );
    });
    await login(page, "/sync/recovery");
    await expectFrame(page, info, {
      screenId: "SYS-07",
      state: "ready",
      texts: fromFrame("SYS-07", "ready", [
        "استرداد جهاز مسحوب",
        "جهاز سُحب وصوله وعليه عمل لم يُرفع. السحب قرار إداري والعمل أمانة مال — والشاشة تفصل بينهما.",
        "ما على الجهاز المسحوب",
        "السحب قائم",
        "الجهاز لا يستعيد وصوله بهذا. الاسترداد يسحب العمل ولا يُعيد الصلاحية — فعلان منفصلان.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-07"]');
    await expect(root).toContainText("هاتف المخزن · STK · الرئيسي");
    await expect(root).toContainText("2 عمليات بـ2,400.00");
    await expect(root).toContainText("INV-KRT-STK-26-000041");
    await expect(root).toContainText("عثمان ك.");
    await page.getByRole("button", { name: "استرداد العمل إلى الدفتر" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-07",
      state: "success",
      texts: fromFrame("SYS-07", "success", [
        "استُرد العمل",
        "عمليات دخلت الدفتر منسوبةً إلى من أنشأها لا إلى من استردّها — والفرق بينهما مسجّل في السجل.",
        "والجهاز",
        "يبقى مسحوباً. نقولها في شاشة النجاح لئلا يُظنّ أن الاسترداد أعاده للخدمة.",
      ]),
    });
    expect(actions).toEqual(["restore"]);
  });

  test("conflict: عملٌ مسترد يعارض ما وقع بعده — لا ترجيح تلقائي، يُحال إلى SYS-03", async ({
    page,
  }, info) => {
    await seed(page, "owner", []);
    await page.route(/\/api\/sync\/recovery(\?.*)?$/, (route) =>
      route.fulfill(json(200, { is_owner: true, devices: [device()] })),
    );
    await page.route("**/api/sync/recovery/dev-9/restore", (route) =>
      route.fulfill(
        json(200, {
          device_id: "dev-9",
          status: "revoked",
          restored: 1,
          duplicate: 0,
          conflicted: 1,
          rejected: 0,
        }),
      ),
    );
    await login(page, "/sync/recovery");
    await page.getByRole("button", { name: "استرداد العمل إلى الدفتر" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-07",
      state: "conflict",
      texts: fromFrame("SYS-07", "conflict", [
        "عملٌ مسترد يعارض ما وقع بعده",
        "لا ترجيح تلقائي",
        "لا الأقدم ولا الأحدث. البيعان وقعا فعلاً ونقدهما في درجين مختلفين. يُحال إلى",
        "بالنسختين.",
      ]),
    });
    await expect(page.locator("body")).toContainText("يُحال إلى «مراجعة التعارضات» بالنسختين.");
    await expect(page.locator('[data-screen="SYS-07"]')).toContainText("دخل 1 · تعارض 1 · رُفض 0");
    await page.getByRole("button", { name: "مراجعة المالك" }).click();
    await expect(page).toHaveURL(/\/sync\/review$/);
  });

  test("permission_denied: المدير يرى العدد والقيمة بلا تفصيل", async ({ page }, info) => {
    await seed(page, "manager", []);
    await page.route(/\/api\/sync\/recovery(\?.*)?$/, (route) =>
      route.fulfill(json(200, { is_owner: false, devices: [device({ items: undefined })] })),
    );
    await login(page, "/sync/recovery");
    await expectFrame(page, info, {
      screenId: "SYS-07",
      state: "permission_denied",
      texts: fromFrame("SYS-07", "permission_denied", [
        "الاسترداد للمالك",
        "مدير الفرع سحب الجهاز ولا يسترد عمله: الاسترداد يقرأ عمليات موظف آخر بتفصيله",
        "ما يراه المدير",
        "العدد والقيمة الإجمالية بلا تفصيل — يكفي لأن يعرف أن ثمّة ما يُسترد فيطلبه.",
      ]),
    });
    const root = page.locator('[data-screen="SYS-07"]');
    await expect(root).toContainText("2 عمليات بـ2,400.00");
    await expect(root).not.toContainText("INV-KRT-STK-26-000041");
    await expect(page.getByRole("button", { name: "استرداد العمل إلى الدفتر" })).toHaveCount(0);
  });

  test("pending_sync: معلّق غير مرفوع — تجميد فوري أو محو بعد إقرار مكتوب", async ({
    page,
  }, info) => {
    await seed(page, "owner", []);
    let status = "revoked";
    const calls: Record<string, unknown>[] = [];
    await page.route(/\/api\/sync\/recovery(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          is_owner: true,
          devices: [
            device({
              held_count: 0,
              held_value_minor: "0",
              reported_pending: 9,
              status,
              items: [],
            }),
          ],
        }),
      ),
    );
    await page.route("**/api/sync/recovery/dev-9/freeze", (route) => {
      status = "frozen";
      calls.push({ action: "freeze" });
      return route.fulfill(
        json(200, device({ status: "frozen", held_count: 0, reported_pending: 9 })),
      );
    });
    await page.route("**/api/sync/recovery/dev-9/wipe", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      calls.push({ action: "wipe", ...body });
      status = "wiped";
      return route.fulfill(
        json(200, device({ status: "wiped", held_count: 0, reported_pending: 9 })),
      );
    });
    await login(page, "/sync/recovery");
    await expectFrame(page, info, {
      screenId: "SYS-07",
      state: "pending_sync",
      texts: fromFrame("SYS-07", "pending_sync", [
        "خطر فقد",
        "عمليات لم تصل",
        ". محوها الآن يعني أن بضاعة خرجت من مخزنك بلا قيد.",
        "تجميد الجهاز الآن",
        "محو — بعد الإقرار",
        "يُجمَّد الجهاز فوراً: لا بيع جديد، لا وصول للبيانات، والمحفوظ باقٍ.",
      ]),
    });
    const root = page.locator('[data-screen="SYS-07"]');
    await expect(root).toContainText("على الجهاز 9 عمليات لم تصل");
    // بلا إقرار: لا محو
    await page.getByRole("button", { name: "محو — بعد الإقرار" }).click();
    await expect(page.getByLabel("إقرار مكتوب بفقد المعلّق")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(calls).toHaveLength(0);
    await page.getByRole("button", { name: "تجميد الجهاز الآن" }).click();
    await expect(root).toContainText("مجمَّد");
    await page.getByLabel("إقرار مكتوب بفقد المعلّق").fill("أقرّ بفقد العمليات التسع — سالم");
    await page.getByRole("button", { name: "محو — بعد الإقرار" }).click();
    await expect(root).toContainText("ممحو");
    expect(calls).toEqual([
      { action: "freeze" },
      { action: "wipe", acknowledgement: "أقرّ بفقد العمليات التسع — سالم" },
    ]);
  });
});

test.describe("SYS-08", () => {
  const change = JSON.stringify({
    previous: "epoch-G17",
    next: "epoch-G18",
    detectedAt: new Date().toISOString(),
  });

  test("conflict → pending_sync → success: الخادم لا يعرف عملك؛ المصالحة بالهويات — موجودة · سترفع · للمراجعة", async ({
    page,
  }, info) => {
    await seed(
      page,
      "owner",
      [
        { id: "op-1", state: "synced", number: "INV-1", amount: "10000" },
        { id: "op-2", state: "synced", number: "INV-2", amount: "20000" },
        { id: "op-3", state: "local", number: "INV-3", amount: "30000" },
      ],
      { "sync.epoch_change": change },
    );
    const pushed: string[][] = [];
    await page.route("**/api/sync/reconcile", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { operation_ids: string[] };
      const ids = body.operation_ids;
      return route.fulfill(
        json(200, {
          sync_epoch: "epoch-G18",
          present: ids.filter((i) => i === "op-1"),
          missing: ids.filter((i) => i !== "op-1"),
        }),
      );
    });
    await page.route("**/api/sync/push", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        sync_epoch: string;
        request_id: string;
        operations: { operation_id: string }[];
      };
      pushed.push(body.operations.map((o) => o.operation_id));
      expect(body.sync_epoch).toBe("epoch-G18");
      return route.fulfill(
        json(200, {
          protocol_version: 1,
          sync_epoch: "epoch-G18",
          request_id: body.request_id,
          results: body.operations.map((o) => ({
            operation_id: o.operation_id,
            status: o.operation_id === "op-2" ? "conflicted" : "accepted",
            member_receipts: [],
          })),
          server_seq_high: "9",
        }),
      );
    });
    await page.route("**/api/sync/status", (route) =>
      route.fulfill(
        json(200, {
          server_time: new Date().toISOString(),
          sync_epoch: "epoch-G18",
          server_seq_high: "9",
          quarantined: 0,
          conflicted: 1,
          last_accepted_at: null,
        }),
      ),
    );
    await login(page, "/sync/epoch");
    await expectFrame(page, info, {
      screenId: "SYS-08",
      state: "conflict",
      texts: fromFrame("SYS-08", "conflict", [
        "الخادم لا يعرف عملك",
        "كانت «مؤكَّدة» وصارت غير معروفة.",
        "نعترف بالأمر",
        "«الخادم استُعيد إلى نقطة سابقة — عملك سليم على جهازك ولم يعد عنده». لا نلوم الشبكة ولا نُخفي خلف رسالة مزامنة عامة.",
        "لا نمسح ولا نرفع تلقائياً",
        "رفعٌ أعمى قد يُنتج ازدواجاً مع ما نجا عند الخادم. المصالحة تُقارن بالهويات الأصلية أولاً.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-08"]');
    await expect(root).toContainText("على جهازك 2 عملية مؤكَّدة بعد تلك النقطة");
    await expect(root).toContainText("الجيل الحاليpoch-G18");
    await page.getByRole("button", { name: "ابدأ المصالحة" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-08",
      state: "success",
      texts: fromFrame("SYS-08", "success", [
        "تمّت المصالحة",
        "استقرّ الدفتران.",
        "أثرٌ دائم",
        "الحدث يبقى في سجل التدقيق بتاريخه. من يراجع بعد أشهر سيجد فجوةً في الترقيم — هذا السطر يفسّرها.",
      ]),
    });
    await expect(root).toContainText("1 موجودة · 2 رُفعت · 1 للمراجعة");
    // op-1 نجت فلم تُرفع؛ op-2 و op-3 رُفعتا بهويتيهما الأصليتين على الجيل الجديد
    expect(pushed.flat().sort()).toEqual(["op-2", "op-3"]);
    const epoch = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const v = await new Promise<string>((res) => {
        const r = db.transaction("meta").objectStore("meta").get("sync_epoch");
        r.onsuccess = () => res((r.result as { value: string }).value);
      });
      db.close();
      return v;
    });
    expect(epoch).toBe("epoch-G18");
  });

  test("stale: المعلَّق ليس مفقوداً — بعدد وقيمة، ويُعاد على الجيل الجديد", async ({
    page,
  }, info) => {
    await seed(page, "owner", [{ id: "op-3", state: "local", number: "INV-3", amount: "30000" }], {
      "sync.epoch_change": change,
    });
    await login(page, "/sync/epoch");
    await expectFrame(page, info, {
      screenId: "SYS-08",
      state: "stale",
      texts: fromFrame("SYS-08", "stale", [
        "مصالحة بعد تغيّر جيل الخادم",
        "الجيل الحالي",
        "· وصلت ردود تخصّ",
        "المعلَّق ليس مفقوداً.",
        "يبقى في قائمة محدَّدة بعدد وقيمة، وتُعاد محاولته على الجيل الجديد. لن يختفي رقم من دفترك لأن الخادم تغيّر.",
        "مؤكَّد",
        "عمليات ثبتت على الجيل الجديد",
        "معلَّق",
        "ردود تخصّ جيلاً قديماً",
        "يحتاجك",
        "عمليات نجحت عندك وغابت عن الخادم",
        "محسوم",
        "مكرّرات مُنعت",
        "وصلت مرتين بمعرّف واحد فحُسبت مرة",
      ]),
    });
    await expect(page.locator('[data-screen="SYS-08"]')).toContainText(
      "1 عملية معلّقة بقيمة 300.00",
    );
  });
});
