import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

/**
 * Per-post layout: title, meta description, OG article schema, and
 * JSON-LD Article structured data. Metadata is German-primary (site
 * SEO intent); the page content itself is bilingual DE + EN.
 */

const SLUG = "medizin-lernen-in-deiner-sprache";
const post = getPostBySlug(SLUG);

const pageTitle =
  "Medizin lernen in deiner Sprache: Erklärungen in 7 Sprachen | MedPrüf Blog";
const pageDesc =
  "Kenntnisprüfung und Stichprobentest laufen auf Deutsch. Verstehen darfst du in deiner Sprache: mehrsprachige Erklärungen zu über 10.000 kuratierten Übungsfragen. Termine und Fristen variieren nach Prüfungsweg.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Medizin auf Deutsch lernen",
    "medizinische Erklärungen mehrsprachig",
    "Kenntnisprüfung Wien Vorbereitung",
    "Stichprobentest Vorbereitung",
    "Kenntnisprüfung arabisch russisch türkisch",
    "Fachsprache Medizin Österreich",
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
      "Medizin lernen in deiner Sprache: die österreichische Arztprüfung mit mehrsprachigen Erklärungen",
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
      "mehrsprachige Erklärungen, Kenntnisprüfung Wien, Stichprobentest, Medizin lernen",
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
