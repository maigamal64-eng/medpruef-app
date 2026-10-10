import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

const SLUG = "ukrainian-refugee-physicians-austria";
const post = getPostBySlug(SLUG);

const pageTitle = "Ukrainian Doctors in Austria: 2026 Licensing Guide | MedPrüf";
const pageDesc = "Step-by-step 2026 guide for Ukrainian doctors in Austria: nostrification, German requirements, Stichprobentest, Ärzteliste, costs and next steps.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Ukrainian doctors Austria",
    "medical licensing Austria",
    "nostrification Austria",
    "Stichprobentest",
    "Austrian Medical Chamber",
    "Ukrainian physicians Austria",
    "medical recognition Austria",
    "German language exam Austria",
  ],
  alternates: {
    canonical: `https://medpruf.com/blog/${SLUG}`,
    languages: {
      en: `https://medpruf.com/blog/${SLUG}`,
      de: `https://medpruf.com/blog/ukrainische-aerzte-oesterreich-anerkennung`,
      "x-default": `https://medpruf.com/blog/${SLUG}`,
    },
  },
  openGraph: {
    type: "article",
    url: `https://medpruf.com/blog/${SLUG}`,
    siteName: "MedPrüf",
    title: pageTitle,
    description: pageDesc,
    locale: "en_US",
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
    headline: "How Ukrainian Doctors Can Practice Medicine in Austria: 2026 Guide",
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
      "Ukrainian doctors, Austria, medical licensing, nostrification, Stichprobentest",
    inLanguage: "en-US",
  };
}

function buildBreadcrumbSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "MedPrüf",
        item: "https://medpruf.com",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: "https://medpruf.com/blog",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "How Ukrainian Doctors Can Practice Medicine in Austria: 2026 Guide",
        item: `https://medpruf.com/blog/${SLUG}`,
      },
    ],
  };
}

function buildFAQSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How long does nostrification take for Ukrainian physicians in Austria?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "From initial application to final recognition, the typical range is six to eighteen months. Cases with significant curriculum differences can take two to three years. Submitting a complete application the first time is the single most effective way to avoid delays.",
        },
      },
      {
        "@type": "Question",
        name: "What German level do Ukrainian refugee physicians need to practice medicine in Austria?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "You need B2 CEFR to register for the Austrian Medical Chamber's language examination. The examination itself assesses professional medical communication. A C1-level certificate is required for the nostrification application at the medical universities (MedUni Wien requires at least C1; confirm the level with the university where you file).",
        },
      },
      {
        "@type": "Question",
        name: "Can Ukrainian physicians work clinically while nostrification is pending?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. There is no general authorization for ordinary patient care merely because nostrification is pending. Austria has narrow statutory temporary/special-activity routes (§36 ÄrzteG), although they are not a general employment workaround for Ukrainian applicants. Observerships (Hospitationen) are available at some institutions for non-hands-on exposure, but they do not authorize clinical practice.",
        },
      },
      {
        "@type": "Question",
        name: "What is the Stichprobentest?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The Stichprobentest is a 250-question written multiple-choice examination covering exactly ten medical disciplines (internal medicine, surgery, pediatrics, neurology, gynecology, dermatology, otorhinolaryngology, psychiatry, ophthalmology, emergency and intensive medicine), used by all three Austrian medical universities to assess clinical knowledge as part of the nostrification procedure. A minimum of 60% correct answers is required in each subject area. The Stichprobentest can only be taken once.",
        },
      },
      {
        "@type": "Question",
        name: "Can I repeat the Stichprobentest if I fail?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. The Stichprobentest can only be taken once. Its result determines which supplementary university examinations are imposed. If six or more disciplines are passed at ≥60% each, examinations are generally prescribed for the failed disciplines only. If five or fewer are passed, examinations from the regular medical curriculum may be imposed instead. Rezeptierkunde/Pharmacology and Gerichtliche Medizin are always prescribed regardless of the Stichprobentest outcome.",
        },
      },
      {
        "@type": "Question",
        name: "Which universities accept medical nostrification applications in Austria?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Four Austrian medical universities handle medical nostrification: Medical University of Vienna, Medical University of Graz, Medical University of Innsbruck, and Johannes Kepler University Linz.",
        },
      },
    ],
  };
}

export default function PostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link rel="alternate" hrefLang="en" href="https://medpruf.com/blog/ukrainian-refugee-physicians-austria" />
      <link rel="alternate" hrefLang="de" href="https://medpruf.com/blog/ukrainische-aerzte-oesterreich-anerkennung" />
      <link rel="alternate" hrefLang="x-default" href="https://medpruf.com/blog/ukrainian-refugee-physicians-austria" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildArticleSchema()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbSchema()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFAQSchema()) }}
      />
      {children}
    </>
  );
}