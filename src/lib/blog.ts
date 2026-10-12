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
    slug: "ukrainian-refugee-physicians-austria",
    title: {
      de: "Geflüchtete Ärztinnen und Ärzte aus der Ukraine: Arztpraxis in Österreich",
      en: "How Ukrainian Doctors Can Practice Medicine in Austria: 2026 Guide",
    },
    summary: {
      de: "Was geflüchtete Ärztinnen und Ärzte aus der Ukraine brauchen, um in Österreich Medizin zu praktizieren: Nostrifizierung, Sprachprüfung, Stichprobentest und der Weg zur Eintragung in die Ärzteliste. Mit Behörden, Kosten, Fristen und Sofort-Schritten.",
      en: "Step-by-step 2026 guide for Ukrainian doctors in Austria: nostrification, German requirements, Stichprobentest, Ärzteliste, costs and next steps.",
    },
    publishedAt: "2026-10-05",
    updatedAt: "2026-10-05",
    author: "MedPrüf",
    readingMinutes: 12,
    tags: ["Ukraine", "Nostrifizierung", "Stichprobentest", "Flüchtlingsärzte", "Ärztliche Anerkennung"],
    hasOwnRoute: true,
  },
  {
    slug: "ukrainische-aerzte-oesterreich-anerkennung",
    title: {
      de: "Wie ukrainische Ärztinnen und Ärzte in Österreich Medizin praktizieren können: Leitfaden 2026",
      en: "How Ukrainian Doctors Can Practice Medicine in Austria: 2026 Guide",
    },
    summary: {
      de: "Schritt-für-Schritt-Leitfaden 2026 für ukrainische Ärztinnen und Ärzte in Österreich: Nostrifizierung, Deutsch-Anforderungen, Stichprobentest, Ärzteliste, Kosten und nächste Schritte.",
      en: "Step-by-step 2026 guide for Ukrainian doctors in Austria: nostrification, German requirements, Stichprobentest, Ärzteliste, costs and next steps.",
    },
    publishedAt: "2026-10-05",
    updatedAt: "2026-10-05",
    author: "MedPrüf",
    readingMinutes: 12,
    tags: ["Ukraine", "Nostrifizierung", "Stichprobentest", "Flüchtlingsärzte", "Ärztliche Anerkennung", "Deutsch"],
    hasOwnRoute: true,
  },
  {
    slug: "kenntnispruefung-zweiter-versuch",
    title: {
      de: "Der zweite Versuch: die Kenntnisprüfung Wien nach einem Fehlversuch bestehen",
      en: "The second attempt: passing the Kenntnisprüfung Wien after failing once",
    },
    summary: {
      de: "Lernen nach einem Fehlversuch: Wissenslücken analysieren und aktives Erinnern üben. Die Wiener Bank ist SIP4a/SIP5a-basiertes Lernmaterial, nicht die postgraduale ÖÄK-Prüfung.",
      en: "Study after an unsuccessful attempt: identify knowledge gaps and practice active recall. The Vienna bank is SIP4a/SIP5a-based study material, distinct from the postgraduate ÖÄK exam.",
    },
    publishedAt: "2026-07-03",
    author: "MedPrüf",
    readingMinutes: 9,
    tags: ["SIP4a / SIP5a", "Zweiter Versuch", "Prüfungsformat", "Wien"],
    hasOwnRoute: true,
  },
  {
    slug: "medizin-lernen-in-deiner-sprache",
    title: {
      de: "Medizin lernen in Ihrer Sprache: die österreichische Arztprüfung mit mehrsprachigen Erklärungen",
      en: "Study medicine in your language: the Austrian medical exam with multilingual explanations",
    },
    summary: {
      de: "Die Prüfung läuft auf Deutsch, Ihr Verständnis darf in Ihrer Sprache entstehen: Erklärungen in sieben Sprachen (Russisch, Arabisch, Englisch, Französisch, Türkisch, Ukrainisch, Serbisch) zu über 10.000 kuratierten Übungsfragen, plus Oberfläche in fünf Sprachen.",
      en: "The exam runs in German, but your understanding can grow in your language: explanations in seven languages (Russian, Arabic, English, French, Turkish, Ukrainian, Serbian) across over 10,000 curated practice questions, plus a five-language interface.",
    },
    publishedAt: "2026-07-03",
    author: "MedPrüf",
    readingMinutes: 8,
    tags: ["Mehrsprachig", "Erklärungen", "Sprache", "Kenntnisprüfung", "Stichprobentest"],
    hasOwnRoute: true,
  },
  {
    slug: "medizinisches-deutsch-auslaendische-aerzte",
    title: {
      de: "Medizinisches Deutsch für Ärztinnen und Ärzte aus dem Ausland: die Sprachlücke schließen",
      en: "Medical German for foreign doctors: closing the language gap",
    },
    summary: {
      de: "Bei den österreichischen Wissensprüfungen scheitert es oft an der deutschen Fachsprache, nicht am Wissen. So schließen Sie die Sprachlücke: zuerst verstehen, dann auf Deutsch üben, Terminologie im Kontext, Übungsfragen auf Deutsch.",
      en: "On the Austrian knowledge exams the barrier is often the German medical language, not the knowledge. Close the gap: understand first, then practice in German, terminology in context, and practice questions in German.",
    },
    publishedAt: "2026-07-02",
    author: "MedPrüf",
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
      de: "Kenntnisprüfung Wien, Stichprobentest und Pharmakologie haben kuratierte Übungsfragenpools. So nutzen Sie Spaced Repetition (SM-2), aktives Erinnern und den 70-30-Rhythmus, um Übungsstoff besser zu behalten.",
      en: "The Kenntnisprüfung Wien, Stichprobentest and Pharmakologie have curated practice question banks. Here is how to use spaced repetition (SM-2), active recall and the 70-30 rhythm to retain what you study.",
    },
    publishedAt: "2026-07-02",
    author: "MedPrüf",
    readingMinutes: 9,
    tags: ["Spaced Repetition", "SM-2", "Lernmethode", "Kenntnisprüfung", "Stichprobentest"],
    hasOwnRoute: true,
  },
  {
    slug: "kenntnispruefung-wien-vollstaendiges-handbuch",
    title: {
      de: "Kenntnisprüfung Wien: Lernleitfaden 2026",
      en: "Vienna Kenntnisprüfung: 2026 practice guide",
    },
    summary: {
      de: "Lernleitfaden zur SIP4a/SIP5a-basierten Wiener Fragenbank. Lernplanung und Formatgrenzen, keine Zulassungsberatung. Offizielle Anforderungen und Termine bestätigt die Universität.",
      en: "A study guide for the SIP4a/SIP5a-based Vienna practice bank. Study planning and format limitations, not admission advice. Your university confirms official requirements and dates.",
    },
    publishedAt: "2026-04-24",
    author: "MedPrüf",
    readingMinutes: 10,
    tags: ["Kenntnisprüfung", "Wien", "Nostrifikation", "SIP 4", "SIP 5"],
    hasOwnRoute: true,
  },
];

export function getPostBySlug(slug: string): BlogPostMeta | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
