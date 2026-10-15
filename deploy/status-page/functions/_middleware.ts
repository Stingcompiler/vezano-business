/**
 * ما يُخدَم هنا صفحة الحالة وأصولها وحدها (0005 §١٥٧). الجذر يذهب إلى `/status`، وأي رابط آخر في
 * الصفحة (الرئيسية، الباقات، الدخول…) يُحوَّل إلى الموقع الرئيسي.
 */
const MAIN = "https://plus.vezano.app";
const LOCAL = [
  /^\/status\/?$/,
  /^\/_next\//,
  /^\/icons\//,
  /^\/favicon\.ico$/,
  /^\/og\.png$/,
  /^\/sw\.js$/,
];

export const onRequest = async (ctx: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> => {
  const url = new URL(ctx.request.url);
  if (url.pathname === "/") return Response.redirect(`${url.origin}/status`, 302);
  if (url.pathname === "/api/public/status" || LOCAL.some((re) => re.test(url.pathname))) {
    return ctx.next();
  }
  return Response.redirect(`${MAIN}${url.pathname}${url.search}`, 302);
};
