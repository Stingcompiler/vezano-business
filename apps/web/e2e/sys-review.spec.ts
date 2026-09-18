import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.35 — SYS-03 تعارض وحجر ومراجعة مالك (4). النسختان معروضتان ولا نختار عنك؛ قبول مخوَّل بسبب أو
 * رفض بسبب دون إعادة كتابة الأصل؛ المرفوض يبقى مقروءاً؛ لا تراجع؛ الكاشير يرى ولا يحسم؛ الترتيب
 * بالأثر المالي لا بالتاريخ.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const receiptMembers = (amount: string, number = "PAY-0244") => [
  {
    entity: "parties.PaymentReceipt",
    id: "r-1",
    payload: {
      receipt_id: "r-1",
      receipt_number: number,
      party_id: "p-1",
      party_name: "أحمد الطيب",
      kind: "receipt",
      method: "cash",
      amount_minor: amount,
    },
  },
];

const item = (over: Record<string, unknown> = {}) => ({
  id: "q-1",
  operation_id: "op-1",
  kind: "payment_receipt",
  reason: "conflicted",
  code: "content_mismatch",
  detail: "",
  device_id: "d2",
  device_name: "الكاشير 2",
  received_at: at(9, 41),
  effect_minor: "18000",
  members: receiptMembers("18000"),
  reviewed_at: "",
  decision: "",
  decision_reason: "",
  decided_by_name: "",
  ...over,
});

const small = () =>
  item({
    id: "q-2",
    operation_id: "op-2",
    effect_minor: "1500",
    members: receiptMembers("1500", "PAY-0250"),
    received_at: at(8, 5),
  });

const detail = (isOwner: boolean) => ({
  item: item(),
  confirmed: {
    kind: "payment_receipt",
    device_name: "الكاشير 1",
    actor_name: "سميرة ع.",
    received_at: at(9, 40),
    members: receiptMembers("14000"),
  },
  effect: {
    party_id: "p-1",
    party_name: "أحمد الطيب",
    balance_now_minor: "6000",
    balance_if_accept_minor: "2000",
    balance_if_reject_minor: "6000",
    device_amount_minor: "18000",
    confirmed_amount_minor: "14000",
  },
  acceptable: true,
  is_owner: isOwner,
});

async function seed(page: Page, role: "owner" | "cashier") {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta"], "readwrite");
        const m = tx.objectStore("meta");
        m.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d2",
            prefix: "POS2",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        m.put({ key: "sync_epoch", value: "epoch-A" });
        m.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الرئيسي",
            branchCode: "KRT",
            deviceId: "d2",
            deviceName: "الكاشير 2",
            devicePrefix: "POS2",
            userId: "u1",
            userName: role === "owner" ? "سالم" : "سميرة ع.",
            roleName: role === "owner" ? "مالك" : "كاشير",
            roleCode: role,
          }),
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role },
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

function routes(page: Page, isOwner: boolean, items: unknown[] = [item(), small()]) {
  const decisions: Record<string, unknown>[] = [];
  void page.route(/\/api\/sync\/quarantine(\?.*)?$/, (route) =>
    route.fulfill(json(200, { is_owner: isOwner, items, as_of: new Date().toISOString() })),
  );
  void page.route("**/api/sync/quarantine/q-1", (route) =>
    route.fulfill(json(200, detail(isOwner))),
  );
  void page.route("**/api/sync/quarantine/q-1/decide", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    decisions.push(body);
    if (!isOwner) return route.fulfill(json(403, { detail: "owner_required" }));
    return route.fulfill(
      json(200, {
        item: item({
          reviewed_at: new Date().toISOString(),
          decision: body["decision"],
          decision_reason: body["reason"],
          decided_by_name: "سالم",
        }),
        applied: body["decision"] === "accept" ? { balance_after_minor: "2000" } : {},
      }),
    );
  });
  return decisions;
}

