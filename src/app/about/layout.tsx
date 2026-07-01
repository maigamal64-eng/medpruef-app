import type { Metadata } from "next";
import { QUESTIONS } from "@/lib/content-truth";

// SOT-driven count so the meta description can never drift from the
// live DB-owned question count. Brand-sweep 2026-06-04.
const ABOUT_DESCRIPTION = `Warum wir MedPrüf gebaut haben: 64.000 ausländische Ärzt:innen suchen eine österreichische Lizenz. Wir bieten ${QUESTIONS.total.toLocaleString(
  "de-DE",
)} Prüfungsfragen in 7 Sprachen mit klinischen KI-Erklärungen.`;

export const metadata: Metadata = {
  title: "Über uns: MedPrüf",
  description: ABOUT_DESCRIPTION,
  alternates: {
    canonical: "https://medpruf.com/about",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/about",
    title: "Über uns: MedPrüf",
    description: ABOUT_DESCRIPTION,
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Über uns: MedPrüf",
    description: ABOUT_DESCRIPTION,
    images: ["/brand/og-image.png"],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
