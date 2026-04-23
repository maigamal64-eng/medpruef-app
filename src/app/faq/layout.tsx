import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — MedPrüf",
  description:
    "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie — Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
  alternates: {
    canonical: "https://medpruf.com/faq",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/faq",
    title: "FAQ — MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie — Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ — MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie — Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
    images: ["/brand/og-image.png"],
  },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return children;
}
