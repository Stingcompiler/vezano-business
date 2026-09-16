# Sting Systems

نظام نقطة بيع وذمم ومخزون يعمل **بلا اتصال أولاً** لمحلات التجزئة الصغيرة في السودان، ومعه سوق توريد B2B.

- **المرجع الحاكم للأعمال:** `design_handoff_sting_systems/Sting-Systems-v21-Complete.md`
- **المرجع الحاكم للواجهات:** حزمة التصميم في `design_handoff_sting_systems/` (164 شاشة)
- **طريقة العمل:** `CLAUDE_CODE_PROMPT.md` · الخطة `docs/PLAN.md` · التصميم `docs/ARCHITECTURE.md` · القرارات `docs/decisions/`

## التشغيل المحلي

```bash
pnpm install && pnpm check          # lint + typecheck + vitest + حدود الحزم
cd backend && uv sync && uv run pytest
```

الخلفية تحتاج PostgreSQL 16 محلياً (`createdb sting_dev`). لا يُعتمد SQLite للخادم.

## الهيكل (§٤.٤)

```
backend/            Django/DRF
apps/web/           Next.js (يُمهَّد في T0.19)
packages/domain     المال والكميات — بلا DOM
packages/sync-core  بروتوكول المزامنة (§٨)
packages/platform   عقود التخزين والأسرار والطباعة + المحوّلات
packages/contracts  أنواع API من OpenAPI
packages/design     الرموز DS-1.2 والحالات الـ17
packages/ui-web     المكوّنات الـ29
tools/boundaries    اختبار حدود الحزم
```
