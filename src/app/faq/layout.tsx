
import { billingSurfaceText } from "@/lib/billing-copy";
import type { Metadata } from "next";

import { billingAmount, billingCancelSummary, billingPlansSummary, billingTrialSummary } from "@/lib/billing-copy";
import { TIERS } from "@/lib/content-truth";

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
      q: 'Wie funktioniert die Pass-Until-You-Pass-Garantie?',
      a: billingSurfaceText("faq_layout_tsx_0", "de"),
    },
    {
      q: "Wie kann ich bezahlen?",
      a: `Du zahlst sicher mit Karte (Visa, Mastercard, auch Apple Pay). Der Checkout läuft über Whop, unseren Zahlungsabwickler; der Vollzugang wird automatisch innerhalb von etwa einer Minute nach der Zahlung freigeschaltet. Verfügbar sind der Einzelmonat (${billingAmount(TIERS.first_month_19.price_cents, "de")} pro Monat), der 3-Monats-Tarif (${billingAmount(TIERS.first_3mo_27.price_cents, "de")} pro Quartal), die Prüfungs-Kohorte (${billingAmount(TIERS.premium_pass_guaranteed.price_cents, "de")} einmalig für 6 Monate) und der kostenlose Tarif. ${billingPlansSummary("de")} ${billingTrialSummary("de")} ${billingCancelSummary("de")}`,
    },
    {
      q: "Wie funktioniert das Empfehlungsprogramm?",
      a: billingSurfaceText("faq_layout_tsx_1", "de"),
    },
    {
      q: "Was ist im kostenlosen Tarif enthalten?",
      a: "Der kostenlose Tarif gibt dir 150 Fragen pro Prüfungstyp, 450 Fragen insgesamt über Kenntnisprüfung Wien, Stichprobentest (Innsbruck) und Pharmakologie, ohne Ablaufdatum. Klinische Erklärungen sind enthalten, wo sie vorhanden sind. Nicht enthalten: Spaced Repetition, Prüfungssimulation, Lesezeichen und KI-Chat-Folgefragen. Deine Antworten werden geräteübergreifend synchronisiert, und du kannst bis zu 10 Flash-Notes kostenlos anlegen. Die KI-Erklärung zu jeder Frage ist den bezahlten Tarifen vorbehalten.",
    },
    {
      q: "Gibt es Tarife pro Prüfung?",
      a: "Nein, jeder bezahlte Tarif enthält alle drei Prüfungstypen: Kenntnisprüfung Wien, Stichprobentest (Innsbruck) und Pharmakologie. Wenn du wirklich nur eine Prüfung vorbereitest, gibt dir der kostenlose Tarif 150 Fragen für genau diesen Prüfungstyp.",
    },
    {
      q: "Wer baut MedPrüf?",
      a: "MedPrüf wird von [name] ([name], Österreich) entwickelt, einem Solo-Engineer, der seinen Cousin durch die österreichische Nostrifikation begleitet hat. Die Fragenbank ist nach Prüfungstyp geordnet, und Fehler kannst du direkt in der App melden.",
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
