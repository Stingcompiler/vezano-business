/**
 * حالة الخدمة من الحافة (0005 §١٥٧): يسأل الخادم الرئيسي ويعيد ردّه كما هو. إن لم يردّ خلال 4.5 ث
 * (أقل من مهلة الصفحة 5 ث) أعاد 503 — فتعرض PUB-03 حالة «تعطل جزئي» المرسومة: البيع المحلي يعمل.
 */
const ORIGIN = "https://plus.vezano.app/api/public/status";

export const onRequestGet = async (): Promise<Response> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    const r = await fetch(ORIGIN, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) return unreachable(`origin ${r.status}`);
    return new Response(await r.text(), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return unreachable("origin unreachable");
  } finally {
    clearTimeout(timer);
  }
};

function unreachable(detail: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
