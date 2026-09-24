/* Service Worker — Sting (WEB-01/WEB-02؛ §١١.٦، §١٢.٥، §١٣.٢؛ ACC-76، 93، 95، 107)
 *
 * - يخزّن هيكل التطبيق والأصول الثابتة والخطوط (cache-first)، والتنقّل network-first مع الرجوع
 *   إلى الهيكل المخزَّن بلا اتصال.
 * - لا يخزّن ردود `/api/` أبداً (لا cache-all) ولا نطاق بوابة الزبون `/portal/` — شبكة فقط.
 * - التحديث الآمن: العامل الجديد لا يستبدل الحالي من تحت يد المستخدم؛ الصفحة تطلب `SKIP_WAITING`
 *   بعد إذنه وبعد التحقق من خلوّ الطابور من معلّق (ACC-93)، أو يُطبَّق عند إغلاق آخر تبويب.
 * - Web Push (WEB-02): الحمولة عناوين ثابتة بلا محتوى حساس (لا مبالغ ولا أسماء)؛ النقر يفتح
 *   التطبيق على المسار المرفق أو يركّز تبويباً مفتوحاً. الاشتراك المنتهي يُبلَّغ للصفحة لتجدّد صامتاً.
 */
const SW_VERSION = "sting-sw-v3";
const SHELL_CACHE = `${SW_VERSION}-shell`;
const ASSET_CACHE = `${SW_VERSION}-assets`;
// الأيقونات مع الهيكل: شاشة البداية والأيقونة المثبَّتة تعملان بلا اتصال (0005 §١٢٤)
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

const isApi = (url) => url.pathname.startsWith("/api/");
const isPortal = (url) => url.pathname.startsWith("/portal/");
const isAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/fonts/") ||
  /\.(woff2?|ttf|otf|png|svg|ico|webp)$/.test(url.pathname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)),
  );
  // لا skipWaiting هنا — الاستبدال بإذن الصفحة (ACC-93)
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(SW_VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_VERSION" && event.source)
    event.source.postMessage({ type: "SW_VERSION", version: SW_VERSION });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url) || isPortal(url)) return; // شبكة فقط — لا تخزين لردود API ولا لبوابة الزبون

  if (isAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL_CACHE).then((cache) => cache.put("/", res.clone()));
          return res;
        })
        .catch(() =>
          caches.match("/", { cacheName: SHELL_CACHE }).then((hit) => hit || Response.error()),
        ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "فيزانو", body: "", path: "/", kind: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // حمولة غير JSON — نعرض العنوان الافتراضي فقط
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.kind || "sting",
      dir: "rtl",
      lang: "ar",
      data: { path: data.path || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(path).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(path);
    }),
  );
});

// انتهى الاشتراك عند المزوّد — نُبلّغ الصفحات المفتوحة لتجدّد بلا سؤال إن كان الإذن قائماً
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window" })
      .then((list) => list.forEach((c) => c.postMessage({ type: "PUSH_EXPIRED" }))),
  );
});
