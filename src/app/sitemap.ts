import type { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/lib/blog";

/**
 * Dynamic sitemap — takes precedence over /public/sitemap.xml in Next.js 15.
 *
 * Scope: only public-facing routes (no auth-gated pages, no /admin, no /api).
 *
 * NOTE: the bare "/" is intentionally NOT listed — it 307-redirects to
 * /landing at the edge, and the canonical for the homepage is /landing
 * (see src/app/layout.tsx). Listing both invited duplicate-content
 * handling and let Google canonicalise to the redirecting root.
 * Brand-sweep 2026-06-04.
 *
 * Priorities per MedPrüf launch brief + Apr-24 SEO sprint:
 *   1.0  — canonical homepage (/landing)
 *   0.9  — primary conversion surface (/pricing)
 *   0.8  — exam-specific SEO landing pages (Kenntnisprüfung, KMP, Pharma)
 *   0.7  — secondary marketing (/about, /materials)
 *   0.6  — blog index
 *   0.5  — blog posts, legal, changelog
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://medpruf.com";
  const now = new Date();
  // Apr-24 SEO sprint landed the new landing pages + blog — lock the
  // lastModified for those routes to that date so the signal reflects
  // the real launch, not the daily sitemap regen.
  const seoSprintDate = new Date("2026-04-24T00:00:00Z");

  const blogPostEntries: MetadataRoute.Sitemap = BLOG_POSTS.map((p) => ({
    url: `${base}/blog/${p.slug}`,
    lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(p.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));

  return [
    // "/" omitted — it 307-redirects to /landing; /landing is the canonical
    // homepage. See the header note above. Brand-sweep 2026-06-04.
    {
      url: `${base}/landing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    // Exam-specific SEO landing pages (Apr-24 sprint)
    {
      url: `${base}/kenntnispruefung-wien`,
      lastModified: seoSprintDate,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${base}/kmp-innsbruck`,
      lastModified: seoSprintDate,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${base}/pharmakologie-pruefung-wien`,
      lastModified: seoSprintDate,
      changeFrequency: "weekly",
      priority: 0.8,
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
      url: `${base}/faq`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // Blog index + posts
    {
      url: `${base}/blog`,
      lastModified: seoSprintDate,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...blogPostEntries,
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
