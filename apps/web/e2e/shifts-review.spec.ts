import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.13 — SHIFT-05 (5). شاشة المالك بعد الإقفال: سجل الورديات من الخادم (15-D10) مرتّباً بالقيمة
 * (38-D30)، لقطة الإغلاق ثابتة والحركة المتأخرة خارجها (06-D2؛ ACC-68)، التسوية للمالك، والوردية
 * المقفلة محلياً بلا رفع تُسمّى وتُستثنى من المجموع (IndexedDB حقيقي).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

/** «أمس 08:02» بالتوقيت المحلي — الواجهة تعرض الساعات محلياً. */
function at(daysAgo: number, hh: number, mm: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

interface RowOpts {
  readonly id: string;
  readonly user: string;
  readonly opened: string;
  readonly closed?: string;
  readonly expected: string;
  readonly counted?: string;
  readonly review?: { readonly by: string; readonly reason: string } | undefined;
  readonly late?: readonly LateOpts[];
  readonly openHours?: number;
}
interface LateOpts {
  readonly id: string;
  readonly number: string;
  readonly kind: string;
  readonly amount: string;
  readonly occurred: string;
  readonly received: string;
  readonly reviewed?: boolean;
}

function row(o: RowOpts) {
  const open = !o.closed;
  const variance = !open && o.counted ? (BigInt(o.counted) - BigInt(o.expected)).toString() : "";
  return {
    id: o.id,
    branch_name: "فرع النور",
    device_name: "كاشير 2",
    user_name: o.user,
    opened_at: o.opened,
    closed_at: o.closed ?? "",
    state: open ? "open" : "closed",
    count_status: open ? "" : o.counted ? "counted" : "not_counted",
    expected_cash_at_close_minor: open ? "" : o.expected,
    expected_cash_minor: o.expected,
    counted_cash_minor: o.counted ?? "",
    counted_by_name: o.counted ? o.user : "",
    variance_minor: variance,
    open_hours: o.openHours ?? 0,
    abandoned: open && (o.openHours ?? 0) >= 24,
    review: o.review
      ? {
          signed_amount_minor: variance || "0",
          approved_by_name: o.review.by,
          reason: o.review.reason,
          occurred_at: at(0, 9, 0),
        }
      : null,
    late_items: (o.late ?? []).map((l) => ({
      id: l.id,
      number: l.number,
      kind: l.kind,
      signed_amount_minor: l.amount,
      occurred_at: l.occurred,
      received_at: l.received,
      reviewed: l.reviewed ?? false,
    })),
  };
}

function review(shifts: ReturnType<typeof row>[], over: Record<string, unknown> = {}) {
  return {
    scope: "all",
    can_settle: true,
    role_name: "مالك",
    user_name: "ندى",
    branch_name: "فرع النور",
    window_days: 7,
    shifts,
    ...over,
  };
}

/** سجل 15-D10: معتمدة بعجز، مطابقة، مهجورة، زيادة غير معتمدة — بترتيب الخادم (القيمة لا التاريخ). */
const LOG = [
  row({
    id: "s-abandoned",
    user: "الكاشير 2",
    opened: at(3, 14, 10),
    expected: "342000",
    openHours: 75,
  }),
  row({
    id: "s-short",
    user: "الكاشير 1",
    opened: at(1, 8, 2),
    closed: at(1, 21, 40),
    expected: "2244000",
    counted: "2229000",
    review: { by: "مدير الفرع", reason: "نقص فكّة" },
  }),
  row({
    id: "s-over",
    user: "الكاشير 1",
    opened: at(2, 8, 0),
    closed: at(2, 20, 30),
    expected: "1720000",
    counted: "1726000",
  }),
  row({
    id: "s-ok",
    user: "الكاشير 3",
    opened: at(1, 14, 10),
    closed: at(1, 22, 5),
    expected: "987000",
    counted: "987000",
  }),
];

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

/** وردية أُقفلت على هذا الجهاز وحدث إقفالها ما زال في الطابور (لم يُرفع). */
async function seedLocalClosed(page: Page) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ openedAt, closedAt }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["projections", "operations"], "readwrite");
        tx.objectStore("projections").put({
          key: "entity:shifts.Shift:s-local",
          value: {
            id: "s-local",
            number: "OPEN-0092",
            branch_id: "b1",
            branch_name: "فرع النور",
            device_id: "d1",
            device_name: "كاشير 2",
            user_id: "u1",
            user_name: "الكاشير 3",
            opening_float_minor: "610000",
            business_date: openedAt.slice(0, 10),
            opened_at: openedAt,
            state: "closed",
            closed_at: closedAt,
            operation_id: "op-open-local",
            close_operation_id: "op-close-local",
            expected_cash_at_close_minor: "610000",
            counted_cash_minor: "610000",
            count_status: "counted",
            counted_by_name: "الكاشير 3",
            denominations: [],
          },
        });
        tx.objectStore("operations").put({
          operationId: "op-close-local",
          kind: "shift_close",
          opVersion: 1,
          dependencies: ["op-open-local"],
          members: [],
          state: "pending",
          createdLocalSeq: 2,
          snapshotRelation: "none",
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { openedAt: at(2, 9, 0), closedAt: at(2, 18, 30) },
  );
}

