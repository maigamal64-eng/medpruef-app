import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impressum: MedPrüf",
  description:
    "Rechtliche Angaben gemäß §5 ECG: Betreiber, Kontakt, Datenschutzbehörde.",
  alternates: {
    canonical: "https://medpruf.com/impressum",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/impressum",
    title: "Impressum: MedPrüf",
    description:
      "Rechtliche Angaben gemäß §5 ECG: Betreiber, Kontakt, Datenschutzbehörde.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
