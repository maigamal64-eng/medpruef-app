import type { Metadata } from "next";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { v2Readiness } from "@/lib/pricing-v2/readiness";

// copy-audit F29 (a-pricing-v2-fit), byte-exact, with the v2 offer only (the
// page then asks "When is your exam?"); flag off keeps today's snippet.
// a-v2-readiness-surfaces-1020: the plan list names only plans checkout can
// sell (v2PlanReady); with all four ready the text is the F29 text unchanged.
const V2 = pricingV2Enabled();
const TITLE = V2 ? "Preise und Tarife: MedPrüf" : "Preise: MedPrüf";
function v2PlanList(): string {
  const ready = v2Readiness();
  const names = ["Monatsabo", "Prüfungspass"];
  if (ready.half_year) names.push("6 Monate");
  if (ready.guarantee_ticket) names.push("Garantie-Ticket");
  return `${names.slice(0, -1).join(", ")} oder ${names[names.length - 1]}`;
}
const DESCRIPTION = V2
  ? `Sagen Sie uns, wann Ihre Prüfung ist, und wir markieren den passenden Tarif: ${v2PlanList()}. 150 Fragen pro Fragenbank als kostenlose Probe, ohne Karte.`
  : "Spezialisierte Vorbereitung auf die österreichische Kenntnisprüfung Wien, den Stichprobentest (Innsbruck) und Pharmakologie. 150 Fragen kostenlos, ohne Kreditkarte.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "https://medpruf.com/pricing",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/pricing",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
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
        item: "https://medpruf.com/",
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
