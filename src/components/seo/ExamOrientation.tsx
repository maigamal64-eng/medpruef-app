"use client";

import Link from "next/link";
import BankFreshnessStamp from "@/components/seo/BankFreshnessStamp";
import { guidanceLink, withLang, type PublicLink } from "@/lib/guidance/public-links";

type Lang = "de" | "en";
type Bank = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

/** Exam page orientation copy (GU-04, CNT-39, TR-23, UX-PUB-02 other-bank strip). */
const COPY = {
  de: {
    title: "Prüfung, Regeln und Grenzen",
    notTitle: "Was MedPrüf nicht ist",
    not: "MedPrüf bietet Übungsfragen und Erklärungen. Es enthält keine offiziellen, erinnerten oder geleakten Prüfungsfragen und berät nicht zu Anerkennung oder Zulassung. Fachsprachprüfung (FSP), die deutsche Kenntnisprüfung und Approbation, Zahnmedizin und die postgraduale ÖÄK-Prüfung deckt MedPrüf nicht ab.",
    banks: "Sie suchen eine andere Fragenbank?",
    help: "Hilfe bei der Wahl",
  },
  en: {
    title: "Exam, rules and limits",
    notTitle: "What MedPrüf is not",
    not: "MedPrüf offers practice questions and explanations. It contains no official, recalled or leaked exam questions and gives no advice on recognition or eligibility. It does not cover the medical German exam (FSP), the German Kenntnisprüfung and Approbation, dentistry or the postgraduate ÖÄK exam.",
    banks: "Looking for another question bank?",
    help: "Help me choose",
  },
} as const;

const BANK_PAGES: Array<{ bank: Bank; href: string; label: Record<Lang, string> }> = [
  { bank: "kenntnispruefung", href: "/kenntnispruefung-wien", label: { de: "SIP4a / SIP5a Wien", en: "SIP4a / SIP5a Vienna" } },
  { bank: "kmp_innsbruck", href: "/stichprobentest", label: { de: "Stichprobentest", en: "Stichprobentest" } },
  { bank: "pharma", href: "/pharmakologie-pruefung-wien", label: { de: "Pharmakologie / Rezeptierkunde", en: "Pharmacology / Rezeptierkunde" } },
];

const ALWAYS = ["/pruefungskalender", "/was-ist-was", "/umfang", "/korrekturen", "/materials"];

/** Freshness stamp, sourced rules links, scope statement and the other banks, for one exam page. */
export default function ExamOrientation({ bank, rulesPaths = [], lang }: { bank: Bank; rulesPaths?: string[]; lang: Lang }) {
  const c = COPY[lang];
  const links = [...rulesPaths, ...ALWAYS].map(guidanceLink).filter((l): l is PublicLink => l !== null);
  return (
    <section aria-labelledby={`exam-orientation-${bank}`} className="max-w-5xl mx-auto px-4 lg:px-8 pb-10">
      <h2 id={`exam-orientation-${bank}`} className="mp-h3 mb-4">{c.title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <BankFreshnessStamp bank={bank} lang={lang} />
        <div className="mp-card p-4 text-sm">
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={withLang(l.href, lang)} className="inline-flex min-h-11 items-center font-semibold text-[var(--mp-fg)] underline underline-offset-4">
                  {l.label[lang]}
                </Link>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 font-semibold text-[var(--mp-fg)]">{c.notTitle}</h3>
          <p className="mt-1 text-[var(--mp-fg-muted)]">{c.not}</p>
        </div>
      </div>
      <nav aria-label={c.banks} className="mt-6">
        <p className="text-sm font-semibold text-[var(--mp-fg)]">{c.banks}</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {BANK_PAGES.filter((b) => b.bank !== bank).map((b) => (
            <li key={b.href}><Link href={b.href} className="mp-btn mp-btn--secondary mp-btn--sm min-h-11">{b.label[lang]}</Link></li>
          ))}
          <li><Link href="/find-your-path" className="mp-btn mp-btn--secondary mp-btn--sm min-h-11">{c.help}</Link></li>
        </ul>
      </nav>
    </section>
  );
}
