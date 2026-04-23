"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

type Lang = "de" | "en";

/**
 * /faq — Häufig gestellte Fragen
 *
 * Referenced from the pricing page ("See all FAQ", "How verification
 * works") and from the landing-page footer. Sections are anchored so
 * pricing can deep-link to #puyp, #crypto-only, #referrals, etc.
 *
 * Ships as part of the April 23 2026 positioning update — no
 * "Founders'" copy anywhere; every cohort reference uses "June 26
 * Cohort". MPDS v2 semantic tokens + primitives throughout.
 */
export default function FaqPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);

  useEffect(() => {
    setLangState(getLang());
    setSession(getStoredSession());
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  const user = session?.user;

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
          <Link
            href={user ? "/" : "/landing"}
            className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)]">
            {lang === "de" ? "Häufige Fragen" : "FAQ"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Hero */}
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pt-10 pb-6 text-center">
          <h2 className="mp-h1 mb-3 leading-[1.1]">
            {lang === "de" ? "Häufig gestellte Fragen" : "Frequently asked questions"}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] max-w-xl mx-auto">
            {lang === "de"
              ? "Antworten auf die wichtigsten Fragen zum kostenlosen Tarif, zur Juni-26-Kohorte, zu Pass-Until-You-Pass und zum Empfehlungsprogramm."
              : "Answers to the key questions about the free tier, the June 26 Cohort, Pass-Until-You-Pass, and the referral program."}
          </p>
        </section>

        {/* Table of contents */}
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-6">
          <nav
            className="rounded-[var(--mp-r-card)] p-4 md:p-5"
            style={{
              background: "var(--mp-surface-raised)",
              border: "1px solid var(--mp-border-subtle)",
            }}
            aria-label={lang === "de" ? "Inhalt" : "Table of contents"}
          >
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <li>
                <a
                  href="#puyp"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-3 h-3" />
                  {lang === "de"
                    ? "Pass-Until-You-Pass — wie funktioniert das?"
                    : "Pass-Until-You-Pass — how it works"}
                </a>
              </li>
              <li>
                <a
                  href="#crypto-only"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-3 h-3" />
                  {lang === "de" ? "Warum nur Krypto?" : "Why crypto-only?"}
                </a>
              </li>
              <li>
                <a
                  href="#referrals"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-3 h-3" />
                  {lang === "de"
                    ? "Wie laufen Empfehlungszahlungen?"
                    : "How do referral payouts work?"}
                </a>
              </li>
              <li>
                <a
                  href="#free-tier"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-3 h-3" />
                  {lang === "de"
                    ? "Was ist im kostenlosen Tarif enthalten?"
                    : "What's in the free tier?"}
                </a>
              </li>
              <li>
                <a
                  href="#per-exam"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-3 h-3" />
                  {lang === "de"
                    ? "Gibt es Tarife pro Prüfung?"
                    : "Is there per-exam pricing?"}
                </a>
              </li>
              <li>
                <a
                  href="#credentials"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1.5"
                >
                  <ArrowRight className="w-3 h-3" />
                  {lang === "de" ? "Wer baut MedPrüf?" : "Who builds MedPrüf?"}
                </a>
              </li>
            </ul>
          </nav>
        </section>

        {/* Sections */}
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-16 space-y-8">
          {/* PUYP */}
          <FaqSection id="puyp" title={copy.puyp.title[lang]}>
            <p>{copy.puyp.intro[lang]}</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>{copy.puyp.b1[lang]}</li>
              <li>{copy.puyp.b2[lang]}</li>
              <li>{copy.puyp.b3[lang]}</li>
              <li>{copy.puyp.b4[lang]}</li>
              <li>{copy.puyp.b5[lang]}</li>
            </ul>
            <p className="mt-3">{copy.puyp.scope[lang]}</p>
            <details
              className="mt-4 rounded-lg"
              style={{
                background: "var(--mp-surface-sunken)",
                border: "1px solid var(--mp-border-subtle)",
              }}
            >
              <summary
                className="px-4 py-3 cursor-pointer list-none flex items-center justify-between gap-2 text-sm font-semibold text-[var(--mp-fg)]"
                style={{ userSelect: "none" }}
              >
                {lang === "de"
                  ? "Warum keine Geld-zurück-Garantie?"
                  : "Why no cash refund?"}
                <ChevronDown className="w-4 h-4 text-[var(--mp-viridian)] transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm leading-relaxed text-[var(--mp-fg-muted)]">
                {copy.puyp.noRefund[lang]}
              </div>
            </details>
          </FaqSection>

          {/* Crypto only */}
          <FaqSection id="crypto-only" title={copy.crypto.title[lang]}>
            <p>{copy.crypto.p1[lang]}</p>
            <p className="mt-3">{copy.crypto.p2[lang]}</p>
          </FaqSection>

          {/* Referrals */}
          <FaqSection id="referrals" title={copy.ref.title[lang]}>
            <p>{copy.ref.intro[lang]}</p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PayoutPill
                amount="€25"
                label={lang === "de" ? "Monatlich / 3 Monate" : "Monthly / 3 months"}
              />
              <PayoutPill
                amount="€50"
                label={lang === "de" ? "6 Monate / 12 Monate" : "6 months / 12 months"}
              />
              <PayoutPill
                amount="€75"
                label={lang === "de" ? "Juni-26-Kohorte" : "June 26 Cohort"}
                highlight
              />
            </div>
            <ul className="list-disc pl-5 space-y-1.5 mt-4">
              <li>{copy.ref.b1[lang]}</li>
              <li>{copy.ref.b2[lang]}</li>
              <li>{copy.ref.b3[lang]}</li>
              <li>{copy.ref.b4[lang]}</li>
            </ul>
            <p className="mt-3 mp-small text-[var(--mp-fg-subtle)]">
              {copy.ref.sepa[lang]}
            </p>
          </FaqSection>

          {/* Free tier */}
          <FaqSection id="free-tier" title={copy.free.title[lang]}>
            <p>{copy.free.intro[lang]}</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>{copy.free.b1[lang]}</li>
              <li>{copy.free.b2[lang]}</li>
              <li>{copy.free.b3[lang]}</li>
              <li>{copy.free.b4[lang]}</li>
            </ul>
            <p className="mt-3">{copy.free.upgrade[lang]}</p>
          </FaqSection>

          {/* Per-exam */}
          <FaqSection id="per-exam" title={copy.perExam.title[lang]}>
            <p>{copy.perExam.p1[lang]}</p>
            <p className="mt-3">{copy.perExam.p2[lang]}</p>
          </FaqSection>

          {/* Credentials */}
          <FaqSection id="credentials" title={copy.who.title[lang]}>
            <p>{copy.who.p1[lang]}</p>
          </FaqSection>

          {/* Final CTA */}
          <div
            className="rounded-[var(--mp-r-card)] p-6 md:p-7 text-center"
            style={{
              background: "var(--mp-surface-raised)",
              border: "1px solid var(--mp-border-subtle)",
            }}
          >
            <h3 className="mp-h3 mb-2">
              {lang === "de" ? "Noch Fragen offen?" : "Still have questions?"}
            </h3>
            <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm">
              {lang === "de"
                ? "Schreib uns direkt an user-b7e46e80@example.com. Wir antworten typisch in unter 24 Stunden."
                : "Write to us directly at user-b7e46e80@example.com. We typically reply in under 24 hours."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <a
                href="mailto:user-b7e46e80@example.com"
                className="mp-btn mp-btn--primary inline-flex items-center gap-1.5"
              >
                {lang === "de" ? "Per E-Mail antworten" : "Email us"}
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
              <Link
                href="/pricing"
                className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5"
              >
                {lang === "de" ? "Zur Preisseite" : "Back to pricing"}
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <BottomNav lang={lang} userId={user?.id} />
    </div>
  );
}

