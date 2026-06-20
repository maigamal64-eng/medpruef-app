import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Preise — MedPrüf",
  description:
    "Spezialisierte Vorbereitung auf die österreichische Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. 150 Fragen kostenlos, ohne Kreditkarte.",
  alternates: {
    canonical: "https://medpruf.com/pricing",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/pricing",
    title: "Preise — MedPrüf",
    description:
      "Spezialisierte Vorbereitung auf die österreichische Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. 150 Fragen kostenlos, ohne Kreditkarte.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Preise — MedPrüf",
    description:
      "Spezialisierte Vorbereitung auf die österreichische Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. 150 Fragen kostenlos, ohne Kreditkarte.",
    images: ["/brand/og-image.png"],
  },
};

/**
 * BreadcrumbList JSON-LD for /pricing (Home → Pricing). Page-scoped —
 * a breadcrumb must end on the current page, so it lives in this layout,
 * never the root layout. Brand-sweep 2026-06-04.
 */
function buildBreadcrumbSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": "https://medpruf.com/pricing#breadcrumb",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://medpruf.com/landing",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Pricing",
        item: "https://medpruf.com/pricing",
      },
    ],
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbSchema()) }}
      />
      {children}
    </>
  );
}
