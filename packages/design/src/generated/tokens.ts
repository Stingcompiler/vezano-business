// مولَّد آلياً من handoff/tokens.json (DS-1.2) — لا يُحرَّر يدوياً.
export const DESIGN_SYSTEM_VERSION = "DS-1.2" as const;
export const DESIGN_SYSTEM_APPROVED = "2026-09-15" as const;

/** القيم الخام بالمقياس — للاستعمال في المولِّدات فقط؛ الشاشات تستعمل الأسماء الدلالية. */
export const color = {
  "teal.50": "#F0FDFA",
  "teal.100": "#CCFBF1",
  "teal.200": "#99F6E4",
  "teal.300": "#5EEAD4",
  "teal.500": "#14B8A6",
  "teal.700": "#0F766E",
  "teal.900": "#115E59",
  "amber.50": "#FFFBEB",
  "amber.200": "#FDE68A",
  "amber.400": "#FBBF24",
  "amber.500": "#F59E0B",
  "amber.800": "#92400E",
  "green.50": "#F0FDF4",
  "green.100": "#DCFCE7",
  "green.200": "#BBF7D0",
  "green.700": "#15803D",
  "green.800": "#166534",
  "red.50": "#FEF2F2",
  "red.200": "#FECACA",
  "red.700": "#B91C1C",
  "blue.50": "#EFF6FF",
  "blue.200": "#BFDBFE",
  "blue.700": "#1D4ED8",
  "slate.50": "#F8FAFC",
  "slate.100": "#F1F5F9",
  "slate.200": "#E2E8F0",
  "slate.300": "#CBD5E1",
  "slate.400": "#94A3B8",
  "slate.500": "#64748B",
  "slate.600": "#475569",
  "slate.700": "#334155",
  "slate.900": "#0F172A",
  "white": "#FFFFFF",
  "cyan.50": "#ECFEFF",
  "cyan.200": "#A5F3FC",
  "cyan.800": "#155E75",
  "orange.50": "#FFF7ED",
  "orange.200": "#FED7AA",
  "orange.800": "#9A3412",
  "fuchsia.50": "#FDF4FF",
  "fuchsia.200": "#F5D0FE",
  "fuchsia.800": "#86198F",
  "violet.50": "#F5F3FF",
  "violet.200": "#DDD6FE",
  "violet.800": "#5B21B6",
  "vezano.ink": "#12253B",
  "vezano.paper": "#F6F8FB",
  "vezano.surface": "#FFFFFF",
  "vezano.line": "#E0E7EE",
  "vezano.muted": "#5B6B7F",
  "vezano.accent": "#0E7C86",
  "vezano.accentStrong": "#0B5A61",
  "vezano.accentTint": "#F0F8F8",
  "vezano.accentLine": "#B6DCDF",
  "vezano.ok": "#15803D",
  "vezano.warn": "#B45309",
  "vezano.danger": "#B91C1C",
  "vezano.sidebar": "#0F1D2C",
  "vezano.sidebarText": "#F5F7FA"
} as const;

/** الأسماء الدلالية العشرون (02-Design-System §١). */
export const semantic = {
  "brand.strong": "#0B5A61",
  "brand.primary": "#0E7C86",
  "brand.tint": "#F0F8F8",
  "brand.line": "#B6DCDF",
  "accent": "#0E7C86",
  "ink.strong": "#12253B",
  "ink.muted": "#5B6B7F",
  "ink.faint": "#5B6B7F",
  "surface.page": "#F6F8FB",
  "surface.card": "#FFFFFF",
  "surface.sunken": "#F6F8FB",
  "border": "#E0E7EE",
  "ok": "#15803D",
  "warn": "#B45309",
  "expire": "#9A3412",
  "danger": "#B91C1C",
  "pending": "#1D4ED8",
  "conflict": "#86198F",
  "denied": "#5B21B6",
  "locked": "#0F172A",
  "sidebar": "#0F1D2C",
  "sidebar-text": "#F5F7FA"
} as const;