test.describe("SHIFT-05", () => {
  test("ready: الفوارق مرتّبةً بالقيمة — سجل الورديات بفارقها ومن عدّها، والمهجورة تُسمّى ولا تُقفل بالمتوقع", async ({
    page,
  }, info) => {
    await page.route("**/api/shifts/review", (route) => route.fulfill(json(200, review(LOG))));
    await login(page, "/shifts/review");
    await expectFrame(page, info, {
      screenId: "SHIFT-05",
      state: "ready",
      texts: fromFrame("SHIFT-05", "ready", [
        "مراجعة فروق وعمليات متأخرة",
        "الفوارق مرتّبةً بالقيمة",
        "كل وردية بفارقها ومن عدّها.",
        "الوردية والمسؤول",
        "المتوقع",
        "المعدود",
        "الفارق",
        "الحالة",
        "مقفلة ومعتمدة",
        "عجز معتمد باسم مدير الفرع مع سبب مكتوب",
        "فارق غير معتمد",
        "زيادة غير معتمدة بعد — تظهر ببندها لا مدموجة بالمبيعات",
        "مطابقة",
        "وردية واحدة مفتوحة منذ 3 أيام",
        "مفتوحة 3 أيام",
        "الصندوق لم يُعدّ. المتوقع ليس عدّاً ولا يصلح إقفالاً.",
        "وردية مهجورة",
        "لن نُقفلها تلقائياً بالرقم المتوقع.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    // الأرقام لاتينية في mono بإشارة الفارق: نقص −150.00 وزيادة +60.00
    const root = page.locator('[data-screen="SHIFT-05"]');
    for (const n of ["22,440.00", "22,290.00", "−150.00", "+60.00", "3,420.00"])
      await expect(root).toContainText(n);
    // الترتيب كما أعاده الخادم: المهجورة، ثم الفارق الأكبر، ثم المطابِقة — لا بالتاريخ
    await expect(page.locator(".shift-row__kind").first()).toHaveText("الكاشير 2");
    // فتح صف الفارق يعرض اللقطة مثبّتة والسبب إلزامياً قبل الإقرار
    await page.getByRole("button", { name: "الكاشير 1" }).nth(1).click();
    await expect(page.locator(".shift-review")).toContainText("+60.00");
    await expect(page.getByRole("button", { name: "إقرار المراجعة" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("empty: لا فوارق — نقول المدى: 7 ورديات في الأسبوع · كلها مطابقة", async ({
    page,
  }, info) => {
    const matched = Array.from({ length: 7 }, (_, i) =>
      row({
        id: `s-${i}`,
        user: "الكاشير 3",
        opened: at(i, 8, 0),
        closed: at(i, 20, 0),
        expected: "987000",
        counted: "987000",
      }),
    );
    await page.route("**/api/shifts/review", (route) => route.fulfill(json(200, review(matched))));
    await login(page, "/shifts/review");
    await expectFrame(page, info, {
      screenId: "SHIFT-05",
      state: "empty",
      texts: fromFrame("SHIFT-05", "empty", [
        "لا فوارق",
        "كل الورديات أُقفلت مطابقةً.",
        "7 ورديات في الأسبوع · كلها مطابقة",
        "مطابقة",
      ]),
    });
  });

  test("conflict: لقطة الإغلاق مثبّتة لا تتغير، والبيع المتأخر خارجها بنداً مستقلاً — ثم إقرار المراجعة", async ({
    page,
  }, info) => {
    const late = row({
      id: "s-late",
      user: "سميرة ع.",
      opened: at(1, 8, 0),
      closed: at(1, 21, 14),
      expected: "348000",
      counted: "348000",
      late: [
        {
          id: "inv-1036",
          number: "INV-1036",
          kind: "sale",
          amount: "15000",
          occurred: at(1, 20, 58),
          received: at(0, 7, 12),
        },
      ],
    });
    await page.route("**/api/shifts/review", (route) =>
      route.fulfill(json(200, review([late, LOG[3]!]))),
    );
    const posted: unknown[] = [];
    await page.route("**/api/shifts/s-late/review", (route) => {
      posted.push(route.request().postDataJSON());
      const reviewed = {
        ...late,
        review: {
          signed_amount_minor: "0",
          approved_by_name: "ندى",
          reason: "",
          occurred_at: at(0, 9, 30),
        },
        late_items: late.late_items.map((i) => ({ ...i, reviewed: true })),
      };
      return route.fulfill(
        json(201, {
          id: "adj-1",
          shift_id: "s-late",
          signed_amount_minor: "0",
          approved_by_name: "ندى",
          reason: "",
          late_item_ids: ["inv-1036"],
          occurred_at: at(0, 9, 30),
          row: reviewed,
        }),
      );
    });
    await login(page, "/shifts/review");
    await expectFrame(page, info, {
      screenId: "SHIFT-05",
      state: "conflict",
      texts: fromFrame("SHIFT-05", "conflict", [
        "مراجعة فروق وعمليات متأخرة",
        "تعارض",
        "وردية أمس 08:00 – 21:14 · سميرة ع.",
        "لقطة الإغلاق — مثبّتة 21:14",
        "لا تتغير",
        "النقد المتوقع وقت الإغلاق",
        "3,480.00",
        "المعدود",
        "الفرق وقت الإغلاق",
        "0.00",
        "وصلت بعد الإغلاق — خارج اللقطة",
        "INV-1036",
        "· بيع نقدي سُجّل 20:58 على جهاز غير متصل",
        "150.00",
        "وصل الخادم اليوم 07:12",
        "بعد الإغلاق بـ10 ساعات",
        "لن يتغير فرق الوردية المغلقة.",
        "اللقطة سجلٌ لما عُرف وقت الإغلاق. البيع المتأخر يُنسب إلى الوردية بتاريخه، ويُعرض هنا كبند مستقل، ويدخل تقرير المبيعات بيومه الصحيح — دون إعادة فتح الوردية ولا تعديل عدّها.",
        "إقرار المراجعة",
        "فتح المستند المتأخر",
      ]),
    });
    // اللقطة لا تتغير بالمتأخر: المتوقَّع 3,480.00 لا 3,630.00
    await expect(page.locator(".shift-snapshot")).not.toContainText("3,630.00");
    await page.getByRole("button", { name: "إقرار المراجعة" }).click();
    await expect(page.locator('[data-screen="SHIFT-05"][data-state="ready"]')).toBeVisible();
    expect(posted).toEqual([{ reason: "" }]);
    await expect(page.locator(".shift-review")).toContainText("إقرار المراجعة باسم ندى");
    await expect(page.locator(".shift-snapshot")).toContainText("3,480.00");
  });

  test("permission_denied: مدير الفرع يرى فرعه ويراجع ولا يُسوّي — التسوية للمالك", async ({
    page,
  }, info) => {
    await page.route("**/api/shifts/review", (route) =>
      route.fulfill(
        json(
          200,
          review([LOG[2]!, LOG[3]!], {
            scope: "branch",
            can_settle: false,
            role_name: "مدير فرع",
            user_name: "عبد الله",
          }),
        ),
      ),
    );
    await login(page, "/shifts/review");
    await expectFrame(page, info, {
      screenId: "SHIFT-05",
      state: "permission_denied",
      texts: fromFrame("SHIFT-05", "permission_denied", [
        "مدير الفرع يرى فرعه",
        "يرى فوارق ورديات فرعه ولا يرى الفروع الأخرى.",
        "التسوية للمالك",
        "المدير يراجع ويعلّق ولا يُسوّي — التسوية إقرارٌ مالي بقبول الفارق.",
        "فارق غير معتمد",
      ]),
    });
    // يفتح صف الفارق فيرى اللقطة، والزرّ ظاهر بسببه لا مخفياً (R-02)
    await page.getByRole("button", { name: "الكاشير 1" }).first().click();
    await expect(page.locator(".shift-review")).toContainText("الفرق وقت الإغلاق");
    const settle = page.getByRole("button", { name: "إقرار المراجعة" });
    await expect(settle).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".c-btn__reason")).toContainText("التسوية للمالك");
    await expect(page.locator('[data-screen="SHIFT-05"]')).not.toContainText("فرع بحري");
  });

  test("stale: وردية لم تُزامَن بعد — تُسمّى وتُستثنى من المجموع", async ({ page }, info) => {
    await seedLocalClosed(page);
    await page.route("**/api/shifts/review", (route) =>
      route.fulfill(json(200, review([LOG[1]!, LOG[3]!]))),
    );
    await login(page, "/shifts/review");
    await expectFrame(page, info, {
      screenId: "SHIFT-05",
      state: "stale",
      texts: fromFrame("SHIFT-05", "stale", [
        "وردية لم تُزامَن بعد",
        "وردية أُقفلت على جهازٍ لم يرفع بعد، فرقمها هنا ناقص.",
        "وردية واحدة بانتظار المزامنة",
        "مقفلة · معلّقة الرفع",
        "أُقفلت محلياً وتُرفع عند المزامنة — الأرقام نهائية عندك لا عند الخادم",
        "جهاز بلا اتصال",
        "مقفلة ومعتمدة",
      ]),
    });
    await expect(page.locator('[data-screen="SHIFT-05"]')).toContainText("6,100.00");
    // المجموع من الخادمي وحده: −150.00 (المحلي مطابق لكنه مستثنى — لا يُبتلع)
    await expect(page.locator(".cat-head__hint").first()).toContainText("−150.00");
  });
});