test.describe("SYS-03", () => {
  test("ready → conflict → success: القائمة بالأثر ثم النسختان ثم قبول بسبب — الرصيد صار 20.00", async ({
    page,
  }, info) => {
    await seed(page, "owner");
    const decisions = routes(page, true);
    await login(page, "/sync/review");
    await expectFrame(page, info, {
      screenId: "SYS-03",
      state: "ready",
      texts: fromFrame("SYS-03", "ready", [
        "بنود محجوزة",
        "قائمة ما ينتظر قرارك، مرتّبةً بالأثر المالي لا بالتاريخ: تعارض على رصيد صنفٍ ثم على سعر ثم على بيانات طرف.",
        "الترتيب بالأثر",
        "ريال قبل تعارضٍ على هجاء اسم. الأقدم أولاً ترتيبٌ محايد، والمحايد هنا إهدار.",
        "ما لا يُحجز",
        "التعارضات التي يحسمها النظام بأمان (طابعٌ مختلف لنفس القيمة) لا تصل هنا. حجزُ ما لا يحتاج قراراً يُعلّم المالك تجاهل الشاشة.",
        "العمل لا يتوقف على المحجوز: البيع يستمر والحجز على البند وحده.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-03"]');
    await expect(root).toContainText("2 بنود محجوزة");
    const rows = page.getByRole("row");
    await expect(rows.nth(1)).toContainText("PAY-0244");
    await expect(rows.nth(1)).toContainText("180.00");
    await expect(rows.nth(2)).toContainText("PAY-0250");

    await page.getByRole("button", { name: /PAY-0244/ }).click();
    await expectFrame(page, info, {
      screenId: "SYS-03",
      state: "conflict",
      texts: fromFrame("SYS-03", "conflict", [
        "تعارض وحجر ومراجعة المالك",
        "قبول مخوَّل أو رفض بسبب — دون إعادة كتابة الأصل. ACC-32 وACC-49.",
        "عملية محجوزة تحتاج قرارك",
        "على الخادم — مؤكد",
        "سداد",
        "PAY-0244",
        "المبلغ",
        "على هذا الجهاز — محجوز",
        "نفس رقم المستند بمبلغين مختلفين — غالباً سُجّل السداد على جهازين بقيمتين.",
        "الأثر على الرصيد:",
        "بالقبول يصبح رصيد أحمد",
        "، وبالرفض يبقى",
        ". راجع الإيصال الورقي قبل أن تقرّر.",
        "قبول نسخة الجهاز بسبب",
        "رفض والإبقاء على المؤكد",
        "القرار يتطلب صلاحية المالك، ويُسجَّل في سجل التدقيق باسمك وسببك ووقته. المستندان يبقيان مقروءين بعده.",
        "فتح الدمج اليدوي",
      ]),
    });
    await expect(root).toContainText(
      "رفض الخادم عملية سند قبض بسبب تعارض في المبلغ. لم يُكتب فوق أي مستند، وحساب أحمد الطيب وحده معلَّق — بقية العملاء يزامنون طبيعياً.",
    );
    await expect(root).toContainText("140.00 نقداً");
    await expect(root).toContainText("09:40 · سميرة ع. · الكاشير 1");
    await expect(root).toContainText("180.00 نقداً");
    await expect(root).toContainText("09:41 · الكاشير 2");
    await expect(root).toContainText("بالقبول يصبح رصيد أحمد 20.00، وبالرفض يبقى 60.00.");
    await expect(page.getByRole("button", { name: "فتح الدمج اليدوي" })).toBeDisabled();

    // بلا سبب: لا يمرّ
    await page.getByRole("button", { name: "قبول نسخة الجهاز بسبب" }).click();
    await expect(page.getByLabel("سبب القرار")).toHaveAttribute("aria-invalid", "true");
    expect(decisions).toHaveLength(0);
    await page.getByLabel("سبب القرار").fill("الإيصال الورقي 180");
    await page.getByRole("button", { name: "قبول نسخة الجهاز بسبب" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-03",
      state: "success",
      texts: fromFrame("SYS-03", "success", [
        "حُسم التعارض",
        "المرفوض يبقى",
        "النسخة غير المختارة تبقى مقروءة في سجل التدقيق باسم من أدخلها. من راجع بعد شهر يحتاج أن يرى أن خلافاً وقع وحُسم.",
        "لا تراجع",
        "الحسم نهائي. التصحيح بقرارٍ جديد يشير إليه — لا بتراجعٍ يمحو أن قراراً اتُّخذ.",
      ]),
    });
    await expect(root).toContainText(
      "اختار المالك نسخة الجهاز. نقول أثر القرار بالأرقام: الرصيد صار 20.00، والنسخة الأخرى محفوظة في السجل لا ممحوّة.",
    );
    await expect(root).toContainText("الإيصال الورقي 180");
    await expect(root).toContainText("سالم");
    expect(decisions).toEqual([{ decision: "accept", reason: "الإيصال الورقي 180" }]);
  });

  test("reject: رفض والإبقاء على المؤكد بسبب — الرصيد يبقى", async ({ page }) => {
    await seed(page, "owner");
    const decisions = routes(page, true);
    await login(page, "/sync/review?id=q-1");
    const root = page.locator('[data-screen="SYS-03"]');
    await expect(root).toHaveAttribute("data-state", "conflict");
    await page.getByLabel("سبب القرار").fill("الإيصال الورقي 140");
    await page.getByRole("button", { name: "رفض والإبقاء على المؤكد" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    await expect(root).toContainText("أبقى المالك النسخة المؤكدة. الرصيد يبقى 60.00");
    expect(decisions).toEqual([{ decision: "reject", reason: "الإيصال الورقي 140" }]);
  });

  test("permission_denied: الكاشير يرى النسختين ولا يحسم؛ الوصول من SYS-02 بمعرّف العملية", async ({
    page,
  }, info) => {
    await seed(page, "cashier");
    routes(page, false);
    await login(page, "/sync/review?op=op-1");
    await expectFrame(page, info, {
      screenId: "SYS-03",
      state: "permission_denied",
      texts: fromFrame("SYS-03", "permission_denied", [
        "على هذا الجهاز — محجوز",
        "حسم التعارض صلاحية مالك. الكاشير يرى التعارض ويُبلّغ عنه ولا يحسمه — وهذه هي حالة",
        "permission_denied",
        "النسختان محفوظتان كلتاهما. لا شيء ضاع، ولا شيء يُطبَّق حتى تقرّر.",
      ]),
    });
    await expect(page.getByRole("button", { name: "قبول نسخة الجهاز بسبب" })).toHaveCount(0);
    await expect(page.getByLabel("سبب القرار")).toHaveCount(0);
  });
});
