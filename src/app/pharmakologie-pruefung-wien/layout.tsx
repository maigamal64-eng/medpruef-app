import type { Metadata } from "next";
import { NEXT_EXAM_DATE } from "@/lib/exam-dates";

/**
 * /pharmakologie-pruefung-wien — SEO landing page for the
 * Pharmakologie-Prüfung / Rezeptierkunde. Primary queries:
 *   "Pharmakologie Prüfung Wien"
 *   "Rezeptierkunde Prüfung"
 *   "Pharmakologie Ergänzungsprüfung"
 *
 * Content: 335 questions, single topic "Pharmakologie" per
 * NOTES.md §Content. Cohort anchor: the Kenntnisprüfung Wien sitting
 * on 2026-09-28 (NEXT_EXAM_DATE, SoT §1). The exact Pharma date is
 * nostrification-driven; the Course startDate tracks the Wien window.
 */

const pageTitle =
  "Pharmakologie Prüfung Wien 2026 — Vorbereitung mit 335 Fragen | MedPrüf";
const pageDesc =
  "Vorbereitung auf die Pharmakologie- und Rezeptierkunde-Prüfung (Wien). 335 Fragen mit klinischen Begründungen, Guideline-Referenzen und Pass-Until-You-Pass-Garantie. Kenntnisprüfung Wien am 28. September 2026.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Pharmakologie Prüfung Wien",
    "Rezeptierkunde",
    "Pharmakologie Ergänzungsprüfung",
    "Pharmakologie 2026",
    "Kenntnisprüfung Kohorte",
    "Pharmakologie Vorbereitung",
    "Approbation Pharmakologie",
    "ausländische Ärzte Pharmakologie",
  ],
  alternates: {
    canonical: "https://medpruf.com/pharmakologie-pruefung-wien",
  },
  openGraph: {
    type: "article",
    url: "https://medpruf.com/pharmakologie-pruefung-wien",
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
    name: "Pharmakologie-Prüfung Wien — Vorbereitung",
    description:
      "Strukturierte Vorbereitung auf die Pharmakologie- und Rezeptierkunde-Prüfung (Wien): 335 Fragen mit klinischen Begründungen, Dosierungen und Guideline-Referenzen.",
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
      "Pharmakologie, Rezeptierkunde, klinische Dosierungen, Wechselwirkungen, Kontraindikationen, österreichische Arzneimittelverordnungen",
    audience: {
      "@type": "EducationalAudience",
      educationalRole: "Foreign-trained physician",
    },
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      startDate: NEXT_EXAM_DATE.pharma,
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
      description:
        "Free tier: 150 questions. Kenntnisprüfung Cohort with Pass-Until-You-Pass available from /pricing.",
    },
  };
}

export default function PharmakologieLayout({
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
