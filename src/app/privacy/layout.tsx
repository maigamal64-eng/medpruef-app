import type { Metadata } from "next";
import { halfYearReady } from "@/lib/pricing-v2/readiness";
import { HalfYearReadyProvider } from "@/lib/pricing-v2/readiness-context";

export const metadata: Metadata = {
  title: "Datenschutz: MedPrüf",
  description:
    "Datenschutzerklärung: welche Daten wir erheben, warum, wie lange, und welche Rechte Sie haben gemäß DSGVO.",
  alternates: {
    canonical: "https://medpruf.com/privacy",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/privacy",
    title: "Datenschutz: MedPrüf",
    description:
      "Datenschutzerklärung: welche Daten wir erheben, warum, wie lange, und welche Rechte Sie haben gemäß DSGVO.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

/** a-legal-lektor-1027: line 3.1 names the 6-month plan only while it is on sale. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <HalfYearReadyProvider value={halfYearReady()}>{children}</HalfYearReadyProvider>;
}
