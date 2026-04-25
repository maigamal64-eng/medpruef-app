import type { Metadata } from "next";
import { NEXT_EXAM_DATE } from "@/lib/exam-dates";

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
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      startDate: NEXT_EXAM_DATE.kmp_innsbruck,
      location: {
        "@type": "Place",
        name: "Online · Med Uni Innsbruck",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Innsbruck",
          addressCountry: "AT",
        },
      },
    },
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
