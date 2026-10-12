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
  Undo2,
  Mail,
} from "lucide-react";
import { getLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import SupportContactForm from "@/components/SupportContactForm";
import { BILLING_SUPPORT_EMAIL, REPORT_ACK_PROMISE, SUPPORT_REPLY_PROMISE, WHOP_MANAGE_URL } from "@/lib/billing-copy";
import {
  FAQ_ACTIVATION,
  FAQ_CONTACT,
  FAQ_FREE_UPGRADE,
  FAQ_PAYMENT_SAFE,
  FAQ_PUYP_WHY,
  FAQ_TITLES,
  faqCancelAfter,
  faqCancelHelp,
  faqCancelIntro,
  faqCancelSteps,
  faqFreeBullets,
  faqFreeIntro,
  faqPaymentCards,
  faqPaymentPlans,
  faqPaymentTrial,
  faqPerExam,
  faqPuypAnswer,
  faqPuypExamples,
  faqReferralAnswer,
  faqRefundAfter,
  faqRefundSteps,
  faqWho,
} from "./faq-copy";
import { resolveFaqAnchor } from "@/lib/faq-anchors";

type Lang = "de" | "en";

/* Sections that feed both the TOC and the main content.
   Keeping them in one array avoids drift between the two.
   Anchor ids are linked from other pages (/faq#cancellation, #refund,
   #payment, #puyp, #referrals, #kontakt): never rename them without a remap in src/lib/faq-anchors.ts (#crypto-only now lands on #payment, LX-27). */
type SectionDef = {
  id: string;
  icon: typeof Info;
  title: { de: string; en: string };
};
const SECTIONS: SectionDef[] = [
  { id: "cancellation", icon: CreditCard, title: FAQ_TITLES.cancellation },
  { id: "refund", icon: Undo2, title: FAQ_TITLES.refund },
  { id: "payment", icon: CreditCard, title: FAQ_TITLES.payment },
  { id: "puyp", icon: ShieldCheck, title: FAQ_TITLES.puyp },
  { id: "referrals", icon: Gift, title: FAQ_TITLES.referrals },
  { id: "free-tier", icon: BookOpen, title: FAQ_TITLES.free },
  { id: "per-exam", icon: Layers, title: FAQ_TITLES.perExam },
  { id: "credentials", icon: Users, title: FAQ_TITLES.who },
  { id: "kontakt", icon: Mail, title: FAQ_TITLES.contact },
];

const UI = {
  back: { de: "Zurück", en: "Back" },
  heading: { de: "Häufige Fragen", en: "FAQ" },
  hero: { de: "Häufig gestellte Fragen", en: "Frequently asked questions" },
  heroSub: {
    de: "Antworten zu Kündigung, Rückerstattung, Zahlung, Pass-Until-You-Pass, Empfehlungen und zum kostenlosen Tarif.",
    en: "Answers about cancelling, refunds, payment, Pass-Until-You-Pass, referrals and the free tier.",
  },
  toc: { de: "Inhaltsverzeichnis", en: "Table of contents" },
  onPage: { de: "Inhalt", en: "On this page" },
  manage: { de: "Abo verwalten und kündigen", en: "Manage and cancel membership" },
  manageNote: {
    de: "Öffnet Whop in einem neuen Tab. Die Whop-Seite ist auf Englisch.",
    en: "Opens Whop in a new tab. The Whop page is in English.",
  },
  safe: { de: "Sicher mit Karte zahlen.", en: "Paying by card safely." },
  cancelLink: { de: "So funktioniert die Kündigung: siehe „Wie kündige ich?“.", en: "How cancelling works: see \"How do I cancel?\"." },
  examples: { de: "Beispiele", en: "Examples" },
  myLink: { de: "Mein Empfehlungslink", en: "My referral link" },
} as const;

/**
 * /faq: Häufig gestellte Fragen
 *
 * Referenced from the pricing page, settings, the landing footer and the
 * exam pages. Sections are anchored so other pages can deep-link to
 * #cancellation, #refund, #payment, #puyp, #referrals and #kontakt
 * (the old #crypto-only anchor is remapped to #payment, LX-27).
 *
 * All answer text lives in ./faq-copy.ts, which also feeds the FAQPage
 * JSON-LD in layout.tsx, so the marked-up answers match the page.
 * Formal Sie (pick-copy-register B). MPDS v2 tokens and primitives.
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

  // Sections render after mount, so the browser's own hash jump finds
  // nothing. Scroll once the content exists, and send renamed anchors
  // (#crypto-only) to their current section (LX-27).
  useEffect(() => {
    if (!mounted) return;
    const target = resolveFaqAnchor(window.location.hash);
    if (!target) return;
    const el = document.getElementById(target);
    if (!el) return;
    if (`#${target}` !== window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${target}`);
    }
    el.scrollIntoView({ block: "start" });
  }, [mounted]);

  const switchLang = (l: Lang) => {
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
            className="flex items-center gap-1.5 min-h-11 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {UI.back[lang]}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)]">{UI.heading[lang]}</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Hero */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-10 pb-6 text-center">
          <h2 className="mp-h1 mb-3 leading-[1.1]">{UI.hero[lang]}</h2>
          <p className="mp-body text-[var(--mp-fg-muted)] max-w-xl mx-auto">{UI.heroSub[lang]}</p>
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
              className="flex items-center justify-between gap-3 px-4 py-3 min-h-11 cursor-pointer list-none text-sm font-semibold text-[var(--mp-fg)]"
              style={{ userSelect: "none" }}
            >
              <span>{UI.toc[lang]}</span>
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
                      className="flex items-center gap-2 px-3 py-2 min-h-11 rounded-lg text-sm text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)] transition-colors"
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

        {/* Main content: left rail TOC on desktop, single column on mobile */}
        <div className="max-w-5xl mx-auto px-4 lg:px-8 pb-16 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6 lg:gap-8">
          {/* Desktop sticky TOC */}
          <aside className="hidden lg:block" aria-label={UI.toc[lang]}>
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
                {UI.onPage[lang]}
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
            {/* Cancellation (UX-PUB-24) */}
            <FaqSection id="cancellation" title={FAQ_TITLES.cancellation[lang]}>
              <p>{faqCancelIntro(lang)}</p>
              <ol className="list-decimal pl-5 space-y-1.5 mt-3">
                {faqCancelSteps(lang).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3">{faqCancelAfter(lang)}</p>
              <a
                href={WHOP_MANAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mp-btn mp-btn--secondary min-h-11 mt-4 inline-flex items-center"
              >
                {UI.manage[lang]}
              </a>
              <p className="mt-2 text-sm">{UI.manageNote[lang]}</p>
              <p className="mt-3">{faqCancelHelp(lang)}</p>
            </FaqSection>

            {/* Refund (UX-PUB-24, pick-refund-route A) */}
            <FaqSection id="refund" title={FAQ_TITLES.refund[lang]}>
              <ol className="list-decimal pl-5 space-y-1.5">
                {faqRefundSteps(lang).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3">{faqRefundAfter(lang)}</p>
              <a
                href={`mailto:${BILLING_SUPPORT_EMAIL}`}
                className="mp-btn mp-btn--secondary min-h-11 mt-4 inline-flex items-center gap-1.5"
              >
                <Mail className="w-4 h-4" aria-hidden />
                {BILLING_SUPPORT_EMAIL}
              </a>
            </FaqSection>

            {/* Payment (LX-25, UX-PUB-28). Anchor id kept for old deep links. */}
            <FaqSection id="payment" title={FAQ_TITLES.payment[lang]}>
              <p>{faqPaymentCards(lang)}</p>
              <p className="mt-3">{faqPaymentPlans(lang)}</p>
              <p className="mt-3">{faqPaymentTrial(lang)}</p>
              <p className="mt-3">{FAQ_ACTIVATION[lang]}</p>
              <p className="mt-3">
                <a href="#cancellation" className="underline inline-flex min-h-11 items-center">
                  {UI.cancelLink[lang]}
                </a>
              </p>

              <Callout variant="info" lang={lang}>
                <strong className="text-[var(--mp-fg)]">{UI.safe[lang]}</strong>{" "}
                {FAQ_PAYMENT_SAFE[lang]}
              </Callout>
            </FaqSection>

            {/* PUYP (UX-PUB-23): one definition from puyp-copy */}
            <FaqSection id="puyp" title={FAQ_TITLES.puyp[lang]}>
              <p>{faqPuypAnswer(lang)}</p>
              <p className="mt-3 font-semibold text-[var(--mp-fg)]">{UI.examples[lang]}</p>
              <ul className="list-disc pl-5 space-y-1.5 mt-1">
                {faqPuypExamples(lang).map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>

              <details
                className="mt-4 rounded-lg group"
                style={{
                  background: "var(--mp-surface-sunken)",
                  border: "1px solid var(--mp-border-subtle)",
                }}
              >
                <summary
                  className="px-4 py-3 min-h-11 cursor-pointer list-none flex items-center justify-between gap-2 text-sm font-semibold text-[var(--mp-fg)]"
                  style={{ userSelect: "none" }}
                >
                  {FAQ_PUYP_WHY.q[lang]}
                  <ChevronDown
                    className="w-4 h-4 text-[var(--mp-viridian)] transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="px-4 pb-4 text-sm leading-relaxed text-[var(--mp-fg-muted)]">
                  {FAQ_PUYP_WHY.a[lang]}
                </div>
              </details>

              <BackToPricing lang={lang} anchor="cohort" />
            </FaqSection>

            {/* Referrals (UX-ACC-50): one reward sentence from referral-copy */}
            <FaqSection id="referrals" title={FAQ_TITLES.referrals[lang]}>
              <p>{faqReferralAnswer(lang)}</p>
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/referrals"
                  className="mp-btn mp-btn--secondary min-h-11 inline-flex items-center gap-1.5"
                >
                  {UI.myLink[lang]}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <BackToPricing lang={lang} inline />
              </div>
            </FaqSection>

            {/* Free tier */}
            <FaqSection id="free-tier" title={FAQ_TITLES.free[lang]}>
              <p>{faqFreeIntro(lang)}</p>
              <ul className="list-disc pl-5 space-y-1.5 mt-3">
                {faqFreeBullets(lang).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="mt-3">{FAQ_FREE_UPGRADE[lang]}</p>
            </FaqSection>

            {/* Per-exam */}
            <FaqSection id="per-exam" title={FAQ_TITLES.perExam[lang]}>
              {faqPerExam(lang).map((para, i) => (
                <p key={para} className={i > 0 ? "mt-3" : undefined}>
                  {para}
                </p>
              ))}
            </FaqSection>

            {/* Founder (TR-15): one statement from COMPANY */}
            <FaqSection id="credentials" title={FAQ_TITLES.who[lang]}>
              <p>{faqWho(lang)}</p>
            </FaqSection>

            {/* Contact (UX-PUB-28, LX-31) */}
            <div id="kontakt" className="space-y-4 scroll-mt-24">
              <div
                className="rounded-[var(--mp-r-card)] p-6 md:p-7 text-center"
                style={{
                  background: "var(--mp-surface-raised)",
                  border: "1px solid var(--mp-border-subtle)",
                }}
              >
                <h3 className="mp-h3 mb-2">{FAQ_CONTACT.title[lang]}</h3>
                <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm">
                  {SUPPORT_REPLY_PROMISE[lang]} {REPORT_ACK_PROMISE[lang]}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
                  <a
                    href={`mailto:${BILLING_SUPPORT_EMAIL}`}
                    className="mp-btn mp-btn--primary min-h-11 inline-flex items-center gap-1.5"
                  >
                    {FAQ_CONTACT.mail[lang]}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                  <Link
                    href="/pricing"
                    className="mp-btn mp-btn--secondary min-h-11 inline-flex items-center gap-1.5"
                  >
                    {FAQ_CONTACT.pricing[lang]}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
              <SupportContactForm lang={lang} />
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
 * audit: concrete payout amounts stripped from the FAQ; the authoritative
 * reward rule lives in src/lib/referral-copy.ts). */
