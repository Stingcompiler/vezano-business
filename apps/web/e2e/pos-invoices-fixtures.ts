import { expect, type Page } from "@playwright/test";

/** مشترك بين pos-invoices.spec وmotion.spec: تجهيز الجهاز والجلسة وصفوف الفواتير الخادمية. */
export const json = (status: number, body: unknown) => ({ status, json: body });

export const today = (h: number, m: number, s = 0) => {
  const d = new Date();
  d.setHours(h, m, s, 0);
  return d.toISOString();
};

export interface LocalSeed {
  readonly id: string;
  readonly number: string;
  readonly opState: "local" | "pending" | "synced";
  readonly occurredAt: string;
  readonly party?: string;
  readonly cash?: string;
  readonly credit?: string;
}

export async function seed(page: Page, sales: readonly LocalSeed[], cache?: unknown) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ sales, cache, openedAt }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections", "operations"], "readwrite");
        const meta = tx.objectStore("meta");
        const proj = tx.objectStore("projections");
        const ops = tx.objectStore("operations");
        meta.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "A2",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        meta.put({ key: "sync_epoch", value: "epoch-A" });
        meta.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الفرع الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "كاشير 2",
            devicePrefix: "A2",
            userId: "u1",
            userName: "سميرة ع.",
            roleName: "كاشير",
          }),
        });
        if (cache) meta.put({ key: "sales.list_cache", value: JSON.stringify(cache) });
        else meta.delete("sales.list_cache");
        let seq = 2;
        for (const s of sales) {
          proj.put({
            key: `entity:sales.Sale:${s.id}`,
            value: {
              id: s.id,
              invoice_number: s.number,
              shift_id: "s1",
              branch_id: "b1",
              device_id: "d1",
              user_id: "u1",
              user_name: "سميرة ع.",
              party_id: s.party ? "p1" : "",
              party_name: s.party ?? "",
              subtotal_minor: "10000",
              discount_minor: "0",
              total_minor: "10000",
              cash_minor: s.cash ?? "10000",
              bank_minor: "0",
              credit_minor: s.credit ?? "0",
              received_minor: "",
              change_minor: "",
              lines: [
                {
                  id: `${s.id}-l1`,
                  item_id: "i1",
                  item_name: "سكر",
                  unit_code: "كغ",
                  qty_milli: "1000",
                  decimal_places: 3,
                  unit_price_minor: "10000",
                  line_total_minor: "10000",
                  manual_price: false,
                },
              ],
              business_date: openedAt.slice(0, 10),
              occurred_at: s.occurredAt,
              operation_id: `op-${s.id}`,
            },
          });
          ops.put({
            operationId: `op-${s.id}`,
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [],
            state: s.opState,
            createdLocalSeq: seq++,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { sales, cache: cache ?? null, openedAt: new Date().toISOString() },
  );
}

export async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

/** صف خادمي كما يعيده `GET /api/sales` — فواتير الأجهزة الأخرى. */
export const serverRow = (
  id: string,
  number: string,
  at: string,
  party: string,
  total: string,
  cash: string,
  credit: string,
  extra: Partial<{ date_suspect: boolean; sync_state: "synced" | "reversed" }> = {},
) => ({
  id,
  invoice_number: number,
  branch_id: "b1",
  device_id: "d2",
  device_name: "الكاشير 1",
  user_name: "محمد ب.",
  party_id: party === "نقدي" ? "" : "p2",
  party_name: party === "نقدي" ? "" : party,
  total_minor: total,
  cash_minor: cash,
  credit_minor: credit,
  bank_minor: "0",
  business_date: new Date().toISOString().slice(0, 10),
  occurred_at: at,
  received_at: at,
  date_suspect: false,
  sync_state: "synced",
  ...extra,
});

export const listBody = (
  rows: unknown[],
  extra: Partial<{
    scope: string;
    can_all_branches: boolean;
    can_totals: boolean;
    last_sale_at: string;
  }> = {},
) => ({
  scope: "branch",
  can_all_branches: true,
  can_totals: true,
  can_decide: true,
  role_name: "مالك",
  branch_name: "الفرع الرئيسي",
  as_of: new Date().toISOString(),
  range: "today",
  rows,
  totals: { count: rows.length, total_minor: "0" },
  last_sale_at: "",
  ...extra,
});

export function listRoute(
  page: Page,
  body: unknown,
  opts: { delayMs?: number; status?: number } = {},
) {
  return page.route("**/api/sales?**", async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    return route.fulfill(json(opts.status ?? 200, body));
  });
}
