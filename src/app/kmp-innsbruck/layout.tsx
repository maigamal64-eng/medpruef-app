import type { Metadata } from "next";
import { getNextExamSitting } from "@/lib/exam-dates";

/**
 * /kmp-innsbruck — SEO landing page for the Kumulative Modulprüfung
 * (KMP) at Med Uni Innsbruck. Primary queries:
 *   "KMP Innsbruck"
 *   "Kumulative Modulprüfung Innsbruck"
 *   "MedUni Innsbruck Prüfung"
 *
 * Content numbers: 3,091 questions across 12 specialties per
 * NOTES.md §Content (imported from 17 KoalaMed PDFs). KoalaMed is
 * a third-party platform that publishes exam-style PDFs — we imported
 * from those sources but KoalaMed is NOT the exam and we don't
 * represent them. The real exam is the MedUni Innsbruck KMP.
 */

const pageTitle = "KMP Innsbruck 2026 — Vorbereitung mit 3.091 Fragen | MedPrüf";
const pageDesc =
  "Strukturierte Vorbereitung auf die Kumulative Modulprüfung (KMP) der Med Uni Innsbruck. 3.091 Prüfungsfragen aus 12 Fachgebieten, klinische Erklärungen, 150 Fragen kostenlos.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "KMP Innsbruck",
    "Kumulative Modulprüfung",
    "MedUni Innsbruck",
    "KMP 2026",
    "Innsbruck Medizin Prüfung",
    "Approbation Österreich",
    "Nostrifikation Innsbruck",
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
    name: "KMP Innsbruck — Vorbereitung",
    description:
      "Strukturierte Vorbereitung auf die Kumulative Modulprüfung (KMP) der Med Uni Innsbruck für ausländische Ärzt:innen — 12 Fachgebiete, 3.091 Prüfungsfragen mit klinischen Erklärungen.",
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
