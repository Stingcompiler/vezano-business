# صفحة الحالة المستقلة — status.vezano.app (0005 §١٥٧)

شاشة PUB-03 نفسها (الكود والنصوص من `apps/web`) منشورة على **GitHub Pages**، بعيداً عن خادم OVH، فتبقى
متاحة إن سقط الخادم — والإطار نفسه يقول «status.vezano.app — استضافة مستقلة عن الخادم».

- لماذا GitHub Pages لا Cloudflare Pages: عناوين Cloudflare Pages (188.114.96.x/97.x) لا تُبلَغ من السودان
  — جُرِّب 2026-10-15 بـ`pages.dev` وبالنطاق المخصّص معاً؛ GitHub Pages يُبلَغ.
- `scripts/build.mjs`: `status.html` وأصولها من بناء الإنتاج، و`index.html` (→ `/status`)، و`404.html`
  (→ الموقع الرئيسي بمساره)، و`CNAME`، و`.nojekyll`.
- الصفحة تسأل `https://plus.vezano.app/api/public/status` من المتصفح (الخادم يسمح لأصل
  `status.vezano.app` وحده — `STING_STATUS_PAGE_ORIGIN`). إن لم يردّ: حالة «تعطل جزئي» المرسومة.
- `sw.js` عامل فارغ: يُرضي تسجيل التطبيق ولا يخزّن شيئاً (صفحة حالة من الكاش تكذب).
- النشر: `.github/workflows/status-page.yml` (GitHub Pages من سير العمل؛ لا أسرار).
- النطاق: سجلّ CNAME في Namecheap: `status` → `stingcompiler.github.io`.