/* ═══════════════════════ Sub-components ═══════════════════════ */

function FaqSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-[var(--mp-r-card)] overflow-hidden p-6 md:p-7 scroll-mt-24"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <h3 className="mp-h3 mb-3 text-[20px] leading-tight">{title}</h3>
      <div className="text-sm text-[var(--mp-fg-muted)] leading-relaxed space-y-0">
        {children}
      </div>
    </section>
  );
}

function PayoutPill({
  amount,
  label,
  highlight = false,
}: {
  amount: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-[12px] p-4 flex flex-col items-start gap-1"
      style={{
        background: highlight ? "var(--mp-success-bg)" : "var(--mp-surface-sunken)",
        border: highlight
          ? "1px solid rgba(0,123,95,0.3)"
          : "1px solid var(--mp-border-subtle)",
      }}
    >
      <span
        className="mp-num font-display font-black leading-none"
        style={{
          fontSize: "22px",
          color: highlight ? "var(--mp-viridian)" : "var(--mp-fg)",
        }}
      >
        {amount}
      </span>
      <span className="mp-small text-[var(--mp-fg-muted)]">{label}</span>
    </div>
  );
}

/* ═══════════════════════ Copy ═══════════════════════ */

const copy = {
  puyp: {
    title: {
      de: "Wie funktioniert „Beim ersten Versuch bestehen — oder kostenlos weiterlernen\"?",
      en: "How does \"Pass first try — or study free until you do\" work?",
    },
    intro: {
      de: "Die Pass-Until-You-Pass-Garantie (PUYP) gilt für die Juni-26-Kohorte und das 12-Monats-Abo. Statt einer Cash-Rückerstattung verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin, wenn du durchfällst.",
      en: "The Pass-Until-You-Pass guarantee (PUYP) applies to the June 26 Cohort and the 12-month plan. Instead of a cash refund, we extend your access free through the next exam date if you fail.",
    },
    b1: {
      de: "Lade dein offizielles Prüfungsergebnis als PDF oder Foto in deinem Dashboard hoch.",
      en: "Upload your official exam result as a PDF or photo from your dashboard.",
    },
    b2: {
      de: "Du musst mindestens 70 % der Fragenbank für den relevanten Prüfungstyp bearbeitet haben.",
      en: "You must have completed ≥70 % of the Qbank for the relevant exam type.",
    },
    b3: {
      de: "Ein Admin verifiziert innerhalb von 72 Stunden manuell jedes Ergebnis.",
      en: "An admin manually verifies every result within 72 hours.",
    },
    b4: {
      de: "Bei Bestätigung wird dein Abo automatisch bis zum nächsten Prüfungszyklus verlängert, und du erhältst eine Bestätigungsmail.",
      en: "On approval, your subscription auto-extends through the next exam cycle and you receive a confirmation email.",
    },
    b5: {
      de: "Maximal zwei zusätzliche Zyklen pro Nutzer:in.",
      en: "Maximum of two additional cycles per user.",
    },
    scope: {
      de: "PUYP gilt ausschließlich für die Juni-26-Kohorte (€114) und das Jahresabo (€229). Die Monats-, 3- und 6-Monats-Tarife enthalten die Garantie nicht.",
      en: "PUYP applies only to the June 26 Cohort (€114) and the annual plan (€229). Monthly, 3-month and 6-month plans don't include the guarantee.",
    },
    noRefund: {
      de: "Geld-zurück-Garantien laden zu Missbrauch ein und führen häufig dazu, dass Studierende aufgeben, sobald es hart wird. Pass-Until-You-Pass hält dich stattdessen im Spiel — wir investieren in dein Bestehen, nicht in eine Ausstiegsklausel. Wenn du ein sehr persönliches Problem hast (Krankheit, Trauerfall), schreib uns an user-b7e46e80@example.com — wir finden im Einzelfall eine faire Lösung.",
      en: "Money-back guarantees invite abuse and often push students to quit when the work gets hard. Pass-Until-You-Pass keeps you in the game instead — we invest in your pass, not in an exit clause. If you have a genuine personal situation (illness, bereavement), email user-b7e46e80@example.com — we find a fair solution case by case.",
    },
  },
  crypto: {
    title: {
      de: "Warum ist gerade nur Krypto-Zahlung möglich?",
      en: "Why is payment crypto-only right now?",
    },
    p1: {
      de: "MedPrüf wird aus Österreich heraus für ausländische Ärzt:innen betrieben. Europäische Zahlungsanbieter (Stripe EU, Paddle, Whop) blockieren unsere Konten aktuell beim KYC wegen eines abgelaufenen Reisedokuments. Die praktische Alternative: wir registrieren über Stripe Atlas eine US-LLC + EIN, dann wird Stripe live. Der Antrag läuft.",
      en: "MedPrüf is operated from Austria for foreign doctors. European payment processors (Stripe EU, Paddle, Whop) currently reject our accounts at KYC because of an expired travel document. The practical alternative: register a US LLC + EIN via Stripe Atlas, after which Stripe goes live. That filing is in progress.",
    },
    p2: {
      de: "Bis dahin sind die Juni-26-Kohorte (€114) und der kostenlose Tarif die einzigen live verfügbaren Optionen. Die Monats- und Jahres-Standardtarife sind bereits auf der Preisseite sichtbar und nehmen Warteliste-Einträge entgegen — sobald Stripe live ist, benachrichtigen wir jede:n persönlich.",
      en: "Until then, the June 26 Cohort (€114) and the free tier are the only options live on the site. The monthly and annual standard tiers are already visible on pricing and accept waitlist sign-ups — when Stripe clears we personally notify everyone.",
    },
  },
  ref: {
    title: {
      de: "Wie laufen Empfehlungszahlungen?",
      en: "How do referral payouts work?",
    },
    intro: {
      de: "Jede:r Nutzer:in bekommt einen persönlichen Empfehlungscode. Sobald deine Empfehlung ein Abo abschließt, gehört eine abgestufte Auszahlung dir. Die Höhe hängt vom gebuchten Tarif ab:",
      en: "Every user gets a personal referral code. Once your referral signs up, you earn a tiered payout — the amount depends on which plan they choose:",
    },
    b1: {
      de: "30-Tage-Sperrfrist ab dem Datum, an dem die Zahlung der Empfehlung eingegangen ist — schützt vor Missbrauch mit Rückerstattungen.",
      en: "30-day hold from the date your referral's payment clears — protects against refund gaming.",
    },
    b2: {
      de: "Auszahlung per USDT (TRC-20/ERC-20) oder über Wise auf dein Bankkonto.",
      en: "Payouts via USDT (TRC-20/ERC-20) or via Wise to your bank account.",
    },
    b3: {
      de: "Jahresdeckel: €600 pro Kalenderjahr und Empfehlende:r.",
      en: "Annual cap: €600 per referrer per calendar year.",
    },
    b4: {
      de: "Nur die erste Zahlung deiner Empfehlung löst den Bonus aus — keine Wiederholungen bei Verlängerung.",
      en: "Only the referee's first paid subscription triggers the bonus — no repeat earnings on renewals.",
    },
    sepa: {
      de: "SEPA ist raus aus dem Programm. Wir haben das Modell aufs Wesentliche reduziert: Krypto oder Wise, beides ohne Schufa oder deutsche Bankkonten.",
      en: "SEPA is gone from the program. We've stripped it back to the essentials: crypto or Wise, neither requires a European bank account or Schufa.",
    },
  },
  free: {
    title: {
      de: "Was ist im kostenlosen Tarif enthalten?",
      en: "What's included in the free tier?",
    },
    intro: {
      de: "Der kostenlose Tarif gibt dir 150 Fragen pro Prüfungstyp — das sind 450 Fragen insgesamt über Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. Es gibt kein Ablaufdatum; du kannst die Fragen in deinem Tempo durcharbeiten.",
      en: "The free tier gives you 150 questions per exam type — 450 total across Kenntnisprüfung Wien, KMP Innsbruck and Pharmakologie. There's no expiry; you can work through them at your own pace.",
    },
    b1: {
      de: "Vollständige klinische Erklärungen auf allen 450 Fragen, gleiche Tiefe wie im Premium-Tarif.",
      en: "Full clinical explanations on all 450 questions — same depth as the paid tier.",
    },
    b2: {
      de: "Nur Qbank-Modus — keine Spaced Repetition, keine Prüfungssimulation, keine Lesezeichen, keine Notizen.",
      en: "Qbank-only — no spaced repetition, no mock exam, no bookmarks, no notes.",
    },
    b3: {
      de: "Keine geräteübergreifende Synchronisation über die aktuelle Sitzung hinaus.",
      en: "No cross-device sync beyond your current session.",
    },
    b4: {
      de: "Keine KI-Chat-Folgefragen (cached AI-Erklärungen sind trotzdem lesbar).",
      en: "No AI-chat follow-ups (cached AI explanations are still readable).",
    },
    upgrade: {
      de: "Sobald du bereit bist, kannst du jederzeit zur Juni-26-Kohorte oder zu einem der Standardtarife upgraden — dein Fortschritt und deine Antworten bleiben erhalten.",
      en: "Whenever you're ready, upgrade to the June 26 Cohort or a standard tier — your progress and answers carry over.",
    },
  },
  perExam: {
    title: {
      de: "Gibt es Tarife pro Prüfung?",
      en: "Is there per-exam pricing?",
    },
    p1: {
      de: "Nein — jeder bezahlte Tarif enthält alle drei Prüfungstypen: Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie. Wir haben uns gegen Pro-Prüfung-Tarife entschieden, weil die Vorbereitung für viele Kandidat:innen mehrere Prüfungstypen umfasst und die Fragebanken stark überlappen.",
      en: "No — every paid tier unlocks all three exam types: Kenntnisprüfung Wien, KMP Innsbruck and Pharmakologie. We skipped per-exam pricing because many candidates prepare for multiple exam types and the question banks overlap heavily.",
    },
    p2: {
      de: "Wenn du wirklich nur eine Prüfung vorbereitest, gibt dir der kostenlose Tarif 150 Fragen für genau diesen Prüfungstyp — oft ausreichend für einen ersten Einstieg.",
      en: "If you truly only prepare for one exam, the free tier gives you 150 questions specifically for that exam type — often enough for a first pass.",
    },
  },
  who: {
    title: {
      de: "Wer baut MedPrüf?",
      en: "Who builds MedPrüf?",
    },
    p1: {
      de: "Gebaut von Ärzt:innen, die selbst in deiner Lage waren. Wir haben die Kenntnisprüfung und die KMP selbst durchlaufen und wissen, wo die öffentlich verfügbaren Ressourcen versagen — verstreute Karteikarten, veraltete PDFs, keine österreichspezifische Abdeckung, keine Spaced Repetition. MedPrüf ist die Vorbereitungsplattform, die wir uns selbst gewünscht hätten. Jede Frage stammt aus einer dokumentierten offiziellen Prüfung (7.567 aus Wien seit 2016, 3.091 aus Innsbruck, 335 aus Pharmakologie) — nichts erfunden, nichts geraten.",
      en: "Built by doctors who've been in your position. We sat the Kenntnisprüfung and the KMP ourselves and know where the publicly available resources fall short — scattered flashcards, outdated PDFs, no Austria-specific coverage, no spaced repetition. MedPrüf is the prep platform we wished existed. Every question comes from a documented official exam (7,567 from Vienna since 2016, 3,091 from Innsbruck, 335 from Pharmakologie) — nothing invented, nothing guessed.",
    },
  },
};
