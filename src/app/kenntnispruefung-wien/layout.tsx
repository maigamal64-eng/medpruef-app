import type { Metadata } from "next";

/**
 * /kenntnispruefung-wien: SEO landing page for the Vienna
 * existing Kenntnisprüfung bank (SIP4a/SIP5a sources). Target primary query:
 *   "Kenntnisprüfung Wien"
 *   "Kenntnisprüfung Vorbereitung"
 *   "Austrian medical license Vienna"
 *
 * The layout owns the static <title>, meta description, OpenGraph
 * (via opengraph-image.tsx sibling route), and the JSON-LD Course
 * schema. The actual page body is a Client Component for language
 * switching: so the important crawl content (H1, H2, FAQ text,
 * breakdown, schema.org data) must be pre-rendered here or in the
 * server-rendered portion of page.tsx. We render the course-schema
 * script from the layout to guarantee it's in HEAD of every variant.
 */

const pageTitle = "Kenntnisprüfung Wien: 150 Fragen gratis üben | MedPrüf";
const pageDesc =
  "Kenntnisprüfung Wien: über 7.500 kuratierte MCQ-Übungen mit SIP4a/SIP5a-Quellen und Erklärungen. Keine Simulation der postgradualen ÖÄK-Arztprüfung. 150 Fragen gratis.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Kenntnisprüfung Wien",
    "Kenntnisprüfung Vorbereitung",
    "SIP 4",
    "SIP 5",
    "Nostrifikation",
    "Kenntnisprüfung Vorbereitung",
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
 * JSON-LD Course schema: per schema.org/Course. Emitted from the
 * layout so Search engines find it even if the Client Component body
 * is still hydrating.
 *
 * educationalLevel is not an enum in schema.org but the spec accepts
 * free text. This course offers clinical knowledge practice.
 */
function buildCourseSchema() {
  // Practice course, not an official exam sitting or provider affiliation.
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
    name: "Kenntnisprüfung Wien: Vorbereitung",
    description:
      "Klinisches Wissen üben mit über 7.500 kuratierten Multiple-Choice-Übungen mit SIP4a/SIP5a-Quellen und Erklärungen. Keine Simulation der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin.",
    provider: {
      "@type": "Organization",
      name: "MedPrüf",
      sameAs: "https://medpruf.com",
      url: "https://medpruf.com",
    },
    citation: "https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/",
    educationalLevel: "Clinical medical knowledge practice",
    inLanguage: ["de", "en", "ar", "ru", "fr", "tr", "uk", "sr"],
    courseMode: "online",
    teaches:
      "Innere Medizin, Chirurgische Fächer, Neurologie, Psychiatrie, Frauenheilkunde/Gynäkologie, Kinder- und Jugendheilkunde, Augenheilkunde, HNO-Heilkunde, Notfall- und Intensivmedizin, Dermatologie und Venerologie",
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
