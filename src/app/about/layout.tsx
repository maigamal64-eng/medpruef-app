import type { Metadata } from "next";
const ABOUT_DESCRIPTION =
  "MedPrüf prepares doctors for the Austrian Kenntnisprüfung, Stichprobentest and Pharmakologie with over 10,000 curated practice questions.";

export const metadata: Metadata = {
  title: "Über uns: MedPrüf",
  description: ABOUT_DESCRIPTION,
  alternates: {
    canonical: "https://medpruf.com/about",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/about",
    title: "Über uns: MedPrüf",
    description: ABOUT_DESCRIPTION,
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Über uns: MedPrüf",
    description: ABOUT_DESCRIPTION,
    images: ["/brand/og-image.png"],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
