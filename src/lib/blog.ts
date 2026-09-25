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
    slug: "kenntnispruefung-zweiter-versuch",
    title: {
      de: "Der zweite Versuch: die Kenntnisprüfung Wien nach einem Fehlversuch bestehen",
      en: "The second attempt: passing the Kenntnisprüfung Wien after failing once",
    },
    summary: {
      de: "Die Kenntnisprüfung Wien ist ein offenes Kurzantwortformat mit kohortenrelativer Bestehensgrenze. Warum der erste Versuch selten am Wissen scheitert, welche drei Verschiebungen den zweiten Versuch tragen, und wie du freien Abruf und Format gezielt trainierst.",
      en: "The Kenntnisprüfung Wien is an open short-answer exam with a cohort-relative pass mark. Why a first attempt rarely fails on knowledge, the three shifts that carry a second attempt, and how to train free recall and the format deliberately.",
    },
    publishedAt: "2026-07-03",
    author: "MedPrüf Editorial",
    readingMinutes: 9,
    tags: ["Kenntnisprüfung", "Zweiter Versuch", "KAF", "Prüfungsformat", "Wien"],
    hasOwnRoute: true,
  },
  {
    slug: "medizin-lernen-in-deiner-sprache",
    title: {
      de: "Medizin lernen in deiner Sprache: die österreichische Arztprüfung mit mehrsprachigen Erklärungen",
      en: "Study medicine in your language: the Austrian medical exam with multilingual explanations",
    },
    summary: {
      de: "Die Prüfung läuft auf Deutsch, dein Verständnis darf in deiner Sprache entstehen: Erklärungen in sieben Sprachen (Russisch, Arabisch, Englisch, Französisch, Türkisch, Ukrainisch, Serbisch) zu über 10.000 echten Fragen, plus Oberfläche in fünf Sprachen.",
      en: "The exam runs in German, but your understanding can grow in your language: explanations in seven languages (Russian, Arabic, English, French, Turkish, Ukrainian, Serbian) across over 10,000 curated practice questions, plus a five-language interface.",
    },
    publishedAt: "2026-07-03",
    author: "MedPrüf Editorial",
    readingMinutes: 8,
    tags: ["Mehrsprachig", "Erklärungen", "Sprache", "Kenntnisprüfung", "Stichprobentest"],
    hasOwnRoute: true,
  },
  {
    slug: "medizinisches-deutsch-auslaendische-aerzte",
    title: {
      de: "Medizinisches Deutsch für ausländische Ärzt:innen: die Sprachlücke schließen",
      en: "Medical German for foreign doctors: closing the language gap",
    },
    summary: {
      de: "Bei den österreichischen Wissensprüfungen scheitert es oft an der deutschen Fachsprache, nicht am Wissen. So schließt du die Sprachlücke: zuerst verstehen, dann auf Deutsch üben, Terminologie im Kontext, echte deutsche Fragen.",
      en: "On the Austrian knowledge exams the barrier is often the German medical language, not the knowledge. Close the gap: understand first, then practice in German, terminology in context, and real German questions.",
    },
    publishedAt: "2026-07-02",
    author: "MedPrüf Editorial",
    readingMinutes: 8,
    tags: ["Medizinisches Deutsch", "Fachsprache", "Sprache", "Kenntnisprüfung", "Nostrifikation"],
    hasOwnRoute: true,
  },
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
