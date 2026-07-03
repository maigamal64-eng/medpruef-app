import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

/**
 * Per-post layout: title, meta description, OG article schema, and
 * JSON-LD Article structured data. Metadata is German-primary (site
 * SEO intent); the page content itself is bilingual DE + EN.
 */

const SLUG = "kenntnispruefung-zweiter-versuch";
const post = getPostBySlug(SLUG);

const pageTitle =
  "Kenntnisprüfung Wien: der zweite Versuch nach einem Fehlversuch | MedPrüf Blog";
const pageDesc =
  "Nächster Termin 28. September 2026, Anmeldeschluss 28. Juli, 795 € pro Versuch. Warum der erste Versuch selten am Wissen scheitert, was beim zweiten anders sein muss, und wie du das offene Kurzantwortformat (KAF) gezielt trainierst.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Kenntnisprüfung durchgefallen",
    "Kenntnisprüfung Wien zweiter Versuch",
    "Kenntnisprüfung wiederholen",
    "Kurzantwortfragen KAF",
    "Kenntnisprüfung Wien Vorbereitung",
    "Kenntnisprüfung Anmeldeschluss 2026",
    "ausländischer Arzt Österreich",
    "Nostrifikation",
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
    headline:
      "Der zweite Versuch: die Kenntnisprüfung Wien nach einem Fehlversuch bestehen",
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
      "Kenntnisprüfung Wien, zweiter Versuch, KAF, Kurzantwortformat",
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
