"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Info,
  ShieldCheck,
  Gift,
  CreditCard,
  BookOpen,
  Layers,
  Users,
} from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

type Lang = "de" | "en";

/* Sections that feed both the TOC and the main content.
   Keeping them in one array avoids drift between the two. */
type SectionDef = {
  id: string;
  icon: typeof Info;
  title: { de: string; en: string };
};
const SECTIONS: SectionDef[] = [
  {
    id: "puyp",
    icon: ShieldCheck,
    title: {
      de: "Pass-Until-You-Pass, wie funktioniert das?",
      en: "Pass-Until-You-Pass, how it works",
    },
  },
  {
    id: "crypto-only",
    icon: CreditCard,
    title: {
      de: "Wie bezahle ich?",
      en: "How do I pay?",
    },
  },
  {
    id: "referrals",
    icon: Gift,
    title: {
      de: "Wie laufen Empfehlungszahlungen?",
      en: "How do referral payouts work?",
    },
  },
  {
    id: "free-tier",
    icon: BookOpen,
    title: {
      de: "Was ist im kostenlosen Tarif enthalten?",
      en: "What's in the free tier?",
    },
  },
  {
    id: "per-exam",
    icon: Layers,
    title: {
      de: "Gibt es Tarife pro Prüfung?",
      en: "Is there per-exam pricing?",
    },
  },
  {
    id: "credentials",
    icon: Users,
    title: {
      de: "Wer baut MedPrüf?",
      en: "Who builds MedPrüf?",
    },
  },
];

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
    <AppLayout
      sidebar={<Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />}
      bottomNav={<BottomNav lang={lang} userId={user?.id} />}
    >
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
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-10 pb-6 text-center">
          <h2 className="mp-h1 mb-3 leading-[1.1]">
            {lang === "de" ? "Häufig gestellte Fragen" : "Frequently asked questions"}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] max-w-xl mx-auto">
            {lang === "de"
              ? "Antworten auf die wichtigsten Fragen zum kostenlosen Tarif, zur Prüfungs-Kohorte, zu Pass-Until-You-Pass und zum Empfehlungsprogramm."
              : "Answers to the key questions about the free tier, the Exam Cohort, Pass-Until-You-Pass, and the referral program."}
          </p>
        </section>

        {/* Mobile TOC (collapsible details) */}
        <section className="lg:hidden max-w-3xl mx-auto px-4 pb-6">
          <details
            className="rounded-[var(--mp-r-card)] group"
            style={{
              background: "var(--mp-surface-raised)",
              border: "1px solid var(--mp-border-subtle)",
            }}
          >
            <summary
              className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none text-sm font-semibold text-[var(--mp-fg)]"
              style={{ userSelect: "none" }}
            >
              <span>
                {lang === "de" ? "Inhaltsverzeichnis" : "Table of contents"}
              </span>
              <ChevronDown
                className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)] transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <ul className="px-2 pb-3 space-y-0.5">
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)] transition-colors"
                    >
                      <Icon
                        className="w-3.5 h-3.5 text-[var(--mp-viridian)] flex-shrink-0"
                        aria-hidden
                      />
                      <span>{s.title[lang]}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </details>
        </section>

        {/* Main content — left rail TOC on desktop, single column on mobile */}
        <div className="max-w-5xl mx-auto px-4 lg:px-8 pb-16 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6 lg:gap-8">
          {/* Desktop sticky TOC */}
          <aside
            className="hidden lg:block"
            aria-label={lang === "de" ? "Inhaltsverzeichnis" : "Table of contents"}
          >
            <nav
              className="sticky top-6 rounded-[var(--mp-r-card)] p-3"
              style={{
                background: "var(--mp-surface-raised)",
                border: "1px solid var(--mp-border-subtle)",
              }}
            >
              <p
                className="px-3 pt-1 pb-2 font-bold text-[var(--mp-fg-subtle)]"
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                {lang === "de" ? "Inhalt" : "On this page"}
              </p>
              <ul className="space-y-0.5">
                {SECTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="flex items-start gap-2 px-3 py-2 rounded-lg text-[13px] leading-snug text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)] transition-colors"
                      >
                        <Icon
                          className="w-3.5 h-3.5 mt-0.5 text-[var(--mp-viridian)] flex-shrink-0"
                          aria-hidden
                        />
                        <span>{s.title[lang]}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          {/* Main sections */}
          <div className="space-y-6 min-w-0">
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

              <Callout variant="info" lang={lang}>
                <strong className="text-[var(--mp-fg)]">
                  {lang === "de"
                    ? "Wichtig: maximal zwei zusätzliche Zyklen."
                    : "Important: up to two additional cycles."}
                </strong>{" "}
                {copy.puyp.scope[lang]}
              </Callout>

              <details
                className="mt-4 rounded-lg group"
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
                    ? "Warum gibt es bei PUYP eine Verlängerung statt Geld zurück?"
                    : "Why does PUYP extend access instead of refunding?"}
                  <ChevronDown
                    className="w-4 h-4 text-[var(--mp-viridian)] transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="px-4 pb-4 text-sm leading-relaxed text-[var(--mp-fg-muted)]">
                  {copy.puyp.noRefund[lang]}
                </div>
              </details>

              <BackToPricing lang={lang} anchor="cohort" />
            </FaqSection>

            {/* Crypto only */}
            <FaqSection id="crypto-only" title={copy.crypto.title[lang]}>
              <p>{copy.crypto.p1[lang]}</p>
              <p className="mt-3">{copy.crypto.p2[lang]}</p>

              <Callout variant="info" lang={lang}>
                <strong className="text-[var(--mp-fg)]">
                  {lang === "de" ? "Sicher mit Karte zahlen." : "Paying by card safely."}
                </strong>{" "}
                {lang === "de"
                  ? "Der Checkout läuft über Whop mit verschlüsselter Kartenzahlung. Wir speichern keine Kartendaten. Visa, Mastercard und Apple Pay werden akzeptiert, bestätigt in Sekunden."
                  : "Checkout runs through Whop with encrypted card payment. We never store your card details. Visa, Mastercard and Apple Pay accepted, confirmed in seconds."}
              </Callout>
            </FaqSection>

            {/* Referrals */}
            <FaqSection id="referrals" title={copy.ref.title[lang]}>
              <p>{copy.ref.intro[lang]}</p>
              <ul className="list-disc pl-5 space-y-1.5 mt-4">
                <li>{copy.ref.b1[lang]}</li>
                <li>{copy.ref.b1b[lang]}</li>
                <li>{copy.ref.b2[lang]}</li>
              </ul>

              <Callout variant="neutral" lang={lang}>
                {copy.ref.b3[lang]}
              </Callout>

              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/referrals"
                  className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5"
                >
                  {lang === "de"
                    ? "Mein Empfehlungslink"
                    : "My referral link"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <BackToPricing lang={lang} inline />
              </div>
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
          </div>
        </div>
      </main>
    </AppLayout>
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

/**
 * Callout — a soft inline notice for critical info ("max 2 cycles",
 * "no SEPA", etc.). Two variants:
 *   - info    → viridian tint, use for rules/constraints
 *   - neutral → surface-sunken, use for softer caveats
 */
function Callout({
  variant = "info",
  lang: _lang,
  children,
}: {
  variant?: "info" | "neutral";
  lang: Lang;
  children: React.ReactNode;
}) {
  const styles =
    variant === "info"
      ? {
          background: "var(--mp-success-bg)",
          borderColor: "rgba(0,123,95,0.25)",
          iconColor: "var(--mp-viridian)",
        }
      : {
          background: "var(--mp-surface-sunken)",
          borderColor: "var(--mp-border-subtle)",
          iconColor: "var(--mp-fg-subtle)",
        };
  return (
    <div
      className="mt-4 rounded-lg p-3 md:p-4 flex items-start gap-3 text-sm leading-relaxed"
      style={{
        background: styles.background,
        border: `1px solid ${styles.borderColor}`,
      }}
      role="note"
    >
      <Info
        className="w-4 h-4 flex-shrink-0 mt-0.5"
        style={{ color: styles.iconColor }}
        aria-hidden
      />
      <div className="text-[var(--mp-fg-muted)] min-w-0">{children}</div>
    </div>
  );
}

/**
 * BackToPricing — small inline CTA that links back to /pricing (optionally
 * to a specific anchor on that page). Used at the end of high-conversion
 * FAQ answers where the reader may be ready to act.
 */
function BackToPricing({
  lang,
  anchor,
  inline = false,
}: {
  lang: Lang;
  anchor?: string;
  inline?: boolean;
}) {
  const href = anchor ? `/pricing#${anchor}` : "/pricing";
  if (inline) {
    return (
      <Link
        href={href}
        className="mp-btn mp-btn--primary inline-flex items-center gap-1.5"
      >
        {lang === "de" ? "Zur Preisseite" : "Back to pricing"}
        <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    );
  }
  return (
    <div className="mt-5 pt-4 border-t border-[var(--mp-border-subtle)]">
      <Link
        href={href}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--mp-viridian)] rounded"
      >
        {lang === "de"
          ? "Zur Preisseite und Tarif wählen"
          : "Back to pricing and pick a plan"}
        <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </div>
  );
}

