/**
 * MedPrüf blog registry.
 *
 * Tiny metadata-only catalog of posts. The actual post content lives
 * inside each post's route component (e.g.
 * `src/app/blog/kenntnispruefung-wien-vollstaendiges-handbuch/page.tsx`)
 * so it's natural JSX — no CMS, no markdown parser, no
 * MDX-at-build-time machinery. That keeps the blog dead simple to
 * maintain with Claude-Code-generated content.
 *
 * The `[slug]/page.tsx` dynamic route exists as a shell for future
 * posts — today the only post has its own hard-coded route. When a
 * future post lands at the dynamic route, register it here too so
 * the index + sitemap pick it up.
 */

export interface BlogPostMeta {
  slug: string;
  title: { de: string; en: string };
  summary: { de: string; en: string };
  publishedAt: string; // ISO date
  updatedAt?: string;
  author: string;
  readingMinutes: number;
  tags: string[];
  /**
   * If true, the post lives at `src/app/blog/<slug>/page.tsx` (its
   * own hard-coded route file). If false, the post is served from
   * the `[slug]/page.tsx` dynamic route and content must be resolved
   * there — today no dynamic posts exist, so this is always true.
   */
  hasOwnRoute: boolean;
}

export const BLOG_POSTS: BlogPostMeta[] = [
  {
    slug: "spaced-repetition-arztpruefungen-oesterreich",
    title: {
      de: "Spaced Repetition für die österreichischen Arztprüfungen (SM-2)",
      en: "Spaced repetition for the Austrian medical exams (SM-2)",
    },
    summary: {
      de: "Kenntnisprüfung Wien, Stichprobentest und Pharmakologie ziehen aus einem riesigen Fragenpool. So nutzt du Spaced Repetition (SM-2), aktives Erinnern und den 70-30-Rhythmus, um über 10.000 Fragen wirklich zu behalten.",
      en: "The Kenntnisprüfung Wien, Stichprobentest and Pharmakologie exams draw from a huge question pool. Here is how to use spaced repetition (SM-2), active recall and the 70-30 rhythm to actually retain over 10,000 questions.",
    },
    publishedAt: "2026-07-02",
    author: "MedPrüf Editorial",
    readingMinutes: 9,
    tags: ["Spaced Repetition", "SM-2", "Lernmethode", "Kenntnisprüfung", "Stichprobentest"],
    hasOwnRoute: true,
  },
  {
    slug: "kenntnispruefung-wien-vollstaendiges-handbuch",
    title: {
      de: "Kenntnisprüfung Wien: vollständiges Handbuch 2026",
      en: "Vienna Kenntnisprüfung: complete 2026 handbook",
    },
    summary: {
      de: "Alles, was du 2026 zur Kenntnisprüfung Wien wissen musst: Zulassung, SIP-4-vs-SIP-5-Struktur, Prüfungsaufbau, typische Schwerpunkte, realistische Lernpläne und häufige Fehler. Ein ehrliches Handbuch von Ärzt:innen, die den Weg selbst gegangen sind.",
      en: "Everything you need to know about the 2026 Vienna Kenntnisprüfung: admission, SIP 4 vs SIP 5 structure, exam format, typical focus areas, realistic study plans, and common mistakes. An honest handbook from doctors who've walked the path themselves.",
    },
    publishedAt: "2026-04-24",
    author: "MedPrüf Editorial",
    readingMinutes: 10,
    tags: ["Kenntnisprüfung", "Wien", "Nostrifikation", "SIP 4", "SIP 5"],
    hasOwnRoute: true,
  },
];

export function getPostBySlug(slug: string): BlogPostMeta | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
