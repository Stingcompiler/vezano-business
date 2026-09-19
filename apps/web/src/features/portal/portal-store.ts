/** رمز المشترك لكل محل — في متصفح الزبون وحده (لا حساب): يفتح الرسائل والتفضيلات لاحقاً. */
const key = (slug: string) => `portal.${slug}.token`;

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
  } catch {
    /* لا تخزين — الرمز في الرابط يكفي لهذه الجلسة */
  }
}
