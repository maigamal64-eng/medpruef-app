import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

/**
 * Per-post layout — owns the <title>, meta description, OG article
 * schema, and JSON-LD Article structured data for the seed blog post.
 */

const SLUG = "kenntnispruefung-wien-vollstaendiges-handbuch";
const post = getPostBySlug(SLUG);

const pageTitle =
  "Kenntnisprüfung Wien — vollständiges Handbuch 2026 | MedPrüf Blog";
const pageDesc =
  "Alles zur Kenntnisprüfung Wien 2026: Zulassung (Nostrifikation), SIP 4 vs SIP 5, Prüfungsaufbau, typische Schwerpunkte, realistischer Lernplan und häufige Fehler. Ehrliches Handbuch von Ärzt:innen, die den Weg selbst gegangen sind.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Kenntnisprüfung Wien",
    "Kenntnisprüfung 2026",
    "SIP 4",
    "SIP 5",
    "Nostrifikation",
    "Ärztekammer Wien",
    "Approbation Österreich",
    "Medizinstudium Ausland",
    "ausländischer Arzt Österreich",
    "Lernplan Kenntnisprüfung",
  ],
  alternates: {
    canonical: `https://medpruf.com/blog/${SLUG}`,
  },
  openGraph: {
    type: "article",
    url: `https://medpruf.com/blog/${SLUG}`,
    siteName: "MedPrüf",
    title: pageTitle,
    description: pageDesc,
    locale: "de_AT",
    publishedTime: post?.publishedAt,
    authors: post ? [post.author] : undefined,
    tags: post?.tags,
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDesc,
  },
};

function buildArticleSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Kenntnisprüfung Wien — vollständiges Handbuch 2026",
    description: pageDesc,
    url: `https://medpruf.com/blog/${SLUG}`,
    datePublished: post?.publishedAt,
    dateModified: post?.updatedAt ?? post?.publishedAt,
    author: {
      "@type": "Organization",
      name: post?.author ?? "MedPrüf",
      url: "https://medpruf.com",
    },
    publisher: {
      "@type": "Organization",
      name: "MedPrüf",
      url: "https://medpruf.com",
      logo: {
        "@type": "ImageObject",
        url: "https://medpruf.com/brand/logomark.svg",
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://medpruf.com/blog/${SLUG}`,
    },
    keywords:
      post?.tags?.join(", ") ??
      "Kenntnisprüfung Wien, SIP 4, SIP 5, Nostrifikation",
    inLanguage: "de-AT",
  };
}

export default function PostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildArticleSchema()) }}
      />
      {children}
    </>
  );
}
