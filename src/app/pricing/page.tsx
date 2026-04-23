"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Sparkles,
  ChevronDown,
  Bitcoin,
  Lock,
  ShieldCheck,
  Gift,
} from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { authFetch as fetch } from "@/lib/authFetch";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import {
  Dialog,
  TextField,
  Select,
  useToast,
  BrandedLoader,
} from "@/components/ui";

type Lang = "de" | "en";
/**
 * Standard Stripe-pending tiers. `premium_pass_guaranteed` (the June 26
 * Cohort) is intentionally NOT in this union — it has its own live
 * crypto checkout and never opens the waitlist dialog.
 *
 * Wire-level tier_interest values sent to /api/waitlist stay as the
 * legacy strings (`'monthly' | '3mo' | '6mo' | '12mo'`) because
 * `/api/waitlist` whitelists those exact values. Don't rename without
 * also updating the waitlist route.
 */
type StandardTier = "monthly" | "3mo" | "6mo" | "12mo";
type ExamType = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

/**
 * /pricing — April 23 2026 positioning update.
 *
 * Six April 23 locks applied here:
 *   1. Pass-Until-You-Pass guarantee badge on the Cohort + 12mo cards,
 *      one PUYP explainer block before the FAQ.
 *   2. Free tier card — 150 Qs × 3 exams, Qbank-only, no expiry.
 *   3. Tiered referral payouts — €25 / €50 / €75 (monthly+3mo / 6mo+12mo
 *      / Cohort), 30-day hold, €600/year cap, USDT or Wise.
 *   4. Positioning — "Pass first try — or study free until you do." No
 *      "Founders'" string anywhere — replaced with "June 26 Cohort".
 *   5. All-access bundle — every paid tier unlocks all 3 exam types.
 *   6. Drop Founders' branding — this file is wholesale-rewritten.
 *
 * Data flow:
 *   - Cohort CTA → POST /api/checkout/nowpayments {tier:'premium_pass_guaranteed'}
 *     → NOWPayments hosted invoice → /dashboard?welcome=cohort
 *   - Standard-tier CTAs → waitlist dialog → POST /api/waitlist with
 *     `tier_interest` set to the legacy string.
 *   - Free tier CTA → /quiz?free=1 (the free-tier gate lives in
 *     /api/questions — a separate agent owns that work).
 */
