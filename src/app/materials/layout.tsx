import type { Metadata } from "next";

/**
 * /materials had NO metadata of its own, so it inherited the root canonical
 * and told Google it was a duplicate of another URL, while ranking on its own
 * merits at average position 11.0 on 30 impressions (Search Console,
 * 25 Jun to 2 Sep 2026). A page asking to be dropped while earning
 * impressions is a page fighting itself. Self-canonical added 2026-09-05.
 */
const pageTitle = "Anerkennung als Ärztin oder Arzt in Österreich | MedPrüf";
const pageDesc =
  "Kostenlose Leitfäden zu beiden Anerkennungswegen: Kenntnisprüfung Wien und Nostrifizierung mit Stichprobentest. Ablauf, Anmeldung, Termine und worauf es in der Vorbereitung ankommt.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  alternates: { canonical: "https://medpruf.com/materials" },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/materials",
    siteName: "MedPrüf",
    title: pageTitle,
    description: pageDesc,
    locale: "de_AT",
  },
  twitter: { card: "summary_large_image", title: pageTitle, description: pageDesc },
};

export default function MaterialsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
