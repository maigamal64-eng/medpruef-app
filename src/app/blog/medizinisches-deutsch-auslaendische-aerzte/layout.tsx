import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

/**
 * Per-post layout: title, meta description, OG article schema, and
 * JSON-LD Article structured data. Metadata is German-primary (site
 * SEO intent); the page content itself is bilingual DE + EN.
 */

const SLUG = "medizinisches-deutsch-auslaendische-aerzte";
const post = getPostBySlug(SLUG);

const pageTitle =
  "Medizinisches Deutsch für ausländische Ärzt:innen | MedPrüf Blog";
const pageDesc =
  "Bei den österreichischen Wissensprüfungen scheitert es oft an der deutschen Fachsprache, nicht am Wissen. So schließt du die Sprachlücke: zuerst verstehen, dann auf Deutsch üben, Terminologie im Kontext und echte deutsche Prüfungsfragen.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "medizinisches Deutsch",
    "Fachsprache Medizin",
    "deutsche medizinische Terminologie",
    "ausländischer Arzt Österreich",
    "Kenntnisprüfung Wien Sprache",
    "Medizin auf Deutsch lernen",
    "Prüfungsvorbereitung Medizin Österreich",
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
      "Medizinisches Deutsch für ausländische Ärzt:innen: die Sprachlücke schließen",
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
      "medizinisches Deutsch, Fachsprache, Kenntnisprüfung Wien",
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