export default function PricingPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);

  // Crypto checkout state
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Waitlist dialog state
  const [waitOpen, setWaitOpen] = useState(false);
  const [waitTier, setWaitTier] = useState<StandardTier>("monthly");
  const [email, setEmail] = useState("");
  const [examType, setExamType] = useState<ExamType>("kenntnispruefung");
  const [examDate, setExamDate] = useState("");
  const [emailErr, setEmailErr] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setLangState(getLang());
    const s = getStoredSession();
    setSession(s);
    if (s?.user?.email) setEmail(s.user.email);
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const openWaitlist = (tier: StandardTier) => {
    setWaitTier(tier);
    setEmailErr(undefined);
    setWaitOpen(true);
  };

  /**
   * June 26 Cohort crypto checkout. Logged-in users hit the NOWPayments
   * endpoint directly; logged-out users get bounced to /login with a
   * `next` + `action` hint so the post-login redirect lands them back
   * here and auto-triggers the checkout.
   */
  const startCohortCheckout = async () => {
    if (!session?.user) {
      const next = encodeURIComponent("/pricing?action=cohort-checkout");
      window.location.href = `/login?next=${next}&action=cohort-checkout`;
      return;
    }
    setCheckoutLoading(true);
    try {
      const r = await fetch("/api/checkout/nowpayments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: "premium_pass_guaranteed" }),
      });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data?.invoice_url) {
          window.location.href = data.invoice_url;
          return;
        }
        toast.error(
          lang === "de" ? "Checkout fehlgeschlagen" : "Checkout failed",
          lang === "de"
            ? "Keine Rechnungs-URL erhalten."
            : "No invoice URL received."
        );
      } else if (r.status === 404) {
        toast.info(
          lang === "de" ? "Kurz noch Geduld" : "Almost ready",
          lang === "de"
            ? "Der Krypto-Checkout geht gleich live. Schreib an user-b7e46e80@example.com."
            : "Crypto checkout launches in a moment. Email user-b7e46e80@example.com."
        );
      } else {
        const msg = await r.text().catch(() => "");
        toast.error(
          lang === "de" ? "Checkout fehlgeschlagen" : "Checkout failed",
          msg.slice(0, 120) ||
            (lang === "de"
              ? "Bitte später erneut versuchen."
              : "Please try again later.")
        );
      }
    } catch {
      toast.error(
        lang === "de" ? "Netzwerkfehler" : "Network error",
        lang === "de" ? "Keine Verbindung zum Server." : "No connection to server."
      );
    }
    setCheckoutLoading(false);
  };

  const submitWaitlist = async () => {
    const e = email.trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setEmailErr(
        lang === "de" ? "Bitte gültige E-Mail eingeben." : "Please enter a valid email."
      );
      return;
    }
    setEmailErr(undefined);
    setSubmitting(true);
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: e,
          tier_interest: waitTier,
          exam_type: examType,
          exam_date: examDate || undefined,
          source: "stripe_pending",
        }),
      });
      if (r.ok) {
        toast.success(
          lang === "de"
            ? "Sie stehen auf der Warteliste."
            : "You're on the waitlist.",
          lang === "de"
            ? "Wir melden uns, sobald Stripe live ist."
            : "We'll notify you when Stripe goes live."
        );
        setWaitOpen(false);
      } else if (r.status === 409) {
        toast.info(
          lang === "de"
            ? "Bereits eingetragen"
            : "Already on the waitlist",
          lang === "de"
            ? "Sie sind bereits auf der Warteliste — wir halten Sie auf dem Laufenden."
            : "You're already on the waitlist — we'll keep you posted."
        );
        setWaitOpen(false);
      } else {
        toast.error(
          lang === "de" ? "Konnte nicht eintragen" : "Could not sign up",
          lang === "de"
            ? "Bitte versuche es später nochmal."
            : "Please try again later."
        );
      }
    } catch {
      toast.error(
        lang === "de" ? "Netzwerkfehler" : "Network error",
        lang === "de" ? "Keine Verbindung zum Server." : "No connection to server."
      );
    }
    setSubmitting(false);
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  const user = session?.user;

  /* Cohort feature bullets — the dominant card */
  const cohortFeatures: Array<{ de: string; en: string }> = [
    {
      de: "Alle 10.993 Fragen · Kenntnisprüfung + KMP + Pharma in einem Abo",
      en: "All 10,993 questions · Kenntnisprüfung + KMP + Pharma bundled",
    },
    {
      de: "Pass-Until-You-Pass: fällst du durch, verlängern wir kostenlos",
      en: "Pass-Until-You-Pass: fail the exam, we extend your access free",
    },
    {
      de: "Klinische KI-Erklärungen in 7 Sprachen (unbegrenzt)",
      en: "Clinical AI explanations in 7 languages (unlimited)",
    },
    {
      de: "Persönlicher Lernplan bis zum Prüfungsdatum",
      en: "Personal study plan up to your exam date",
    },
    {
      de: "Spaced-Repetition-Algorithmus (SM-2) + Prüfungssimulation",
      en: "Spaced-repetition algorithm (SM-2) + exam simulation",
    },
    {
      de: "Offline-Modus, Schnellsuche (Cmd+K), Streak Freeze",
      en: "Offline mode, quick search (Cmd+K), streak freeze",
    },
    {
      de: "Gültig 6 Monate ab Zahlung — deine gesamte Prüfungsvorbereitung",
      en: "Valid 6 months from payment — your entire exam prep window",
    },
  ];

  /**
   * Standard Stripe-pending tiers — slim rows under the Cohort card.
   *
   * Ordered by ICP priority (6mo = "Core Prep" in the launch brief,
   * the standard cohort length; 3mo = Final Sprint; 12mo carries PUYP;
   * monthly is the indecisive fallback). On mobile the user scans the
   * list top-to-bottom so we lead with 6mo rather than monthly.
   */
  const standardTiers: Array<{
    id: StandardTier;
    price: string;
    cadence: { de: string; en: string };
    desc: { de: string; en: string };
    puyp?: boolean;
    popular?: boolean;
  }> = [
    {
      id: "6mo",
      price: "€149",
      cadence: { de: "für 6 Monate", en: "for 6 months" },
      desc: {
        de: "Die Standard-Prüfungsphase — 6 Monate Vollzugang, alle 3 Prüfungstypen.",
        en: "Standard prep window — 6 months of full access, all 3 exam types.",
      },
      popular: true,
    },
    {
      id: "3mo",
      price: "€79",
      cadence: { de: "für 3 Monate", en: "for 3 months" },
      desc: {
        de: "Endspurt vor der Prüfung. Vollzugang zu allen 3 Prüfungstypen.",
        en: "Final sprint before exam day. All-access across all 3 exam types.",
      },
    },
    {
      id: "12mo",
      price: "€229",
      cadence: { de: "für 12 Monate", en: "for 12 months" },
      desc: {
        de: "Maximaler Puffer · inkl. Pass-Until-You-Pass-Garantie.",
        en: "Maximum buffer · includes Pass-Until-You-Pass guarantee.",
      },
      puyp: true,
    },
    {
      id: "monthly",
      price: "€29",
      cadence: { de: "/ Monat", en: "/ month" },
      desc: {
        de: "Monatlich — kürzester Zugang, jederzeit kündbar, alle 3 Prüfungen.",
        en: "Month-to-month — shortest commitment, cancel any time, all 3 exams.",
      },
    },
  ];

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* ══════════ Header ══════════ */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
          <Link
            href={user ? "/" : "/landing"}
            className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)] flex items-center gap-2">
            <Crown className="w-4 h-4 text-[var(--mp-viridian)]" />
            {lang === "de" ? "Preise" : "Pricing"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* ══════════ Hero ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-12 pb-6 text-center">
          <span className="mp-caption inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--mp-success-bg)] text-[var(--mp-viridian)] mb-5 normal-case tracking-[0.08em]">
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "de"
              ? "Juni-26-Kohorte — Plätze offen"
              : "June 26 Cohort — seats open"}
          </span>
          <h2 className="mp-h1 mb-4 leading-[1.05]">
            {lang === "de"
              ? "Beim ersten Versuch bestehen — oder kostenlos weiterlernen, bis du es schaffst."
              : "Pass first try — or study free until you do."}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] max-w-2xl mx-auto">
            {lang === "de"
              ? "Die einzige Prüfungsvorbereitung, die speziell für die österreichische Kenntnisprüfung, KMP und Pharmakologie gebaut wurde. Gebaut von Ärzt:innen, die selbst in deiner Lage waren."
              : "The only exam prep built specifically for Austria's Kenntnisprüfung, KMP & Pharmakologie. Built by doctors who've been in your position."}
          </p>
        </section>

        {/* ══════════ Free tier card ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
          <FreeTierCard lang={lang} />
        </section>

        {/* ══════════ Cohort featured card ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-6">
          <CohortFeaturedCard
            lang={lang}
            features={cohortFeatures}
            onCheckout={startCohortCheckout}
            loading={checkoutLoading}
          />
        </section>

        {/* ══════════ Standard Stripe-pending tiers ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10 mt-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-[var(--mp-border)]" />
            <span className="mp-caption text-[var(--mp-fg-subtle)] normal-case tracking-[0.12em] text-[11px]">
              {lang === "de" ? "Standardtarife · alle Prüfungen enthalten" : "Standard tiers · all exams included"}
            </span>
            <div className="h-px flex-1 bg-[var(--mp-border)]" />
          </div>

          <div className="space-y-3">
            {standardTiers.map((tier) => (
              <StandardTierRow
                key={tier.id}
                lang={lang}
                tier={tier}
                onWaitlist={() => openWaitlist(tier.id)}
              />
            ))}
          </div>

          {/* Fine print */}
          <p className="text-center mp-small text-[var(--mp-fg-subtle)] mt-8">
            {lang === "de"
              ? "Preise in Euro, inkl. österreichischer USt. wo anwendbar. Jeder bezahlte Tarif enthält alle drei Prüfungstypen. Keine versteckten Gebühren."
              : "Prices in Euro, incl. Austrian VAT where applicable. Every paid tier includes all three exam types. No hidden fees."}
          </p>
        </section>

        {/* ══════════ Referral block ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10">
          <ReferralBlock lang={lang} />
        </section>

        {/* ══════════ PUYP block ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10">
          <PuypBlock lang={lang} />
        </section>

        {/* ══════════ FAQ preview ══════════ */}
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-12">
          <h3 className="mp-h2 mb-5 text-center">
            {lang === "de" ? "Häufige Fragen" : "Common questions"}
          </h3>
          <div className="space-y-3">
            <FAQItem
              q={
                lang === "de"
                  ? "Wie funktioniert „Beim ersten Versuch bestehen — oder kostenlos weiterlernen\"?"
                  : "How does \"Pass first try — or study free until you do\" work?"
              }
              a={
                lang === "de"
                  ? "Wenn du die Juni-26-Kohorte oder das Jahresabo hast, mindestens 70 % der relevanten Fragenbank bearbeitet hast und dann durchfällst, lädst du deinen offiziellen Bescheid hoch. Wir verifizieren innerhalb von 72 Stunden und verlängern deinen Zugang kostenlos bis zum nächsten Prüfungstermin — maximal zwei zusätzliche Zyklen."
                  : "If you're on the June 26 Cohort or the 12-month plan, completed ≥70 % of the relevant Qbank and fail the real exam, you upload your official result. We verify within 72 hours and extend your access free through the next exam cycle — up to two additional cycles."
              }
            />
            <FAQItem
              q={
                lang === "de"
                  ? "Warum nur Krypto-Zahlung für die Juni-26-Kohorte?"
                  : "Why crypto-only for the June 26 Cohort?"
              }
              a={
                lang === "de"
                  ? "Unsere US-Merchant-Entity über Stripe Atlas ist noch in Bearbeitung. Solange sie läuft, ist die Kohorte ausschließlich per USDT/USDC zahlbar. Sobald Stripe live ist, schalten wir die Standardtarife frei — trag dich oben in die Warteliste ein."
                  : "Our US merchant entity via Stripe Atlas is still in progress. Until then, the Cohort is crypto-only (USDT/USDC). When Stripe clears we open the standard tiers — join the waitlist above."
              }
            />
            <FAQItem
              q={
                lang === "de"
                  ? "Gibt es Tarife pro Prüfung?"
                  : "Is there per-exam pricing?"
              }
              a={
                lang === "de"
                  ? "Nein — jeder bezahlte Tarif enthält alle drei Prüfungstypen (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie). Wenn du nur eine Prüfung brauchst, gibt dir der kostenlose Tarif 150 Fragen pro Prüfungstyp."
                  : "No — every paid tier unlocks all three exam types (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie). If you only need one exam, the free tier gives you 150 questions per exam type."
              }
            />
          </div>

          <div className="text-center mt-6">
            <Link
              href="/faq"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] hover:underline"
            >
              {lang === "de" ? "Alle FAQ ansehen" : "See all FAQ"}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </section>

        {/* ══════════ Final CTA ══════════ */}
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-28">
          <div
            className="relative rounded-[var(--mp-r-card)] overflow-hidden p-8 md:p-10 text-center"
            style={{
              background:
                "linear-gradient(135deg, var(--mp-oxford-blue), var(--mp-cta-blue))",
              boxShadow: "var(--mp-shadow-elev)",
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle at 85% 100%, rgba(0,168,150,0.28), transparent 60%)",
              }}
              aria-hidden
            />
            <div className="relative">
              <h3 className="mp-h2 text-white mb-3">
                {lang === "de"
                  ? "Bereit für die Kenntnisprüfung am 26. Juni?"
                  : "Ready for the June 26 Kenntnisprüfung?"}
              </h3>
              <p className="mp-body text-white/80 max-w-xl mx-auto mb-6">
                {lang === "de"
                  ? "6 Monate Vollzugang, €114, zahlbar in Krypto. Inklusive Pass-Until-You-Pass-Garantie."
                  : "6 months of full access, €114, payable in crypto. Pass-Until-You-Pass guarantee included."}
              </p>
              <button
                type="button"
                onClick={startCohortCheckout}
                disabled={checkoutLoading}
                className="mp-btn mp-btn--lg inline-flex items-center gap-2"
                style={{
                  background: "var(--mp-accent-teal)",
                  color: "var(--mp-oxford-blue-dk)",
                  opacity: checkoutLoading ? 0.6 : 1,
                }}
              >
                <Bitcoin className="w-4 h-4" />
                {checkoutLoading
                  ? lang === "de"
                    ? "Rechnung wird erstellt…"
                    : "Creating invoice…"
                  : lang === "de"
                    ? "Jetzt zahlen mit Krypto"
                    : "Pay with crypto"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      </main>

      <BottomNav lang={lang} userId={user?.id} />

      {/* ══════════ Waitlist dialog (standard tiers only) ══════════ */}
      <Dialog
        open={waitOpen}
        onOpenChange={setWaitOpen}
        title={
          lang === "de"
            ? "Warteliste beitreten"
            : "Join the waitlist"
        }
        description={
          lang === "de"
            ? "Wir melden uns persönlich, sobald die Kreditkarten-Zahlung live ist. Kein Spam, kein Newsletter."
            : "We'll reach out personally when card payment goes live. No spam, no newsletter."
        }
        footer={
          <>
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              onClick={() => setWaitOpen(false)}
              disabled={submitting}
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--success"
              onClick={submitWaitlist}
              disabled={submitting}
            >
              {submitting
                ? lang === "de"
                  ? "Wird gesendet…"
                  : "Sending…"
                : lang === "de"
                  ? "Auf die Warteliste"
                  : "Join waitlist"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div
            className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
            style={{
              background: "var(--mp-success-bg)",
              border: "1px solid rgba(0,123,95,0.22)",
              color: "var(--mp-viridian)",
            }}
          >
            <Lock className="w-3 h-3 flex-shrink-0" aria-hidden />
            <span>
              {lang === "de" ? "Gewünschter Tarif: " : "Tier of interest: "}
              <span className="font-semibold">{tierLabel(waitTier, lang)}</span>
            </span>
          </div>

          <TextField
            label={lang === "de" ? "E-Mail-Adresse" : "Email address"}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="user-6e2c059a@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailErr}
          />

          <Select
            label={lang === "de" ? "Welche Prüfung?" : "Which exam?"}
            required
            value={examType}
            onChange={(e) => setExamType(e.target.value as ExamType)}
            options={[
              {
                value: "kenntnispruefung",
                label:
                  lang === "de"
                    ? "Kenntnisprüfung (Wien)"
                    : "Kenntnisprüfung (Vienna)",
              },
              { value: "kmp_innsbruck", label: "KMP Innsbruck" },
              { value: "pharma", label: "Pharmakologie" },
            ]}
          />

          <TextField
            label={
              lang === "de"
                ? "Prüfungsdatum (optional)"
                : "Exam date (optional)"
            }
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            helper={
              lang === "de"
                ? "Hilft uns, dich zu priorisieren, sobald Stripe live ist."
                : "Helps us prioritise you when Stripe goes live."
            }
          />

          <p className="text-[11px] text-[var(--mp-fg-subtle)] leading-relaxed pt-1">
            {lang === "de"
              ? "Deine E-Mail wird ausschließlich für die Stripe-Benachrichtigung verwendet. Du kannst dich jederzeit austragen."
              : "Your email is only used for the Stripe notification. You can unsubscribe any time."}
          </p>
        </div>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════ Free tier card ═══════════════════════ */

function FreeTierCard({ lang }: { lang: Lang }) {
  return (
    <article
      className="rounded-[var(--mp-r-card)] overflow-hidden p-6 md:p-7 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6 items-center"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span
            className="mp-caption inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full normal-case tracking-[0.08em]"
            style={{
              background: "var(--mp-surface-sunken)",
              color: "var(--mp-fg-muted)",
              border: "1px solid var(--mp-border-subtle)",
              fontSize: "10px",
              fontWeight: 700,
            }}
          >
            {lang === "de" ? "Kostenlos" : "Free"}
          </span>
          <h3 className="mp-h3 text-[20px]">
            {lang === "de"
              ? "Starte kostenlos — 150 Fragen pro Prüfungstyp"
              : "Start free — 150 questions per exam type"}
          </h3>
        </div>
        <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm leading-relaxed">
          {lang === "de"
            ? "450 Fragen gesamt (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie) mit vollständigen Erklärungen. Nur Qbank-Modus, kein Ablaufdatum."
            : "450 questions total (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie) with full explanations. Qbank-only, no expiry."}
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--mp-fg)]">
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Vollständige klinische Erklärungen"
              : "Full clinical explanations"}
          </li>
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Alle 3 Prüfungstypen · kein Zeitlimit"
              : "All 3 exam types · no time limit"}
          </li>
          <li className="flex items-start gap-2 text-[var(--mp-fg-subtle)]">
            <Lock
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
              aria-hidden
            />
            {lang === "de"
              ? "Spaced-Repetition, Prüfungssimulation und Lesezeichen sind den bezahlten Tarifen vorbehalten"
              : "Spaced-repetition, mock exam and bookmarks are paid-tier only"}
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 md:items-end">
        <div className="flex items-baseline gap-1.5 md:justify-end">
          <span className="mp-num font-display font-black text-[var(--mp-fg)] text-[32px] leading-none">
            €0
          </span>
          <span className="text-sm text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "/ dauerhaft" : "/ forever"}
          </span>
        </div>
        <Link
          href="/quiz?exam=pharma&free=1"
          className="mp-btn mp-btn--primary inline-flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap"
        >
          {lang === "de"
            ? "Kostenlos starten — 150 Pharma-Fragen"
            : "Start free — 150 Pharmakologie questions"}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <p className="mp-small text-[var(--mp-fg-subtle)] md:text-right">
          {lang === "de"
            ? "Keine Kreditkarte. Jederzeit upgradebar."
            : "No credit card. Upgrade any time."}
        </p>
      </div>
    </article>
  );
}

