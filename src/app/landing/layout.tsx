import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MedPrüf — Pass Your Austrian Kenntnisprüfung | Vienna Medical Exam Prep",
  description: "Prepare for the Austrian Kenntnisprüfung (Vienna) with 10,993+ clinical questions, exam simulation, flashcards, and performance analytics. Free to start. Built for foreign doctors seeking Austrian medical licensure.",
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
    title: "MedPrüf — Pass Your Austrian Kenntnisprüfung",
    description: "10,993+ clinical questions for the Vienna Kenntnisprüfung. Exam simulation, flashcards, analytics. Free to start — no credit card required.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
