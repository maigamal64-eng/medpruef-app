import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Neuerungen: MedPrüf",
  description:
    "Alle Produkt-Updates chronologisch: neue Prüfungstypen, verbesserte KI-Erklärungen, Übersetzungen, und mehr.",
  alternates: {
    canonical: "https://medpruf.com/changelog",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/changelog",
    title: "Neuerungen: MedPrüf",
    description:
      "Alle Produkt-Updates chronologisch: neue Prüfungstypen, verbesserte KI-Erklärungen, Übersetzungen, und mehr.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
