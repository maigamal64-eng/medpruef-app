import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prüfungsvorbereitung — MedPrüf",
  description:
    "Specialized prep for the Austrian Kenntnisprüfung Wien, KMP Innsbruck, and Pharmakologie exams. 150 questions free — no credit card.",
  keywords: [
    "Kenntnisprüfung", "Kenntnisprüfung preparation", "Austrian medical exam",
    "Vienna medical license", "SIP 4", "SIP 5", "medical exam questions",
    "Prüfungsvorbereitung", "Ärztekammer Wien", "Approbation Österreich",
    "foreign doctor Austria", "medical MCQ practice", "exam simulation",
    "Kenntnisprüfung Vorbereitung", "medizinische Kenntnisprüfung",
    "Austrian medical licensure", "clinical questions",
  ],
  alternates: {
    canonical: "https://medpruf.com/landing",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/landing",
    title: "Prüfungsvorbereitung — MedPrüf",
    description:
      "Specialized prep for the Austrian Kenntnisprüfung Wien, KMP Innsbruck, and Pharmakologie exams. 150 questions free — no credit card.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Prüfungsvorbereitung — MedPrüf",
    description:
      "Specialized prep for the Austrian Kenntnisprüfung Wien, KMP Innsbruck, and Pharmakologie exams. 150 questions free — no credit card.",
    images: ["/brand/og-image.png"],
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