/* ═══════════════════════ Cohort featured card ═══════════════════════ */

function CohortFeaturedCard({
  lang,
  features,
  onCheckout,
  loading,
}: {
  lang: Lang;
  features: Array<{ de: string; en: string }>;
  onCheckout: () => void;
  loading: boolean;
}) {
  return (
    <article
      className="relative rounded-[var(--mp-r-card)] overflow-hidden"
      style={{
        background: "var(--mp-surface-raised)",
        border: "2px solid var(--mp-viridian)",
        boxShadow: "var(--mp-shadow-elev)",
      }}
    >
      {/* Viridian glow from top-right */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 95% 0%, rgba(0,168,150,0.12), transparent 55%)",
        }}
        aria-hidden
      />

      {/* Cohort badge */}
      <div className="absolute top-5 right-5 z-10">
        <span
          className="mp-caption inline-flex items-center gap-1.5 px-3 py-1 rounded-full"
          style={{
            background: "rgba(0,168,150,0.15)",
            color: "var(--mp-viridian)",
            border: "1px solid rgba(0,168,150,0.35)",
            letterSpacing: "0.08em",
            fontSize: "10px",
            fontWeight: 700,
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "var(--mp-accent-teal)" }}
            aria-hidden
          />
          {lang === "de"
            ? "Juni-26-Kohorte"
            : "June 26 Cohort"}
        </span>
      </div>

      <div className="relative p-6 md:p-8 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
        {/* LEFT: Title, description, feature list */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-5 h-5 text-[var(--mp-viridian)]" />
            <span className="mp-caption text-[var(--mp-viridian)] normal-case tracking-[0.12em]">
              {lang === "de"
                ? "6 Monate · alle 3 Prüfungen · Pass-Until-You-Pass"
                : "6 months · all 3 exams · Pass-Until-You-Pass"}
            </span>
          </div>
          <h3 className="mp-h2 mb-3">
            {lang === "de" ? "Juni-26-Kohorte" : "June 26 Cohort"}
          </h3>
          <p className="mp-body text-[var(--mp-fg-muted)] mb-5 max-w-xl">
            {lang === "de"
              ? "Ein einmaliger Preis, sechs Monate Vollzugang auf Kenntnisprüfung, KMP und Pharmakologie. Wenn du durchfällst, verlängern wir kostenlos — ohne Cash-Refund, ohne Kleingedrucktes. Aktiviert in Minuten, keine Kreditkarte."
              : "One upfront price, six months of full access across Kenntnisprüfung, KMP and Pharmakologie. If you fail, we extend your access free — no cash refund, no fine print. Activated in minutes, no credit card."}
          </p>

          {/* PUYP badge — prominent */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
            style={{
              background: "var(--mp-success-bg)",
              color: "var(--mp-viridian)",
              border: "1px solid rgba(0,123,95,0.3)",
            }}
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-bold">
              {lang === "de"
                ? "Pass-Until-You-Pass-Garantie"
                : "Pass-Until-You-Pass guarantee"}
            </span>
          </div>

          <ul className="space-y-2.5">
            {features.map((f) => (
              <li key={f.en} className="flex items-start gap-2.5">
                <span
                  className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center rounded-full"
                  style={{
                    width: "18px",
                    height: "18px",
                    background: "rgba(0,123,95,0.12)",
                    color: "var(--mp-viridian)",
                  }}
                  aria-hidden
                >
                  <Check className="w-3 h-3" strokeWidth={3} />
                </span>
                <span className="text-sm text-[var(--mp-fg)] leading-relaxed">
                  {f[lang]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT: Price + crypto CTA */}
        <div
          className="rounded-[12px] p-5 lg:sticky lg:top-4 flex flex-col gap-3"
          style={{
            background: "var(--mp-surface-sunken)",
            border: "1px solid var(--mp-border-subtle)",
          }}
        >
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="mp-num font-display font-black text-[var(--mp-fg)] text-[40px] leading-none">
                €114
              </span>
            </div>
            <p className="text-sm text-[var(--mp-fg-muted)] mt-1.5">
              {lang === "de"
                ? "für 6 Monate Vollzugang, inkl. Pass-Until-You-Pass-Garantie"
                : "6 months of all-access, with Pass-Until-You-Pass guarantee"}
            </p>
            <p
              className="mp-small mt-2 inline-flex items-center gap-1.5"
              style={{ color: "var(--mp-viridian)", fontWeight: 600 }}
            >
              <Bitcoin className="w-3.5 h-3.5" />
              {lang === "de"
                ? "USDT oder USDC — kein Kursrisiko"
                : "USDT or USDC — no FX risk"}
            </p>
          </div>

          <button
            type="button"
            onClick={onCheckout}
            disabled={loading}
            className="mp-btn mp-btn--success mp-btn--lg w-full inline-flex items-center justify-center gap-2"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? (
              <>
                <BrandedLoader size={24} hideLabel />
                {lang === "de" ? "Rechnung wird erstellt…" : "Creating invoice…"}
              </>
            ) : (
              <>
                {lang === "de" ? "Jetzt zahlen mit Krypto" : "Pay with crypto"}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="mp-small text-[var(--mp-fg-subtle)] text-center">
            {lang === "de"
              ? "Sofort-Aktivierung. Pass-Until-You-Pass statt Geld-zurück."
              : "Instant activation. Pass-Until-You-Pass instead of refund."}
          </p>
        </div>
      </div>
    </article>
  );
}

/* ═══════════════════════ Standard tier row (slim, disabled) ═══════════════════════ */

function StandardTierRow({
  lang,
  tier,
  onWaitlist,
}: {
  lang: Lang;
  tier: {
    id: StandardTier;
    price: string;
    cadence: { de: string; en: string };
    desc: { de: string; en: string };
    puyp?: boolean;
    popular?: boolean;
  };
  onWaitlist: () => void;
}) {
  return (
    <div
      className="rounded-[var(--mp-r-card)] p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4 md:gap-6 transition-colors"
      style={{
        background: "var(--mp-surface-raised)",
        border: `1px solid ${tier.popular ? "rgba(0,123,95,0.25)" : "var(--mp-border-subtle)"}`,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <h4 className="mp-h3 text-[18px]">{tierLabel(tier.id, lang)}</h4>
          {tier.popular && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{
                background: "var(--mp-success-bg)",
                color: "var(--mp-viridian)",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {lang === "de" ? "Beliebt" : "Popular"}
            </span>
          )}
          {tier.puyp && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{
                background: "var(--mp-success-bg)",
                color: "var(--mp-viridian)",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.08em",
              }}
            >
              <ShieldCheck className="w-2.5 h-2.5" />
              PUYP
            </span>
          )}
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full"
            style={{
              background: "var(--mp-surface-sunken)",
              color: "var(--mp-fg-muted)",
              border: "1px solid var(--mp-border-subtle)",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            <Lock className="w-2.5 h-2.5" aria-hidden />
            {lang === "de"
              ? "Stripe startet bald"
              : "Stripe launching soon"}
          </span>
        </div>
        <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">
          {tier.desc[lang]}
        </p>
      </div>

      <div className="flex items-center justify-between md:justify-end gap-3 md:gap-5 md:ml-auto">
        <div className="text-left md:text-right">
          <div className="mp-num font-display font-black text-[var(--mp-fg)] text-[22px] leading-none">
            {tier.price}
          </div>
          <div className="mp-small text-[var(--mp-fg-subtle)]">
            {tier.cadence[lang]}
          </div>
        </div>
        <button
          type="button"
          onClick={onWaitlist}
          className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 whitespace-nowrap"
          aria-label={
            lang === "de"
              ? `Warteliste beitreten für ${tierLabel(tier.id, lang)}`
              : `Join waitlist for ${tierLabel(tier.id, lang)}`
          }
        >
          {lang === "de" ? "Warteliste" : "Waitlist"}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════ Referral block ═══════════════════════ */

function ReferralBlock({ lang }: { lang: Lang }) {
  // Post-soft-launch §1.4.9 trust audit: concrete per-tier payout amounts
  // (€25 / €50 / €75) are strictly owned by /referrals. The pricing page
  // only points users there — one source of truth for the exact figures
  // avoids copy drift and keeps first-touch surfaces clean.
  //
  // Calm visual weight — surface-sunken background instead of raised,
  // no borders on bullets, so it clearly subordinates to the tier cards
  // above it without being buried.
  return (
    <div
      className="rounded-[var(--mp-r-card)] overflow-hidden p-6 md:p-7"
      style={{
        background: "var(--mp-surface-sunken)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Gift className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
        <span
          className="font-bold text-[var(--mp-viridian)]"
          style={{
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {lang === "de" ? "Empfehlungsprogramm" : "Referral program"}
        </span>
      </div>
      <h3 className="mp-h3 mb-2 text-[20px]">
        {lang === "de"
          ? "Lade andere Prüflinge ein — gestaffelte Prämien pro Abschluss."
          : "Invite fellow candidates — tiered rewards per signed-up referral."}
      </h3>
      <p className="text-sm text-[var(--mp-fg-muted)] mb-5 max-w-2xl leading-relaxed">
        {lang === "de"
          ? "Die Prämienhöhe hängt vom gewählten Tarif deiner Empfehlung ab. Auszahlung in USDT oder über Wise, 30 Tage nach Zahlungseingang. Kein SEPA."
          : "Reward scales with the plan your referral picks. Paid in USDT or via Wise, 30 days after their payment clears. No SEPA."}
      </p>

      <Link
        href="/referrals"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--mp-viridian)] rounded"
      >
        {lang === "de"
          ? "Prämienstufen und Dashboard ansehen"
          : "See payout tiers and dashboard"}
        <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </div>
  );
}

/* ═══════════════════════ PUYP block ═══════════════════════ */

function PuypBlock({ lang }: { lang: Lang }) {
  // Calm, sunken background — this block is reassurance copy, not
  // a CTA. The Cohort card above is the primary conversion surface;
  // here we just explain the mechanism in plain language.
  return (
    <div
      className="rounded-[var(--mp-r-card)] overflow-hidden p-6 md:p-7"
      style={{
        background: "var(--mp-surface-sunken)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
        <span
          className="font-bold text-[var(--mp-viridian)]"
          style={{
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {lang === "de"
            ? "Pass-Until-You-Pass-Garantie"
            : "Pass-Until-You-Pass guarantee"}
        </span>
      </div>
      <h3 className="mp-h3 mb-2 text-[20px]">
        {lang === "de"
          ? "Du fällst durch? Wir verlängern — kostenlos."
          : "Fail the exam? We extend — free."}
      </h3>
      <p className="text-sm text-[var(--mp-fg-muted)] mb-5 max-w-2xl leading-relaxed">
        {lang === "de"
          ? "Keine Cash-Rückerstattung — wir investieren stattdessen in dein Bestehen. Gilt nur für die Juni-26-Kohorte und den 12-Monats-Tarif."
          : "No cash refund — we invest in your pass instead. Applies to the June 26 Cohort and the 12-month plan only."}
      </p>

      <ul className="space-y-2 mb-5">
        {[
          lang === "de"
            ? "Prüfungsergebnis (PDF oder Foto) hochladen — Admin prüft innerhalb 72 Stunden."
            : "Upload your official result (PDF or photo) — admin verifies within 72 hours.",
          lang === "de"
            ? "Mindestens 70 % der relevanten Fragenbank müssen bearbeitet sein."
            : "At least 70 % of the relevant Qbank must be completed.",
          lang === "de"
            ? "Bis zu zwei zusätzliche Zyklen — also bis zu 18 Monate Zugang aus einer €114-Zahlung."
            : "Up to two additional cycles — up to 18 months of access from one €114 payment.",
        ].map((line) => (
          <li
            key={line}
            className="flex items-start gap-2 text-sm text-[var(--mp-fg)] leading-relaxed"
          >
            <Check
              className="w-3.5 h-3.5 mt-1 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
              aria-hidden
            />
            {line}
          </li>
        ))}
      </ul>

      <Link
        href="/faq#puyp"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--mp-viridian)] rounded"
      >
        {lang === "de" ? "Wie die Verifizierung läuft" : "How verification works"}
        <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </div>
  );
}

/* ═══════════════════════ FAQ item ═══════════════════════ */

function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details
      className="group rounded-[var(--mp-r-card)] overflow-hidden"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <summary
        className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer list-none hover:bg-[var(--mp-surface-sunken)] transition-colors"
        style={{ userSelect: "none" }}
      >
        <span className="text-sm font-semibold text-[var(--mp-fg)] pr-2">{q}</span>
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)] transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="px-5 pb-5 -mt-1 text-sm text-[var(--mp-fg-muted)] leading-relaxed">
        {a}
      </div>
    </details>
  );
}

/* ═══════════════════════ Helpers ═══════════════════════ */

function tierLabel(tier: StandardTier, lang: Lang): string {
  const labels: Record<StandardTier, { de: string; en: string }> = {
    monthly: { de: "Monatlich (€29/Mo)", en: "Monthly (€29/mo)" },
    "3mo": { de: "3 Monate (€79)", en: "3 months (€79)" },
    "6mo": { de: "6 Monate (€149)", en: "6 months (€149)" },
    "12mo": { de: "12 Monate (€229)", en: "12 months (€229)" },
  };
  return labels[tier][lang];
}
