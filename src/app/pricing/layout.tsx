import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Preise — MedPrüf",
  description:
    "Spezialisierte Vorbereitung auf die österreichische Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. 150 Fragen kostenlos — ohne Kreditkarte.",
  alternates: {
    canonical: "https://medpruf.com/pricing",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/pricing",
    title: "Preise — MedPrüf",
    description:
      "Spezialisierte Vorbereitung auf die österreichische Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. 150 Fragen kostenlos — ohne Kreditkarte.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Preise — MedPrüf",
    description:
      "Spezialisierte Vorbereitung auf die österreichische Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. 150 Fragen kostenlos — ohne Kreditkarte.",
    images: ["/brand/og-image.png"],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