/* PayoutPill was removed 2026-04-23 (post-soft-launch §1.4.9 trust
 * audit — concrete payout amounts stripped from the FAQ; the authoritative
 * tier table lives on /referrals). */

/* ═══════════════════════ Copy ═══════════════════════ */

const copy = {
  puyp: {
    title: {
      de: "Wie funktioniert „Beim ersten Versuch bestehen, oder kostenlos weiterlernen\"?",
      en: "How does \"Pass first try, or study free until you do\" work?",
    },
    intro: {
      de: "Die Pass-Until-You-Pass-Garantie (PUYP) gilt für die Prüfungs-Kohorte. Statt einer Cash-Rückerstattung verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin, wenn du durchfällst.",
      en: "The Pass-Until-You-Pass guarantee (PUYP) applies to the Exam Cohort. Instead of a cash refund, we extend your access free through the next exam date if you fail.",
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
      de: "PUYP gilt für die Prüfungs-Kohorte (129 €). Der 3-Monats-Einstieg (49 €) und der Einzelmonat (19 €) enthalten die Garantie nicht.",
      en: "PUYP applies to the Exam Cohort (129 €). The 3-month starter (49 €) and the single-month tier (19 €) don't include the guarantee.",
    },
    noRefund: {
      de: "Die PUYP-Verlängerung gilt, wenn du die Bedingungen der Prüfungs-Kohorte erfüllst und beim ersten Versuch nicht bestehst. Sie ist eine zusätzliche Leistung und ersetzt nicht dein Recht, innerhalb von 7 Tagen nach dem Kauf eine Rückerstattung zu beantragen. Nach Ablauf dieser 7 Tage verlängert PUYP den Zugang statt den Kaufpreis zurückzuzahlen.",
      en: "The PUYP extension applies if you meet the Exam Cohort conditions and do not pass your first attempt. It is an additional benefit and does not replace your right to request a refund within 7 days of purchase. After that 7-day period, PUYP extends access instead of refunding the purchase price.",
    },
  },
  crypto: {
    title: {
      de: "Wie kann ich bezahlen?",
      en: "How can I pay?",
    },
    p1: {
      de: "Du zahlst sicher mit Karte (Visa, Mastercard, auch Apple Pay). Der Checkout läuft über Whop, unseren Zahlungsabwickler. Nach der Zahlung wird dein Vollzugang automatisch freigeschaltet, meist innerhalb einer Minute.",
      en: "You pay securely by card (Visa, Mastercard, Apple Pay too). Checkout runs through Whop, our payment processor. After payment, your full access unlocks automatically, usually within a minute.",
    },
    p2: {
      de: "Verfügbar sind die Prüfungs-Kohorte (129 € einmalig für 6 Monate), der 3-Monats-Tarif (49 € pro Quartal) und der Einzelmonat (19 € pro Monat). Der Einzelmonat verlängert sich monatlich und der 3-Monats-Tarif quartalsweise automatisch, sofern du nicht vorher kündigst. Die Prüfungs-Kohorte verlängert sich nicht automatisch. Die kostenlose Version umfasst bis zu 150 Fragen pro Prüfungstyp.",
      en: "Available plans are the Exam Cohort (129 € once for 6 months), the 3-Month plan (49 € per quarter), and the Single Month plan (19 € per month). The Single Month renews monthly and the 3-Month plan quarterly unless you cancel before renewal. The Exam Cohort does not auto-renew. The free tier includes up to 150 questions per exam type.",
    },
  },
  ref: {
    title: {
      de: "Wie funktioniert das Empfehlungsprogramm?",
      en: "How does the referral program work?",
    },
    intro: {
      de: "Das Empfehlungsprogramm ist nur für eingeladene und freigeschaltete Konten verfügbar. Wenn du freigeschaltet bist, kannst du zwei Kolleg:innen einladen. Sobald beide die Teilnahmebedingungen erfüllen, erhältst du Pro kostenlos bis zum nächsten Prüfungsfenster. Für dich als Empfehlenden ist das kostenlos:",
      en: "The referral program is available only to invited, enabled accounts. If you are enabled, you can invite two colleagues. Once both meet the eligibility requirements, you receive Pro free through your next exam window. There is no charge to you as the referrer:",
    },
    b1: {
      de: "Eine Empfehlung qualifiziert sich erst, wenn diese Person den kostenlosen Pro-Trial startet: Karte hinterlegt, 0 € heute, jederzeit in der Testwoche kündbar, danach 19 €/Monat.",
      en: "A referral only qualifies once that person starts the free Pro trial: card on file, 0 € today, cancel anytime during the trial week, then 19 €/month.",
    },
    b1b: {
      de: "Zusätzlich muss diese Person mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantworten.",
      en: "That person must also answer at least 20 different questions across at least 2 different days.",
    },
    b2: {
      de: "Nach der zweiten qualifizierten Empfehlung prüft unser Team kurz und schaltet Pro für dich frei, kostenlos bis zum Ende deines Prüfungsfensters (Prüfungstermin plus 14 Tage Puffer).",
      en: "After your second qualified referral, our team does a quick review and unlocks Pro for you, free through the end of your exam window (exam date plus a 14-day buffer).",
    },
    b3: {
      de: "Der frühere Bar-Auszahlungsplan ist für neue Empfehlungen pausiert. Diese Version zahlt in Pro-Zugang, nicht in Geld.",
      en: "The earlier cash-payout plan is paused for new referrals. This version pays in Pro access, not money.",
    },
  },
  free: {
    title: {
      de: "Was ist im kostenlosen Tarif enthalten?",
      en: "What's included in the free tier?",
    },
    intro: {
      de: "Der kostenlose Tarif umfasst bis zu 150 Fragen pro Prüfungstyp, insgesamt bis zu 450 über Kenntnisprüfung Wien, Stichprobentest (Innsbruck) und Pharmakologie. Er läuft nicht ab. Deine gespeicherten Antworten und dein Themenfortschritt werden mit deinem Konto synchronisiert.",
      en: "The free tier includes up to 150 questions per exam type, up to 450 across Kenntnisprüfung Wien, Stichprobentest (Innsbruck) and Pharmakologie. It does not expire. Your saved answers and topic progress sync with your account.",
    },
    b1: {
      de: "Vorhandene klinische Erklärungen sind enthalten. Eine neue KI-Erklärung oder KI-Chat-Folgefrage kannst du mit einem bezahlten Tarif anfordern; gespeicherte Erklärungen bleiben lesbar.",
      en: "Existing clinical explanations are included. Requesting a new AI explanation or an AI chat follow-up requires a paid plan; saved explanations remain readable.",
    },
    b2: {
      de: "Weitere Werkzeuge wie Wiederholungsplanung, Prüfungssimulation, Lesezeichen und Notizen können je nach Tarif eingeschränkt sein. Die App zeigt die jeweilige Freischaltung direkt am Werkzeug an.",
      en: "Additional tools such as spaced repetition, exam simulation, bookmarks and notes may be plan-limited. The app shows the access requirement beside each tool.",
    },
    b3: {
      de: "Offline heruntergeladene Fragen benötigen eine Internetverbindung, um Antworten und Fortschritt mit deinem Konto abzugleichen.",
      en: "Downloaded offline questions need an internet connection to sync answers and progress with your account.",
    },
    b4: {
      de: "Neue KI-Erklärungen und KI-Chat-Folgefragen sind bezahlten Tarifen vorbehalten; bereits gespeicherte Erklärungen bleiben lesbar.",
      en: "New AI explanations and AI chat follow-ups are reserved for paid plans; explanations already saved remain readable.",
    },
    upgrade: {
      de: "Sobald du bereit bist, kannst du jederzeit zur Prüfungs-Kohorte oder zu einem der Standardtarife upgraden, dein Fortschritt und deine Antworten bleiben erhalten.",
      en: "Whenever you're ready, upgrade to the Exam Cohort or a standard tier, your progress and answers carry over.",
    },
  },
  perExam: {
    title: {
      de: "Gibt es Tarife pro Prüfung?",
      en: "Is there per-exam pricing?",
    },
    p1: {
      de: "Nein, jeder bezahlte Tarif enthält alle drei Prüfungstypen: Kenntnisprüfung Wien, Stichprobentest (Innsbruck) und Pharmakologie. Wir haben uns gegen Pro-Prüfung-Tarife entschieden, weil die Vorbereitung für viele Kandidat:innen mehrere Prüfungstypen umfasst und die Fragebanken stark überlappen.",
      en: "No, every paid tier unlocks all three exam types: Kenntnisprüfung Wien, Stichprobentest (Innsbruck) and Pharmakologie. We skipped per-exam pricing because many candidates prepare for multiple exam types and the question banks overlap heavily.",
    },
    p2: {
      de: "Wenn du wirklich nur eine Prüfung vorbereitest, gibt dir der kostenlose Tarif 150 Fragen für genau diesen Prüfungstyp, oft ausreichend für einen ersten Einstieg.",
      en: "If you truly only prepare for one exam, the free tier gives you 150 questions specifically for that exam type, often enough for a first pass.",
    },
  },
  who: {
    title: {
      de: "Wer baut MedPrüf?",
      en: "Who builds MedPrüf?",
    },
    p1: {
      de: "MedPrüf wird von [name] ([name], Österreich) entwickelt. Die drei Fragenbanken haben unterschiedliche Quellen und Formate: Die Kenntnisprüfung-Bank enthält Anki-basierte Multiple-Choice-Übungsfragen, die Stichprobentest-Bank curriculum-basierte Übungsfragen, und die Pharmakologie-Bank Lernfragen zur Pharmakologie und Rezeptierkunde. Sie sind keine offiziellen oder rekonstruierten Prüfungsfragen. Die reale Kenntnisprüfung verwendet offene Kurzantwortfragen.",
      en: "MedPrüf is built by [name] ([name], Austria). The three question banks use different sources and formats: the Kenntnisprüfung bank contains Anki-based multiple-choice practice questions, the Stichprobentest bank contains curriculum-based practice questions, and the Pharmakologie bank contains pharmacology and prescribing study questions. They are not official or reconstructed exam questions. The real Kenntnisprüfung uses open short-answer questions.",
    },
  },
};
