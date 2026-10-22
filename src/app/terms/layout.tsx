import type { Metadata } from "next";
import { halfYearReady } from "@/lib/pricing-v2/readiness";
import { HalfYearReadyProvider } from "@/lib/pricing-v2/readiness-context";

export const metadata: Metadata = {
  title: "AGB: MedPrüf",
  description:
    "Allgemeine Geschäftsbedingungen für die Nutzung von MedPrüf: Leistungsumfang, medizinischer Haftungsausschluss, Zahlungsbedingungen.",
  alternates: {
    canonical: "https://medpruf.com/terms",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/terms",
    title: "AGB: MedPrüf",
    description:
      "Allgemeine Geschäftsbedingungen für die Nutzung von MedPrüf: Leistungsumfang, medizinischer Haftungsausschluss, Zahlungsbedingungen.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

/** a-v2-copy-surfaces-1021: section 5 names the 6-month plan only while it is on sale. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <HalfYearReadyProvider value={halfYearReady()}>{children}</HalfYearReadyProvider>;
}
