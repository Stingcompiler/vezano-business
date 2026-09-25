import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.34 — SYS-01 مركز الاتصال والمزامنة (6) + SYS-02 تفاصيل عملية متعثرة (5). الجواب أولاً: هل عملي
 * وصل؟ ثلاث حالات لا اثنتان؛ «هناك شبكة» ≠ «نجح الوصول»؛ ثلاث محاولات ثم وقوف والطابور محفوظ؛ البيع
 * مستمر؛ التعثر بلغة المحل وبفعل واحد؛ العائدة إلى الطابور تعود لموضعها لا رأسه.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface OpSeed {
  readonly id: string;
  readonly kind: string;
  readonly state: "local" | "pending" | "synced" | "conflict" | "quarantined";
  readonly members?: readonly { entity: string; id: string; payload: Record<string, unknown> }[];
  readonly attempts?: readonly Record<string, unknown>[];
  readonly quarantine?: { code: string; detail: string };
}

const at = (h: number, m: number, daysAgo = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const sale = (
  id: string,
  number: string,
  state: OpSeed["state"],
  extra: Partial<OpSeed> = {},
): OpSeed => ({
  id,
  kind: "sale",
  state,
  members: [
    {
      entity: "sales.Sale",
      id: `${id}-h`,
      payload: { sale_id: `${id}-h`, invoice_number: number, total_minor: "10000" },
    },
    { entity: "sales.Payment", id: `${id}-p1`, payload: { method: "cash", amount_minor: "4000" } },
    {
      entity: "sales.Payment",
      id: `${id}-p2`,
      payload: { method: "credit", amount_minor: "6000" },
    },
  ],
  attempts: [{ at: at(10, 14), event: "saved" }],
  ...extra,
});

async function seed(page: Page, ops: readonly OpSeed[], meta: Record<string, string> = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ ops, meta }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "operations"], "readwrite");
        const m = tx.objectStore("meta");
        const o = tx.objectStore("operations");
        m.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "POS1",
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
            deviceId: "d1",
            deviceName: "حاسوب الكاشير 1",
            devicePrefix: "POS1",
            userId: "u1",
            userName: "سميرة ع.",
            roleName: "كاشير",
            roleCode: "cashier",
          }),
        });
        for (const [k, v] of Object.entries(meta)) m.put({ key: k, value: v });
        let seq = 1;
        for (const s of ops) {
          o.put({
            operationId: s.id,
            kind: s.kind,
            opVersion: 1,
            dependencies: [],
            members: (s.members ?? []).map((x) => ({ ...x, schemaVersion: 1, serverSeq: null })),
            state: s.state,
            createdLocalSeq: seq++,
            snapshotRelation: "none",
          });
          if (s.attempts)
            m.put({ key: `sync.attempts:${s.id}`, value: JSON.stringify(s.attempts) });
          if (s.quarantine)
            m.put({ key: `quarantine:${s.id}`, value: JSON.stringify(s.quarantine) });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { ops, meta },
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

function statusRoute(page: Page) {
  return page.route("**/api/sync/status", (route) =>
    route.fulfill(
      json(200, {
        server_time: new Date().toISOString(),
        sync_epoch: "epoch-A",
        server_seq_high: "9",
        quarantined: 0,
        conflicted: 0,
        last_accepted_at: null,
      }),
    ),
  );
}

function pushRoute(page: Page, script: (call: number) => { status: number; body?: unknown }) {
  let calls = 0;
  const seen: number[] = [];
  void page.route("**/api/sync/push", async (route) => {
    calls++;
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string }[];
      request_id: string;
    };
    seen.push(body.operations.length);
    const r = script(calls);
    if (r.status !== 200)
      return route.fulfill(json(r.status, r.body ?? { detail: "server_error" }));
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
  return { calls: () => calls, seen };
}

const msAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

test.describe("SYS-01", () => {
  test("pending_sync → synced: الجواب أولاً بالعدد؛ الجدول بأثره المالي؛ «محاولة رفع الآن» ترفع وتقول العدد", async ({
    page,
  }, info) => {
    await seed(
      page,
      [
        sale("op-1", "INV-KRT-POS1-26-000041", "local"),
        sale("op-2", "INV-KRT-POS1-26-000040", "synced", {
          attempts: [
            { at: at(9, 41), event: "saved" },
            { at: at(9, 41), event: "sent" },
            { at: at(9, 41), event: "accepted" },
          ],
        }),
      ],
      { "sync.last_ok": msAgo(14 * 60_000) },
    );
    const push = pushRoute(page, () => ({ status: 200 }));
    await statusRoute(page);
    await login(page, "/sync");
    await expectFrame(page, info, {
      screenId: "SYS-01",
      state: "pending_sync",
      texts: fromFrame("SYS-01", "pending_sync", [
        "مركز الاتصال والمزامنة",
        "حالة المزامنة",
        "محفوظ محلياً · معلّق · مؤكد · محجوز. كل بند بأثره المالي لا برسالة تقنية.",
        "معلّق",
        "عمليات معلّقة",
        "آخر اتصال ناجح قبل 14 دقيقة",
        "العملية",
        "أثرها على مالك",
        "الحالة",
        "الإجراء",
        "محفوظ محلياً",
        "آمن على الجهاز",
        "معلّق الرفع",
        "ينتظر الاتصال",
        "مؤكد اليوم",
        "وصل الخادم",
        "محجوز للمراجعة",
        "يحتاج قرار المالك",
        "يُرفع تلقائياً",
        "محاولة رفع الآن",
        "تصدير المعلّق كنسخة",
        "آخر ما رُفع",
        "مؤكد",
        "للفريق التقني ولا تحتوي بيانات عملاء. لا يُعرض عليك JSON ولا رسائل خادم خام.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-01"]');
    await expect(root).toContainText("بيع 100.00 — يزيد الذمة 60.00 ويدخل الصندوق 40.00");
    await expect(root).toContainText("حاسوب الكاشير 1 · اليوم 10:14");
    await expect(root).toContainText("1 عمليات معلّقة");

    await page.getByRole("button", { name: "محاولة رفع الآن" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-01",
      state: "synced",
      texts: fromFrame("SYS-01", "synced", [
        "اكتمل الرفع الآن",
        "نقول العدد",
        "عملية» لا «تمت المزامنة». العدد هو ما كان يقلقه.",
      ]),
    });
    await expect(root).toContainText("رُفعت 1 عملية");
    expect(push.calls()).toBe(1);
    expect(push.seen[0]).toBe(1);
  });

  test("ready: كل عملك وصل — آخر مطابقة ولا شيء في الطابور", async ({ page }, info) => {
    await seed(page, [], { "sync.last_ok": msAgo(5_000) });
    await statusRoute(page);
    await login(page, "/sync");
    await expectFrame(page, info, {
      screenId: "SYS-01",
      state: "ready",
      texts: fromFrame("SYS-01", "ready", ["كل عملك وصل", "· لا شيء في الطابور", "آخر ما رُفع"]),
    });
    await expect(page.locator('[data-screen="SYS-01"]')).toContainText(
      /آخر مطابقة قبل \d+ ثانية · لا شيء في الطابور/,
    );
  });

  test("stale: مطابقة قديمة مع «طابق الآن» — الشبكة ≠ الوصول", async ({ page }, info) => {
    await seed(page, [], { "sync.last_ok": msAgo(6 * 3_600_000) });
    await statusRoute(page);
    await login(page, "/sync");
    await expectFrame(page, info, {
      screenId: "SYS-01",
      state: "stale",
      texts: fromFrame("SYS-01", "stale", [
        "آخر مطابقة قديمة",
        "لا معلّق عندك ولا تأكيد أن ما عند الخادم وصلك.",
        "ما نعرضه",
        "وقت آخر مطابقة ناجحة بارزاً، و«طابق الآن»، وتحذير أن أرقام اليوم قد تنقصها مبيعات أجهزة أخرى.",
      ]),
    });
    const root = page.locator('[data-screen="SYS-01"]');
    await expect(root).toContainText("آخر مطابقة ناجحة قبل 6 ساعة");
    await page.getByRole("button", { name: "طابق الآن" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText(/آخر مطابقة قبل \d+ ثانية/);
  });

  test("server_error: ثلاث محاولات ثم وقوف — الطابور محفوظ والبيع مستمر؛ الاستئناف يدوي", async ({
    page,
  }, info) => {
    await seed(page, [sale("op-1", "INV-KRT-POS1-26-000041", "local")], {
      "sync.last_ok": msAgo(14 * 60_000),
      push_attempts: "3",
      "sync.halted": new Date().toISOString(),
      "sync.last_push": JSON.stringify({
        kind: "retry",
        status: 503,
        at: new Date().toISOString(),
      }),
    });
    const push = pushRoute(page, (n) => (n === 1 ? { status: 503 } : { status: 200 }));
    await statusRoute(page);
    await login(page, "/sync");
    await expectFrame(page, info, {
      screenId: "SYS-01",
      state: "server_error",
      texts: fromFrame("SYS-01", "server_error", [
        "الخادم يرفض الطابور",
        "الشبكة تعمل والخادم يردّ بخطأ. ثلاث محاولات متباعدة ثم وقوف — والطابور محفوظ كما هو.",
        "لا إعادة بلا حدّ",
        "التكرار الأبدي يُخفي العطب أسبوعاً حتى يُكتشف بجردٍ لا يطابق. الوقوف المعلَن أصدق من محاولةٍ صامتة.",
        "البيع مستمر",
        "POS لا يتوقف. الطابور يكبر ويُعرض عدده، والعمل لا ينقطع لأن خادماً تعثّر.",
      ]),
    });
    const root = page.locator('[data-screen="SYS-01"]');
    await expect(root).toContainText("ERR-SYNC-503 · dev POS1");
    await expect(root).toContainText("بانتظار محاولة يدوية");
    // يدوي: يفشل مرة (يبقى موقوفاً) ثم ينجح ويرفع الوقوف
    await page.getByRole("button", { name: "محاولة رفع الآن" }).click();
    await expect(root).toHaveAttribute("data-state", "server_error");
    await page.getByRole("button", { name: "محاولة رفع الآن" }).click();
    await expect(root).toHaveAttribute("data-state", "synced");
    expect(push.calls()).toBe(2);
  });

  test("offline: بلا اتصال — البيع يعمل؛ المعلّق معدود", async ({ page }, info) => {
    await seed(page, [sale("op-1", "INV-KRT-POS1-26-000041", "local")], {
      "sync.last_ok": msAgo(14 * 60_000),
    });
    await login(page, "/sync");
    await page.context().setOffline(true);
    await expectFrame(page, info, {
      screenId: "SYS-01",
      state: "offline",
      texts: fromFrame("SYS-01", "offline", [
        "بلا اتصال — البيع يعمل",
        "كل ما تبيعه الآن محفوظ على هذا الجهاز ويُرفع عند عودة الشبكة.",
        "عمليات معلّقة",
        "آخر اتصال ناجح قبل 14 دقيقة",
      ]),
    });
    await expect(page.getByRole("button", { name: "محاولة رفع الآن" })).toBeDisabled();
    await page.context().setOffline(false);
  });
});

test.describe("SYS-02", () => {
  test("ready → pending_sync: مرفوضة برقم مستعمل — السبب بلغة المحل وفعل واحد؛ إعادة الترقيم تعيدها لموضعها", async ({
    page,
  }, info) => {
    await seed(
      page,
      [
        sale("op-0", "INV-KRT-POS1-26-000039", "local"),
        sale("op-1", "INV-KRT-POS1-26-000041", "quarantined", {
          attempts: [
            { at: at(9, 12), event: "saved" },
            { at: at(9, 12), event: "sent" },
            { at: at(9, 12), event: "transient", status: 503, code: "server_error" },
            { at: at(9, 16), event: "sent" },
            { at: at(9, 16), event: "transient", status: 503, code: "server_error" },
            { at: at(9, 21), event: "sent" },
            { at: at(9, 21), event: "rejected", code: "commit_failed" },
          ],
          quarantine: {
            code: "commit_failed",
            detail: "duplicate key value violates unique constraint sales_sale_invoice_number",
          },
        }),
      ],
      { invoice_seq: "41" },
    );
    await login(page, "/sync/operations/op-1");
    await expectFrame(page, info, {
      screenId: "SYS-02",
      state: "ready",
      texts: fromFrame("SYS-02", "ready", [
        "تفاصيل عملية متعثرة",
        "شاشة تشخيص لصاحب محل لا لمهندس: لماذا وقفت هذه العملية بعينها، وما الذي يفعله الآن.",
        "العملية",
        "الجهاز والوقت",
        "الحالة",
        "متعثّرة",
        "ما الذي لم يحدث",
        "الفاتورة لم تُسجَّل عند الخادم",
        "ما الذي حدث فعلاً",
        "محفوظة على الجهاز بالكامل",
        "السبب بلغة مفهومة",
        "رقم الفاتورة استعمله جهاز آخر",
        "ما تفعله الآن",
        "إعادة ترقيم بموافقتك ثم رفع",
        "الفعل الواحد",
        "لكل سبب مخرجٌ واحد واضح — لا قائمة خيارات على من لا يعرف الفرق بينها.",
        "العملية وتاريخها",
        "بلغة المحل",
        "«الخادم رفض: الصنف المحذوف» لا «HTTP 422». الرمز التقني يبقى مطوياً خلف «تفاصيل للدعم».",
        "تفاصيل للدعم",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-02"]');
    await expect(root).toContainText("حاسوب الكاشير 1 · اليوم 09:12");
    await expect(root).toContainText("09:12حُفظت محلياً");
    await expect(root).toContainText("09:16تعذّر الوصول إلى الخادم (503)");
    await expect(root).toContainText("09:21رفضها الخادم — commit_failed");
    await page.locator("summary", { hasText: "تفاصيل للدعم" }).click();
    await expect(root).toContainText("ERR-SYNC-commit_failed · op op1 · dev POS1");

    await page.getByRole("button", { name: "إعادة ترقيم بموافقتك ثم رفع" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-02",
      state: "pending_sync",
      texts: fromFrame("SYS-02", "pending_sync", [
        "عادت إلى الطابور",
        "والعملية عادت تنتظر دورها.",
        "لا قفز",
        "تعود إلى موضعها الزمني لا إلى رأس الطابور. الترتيب الزمني هو ما يجعل الدفتر مقروءاً بعد شهر.",
      ]),
    });
    await expect(root).toContainText("رقم جديد INV-KRT-POS1-26-000042");
    // موضعها الزمني: بعد op-0 في مركز المزامنة، لا في رأس الطابور
    const order = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const rows = await new Promise<
        { operationId: string; state: string; createdLocalSeq: number }[]
      >((res) => {
        const r = db.transaction("operations").objectStore("operations").getAll();
        r.onsuccess = () => res(r.result as never);
      });
      db.close();
      return rows
        .sort((a, b) => a.createdLocalSeq - b.createdLocalSeq)
        .map((r) => `${r.operationId}:${r.state}`);
    });
    expect(order).toEqual(["op-0:local", "op-1:local"]);
  });

  test("conflict: موقوفة بتعارض — لا تُعاد المحاولة ومسارها إلى SYS-03", async ({ page }, info) => {
    await seed(page, [
      sale("op-1", "INV-KRT-POS1-26-000041", "conflict", {
        attempts: [
          { at: at(9, 12), event: "saved" },
          { at: at(9, 12), event: "sent" },
          { at: at(9, 12), event: "conflicted", code: "content_mismatch" },
        ],
      }),
    ]);
    await login(page, "/sync/operations/op-1");
    await expectFrame(page, info, {
      screenId: "SYS-02",
      state: "conflict",
      texts: fromFrame("SYS-02", "conflict", [
        "العملية موقوفة بتعارض",
        "ليست فشلاً تقنياً: جهازان عدّلا الشيء نفسه. لا تُعاد المحاولة — إعادة المحاولة لا تحلّ خلافاً.",
        "التحويل",
        "مسارها إلى",
        "حيث يُراجعها المالك بالنسختين. هنا نُظهر السبب والمسار لا الحلّ.",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "مسارها إلى «مراجعة التعارضات» حيث يُراجعها المالك بالنسختين.",
    );
    // مسارها إلى SYS-03 (T1.35) بمعرّف العملية
    await page.route(/\/api\/sync\/quarantine(\?.*)?$/, (route) =>
      route.fulfill(json(200, { is_owner: true, items: [], as_of: new Date().toISOString() })),
    );
    await page.getByRole("button", { name: "مراجعة المالك" }).click();
    await expect(page).toHaveURL(/\/sync\/review\?op=op-1$/);
    await expect(page.locator('[data-screen="SYS-03"]')).toHaveAttribute("data-state", "ready");
    await page.goBack();
    await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toHaveCount(0);
  });

  test("server_error → empty: الخادم يردّ بخطأ ثم تُقبل بإعادة المحاولة — «لا شيء متعثر»", async ({
    page,
  }, info) => {
    await seed(page, [
      sale("op-1", "INV-KRT-POS1-26-000041", "local", {
        attempts: [
          { at: at(9, 12), event: "saved" },
          { at: at(9, 12), event: "sent" },
          { at: at(9, 12), event: "transient", status: 500, code: "server_error" },
        ],
      }),
    ]);
    pushRoute(page, () => ({ status: 200 }));
    await login(page, "/sync/operations/op-1");
    await expectFrame(page, info, {
      screenId: "SYS-02",
      state: "server_error",
      texts: fromFrame("SYS-02", "server_error", [
        "ما الذي لم يحدث",
        "الفاتورة لم تُسجَّل عند الخادم",
        "ما الذي حدث فعلاً",
        "محفوظة على الجهاز بالكامل",
        "السبب بلغة مفهومة",
        "ما تفعله الآن",
        "إعادة المحاولة",
      ]),
    });
    const root = page.locator('[data-screen="SYS-02"]');
    await expect(root).toContainText("الخادم يردّ بخطأ 500 — الشبكة تعمل والخادم يرفض");
    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-02",
      state: "empty",
      texts: fromFrame("SYS-02", "empty", [
        "لا عمليات متعثرة",
        "الحالة الصحّية. يُفتح هذا غالباً من إشعارٍ قديم بعد أن حُلّت المشكلة تلقائياً.",
        "نقول ما جرى",
      ]),
    });
    await expect(root).toContainText(
      "لا شيء متعثر — آخر تعثّر كان اليوم 09:12 وحُلّ بإعادة المحاولة.",
    );
    await expect(root).toContainText("مؤكَّدة بختم وقت الخادم");
  });
});
