import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

/**
 * Per-post layout: title, meta description, OG article schema, and
 * JSON-LD Article structured data. Metadata is German-primary (site
 * SEO intent); the page content itself is bilingual DE + EN.
 */

const SLUG = "spaced-repetition-arztpruefungen-oesterreich";
const post = getPostBySlug(SLUG);

const pageTitle =
  "Spaced Repetition für die Arztprüfung in Österreich (SM-2) | MedPrüf Blog";
const pageDesc =
  "Kenntnisprüfung Wien, Stichprobentest und Pharmakologie ziehen aus einem riesigen Fragenpool. So nutzt du Spaced Repetition (SM-2), aktives Erinnern und den 70-30-Rhythmus, um über 10.000 Fragen wirklich zu behalten.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Spaced Repetition Medizin",
    "SM-2 Algorithmus",
    "Anki Alternative Ärzte",
    "Kenntnisprüfung Wien Vorbereitung",
    "Stichprobentest Vorbereitung",
    "Prüfungsvorbereitung Medizin Österreich",
    "Fragenbank Kenntnisprüfung",
    "ausländischer Arzt Österreich",
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
      "Spaced Repetition für die österreichischen Arztprüfungen: über 10.000 Fragen wirklich behalten",
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
      "Spaced Repetition, SM-2, Kenntnisprüfung Wien, Stichprobentest",
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
