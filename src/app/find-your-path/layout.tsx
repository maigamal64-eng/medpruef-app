import type { Metadata } from "next";

// Public orientation surface for confused candidates. Title uses a comma,
// not an em dash ([name]'s rule; the legacy landing title's em dash is a
// flagged future-pass item, not a pattern to copy).
export const metadata: Metadata = {
  title: "Welche Fragenbank passt zu Ihnen? MedPrüf",
  description:
    "Choose a MedPrüf practice bank and plan your study. University eligibility, examinations and registration dates require separate confirmation.",
  keywords: [
    "Kenntnisprüfung Wien", "Stichprobentest", "Nostrifizierung Österreich",
    "Anerkennung Arzt Österreich", "foreign doctor Austria", "SIP4a SIP5a",
    "practice bank Austria", "Approbation Österreich",
  ],
  alternates: {
    canonical: "https://medpruf.com/find-your-path",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/find-your-path",
    title: "Welche Fragenbank passt zu Ihnen? MedPrüf",
    description:
      "Choose your practice bank and study target. Confirm official requirements and dates with your university.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Welche Fragenbank passt zu Ihnen? MedPrüf",
    description:
      "Choose your practice bank and study target. Confirm official requirements and dates with your university.",
    images: ["/brand/og-image.png"],
  },
};

export default function FindYourPathLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
