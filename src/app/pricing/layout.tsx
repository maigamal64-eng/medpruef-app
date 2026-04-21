import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Preise — Kostenlos oder Pro für €19/Monat",
  description:
    "Alle Funktionen zum Testen kostenlos. Pro: unbegrenzte KI-Erklärungen, Lernplan, Übersetzungen in 7 Sprachen, Prüfungssimulation. Jederzeit kündbar.",
  alternates: {
    canonical: "https://medpruf.com/pricing",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/pricing",
    title: "Preise — Kostenlos oder Pro für €19/Monat",
    description:
      "Alle Funktionen zum Testen kostenlos. Pro: unbegrenzte KI-Erklärungen, Lernplan, Übersetzungen in 7 Sprachen, Prüfungssimulation. Jederzeit kündbar.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
