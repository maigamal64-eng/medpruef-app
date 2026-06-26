import type { Metadata } from "next";

// Public orientation surface for confused candidates. Title uses a comma,
// not an em dash ([name]'s rule; the legacy landing title's em dash is a
// flagged future-pass item, not a pattern to copy).
export const metadata: Metadata = {
  title: "Finde deinen Weg zur Anerkennung, MedPrüf",
  description:
    "Not sure which Austrian recognition route is yours? Answer three short questions and get your route, your deadlines, and where to start. Kenntnisprüfung Wien or Stichprobentest.",
  keywords: [
    "Kenntnisprüfung Wien", "Stichprobentest", "Nostrifizierung Österreich",
    "Anerkennung Arzt Österreich", "foreign doctor Austria", "Arztprüfung Allgemeinmedizin",
    "Ärztekammer", "recognition route Austria", "Approbation Österreich",
  ],
  alternates: {
    canonical: "https://medpruf.com/find-your-path",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/find-your-path",
    title: "Finde deinen Weg zur Anerkennung, MedPrüf",
    description:
      "Not sure which Austrian recognition route is yours? Three short questions, then your route, deadlines, and where to start.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Finde deinen Weg zur Anerkennung, MedPrüf",
    description:
      "Not sure which Austrian recognition route is yours? Three short questions, then your route, deadlines, and where to start.",
    images: ["/brand/og-image.png"],
  },
};

export default function FindYourPathLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
