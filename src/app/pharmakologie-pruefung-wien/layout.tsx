
import { billingSurfaceText } from "@/lib/billing-copy";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import type { Metadata } from "next";
import { seoCopyEnabled, seoLinkHub } from "@/lib/seo/gsc";
import { SeoLinkHub, SeoScopeLine } from "@/components/seo/GscSeo";

/**
 * /pharmakologie-pruefung-wien — SEO landing page for the
 * Pharmakologie-Prüfung / Rezeptierkunde. Primary queries:
 *   "Pharmakologie Prüfung Wien"
 *   "Rezeptierkunde Prüfung"
 *   "Pharmakologie Ergänzungsprüfung"
 *
 * Exam weeks come from OFFICIAL_SITTINGS on the page itself; metadata
 * stays date-free so it never goes stale. Do not borrow dates from other
 * exam types in its metadata or course schema.
 */

const pageTitle =
  "Pharmakologie Prüfung Wien: Vorbereitung | MedPrüf";
const pageDesc =
  "Übungsfragen zu Rezeptierkunde und Pharmakologie für die Ergänzungsprüfung an der MedUni Wien, mit den veröffentlichten Prüfungswochen und Anmeldefristen.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Pharmakologie Prüfung Wien",
    "Rezeptierkunde",
    "Pharmakologie Ergänzungsprüfung",
    "Pharmakologie Vorbereitung",
    pricingV2Enabled() ? "Garantie-Ticket" : "Prüfungs-Kohorte",
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
      "Übungsfragen zu Rezeptierkunde und Pharmakologie für die Ergänzungsprüfung an der MedUni Wien.",
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
        billingSurfaceText("pharmakologie_pruefung_wien_layout_tsx_0", "de"),
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
      {seoCopyEnabled() && <SeoScopeLine />}
      {children}
      <SeoLinkHub {...seoLinkHub("pharma")} />
    </>
  );
}
