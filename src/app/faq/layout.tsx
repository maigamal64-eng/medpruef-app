import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — MedPrüf",
  description:
    "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie — Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
  alternates: {
    canonical: "https://medpruf.com/faq",
  },
  openGraph: {
    type: "website",
    url: "https://medpruf.com/faq",
    title: "FAQ — MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie — Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ — MedPrüf",
    description:
      "Häufig gestellte Fragen zu MedPrüf: Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie — Zahlung, Pass-Until-You-Pass, Übersetzungen, Datenschutz.",
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
      q: 'Wie funktioniert „Beim ersten Versuch bestehen — oder kostenlos weiterlernen"?',
      a: "Die Pass-Until-You-Pass-Garantie (PUYP) gilt für die Juni-26-Kohorte (114 €), den 6-Monats-Tarif (149 €) und das Jahresabo (229 €). Statt einer Cash-Rückerstattung verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin, wenn du durchfällst: Du lädst dein offizielles Prüfungsergebnis hoch, musst mindestens 70 % der relevanten Fragenbank bearbeitet haben, ein Admin verifiziert innerhalb von 72 Stunden, und bei Bestätigung verlängert sich dein Abo automatisch — maximal zwei zusätzliche Zyklen pro Nutzer:in.",
    },
    {
      q: "Wie kann ich bezahlen?",
      a: "Du zahlst sicher mit Karte (Visa, Mastercard, auch Apple Pay). Der Checkout läuft über Whop, unseren Zahlungsabwickler; der Vollzugang wird automatisch innerhalb von etwa einer Minute nach der Zahlung freigeschaltet. Live verfügbar sind die Juni-26-Kohorte (114 €), der 3-Monats-Einstieg (27 €), der Einzelmonat (19 €) und der kostenlose Tarif. Es ist kein Abo: nichts verlängert sich automatisch, der Zugang läuft nach der gebuchten Laufzeit einfach aus.",
    },
    {
      q: "Wie laufen Empfehlungszahlungen?",
      a: "Jede:r Nutzer:in bekommt einen persönlichen Empfehlungscode. Sobald deine Empfehlung ein Abo abschließt, gehört eine abgestufte Auszahlung dir. Es gilt eine 30-Tage-Sperrfrist ab Zahlungseingang, Auszahlung per USDT (TRC-20/ERC-20) oder über Wise, ein Jahresdeckel von 600 € pro Empfehlende:r, und nur die erste Zahlung deiner Empfehlung löst den Bonus aus. SEPA ist nicht Teil des Programms.",
    },
    {
      q: "Was ist im kostenlosen Tarif enthalten?",
      a: "Der kostenlose Tarif gibt dir 150 Fragen pro Prüfungstyp — 450 Fragen insgesamt über Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie, ohne Ablaufdatum. Enthalten sind vollständige klinische Erklärungen auf allen 450 Fragen (gleiche Tiefe wie im bezahlten Tarif). Nicht enthalten: Spaced Repetition, Prüfungssimulation, Lesezeichen, Notizen, geräteübergreifende Synchronisation und KI-Chat-Folgefragen.",
    },
    {
      q: "Gibt es Tarife pro Prüfung?",
      a: "Nein — jeder bezahlte Tarif enthält alle drei Prüfungstypen: Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. Wenn du wirklich nur eine Prüfung vorbereitest, gibt dir der kostenlose Tarif 150 Fragen für genau diesen Prüfungstyp.",
    },
    {
      q: "Wer baut MedPrüf?",
      a: "MedPrüf wird von [name] ([name], Österreich) entwickelt — einem Solo-Engineer, der seinen Cousin durch die österreichische Nostrifikation begleitet hat. Jede Frage stammt aus einer dokumentierten offiziellen Prüfung (7.566 aus Wien seit 2016, 3.091 aus Innsbruck, 335 aus Pharmakologie) — nichts erfunden, nichts geraten.",
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
