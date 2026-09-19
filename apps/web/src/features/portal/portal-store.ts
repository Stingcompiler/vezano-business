/** رمز المشترك لكل محل — في متصفح الزبون وحده (لا حساب): يفتح الرسائل والتفضيلات لاحقاً. */
const key = (slug: string) => `portal.${slug}.token`;
const INDEX = "portal.shops";

export function readToken(slug: string): string {
  try {
    return localStorage.getItem(key(slug)) ?? "";
  } catch {
    return "";
  }
}

export function saveToken(slug: string, token: string): void {
  try {
    localStorage.setItem(key(slug), token);
    const shops = listShops();
    if (!shops.includes(slug)) localStorage.setItem(INDEX, JSON.stringify([...shops, slug]));
  } catch {
    /* لا تخزين — الرمز في الرابط يكفي لهذه الجلسة */
  }
}

/** المحال المشترَك فيها من هذا المتصفح — للتفضيلات (CUS-04: «أنت مشترك في محلين»). */
export function listShops(): string[] {
  try {
    const raw = localStorage.getItem(INDEX);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
