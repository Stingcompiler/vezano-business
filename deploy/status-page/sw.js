// صفحة الحالة المستقلة بلا تخزين مؤقت (0005 §١٥٧): عامل فارغ يُرضي تسجيل التطبيق ولا يعترض أي طلب —
// الحالة تُقرأ حيّة دائماً، وصفحة حالة من الكاش تكذب.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
