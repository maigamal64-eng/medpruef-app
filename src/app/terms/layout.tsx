import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AGB: MedPrüf",
  description:
    "Allgemeine Geschäftsbedingungen für die Nutzung von MedPrüf: Leistungsumfang, medizinischer Haftungsausschluss, Zahlungsbedingungen.",
  alternates: {
    canonical: "https://medpruf.com/terms",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/terms",
    title: "AGB: MedPrüf",
    description:
      "Allgemeine Geschäftsbedingungen für die Nutzung von MedPrüf: Leistungsumfang, medizinischer Haftungsausschluss, Zahlungsbedingungen.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
