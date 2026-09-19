/** لقطة السوق الأخيرة في متصفح المشتري — للحالة `stale` («عروض من آخر جلب» بوقتها)؛ ليست سعراً مؤكَّداً. */
export function readSnapshot<T>(key: string): { at: string; data: T } | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { at: string; data: T }) : null;
  } catch {
    return null;
  }
}

export function writeSnapshot<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), data }));
  } catch {
    /* لا تخزين — لا بأس */
  }
}

export function readArea(): string {
  try {
    return localStorage.getItem("market.area") ?? "";
  } catch {
    return "";
  }
}

export function writeArea(area: string): void {
  try {
    localStorage.setItem("market.area", area);
  } catch {
    /* لا تخزين */
  }
}
