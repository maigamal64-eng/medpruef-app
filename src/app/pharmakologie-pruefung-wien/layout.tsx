import type { Metadata } from "next";

/**
 * /pharmakologie-pruefung-wien — SEO landing page for the
 * Pharmakologie-Prüfung / Rezeptierkunde. Primary queries:
 *   "Pharmakologie Prüfung Wien"
 *   "Rezeptierkunde Prüfung"
 *   "Pharmakologie Ergänzungsprüfung"
 *
 * Content: 335 questions, single topic "Pharmakologie" per
 * NOTES.md §Content. Pharma has no fixed annual exam date. Do not
 * borrow dates from other exam types in its metadata or course schema.
 */

const pageTitle =
  "Pharmakologie Prüfung Wien: Vorbereitung | MedPrüf";
const pageDesc =
  "Vorbereitung auf Pharmakologie und Rezeptierkunde mit kuratierten klinischen Übungsfragen. Prüfungstermine hängen von deiner Universität und deinem Studienplan ab.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Pharmakologie Prüfung Wien",
    "Rezeptierkunde",
    "Pharmakologie Ergänzungsprüfung",
    "Pharmakologie Vorbereitung",
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
  const courseInstance: Record<string, unknown> = {
    "@type": "CourseInstance",
    courseMode: "online",
    location: {
      "@type": "Place",
      name: "Online · MedPrüf",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Wien",
        addressCountry: "AT",
      },
    },
  };

  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: "Pharmakologie-Prüfung Wien: Vorbereitung",
    description:
      "Vorbereitung auf Pharmakologie und Rezeptierkunde mit kuratierten klinischen Übungsfragen. Termine variieren je nach Universität und Studienplan.",
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
        "Free tier: 150 questions. Exam Cohort: €129 one-time for six months. See /pricing for current plans.",
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
