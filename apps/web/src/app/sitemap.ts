import type { MetadataRoute } from "next";

import { SITE_URL } from "@/features/public/site";

/** الصفحات العامة وحدها (0005 §١٥٤) — ما خلف الدخول ممنوع في robots.ts. */
const PAGES: { path: string; priority: number; changeFrequency: "weekly" | "monthly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/plans", priority: 0.9, changeFrequency: "monthly" },
  { path: "/register", priority: 0.8, changeFrequency: "monthly" },
  { path: "/market", priority: 0.6, changeFrequency: "weekly" },
  { path: "/status", priority: 0.5, changeFrequency: "weekly" },
  { path: "/demo/track", priority: 0.4, changeFrequency: "monthly" },
  { path: "/legal", priority: 0.4, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({
    url: `${SITE_URL}${p.path === "/" ? "" : p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
