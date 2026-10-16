import type { Metadata } from "next";
import { FREE_TIER } from "@/lib/content-truth";
import { pageCopy, seoCopyEnabled, seoLinkHub } from "@/lib/seo/gsc";
import { SeoLinkHub, SeoScopeLine } from "@/components/seo/GscSeo";

// a-seo-from-gsc: new title and description only while SEO_GSC_COPY_ENABLED is on.
const { title: TITLE, description: DESC } = pageCopy("landing", {
  title: "MedPrüf: SIP4a, SIP5a und Stichprobentest üben",
  description: `Kuratierte Übungsfragen für SIP4a, SIP5a, Stichprobentest und Rezeptierkunde in Österreich. ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank als kostenlose Probe, ohne Karte.`,
});

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: [
    "Kenntnisprüfung", "Kenntnisprüfung preparation", "Austrian medical exam",
    "Vienna medical license", "SIP 4", "SIP 5", "medical exam questions",
    "Prüfungsvorbereitung", "foreign doctor Austria", "medical MCQ practice", "exam simulation",
    "Kenntnisprüfung Vorbereitung", "medizinische Kenntnisprüfung",
    "Austrian medical licensure", "clinical questions",
  ],
  alternates: {
    canonical: "https://medpruf.com/",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/",
    title: TITLE,
    description: DESC,
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESC,
    images: ["/brand/og-image.png"],
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {seoCopyEnabled() && <SeoScopeLine />}
      {children}
      <SeoLinkHub {...seoLinkHub("all")} />
    </>
  );
}
