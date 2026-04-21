import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Über MedPrüf — Österreichische Ärzteprüfung Vorbereitung",
  description:
    "Warum wir MedPrüf gebaut haben: 64.000 ausländische Ärzt:innen suchen eine österreichische Lizenz. Wir bieten 10.993 Prüfungsfragen in 7 Sprachen mit klinischen KI-Erklärungen.",
  alternates: {
    canonical: "https://medpruf.com/about",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/about",
    title: "Über MedPrüf — Österreichische Ärzteprüfung Vorbereitung",
    description:
      "Warum wir MedPrüf gebaut haben: 64.000 ausländische Ärzt:innen suchen eine österreichische Lizenz. Wir bieten 10.993 Prüfungsfragen in 7 Sprachen mit klinischen KI-Erklärungen.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
