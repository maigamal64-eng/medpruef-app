import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

const SLUG = "ukrainian-refugee-physicians-austria";
const post = getPostBySlug(SLUG);

const pageTitle =
  "Ukrainische Flüchtlingsärzt:innen: Arztpraxis in Österreich | MedPrüf Blog";
const pageDesc =
  "Was ukrainische Flüchtlingsärzt:innen brauchen, um in Österreich Medizin zu praktizieren: Nostrifizierung, Sprachprüfung, Stichprobentest und der Weg zur Eintragung in die Ärzteliste. Mit Behörden, Kosten, Fristen und Sofort-Schritten.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Ukraine",
    "Nostrifizierung",
    "Stichprobentest",
    "Flüchtlingsärzte",
    "Ärztliche Anerkennung",
    "ukrainische Ärzte Österreich",
    "Medizin praktizieren Österreich",
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
    headline: "Ukrainische Flüchtlingsärzt:innen: Arztpraxis in Österreich",
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
      "Ukraine, Nostrifizierung, Stichprobentest, Flüchtlingsärzte",
    inLanguage: "de-AT",
  };
}

export default function PostLayout({ children }: { children: React.ReactNode }) {
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