import type { Metadata } from "next";
import { getNextExamSitting } from "@/lib/exam-dates";

/**
 * /stichprobentest — SEO landing page for the national Stichprobentest
 * (the Nostrifizierung screening exam). Primary queries, measured on live
 * google.at/google.de SERPs 2026-09-05:
 *   "Stichprobentest Österreich"   (we ranked #7 AT / #6 DE on the bare homepage)
 *   "Stichprobentest Vorbereitung" (#7 AT / #3 DE)
 *   "Stichprobentest Medizin"      (#9 AT / #7 DE)
 * Those SERPs carry ZERO ads and ZERO People-Also-Ask, and no commercial
 * competitor for this exam exists on either geo. Every page above us is a
 * university or ministry procedural page; none offers preparation.
 *
 * Renamed from /kmp-innsbruck on 2026-09-05. The venue ROTATES every sitting
 * (2026: Innsbruck-Feb, Wien-May, Graz-Sep), so it must never be baked into
 * the URL, the title, or the H1. The DB key stays `kmp_innsbruck` (legacy).
 *
 * The DB key + URL slug stay `kmp_innsbruck` / /kmp-innsbruck (legacy
 * key + route/provenance anchor). The display copy was corrected on
 * 2026-06-21: the exam is the national Stichprobentest, NOT the
 * domestic "Kumulative Modulprüfung" (that is Innsbruck's own
 * end-of-semester exam for domestic students, not the foreign-doctor
 * recognition test). The "KMP Innsbruck" keyword is kept below so the
 * page still ranks for the term users historically searched.
 *
 * Public copy uses a rounded question count to avoid stale snapshots. We do NOT name a source institution in customer-facing
 * copy (removed 2026-09-05, [name]'s call): naming one creates institutional
 * exposure for zero commercial benefit, and a competitor selling recalled
 * exam content was stopped in Feb 2026 over a dispute with a Universitäts-
 * leitung. What we DO say, because it is both true and the differentiator:
 * these are curriculum-derived practice questions, explicitly NOT official
 * or recalled exam items.
 */

const pageTitle = "Stichprobentest: Vorbereitung mit 2.700+ Übungsfragen | MedPrüf";
const pageDesc =
  "Strukturierte Vorbereitung auf den nationalen Stichprobentest der Nostrifizierung mit über 2.700 kuratierten klinischen Übungsfragen. Keine offiziellen oder erinnerten Prüfungsfragen. 150 Fragen kostenlos.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Stichprobentest",
    "Stichprobentest Innsbruck",
    "Stichprobentest Nostrifizierung",
    "Stichprobentest Fragen",
    "Stichprobentest üben",
    "Stichprobentest Vorbereitung",
    "KMP Innsbruck",
    "Nostrifizierung Österreich",
    "Nostrifizierung Arzt",
    "Approbation Österreich",
  ],
  alternates: {
    canonical: "https://medpruf.com/stichprobentest",
  },
  openGraph: {
    type: "article",
    url: "https://medpruf.com/stichprobentest",
    siteName: "MedPrüf",
    title: pageTitle,
    description: pageDesc,
    locale: "de_AT",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDesc,
  },
};

function buildCourseSchema() {
  // The "KMP Innsbruck" exam is the national Stichprobentest — venue
  // rotates each sitting (next: Graz, 23 Sep 2026). Use the real next
  // sitting (computed at runtime, ages out) for both startDate and the
  // CourseInstance location; omit startDate if none is published.
  const sitting = getNextExamSitting("kmp_innsbruck");
  const courseInstance: Record<string, unknown> = {
    "@type": "CourseInstance",
    courseMode: "online",
    location: {
      "@type": "Place",
      name: sitting?.location
        ? `Online · Stichprobentest ${sitting.location}`
        : "Online · Stichprobentest Österreich",
      address: {
        "@type": "PostalAddress",
        addressLocality: sitting?.location ?? "Österreich",
        addressCountry: "AT",
      },
    },
  };
  if (sitting?.date) courseInstance.startDate = sitting.date;

  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: "Stichprobentest: Vorbereitung",
    description:
      "Vorbereitung auf den nationalen Stichprobentest der Nostrifizierung mit über 2.700 kuratierten Übungsfragen und klinischen Erklärungen. Keine offiziellen Prüfungsfragen.",
    provider: {
      "@type": "Organization",
      name: "MedPrüf",
      sameAs: "https://medpruf.com",
      url: "https://medpruf.com",
    },
    educationalLevel: "Postgraduate medical",
    inLanguage: ["de", "en", "ar", "ru", "fr", "tr", "uk", "sr"],
    courseMode: "online",
    teaches:
      "Innere Medizin, Allgemeine Chirurgie, chirurgische Spezialfächer und Anästhesie, Dermatologie, Gynäkologie und Geburtshilfe, HNO, Kinder und Jugendheilkunde, Kinder und Jugendpsychiatrie, Neurologie, Psychiatrie, Intensivmedizin, Augenheilkunde",
    audience: {
      "@type": "EducationalAudience",
      educationalRole: "Foreign-trained physician",
    },
    hasCourseInstance: courseInstance,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      description: "Free tier: 150 questions, no credit card required.",
    },
  };
}

export default function KmpInnsbruckLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildCourseSchema()) }}
      />
      {children}
    </>
  );
}
