import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MedPrüf: Kenntnisprüfung & Stichprobentest",
  description:
    "Klinisches Wissen üben mit den Fragenbanken Kenntnisprüfung Wien, Stichprobentest und Pharmakologie. Über 10.000 kuratierte Übungsfragen. 450 Fragen kostenlos, ohne Kreditkarte.",
  keywords: [
    "Kenntnisprüfung", "Kenntnisprüfung preparation", "Austrian medical exam",
    "Vienna medical license", "SIP 4", "SIP 5", "medical exam questions",
    "Prüfungsvorbereitung", "Approbation Österreich",
    "foreign doctor Austria", "medical MCQ practice", "exam simulation",
    "Kenntnisprüfung Vorbereitung", "medizinische Kenntnisprüfung",
    "Austrian medical licensure", "clinical questions",
  ],
  alternates: {
    canonical: "https://medpruf.com/",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/",
    title: "MedPrüf: Kenntnisprüfung & Stichprobentest",
    description:
      "Klinisches Wissen üben mit den Fragenbanken Kenntnisprüfung Wien, Stichprobentest und Pharmakologie. Über 10.000 kuratierte Übungsfragen. 450 Fragen kostenlos, ohne Kreditkarte.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MedPrüf: Kenntnisprüfung & Stichprobentest",
    description:
      "Klinisches Wissen üben mit den Fragenbanken Kenntnisprüfung Wien, Stichprobentest und Pharmakologie. Über 10.000 kuratierte Übungsfragen. 450 Fragen kostenlos, ohne Kreditkarte.",
    images: ["/brand/og-image.png"],
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
