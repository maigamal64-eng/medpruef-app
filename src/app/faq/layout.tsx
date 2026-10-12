import type { Metadata } from "next";

import { faqSchemaEntries } from "./faq-copy";

export const metadata: Metadata = {
  title: "FAQ: MedPrüf",
  description:
    "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie. Kündigung, Rückerstattung, Zahlung, Pass-Until-You-Pass.",
  alternates: {
    canonical: "https://medpruf.com/faq",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/faq",
    title: "FAQ: MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie. Kündigung, Rückerstattung, Zahlung, Pass-Until-You-Pass.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ: MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie. Kündigung, Rückerstattung, Zahlung, Pass-Until-You-Pass.",
    images: ["/brand/og-image.png"],
  },
};

/**
 * FAQPage JSON-LD, scoped to /faq ONLY (not the root layout) so the
 * marked-up Q&A matches the questions actually visible on this page.
 *
 * The answers come from ./faq-copy.ts, the same module the page renders
 * (German, the page default), flattened to plain text per the schema.org
 * acceptedAnswer.text guidance, so the marked-up text cannot drift from
 * the visible answer.
 *
 * Emitted from the layout so crawlers find it even though the page body
 * is a Client Component that hydrates after load. Brand-sweep 2026-06-04.
 */
function buildFaqSchema() {
  // Same text as the visible German page: both read ./faq-copy.ts.
  const qa = faqSchemaEntries("de");

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        "@id": "https://medpruf.com/faq#faqpage",
        mainEntity: qa.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: {
            "@type": "Answer",
            text: a,
          },
        })),
      },
      {
        // Crumbs end on THIS page (Home → FAQ) — a breadcrumb is page-scoped,
        // so it lives in the /faq layout, never the root layout.
        "@type": "BreadcrumbList",
        "@id": "https://medpruf.com/faq#breadcrumb",
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
            name: "FAQ",
            item: "https://medpruf.com/faq",
          },
        ],
      },
    ],
  };
}

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqSchema()) }}
      />
      {children}
    </>
  );
}
