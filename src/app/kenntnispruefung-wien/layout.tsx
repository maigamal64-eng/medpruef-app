import type { Metadata } from "next";
import { NEXT_EXAM_DATE } from "@/lib/exam-dates";

/**
 * /kenntnispruefung-wien — SEO landing page for the Vienna
 * Kenntnisprüfung (SIP 4 + SIP 5). Target primary query:
 *   "Kenntnisprüfung Wien"
 *   "Kenntnisprüfung Vorbereitung"
 *   "Austrian medical license Vienna"
 *
 * The layout owns the static <title>, meta description, OpenGraph
 * (via opengraph-image.tsx sibling route), and the JSON-LD Course
 * schema. The actual page body is a Client Component for language
 * switching — so the important crawl content (H1, H2, FAQ text,
 * breakdown, schema.org data) must be pre-rendered here or in the
 * server-rendered portion of page.tsx. We render the course-schema
 * script from the layout to guarantee it's in HEAD of every variant.
 */

const pageTitle = "Kenntnisprüfung Wien 2026 — Vorbereitung mit 7.567 Fragen | MedPrüf";
const pageDesc =
  "Vorbereitung auf die österreichische Kenntnisprüfung Wien (SIP 4 + SIP 5). 7.567 Prüfungsfragen aus 10 Fachgebieten, klinische KI-Erklärungen, Pass-Until-You-Pass-Garantie. 150 Fragen kostenlos.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Kenntnisprüfung Wien",
    "Kenntnisprüfung Vorbereitung",
    "SIP 4",
    "SIP 5",
    "Ärztekammer Wien",
    "Approbation Österreich",
    "Nostrifikation",
    "Kenntnisprüfung 2026",
    "ausländische Ärzte Österreich",
    "medizinische Lizenz Wien",
  ],
  alternates: {
    canonical: "https://medpruf.com/kenntnispruefung-wien",
  },
  openGraph: {
    type: "article",
    url: "https://medpruf.com/kenntnispruefung-wien",
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

/**
 * JSON-LD Course schema — per schema.org/Course. Emitted from the
 * layout so Search engines find it even if the Client Component body
 * is still hydrating.
 *
 * educationalLevel is not an enum in schema.org but the spec accepts
 * free text. We use "Postgraduate medical" — accurate for a
 * re-licensing exam.
 */
function buildCourseSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: "Kenntnisprüfung Wien — Vorbereitung",
    description:
      "Strukturierte Vorbereitung auf die österreichische Kenntnisprüfung (Wien) für ausländische Ärzt:innen — SIP 4 + SIP 5, 10 Fachgebiete, 7.567 Prüfungsfragen mit klinischen Erklärungen.",
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
      "Innere Medizin, Chirurgische Fächer, Neurologie, Psychiatrie, Frauenheilkunde/Gynäkologie, Kinder- und Jugendheilkunde, Augenheilkunde, HNO-Heilkunde, Notfall- und Intensivmedizin, Dermatologie und Venerologie",
    audience: {
      "@type": "EducationalAudience",
      educationalRole: "Foreign-trained physician",
    },
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      startDate: NEXT_EXAM_DATE.kenntnispruefung,
      location: {
        "@type": "Place",
        name: "Online · Ärztekammer Wien",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Wien",
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

export default function KenntnispruefungWienLayout({
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
