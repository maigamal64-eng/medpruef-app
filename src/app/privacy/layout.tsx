import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Datenschutz | MedPrüf",
  description:
    "Datenschutzerklärung: welche Daten wir erheben, warum, wie lange, und welche Rechte Sie haben gemäß DSGVO.",
  alternates: {
    canonical: "https://medpruf.com/privacy",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/privacy",
    title: "Datenschutz | MedPrüf",
    description:
      "Datenschutzerklärung: welche Daten wir erheben, warum, wie lange, und welche Rechte Sie haben gemäß DSGVO.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
