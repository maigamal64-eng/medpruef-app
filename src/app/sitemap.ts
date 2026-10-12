import { liveGuidanceRoutes } from "@/lib/guidance/routes";
import type { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/lib/blog";

/**
 * Dynamic sitemap — takes precedence over /public/sitemap.xml in Next.js 15.
 *
 * Scope: only public-facing routes (no auth-gated pages, no /admin, no /api).
 *
 * NOTE (revised 2026-09-05, from measured data): the bare "/" IS listed and
 * /landing is not. Search Console for 25 Jun to 2 Sep 2026 attributes ALL 629
 * homepage impressions and 76 clicks to "/", not to /landing: Google indexes
 * and ranks the apex regardless of the 307. The previous setup pointed the
 * sitemap and the canonical at a URL Google had already declined to index,
 * so three signals disagreed with the one that earns 78% of our organic
 * clicks. They now all point at "/". Supersedes brand-sweep 2026-06-04.
 *
 * Priorities per MedPrüf launch brief + Apr-24 SEO sprint:
 *   1.0  — canonical homepage (/)
 *   0.9  — primary conversion surface (/pricing)
 *   0.8  — exam-specific SEO landing pages (Kenntnisprüfung, Stichprobentest, Pharma)
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
  const guidanceDate = new Date("2026-10-12T00:00:00Z");

  const blogPostEntries: MetadataRoute.Sitemap = BLOG_POSTS.map((p) => ({
    url: `${base}/blog/${p.slug}`,
    lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(p.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));

  return [
    {
      url: `${base}/`,
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
      url: `${base}/stichprobentest`,
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
    // Vienna registration guidance (b01, 2026-10-12). Facts carry their own
    // read-on stamps; the date marks when the pages went live.
    // a26: every live guidance route from the one registry (b07, b14 to b18, b22).
    ...liveGuidanceRoutes().map((route) => route.path).map(
      (path) => ({
        url: `${base}${path}`,
        lastModified: guidanceDate,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })
    ),
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
      // Added 2026-09-05: /find-your-path drew 5 Search Console impressions
      // while being absent from our own sitemap.
      url: `${base}/find-your-path`,
      lastModified: seoSprintDate,
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
