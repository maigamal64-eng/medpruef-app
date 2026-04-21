import type { MetadataRoute } from "next";

/**
 * Dynamic sitemap — takes precedence over /public/sitemap.xml in Next.js 15.
 *
 * Scope: only public-facing routes (no auth-gated pages, no /admin, no /api).
 * Priorities per MedPrüf launch brief:
 *   1.0  — canonical root (/)
 *   0.9  — primary conversion surfaces (/landing, /pricing)
 *   0.7  — secondary marketing (/about, /materials)
 *   0.5  — legal + changelog (/privacy, /terms, /impressum, /changelog)
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://medpruf.com";
  const now = new Date();

  return [
    {
      url: `${base}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${base}/landing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${base}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${base}/materials`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${base}/changelog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: `${base}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${base}/impressum`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
