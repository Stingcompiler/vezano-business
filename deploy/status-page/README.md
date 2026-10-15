# صفحة الحالة المستقلة — status.vezano.app (0005 §١٥٧)

شاشة PUB-03 نفسها (الكود والنصوص من `apps/web`) منشورة على **Cloudflare Pages**، بعيداً عن خادم OVH، فتبقى
متاحة إن سقط الخادم — والإطار نفسه يقول «status.vezano.app — استضافة مستقلة عن الخادم».

- `scripts/build.mjs`: يأخذ `status.html` المبنية مسبقاً وأصولها من بناء الإنتاج إلى `dist/`.
- `functions/api/public/status.ts`: يسأل `plus.vezano.app` من الحافة بمهلة 4.5 ث؛ إن لم يردّ أعاد 503
  فتعرض الصفحة حالة «تعطل جزئي» المرسومة (البيع المحلي يعمل).
- `functions/_middleware.ts`: `/` → `/status`؛ أي مسار آخر غير الصفحة وأصولها يُحوَّل إلى `plus.vezano.app`.
- النشر: `.github/workflows/status-page.yml` بسرّي `CLOUDFLARE_API_TOKEN` (صلاحية Cloudflare Pages: Edit).
- النطاق: سجلّ CNAME في Namecheap: `status` → `vezano-status.pages.dev`.
