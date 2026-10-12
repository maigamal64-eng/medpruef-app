import type { Metadata } from "next";
import { getPostBySlug } from "@/lib/blog";

const SLUG = "ukrainische-aerzte-oesterreich-anerkennung";
const post = getPostBySlug("ukrainian-refugee-physicians-austria");

const pageTitle = "Ukrainische Ärzte in Österreich: 2026 Leitfaden zur Anerkennung | MedPrüf";
const pageDesc = "Schritt-für-Schritt 2026 Leitfaden für ukrainische Ärzt:innen in Österreich: Nostrifizierung, Deutsch-Anforderungen, Stichprobentest, Ärzteliste, Kosten und nächste Schritte.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDesc,
  keywords: [
    "Ukrainische Ärzte Österreich",
    "Approbation Österreich",
    "Nostrifizierung Österreich",
    "Stichprobentest",
    "Österreichische Ärztekammer",
    "Ukrainische Ärztinnen Österreich",
    "Medizinische Anerkennung Österreich",
    "Deutsch Sprachprüfung Österreich",
  ],
  alternates: {
    canonical: `https://medpruf.com/blog/${SLUG}`,
    languages: {
      en: `https://medpruf.com/blog/ukrainian-refugee-physicians-austria`,
      de: `https://medpruf.com/blog/${SLUG}`,
      "x-default": `https://medpruf.com/blog/ukrainian-refugee-physicians-austria`,
    },
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
    headline: "Wie ukrainische Ärzt:innen in Österreich Medizin praktizieren können: 2026 Leitfaden",
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
      "Ukrainische Ärzte, Österreich, Approbation, Nostrifizierung, Stichprobentest",
    inLanguage: "de-AT",
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
        name: "Wie ukrainische Ärzt:innen in Österreich Medizin praktizieren können: 2026 Leitfaden",
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
        name: "Wie lange dauert die Nostrifizierung für ukrainische Ärzt:innen in Österreich?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Vom Erstantrag bis zur endgültigen Anerkennung beträgt der typische Rahmen sechs bis achtzehn Monate. Fälle mit erheblichen Curriculum-Unterschieden können zwei bis drei Jahre dauern. Einen vollständigen Antrag beim ersten Mal einzureichen, ist der wirksamste Hebel gegen Verzögerungen.",
        },
      },
      {
        "@type": "Question",
        name: "Welches Deutschniveau brauchen ukrainische Ärzt:innen für die ärztliche Tätigkeit in Österreich?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sie benötigen B2 GER für die Anmeldung zur ärztlichen Sprachprüfung der Österreichischen Ärztekammer. Die Prüfung selbst prüft professionelle medizinische Kommunikation. Ein C1-Zertifikat wird für den Nostrifizierungsantrag an den Medizinischen Universitäten verlangt (MedUni Wien verlangt mindestens C1; klären Sie das Niveau mit der Universität, bei der Sie einreichen).",
        },
      },
      {
        "@type": "Question",
        name: "Können ukrainische Ärzt:innen klinisch arbeiten, während die Nostrifizierung läuft?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nein. Es gibt keine generelle Ermächtigung zur ordentlichen Patientenversorgung bloß weil die Nostrifizierung anhängig ist. Österreich hat enge gesetzliche befristete/Sonderaktivitäts-Routen (§36 ÄrzteG), diese sind jedoch kein genereller Beschäftigungs-Workaround für ukrainische Antragsteller. Hospitationen sind an manchen Institutionen für nicht-händische Erfahrung möglich, erlauben aber keine klinische Tätigkeit.",
        },
      },
      {
        "@type": "Question",
        name: "Was ist der Stichprobentest?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Der Stichprobentest ist eine 250-Fragen-Schriftprüfung im Multiple-Choice-Format, die exakt zehn medizinische Fachbereiche abdeckt (Innere Medizin, Chirurgie, Kinder- und Jugendheilkunde, Neurologie, Gynäkologie, Dermatologie, Hals-Nasen-Ohrenheilkunde, Psychiatrie, Augenheilkunde, Notfall- und Intensivmedizin). Er wird von allen drei österreichischen Medizinischen Universitäten im Rahmen der Nostrifizierung zur Überprüfung klinischer Kenntnisse eingesetzt. Mindestens 60 % richtige Antworten sind in jedem Fachbereich erforderlich. Der Stichprobentest kann nur einmal abgelegt werden.",
        },
      },
      {
        "@type": "Question",
        name: "Kann ich den Stichprobentest wiederholen, wenn ich nicht bestehe?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nein. Der Stichprobentest kann nur einmal abgelegt werden. Sein Ergebnis bestimmt, welche ergänzenden Universitätsprüfungen angeordnet werden. Werden sechs oder mehr Fachbereiche mit je ≥60 % bestanden, werden in der Regel nur in den nicht bestandenen Bereichen Prüfungen angeordnet. Werden fünf oder weniger bestanden, können Prüfungen aus dem regulären Medizinstudium auferlegt werden. Rezeptierkunde/Pharmakologie und Gerichtliche Medizin werden unabhängig vom Stichprobentest-Ergebnis immer angeordnet.",
        },
      },
      {
        "@type": "Question",
        name: "Welche Universitäten nehmen Anträge auf medizinische Nostrifizierung in Österreich an?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Den Antrag stellen Sie bei einer Medizinischen Universität. Den gemeinsamen Stichprobentest führen die Medizinischen Universitäten Wien, Graz und Innsbruck durch.",
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