import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog: MedPrüf",
  description:
    "MedPrüf-Blog: ehrliche Guides für ausländische Ärzt:innen zur österreichischen Kenntnisprüfung, Stichprobentest (Innsbruck), Pharmakologie-Prüfung und Nostrifikation.",
  alternates: {
    canonical: "https://medpruf.com/blog",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/blog",
    siteName: "MedPrüf",
    title: "Blog: MedPrüf",
    description:
      "Ehrliche Guides für ausländische Ärzt:innen zur österreichischen Kenntnisprüfung, Stichprobentest (Innsbruck), Pharmakologie-Prüfung und Nostrifikation.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog: MedPrüf",
    description:
      "Ehrliche Guides für ausländische Ärzt:innen zur österreichischen Kenntnisprüfung, Stichprobentest (Innsbruck), Pharmakologie-Prüfung und Nostrifikation.",
  },
};

export default function BlogRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
