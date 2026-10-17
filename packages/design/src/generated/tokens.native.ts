// مولَّد آلياً من handoff/tokens.json (DS-1.2) لـ React Native — لا يُحرَّر يدوياً.
// الشاشات تقرأ الأسماء الدلالية لا القيم (02-Design-System §١)؛ نفس قيم theme.css حرفياً.

/** ألوان الوضع الفاتح: الأسماء الدلالية + ألوان شارات الحالات الـ17 (bg/fg/border). */
export const lightColors = {
  "brandStrong": "#0B5A61",
  "brandPrimary": "#0E7C86",
  "brandTint": "#F0F8F8",
  "brandLine": "#B6DCDF",
  "accent": "#0E7C86",
  "inkStrong": "#12253B",
  "inkMuted": "#5B6B7F",
  "inkFaint": "#5B6B7F",
  "surfacePage": "#F6F8FB",
  "surfaceCard": "#FFFFFF",
  "surfaceSunken": "#F6F8FB",
  "border": "#E0E7EE",
  "ok": "#15803D",
  "warn": "#B45309",
  "expire": "#9A3412",
  "danger": "#B91C1C",
  "pending": "#1D4ED8",
  "conflict": "#86198F",
  "denied": "#5B21B6",
  "locked": "#0F172A",
  "sidebar": "#FFFFFF",
  "sidebarText": "#12253B",
  "navy": "#0F1D2C",
  "navyText": "#F5F7FA",
  "state": {
    "ready": {
      "bg": "#F0F8F8",
      "fg": "#0B5A61",
      "border": "#B6DCDF"
    },
    "loading": {
      "bg": "#F1F5F9",
      "fg": "#334155",
      "border": "#CBD5E1"
    },
    "empty": {
      "bg": "#F8FAFC",
      "fg": "#475569",
      "border": "#CBD5E1"
    },
    "validation_error": {
      "bg": "#FEF2F2",
      "fg": "#B91C1C",
      "border": "#FECACA"
    },
    "permission_denied": {
      "bg": "#F5F3FF",
      "fg": "#5B21B6",
      "border": "#DDD6FE"
    },
    "offline": {
      "bg": "#FFFBEB",
      "fg": "#B45309",
      "border": "#FDE68A"
    },
    "stale": {
      "bg": "#FFFBEB",
      "fg": "#B45309",
      "border": "#FDE68A"
    },
    "saving": {
      "bg": "#EFF6FF",
      "fg": "#1D4ED8",
      "border": "#BFDBFE"
    },
    "saved_local": {
      "bg": "#ECFEFF",
      "fg": "#155E75",
      "border": "#A5F3FC"
    },
    "pending_sync": {
      "bg": "#EFF6FF",
      "fg": "#1D4ED8",
      "border": "#BFDBFE"
    },
    "synced": {
      "bg": "#F0F8F8",
      "fg": "#0B5A61",
      "border": "#B6DCDF"
    },
    "conflict": {
      "bg": "#FDF4FF",
      "fg": "#86198F",
      "border": "#F5D0FE"
    },
    "server_error": {
      "bg": "#FEF2F2",
      "fg": "#B91C1C",
      "border": "#FECACA"
    },
    "expired": {
      "bg": "#FFF7ED",
      "fg": "#9A3412",
      "border": "#FED7AA"
    },
    "partial": {
      "bg": "#FFFBEB",
      "fg": "#B45309",
      "border": "#FDE68A"
    },
    "success": {
      "bg": "#F0FDF4",
      "fg": "#15803D",
      "border": "#BBF7D0"
    },
    "phase_locked": {
      "bg": "#F1F5F9",
      "fg": "#0F172A",
      "border": "#94A3B8"
    }
  }
} as const;