/** ألوان شارة كل حالة: bg / fg / border. */
export const stateColor = {
  "ready.bg": "#F0F8F8",
  "ready.fg": "#0B5A61",
  "ready.border": "#B6DCDF",
  "loading.bg": "#F1F5F9",
  "loading.fg": "#334155",
  "loading.border": "#CBD5E1",
  "empty.bg": "#F8FAFC",
  "empty.fg": "#475569",
  "empty.border": "#CBD5E1",
  "validation_error.bg": "#FEF2F2",
  "validation_error.fg": "#B91C1C",
  "validation_error.border": "#FECACA",
  "permission_denied.bg": "#F5F3FF",
  "permission_denied.fg": "#5B21B6",
  "permission_denied.border": "#DDD6FE",
  "offline.bg": "#FFFBEB",
  "offline.fg": "#B45309",
  "offline.border": "#FDE68A",
  "stale.bg": "#FFFBEB",
  "stale.fg": "#B45309",
  "stale.border": "#FDE68A",
  "saving.bg": "#EFF6FF",
  "saving.fg": "#1D4ED8",
  "saving.border": "#BFDBFE",
  "saved_local.bg": "#ECFEFF",
  "saved_local.fg": "#155E75",
  "saved_local.border": "#A5F3FC",
  "pending_sync.bg": "#EFF6FF",
  "pending_sync.fg": "#1D4ED8",
  "pending_sync.border": "#BFDBFE",
  "synced.bg": "#F0F8F8",
  "synced.fg": "#0B5A61",
  "synced.border": "#B6DCDF",
  "conflict.bg": "#FDF4FF",
  "conflict.fg": "#86198F",
  "conflict.border": "#F5D0FE",
  "server_error.bg": "#FEF2F2",
  "server_error.fg": "#B91C1C",
  "server_error.border": "#FECACA",
  "expired.bg": "#FFF7ED",
  "expired.fg": "#9A3412",
  "expired.border": "#FED7AA",
  "partial.bg": "#FFFBEB",
  "partial.fg": "#B45309",
  "partial.border": "#FDE68A",
  "success.bg": "#F0FDF4",
  "success.fg": "#15803D",
  "success.border": "#BBF7D0",
  "phase_locked.bg": "#F1F5F9",
  "phase_locked.fg": "#0F172A",
  "phase_locked.border": "#94A3B8"
} as const;

export const font = {
  "heading": "Cairo, IBM Plex Sans Arabic, sans-serif",
  "ui": "IBM Plex Sans Arabic, system-ui, sans-serif",
  "mono": "IBM Plex Mono, monospace"
} as const;
export const fontWeight = {
  "regular": 400,
  "medium": 500,
  "semibold": 600,
  "bold": 700
} as const;
export const fontSize = {
  "pageTitle": "28px",
  "sectionTitle": "20px",
  "cardTitle": "16px",
  "base": "15px",
  "subTitle": "15px",
  "body": "14px",
  "bodyDense": "13.5px",
  "note": "13px",
  "badge": "12.5px",
  "badgeMin": "12px"
} as const;
export const lineHeight = {
  "tight": 1.25,
  "snug": 1.4,
  "body": 1.65,
  "dense": 1.7
} as const;
export const space = {
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "6": "24px",
  "8": "32px",
  "11": "44px",
  "16": "64px",
  "1.5": "6px",
  "2.5": "10px",
  "3.5": "14px"
} as const;
export const radius = {
  "badge": "6px",
  "iconSm": "7px",
  "panelSm": "9px",
  "stat": "10px",
  "card": "12px"
} as const;
export const border = {
  "default": "1px solid #E0E7EE"
} as const;
export const shadow = {
  "none": "none",
  "overlay": "0 8px 24px rgba(15,23,42,.12)"
} as const;
export const motion = {
  "enter": "180ms cubic-bezier(0,0,.2,1)",
  "exit": "100ms cubic-bezier(.4,0,1,1)",
  "none": "0ms"
} as const;
export const layout = {
  "contentMax": "1240px",
  "pagePadding": "24px",
  "cardPadding": "16px",
  "gridGap": "14px",
  "sectionGap": "44px",
  "touchTarget": "44px"
} as const;

/** الحالات الـ17: الرمز → الاسم العربي للشارة. */
export const stateLabel = {
  "ready": "جاهز",
  "loading": "تحميل",
  "empty": "فارغ",
  "validation_error": "خطأ تحقق",
  "permission_denied": "صلاحية مرفوضة",
  "offline": "بلا اتصال",
  "stale": "بيانات قديمة",
  "saving": "جارٍ الحفظ",
  "saved_local": "محفوظ محلياً",
  "pending_sync": "معلّق المزامنة",
  "synced": "مؤكد خادمياً",
  "conflict": "تعارض",
  "server_error": "خطأ خادم",
  "expired": "منتهي الصلاحية",
  "partial": "جزئي",
  "success": "نجاح",
  "phase_locked": "مرحلة غير مفعّلة"
} as const;
export type StateCode = keyof typeof stateLabel;
export const STATE_CODES = ["ready","loading","empty","validation_error","permission_denied","offline","stale","saving","saved_local","pending_sync","synced","conflict","server_error","expired","partial","success","phase_locked"] as const;

/** المنصات ومقاساتها المعتمدة (W/M/D/A/C). */
export const platform = {
  "W": {
    "viewports": [
      390,
      834,
      1440
    ],
    "note": "تحقق إضافي على 360px؛ إعادة ترتيب المحتوى لا تعني ثلاث صفحات أعمال"
  },
  "M": {
    "viewports": [
      390
    ],
    "note": "تحقق على 360px؛ نسخة تابلت 834px لشاشات POS فقط"
  },
  "D": {
    "viewports": [
      1366,
      1920
    ],
    "note": "تغيير حجم النافذة مطلوب بين المقاسين"
  },
  "A": {
    "viewports": [
      390,
      834,
      1440
    ],
    "note": "إدارة Sting ويب متجاوب داخل إطار منفصل"
  },
  "C": {
    "viewports": [
      390,
      1440
    ],
    "note": "بوابة الزبون ويب/PWA؛ لا تتطلب Expo"
  }
} as const;
export type PlatformCode = keyof typeof platform;
