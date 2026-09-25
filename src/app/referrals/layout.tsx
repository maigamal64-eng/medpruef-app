import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Empfehlungen: MedPrüf",
  description:
    "Einladungsprogramm für berechtigte MedPrüf-Konten. Verfügbare Prämien und Bedingungen werden im Konto angezeigt.",
  alternates: {
    canonical: "https://medpruf.com/referrals",
  },
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/referrals",
    title: "Empfehlungen: MedPrüf",
    description:
      "Einladungsprogramm für berechtigte MedPrüf-Konten. Verfügbare Prämien und Bedingungen werden im Konto angezeigt.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Empfehlungen: MedPrüf",
    description:
      "Einladungsprogramm für berechtigte MedPrüf-Konten. Verfügbare Prämien und Bedingungen werden im Konto angezeigt.",
    images: ["/brand/og-image.png"],
  },
};

export default function ReferralsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