/** ألوان الوضع الداكن — المفاتيح نفسها؛ ما لا تجاوز له في dark يبقى بقيمته الفاتحة كما في CSS. */
export const darkColors = {
  "brandStrong": "#5AC6CD",
  "brandPrimary": "#37B0B8",
  "brandTint": "#12303A",
  "brandLine": "#1F5A62",
  "accent": "#37B0B8",
  "inkStrong": "#E8EDF3",
  "inkMuted": "#9EABBA",
  "inkFaint": "#8A97A8",
  "surfacePage": "#0C141F",
  "surfaceCard": "#131E2D",
  "surfaceSunken": "#0C141F",
  "border": "#243246",
  "ok": "#4ADE80",
  "warn": "#FBBF24",
  "expire": "#9A3412",
  "danger": "#F87171",
  "pending": "#1D4ED8",
  "conflict": "#86198F",
  "denied": "#5B21B6",
  "locked": "#0F172A",
  "sidebar": "#131E2D",
  "sidebarText": "#E8EDF3",
  "navy": "#0F1D2C",
  "navyText": "#F5F7FA",
  "state": {
    "ready": {
      "bg": "#12303A",
      "fg": "#5AC6CD",
      "border": "#1F5A62"
    },
    "loading": {
      "bg": "#1B2635",
      "fg": "#C7D2E0",
      "border": "#3A4A5E"
    },
    "empty": {
      "bg": "#162130",
      "fg": "#C7D2E0",
      "border": "#3A4A5E"
    },
    "validation_error": {
      "bg": "#3A1717",
      "fg": "#FCA5A5",
      "border": "#7F2A2A"
    },
    "permission_denied": {
      "bg": "#2A1F45",
      "fg": "#C4B5FD",
      "border": "#5B3FA8"
    },
    "offline": {
      "bg": "#3A2A0F",
      "fg": "#FCD34D",
      "border": "#7A5A12"
    },
    "stale": {
      "bg": "#3A2A0F",
      "fg": "#FCD34D",
      "border": "#7A5A12"
    },
    "saving": {
      "bg": "#14243F",
      "fg": "#93C5FD",
      "border": "#2A4E8A"
    },
    "saved_local": {
      "bg": "#0F2E36",
      "fg": "#67E8F9",
      "border": "#1B5C68"
    },
    "pending_sync": {
      "bg": "#14243F",
      "fg": "#93C5FD",
      "border": "#2A4E8A"
    },
    "synced": {
      "bg": "#12303A",
      "fg": "#5AC6CD",
      "border": "#1F5A62"
    },
    "conflict": {
      "bg": "#331A38",
      "fg": "#F0ABFC",
      "border": "#6F2F78"
    },
    "server_error": {
      "bg": "#3A1717",
      "fg": "#FCA5A5",
      "border": "#7F2A2A"
    },
    "expired": {
      "bg": "#3A2210",
      "fg": "#FDBA74",
      "border": "#7C4A1C"
    },
    "partial": {
      "bg": "#3A2A0F",
      "fg": "#FCD34D",
      "border": "#7A5A12"
    },
    "success": {
      "bg": "#12301F",
      "fg": "#4ADE80",
      "border": "#1F5A36"
    },
    "phase_locked": {
      "bg": "#1B2635",
      "fg": "#E8EDF3",
      "border": "#5B6B7F"
    }
  }
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
/** شكل لوحة الألوان (مفاتيح الفاتح، قيم نصية) — لسياق السمة في تطبيق الجوال. */
export type NativeColors = Widen<typeof lightColors>;
export type ColorScheme = "light" | "dark";
/** satisfies: الداكن يُرفض في typecheck إن نقصه مفتاح من الفاتح. */
export const colors = { light: lightColors, dark: darkColors } as const satisfies Record<ColorScheme, NativeColors>;

/** العائلة الأولى من كل سلسلة في tokens.json (RN لا يدعم البدائل)؛ اسم الخط كما يُحمَّل. */
export const fontFamily = {
  "heading": "Tajawal",
  "ui": "Tajawal",
  "mono": "IBM Plex Mono"
} as const;
/** السلسلة كاملة بلا العائلات العامة — للمنصة التي تحمّل بديلاً. */
export const fontFamilyFallbacks = {
  "heading": [
    "Tajawal",
    "Cairo"
  ],
  "ui": [
    "Tajawal",
    "IBM Plex Sans Arabic"
  ],
  "mono": [
    "IBM Plex Mono"
  ]
} as const;
/** أوزان RN نصوص ("400") لا أرقام. */
export const fontWeight = {
  "regular": "400",
  "medium": "500",
  "semibold": "600",
  "bold": "700",
  "extrabold": "800"
} as const;
/** بالنقاط (dp) بلا px. */
export const fontSize = {
  "pageTitle": 28,
  "sectionTitle": 20,
  "cardTitle": 16,
  "base": 16,
  "subTitle": 16,
  "body": 15,
  "bodyDense": 14,
  "note": 13,
  "badge": 12.5,
  "badgeMin": 12
} as const;
/** مضاعِفات كما في CSS؛ RN يريد نقاطاً: Math.round(fontSize * lineHeight). */
export const lineHeight = {
  "tight": 1.25,
  "snug": 1.4,
  "body": 1.65,
  "dense": 1.7
} as const;
export const space = {
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "6": 24,
  "8": 32,
  "11": 44,
  "16": 64,
  "1.5": 6,
  "2.5": 10,
  "3.5": 14
} as const;
export const radius = {
  "badge": 6,
  "iconSm": 7,
  "panelSm": 10,
  "stat": 10,
  "card": 18
} as const;
/** touchTarget = 44: الحد الأدنى لكل هدف لمس. */
export const layout = {
  "contentMax": 1240,
  "pagePadding": 24,
  "cardPadding": 16,
  "gridGap": 14,
  "sectionGap": 44,
  "touchTarget": 44
} as const;
