import type { Metadata } from "next";
import { getNextExamDate } from "@/lib/exam-dates";

/**
 * /pharmakologie-pruefung-wien — SEO landing page for the
 * Pharmakologie-Prüfung / Rezeptierkunde. Primary queries:
 *   "Pharmakologie Prüfung Wien"
 *   "Rezeptierkunde Prüfung"
 *   "Pharmakologie Ergänzungsprüfung"
 *
 * Content: 335 questions, single topic "Pharmakologie" per
 * NOTES.md §Content. Pharma has NO fixed exam date (it is term-based,
 * tied to MedUni nostrification semester exam weeks) — so we never
 * fabricate a Pharma countdown. The Course startDate below anchors to
 * the next Kenntnisprüfung Wien sitting (the in-market cohort window
 * the page copy points buyers to), computed at runtime so it ages out.
 */

const pageTitle =
  "Pharmakologie Prüfung Wien 2026: Vorbereitung mit 335 Fragen | MedPrüf";
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
    "Prüfungs-Kohorte",
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
  // Pharma has no fixed sitting; anchor the course instance to the next
  // Kenntnisprüfung Wien window (computed at runtime, ages out). Omit
  // startDate entirely if no future Wien sitting is published rather
  // than emit a stale or fabricated date.
  const cohortStart = getNextExamDate("kenntnispruefung");
  const courseInstance: Record<string, unknown> = {
    "@type": "CourseInstance",
    courseMode: "online",
    location: {
      "@type": "Place",
      name: "Online · Ärztekammer Wien",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Wien",
        addressCountry: "AT",
      },
    },
  };
  if (cohortStart) courseInstance.startDate = cohortStart;

  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: "Pharmakologie-Prüfung Wien: Vorbereitung",
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
    hasCourseInstance: courseInstance,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      description:
        "Free tier: 150 questions. Exam Cohort with Pass-Until-You-Pass available from /pricing.",
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
