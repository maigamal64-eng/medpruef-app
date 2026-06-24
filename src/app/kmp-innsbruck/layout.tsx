import type { Metadata } from "next";
import { getNextExamSitting } from "@/lib/exam-dates";

/**
 * /kmp-innsbruck — SEO landing page for the national Stichprobentest
 * (the MedUni Nostrifizierung screening). Primary queries:
 *   "Stichprobentest"
 *   "Stichprobentest Innsbruck"
 *   "Nostrifizierung Innsbruck"
 *   "MedUni Innsbruck Prüfung"
 *
 * The DB key + URL slug stay `kmp_innsbruck` / /kmp-innsbruck (legacy
 * key + route/provenance anchor). The display copy was corrected on
 * 2026-06-21: the exam is the national Stichprobentest, NOT the
 * domestic "Kumulative Modulprüfung" (that is Innsbruck's own
 * end-of-semester exam for domestic students, not the foreign-doctor
 * recognition test). The "KMP Innsbruck" keyword is kept below so the
 * page still ranks for the term users historically searched.
 *
 * Content numbers: 2,742 questions across 12 specialties (live DB count
 * 2026-06-24; imported from 17 KoalaMed PDFs distilled from the
 * Med Uni Innsbruck clinical curriculum). KoalaMed is a third-party
 * platform that publishes exam-style PDFs; we imported from those
 * materials but KoalaMed is NOT the exam, we don't represent them, and
 * these are NOT official Stichprobentest items.
 */

const pageTitle = "Stichprobentest (Innsbruck) 2026: Vorbereitung mit 2.742 Fragen | MedPrüf";
const pageDesc =
  "Strukturierte Vorbereitung auf den nationalen Stichprobentest der Nostrifizierung. 2.742 Fragen aus 12 Fachgebieten, klinisch kommentiert, aus dem Curriculum der Med Uni Innsbruck. 150 Fragen kostenlos.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Stichprobentest",
    "Stichprobentest Innsbruck",
    "Stichprobentest Nostrifizierung",
    "KMP Innsbruck",
    "MedUni Innsbruck",
    "Innsbruck Medizin Prüfung",
    "Approbation Österreich",
    "Nostrifizierung Innsbruck",
    "ausländische Ärzte Tirol",
  ],
  alternates: {
    canonical: "https://medpruf.com/kmp-innsbruck",
  },
  openGraph: {
    type: "article",
    url: "https://medpruf.com/kmp-innsbruck",
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
        : "Online · MedUni Nostrifizierung",
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
    name: "Stichprobentest (Innsbruck): Vorbereitung",
    description:
      "Strukturierte Vorbereitung auf den nationalen Stichprobentest der Nostrifizierung für ausländische Ärzt:innen: 12 Fachgebiete, 2.742 Fragen aus dem klinischen Curriculum der Med Uni Innsbruck, mit klinischen Erklärungen.",
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
      description: "Free tier — 150 questions, no credit card required.",
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
