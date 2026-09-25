import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ: MedPrüf",
  description:
    "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie. Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
  alternates: {
    canonical: "https://medpruf.com/faq",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/faq",
    title: "FAQ: MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie. Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ: MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie. Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
    images: ["/brand/og-image.png"],
  },
};

/**
 * FAQPage JSON-LD — scoped to /faq ONLY (not the root layout) so the
 * marked-up Q&A matches the questions actually visible on this page.
 *
 * The answers mirror the German copy rendered in `page.tsx` (the page
 * defaults to `de`); strong/markup is flattened to plain text per the
 * schema.org acceptedAnswer.text guidance. If the on-page copy changes,
 * update these strings in the same commit (Google requires the marked-up
 * text to match the visible answer).
 *
 * Emitted from the layout so crawlers find it even though the page body
 * is a Client Component that hydrates after load. Brand-sweep 2026-06-04.
 */
function buildFaqSchema() {
  const qa: Array<{ q: string; a: string }> = [
    {
      q: 'Wie funktioniert „Beim ersten Versuch bestehen, oder kostenlos weiterlernen"?',
      a: "Die Pass-Until-You-Pass-Garantie (PUYP) gilt für die Prüfungs-Kohorte (129 €). Statt einer Cash-Rückerstattung verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin, wenn du durchfällst: Du lädst dein offizielles Prüfungsergebnis hoch, musst mindestens 70 % der relevanten Fragenbank bearbeitet haben, ein Admin verifiziert innerhalb von 72 Stunden, und bei Bestätigung verlängert sich dein Abo automatisch, maximal zwei zusätzliche Zyklen pro Nutzer:in.",
    },
    {
      q: "Wie kann ich bezahlen?",
      a: "Du zahlst sicher mit Karte (Visa, Mastercard, auch Apple Pay). Der Checkout läuft über Whop. Verfügbar sind die Prüfungs-Kohorte (129 € einmalig für 6 Monate), der 3-Monats-Tarif (49 € pro Quartal) und der Einzelmonat (19 € pro Monat). Der Einzelmonat verlängert sich monatlich und der 3-Monats-Tarif quartalsweise automatisch, sofern du nicht vorher kündigst. Die Prüfungs-Kohorte verlängert sich nicht automatisch.",
    },
    {
      q: "Wie laufen Empfehlungszahlungen?",
      a: "Das Empfehlungsprogramm ist nur für eingeladene und freigeschaltete Konten verfügbar. Wenn du freigeschaltet bist, kannst du zwei Kolleg:innen einladen. Beide müssen den Pro-Test mit Karte starten (0 € heute, danach 19 €/Monat, wenn nicht während der Testwoche gekündigt) und mindestens 20 verschiedene Fragen an mindestens 2 Tagen beantworten. Nach Prüfung wird Pro bis zum nächsten Prüfungsfenster gutgeschrieben. Es gibt keine Barauszahlung.",
    },
    {
      q: "Was ist im kostenlosen Tarif enthalten?",
      a: "Der kostenlose Tarif umfasst bis zu 150 Fragen pro Prüfungstyp und läuft nicht ab. Gespeicherte Antworten und Themenfortschritt werden mit deinem Konto synchronisiert. Vorhandene klinische Erklärungen und bereits gespeicherte KI-Erklärungen bleiben lesbar. Neue KI-Erklärungen und KI-Chat-Folgefragen erfordern einen bezahlten Tarif. Weitere Werkzeuge zeigen ihre Tarifvoraussetzungen direkt in der App.",
    },
    {
      q: "Gibt es Tarife pro Prüfung?",
      a: "Nein, jeder bezahlte Tarif enthält alle drei Prüfungstypen: Kenntnisprüfung Wien, Stichprobentest (Innsbruck) und Pharmakologie. Wenn du wirklich nur eine Prüfung vorbereitest, gibt dir der kostenlose Tarif 150 Fragen für genau diesen Prüfungstyp.",
    },
    {
      q: "Wer baut MedPrüf?",
      a: "MedPrüf wird von [name] ([name], Österreich) entwickelt. Die Fragenbanken nutzen unterschiedliche Quellen und Formate: Anki-basierte Multiple-Choice-Übungsfragen für die Kenntnisprüfung, curriculum-basierte Übungsfragen für den Stichprobentest und Lernfragen für Pharmakologie und Rezeptierkunde. Sie sind keine offiziellen oder rekonstruierten Prüfungsfragen. Die reale Kenntnisprüfung verwendet offene Kurzantwortfragen.",
    },
  ];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        "@id": "https://medpruf.com/faq#faqpage",
        mainEntity: qa.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: {
            "@type": "Answer",
            text: a,
          },
        })),
      },
      {
        // Crumbs end on THIS page (Home → FAQ) — a breadcrumb is page-scoped,
        // so it lives in the /faq layout, never the root layout.
        "@type": "BreadcrumbList",
        "@id": "https://medpruf.com/faq#breadcrumb",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://medpruf.com/landing",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "FAQ",
            item: "https://medpruf.com/faq",
          },
        ],
      },
    ],
  };
}

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqSchema()) }}
      />
      {children}
    </>
  );
}
