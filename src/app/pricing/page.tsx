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
  Share2,
} from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource, type ExamSourceId } from "@/lib/topics";
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
  const [storedExam, setStoredExam] = useState<ExamSourceId>("kenntnispruefung");

  // Crypto checkout state.
  // `checkoutLoading` tracks which tier is currently spinning its CTA —
  // null means idle, "cohort" = €114 PUYP, "starter" = €27 / 3-month
  // entry tier (€9 effective per month), "first_month" = €19 single-
  // month fallback. Tracking the specific card lets us disable only
  // that button while the NOWPayments invoice is being created,
  // instead of freezing the entire page.
  const [checkoutLoading, setCheckoutLoading] = useState<
    null | "cohort" | "starter" | "first_month"
  >(null);
  // Whether to show the demoted "or just one more month — €19" tier
  // under the starter card. Hidden by default — most new users should
  // pick the €27 / 3-month entry; the single-month fallback is mainly
  // for users whose 3-month entry expired and want to bridge.
  const [showSingleMonth, setShowSingleMonth] = useState(false);

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
    setStoredExam(getStoredExamSource());
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
   * Start a Whop CARD checkout for any live tier.
   *
   * Logged-in users get a per-user Whop checkout-configuration session
   * (POST /api/whop/checkout) carrying metadata.medpruef_user_id + tier,
   * then redirect to its hosted purchase_url (card + Apple Pay, secure).
   * The webhook (/api/webhooks/whop) grants Pro on payment.succeeded by
   * reading that metadata. Logged-out users bounce to /login with a
   * `next` + `action` hint so the post-login redirect auto-triggers it.
   *
   * `slot` controls which CTA spinner lights up.
   */
  const startCryptoCheckout = async (
    tier:
      | "premium_pass_guaranteed"
      | "first_3mo_27"
      | "first_month_19",
    slot: "cohort" | "starter" | "first_month",
    actionHint: string,
  ) => {
    if (!session?.user) {
      const next = encodeURIComponent(`/pricing?action=${actionHint}`);
      window.location.href = `/login?next=${next}&action=${actionHint}`;
      return;
    }
    setCheckoutLoading(slot);
    try {
      const r = await fetch("/api/whop/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        purchaseUrl?: string;
        error?: string;
      };
      if (r.ok && data?.purchaseUrl) {
        window.location.href = data.purchaseUrl;
        return;
      }
      toast.error(
        lang === "de" ? "Checkout fehlgeschlagen" : "Checkout failed",
        (data?.error ?? "").slice(0, 140) ||
          (lang === "de"
            ? "Bitte später erneut versuchen."
            : "Please try again later.")
      );
    } catch {
      toast.error(
        lang === "de" ? "Netzwerkfehler" : "Network error",
        lang === "de" ? "Keine Verbindung zum Server." : "No connection to server."
      );
    }
    setCheckoutLoading(null);
  };

  /**
   * Paid CTAs create a per-user Whop checkout session and redirect to the
   * hosted card page (whop.com/checkout/...?session=ch_...). The session
   * carries metadata.medpruef_user_id so the webhook maps the card payment
   * back to this user. Card + Apple Pay both work with no extra setup.
   *
   * Logged-out users bounce to /login first, then the action-hint redirect
   * re-fires the same checkout after they authenticate.
   */
  const openCohortDialog = () => {
    if (!session?.user) {
      const next = encodeURIComponent("/pricing?action=cohort-checkout");
      window.location.href = `/login?next=${next}&action=cohort-checkout`;
      return;
    }
    void startCryptoCheckout("premium_pass_guaranteed", "cohort", "cohort-checkout");
  };

  const openStarter3moDialog = () => {
    if (!session?.user) {
      const next = encodeURIComponent("/pricing?action=starter-3mo-checkout");
      window.location.href = `/login?next=${next}&action=starter-3mo-checkout`;
      return;
    }
    void startCryptoCheckout("first_3mo_27", "starter", "starter-3mo-checkout");
  };

  const openFirstMonthDialog = () => {
    if (!session?.user) {
      const next = encodeURIComponent("/pricing?action=first-month-checkout");
      window.location.href = `/login?next=${next}&action=first-month-checkout`;
      return;
    }
    void startCryptoCheckout("first_month_19", "first_month", "first-month-checkout");
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
            ? "Du stehst auf der Warteliste."
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
            ? "Du stehst bereits auf der Warteliste — wir halten dich auf dem Laufenden."
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
      de: "Alle 10.992 Fragen · Kenntnisprüfung + KMP + Pharma in einem Abo",
      en: "All 10,992 questions · Kenntnisprüfung + KMP + Pharma bundled",
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
              ? "Juni-26-Kohorte — Anmeldung bis 22. Juni"
              : "June 26 Cohort — sign up by June 22"}
          </span>
          <h2 className="mp-h1 mb-4 leading-[1.05]">
            {lang === "de"
              ? "Beim ersten Versuch bestehen — oder kostenlos weiterlernen, bis du es schaffst."
              : "Pass first try — or study free until you do."}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] max-w-2xl mx-auto">
            {lang === "de"
              ? "Die einzige Prüfungsvorbereitung, speziell für Österreichs Kenntnisprüfung, KMP und Pharmakologie. Destilliert aus 10.992 dokumentierten offiziellen Prüfungsfragen — Wien seit 2016, KMP Innsbruck und Pharmakologie."
              : "The only exam prep built specifically for Austria's Kenntnisprüfung, KMP & Pharmakologie. Distilled from 10,992 documented official exam questions — Vienna since 2016, KMP Innsbruck and Pharmakologie."}
          </p>
        </section>

        {/* ══════════ Free tier card ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
          <FreeTierCard lang={lang} examSource={storedExam} />
        </section>

        {/* ══════════ €27 / 3-month entry tier card (primary) ══════════ */}
        {/* Phase 1 of the 2026-04-28 pricing reset — replaces €19 single-
            month as the dominant entry surface. Three months for €27
            (~€9 per month) gives the prospect a real prep window without
            committing to the full €114 Cohort price. The `first-month`
            anchor stays on this section so the landing-page tertiary
            CTA still deep-links here even after the rename. */}
        <section
          id="first-month"
          className="max-w-5xl mx-auto px-4 lg:px-8 pb-4 scroll-mt-20"
        >
          <Starter3MoCard
            lang={lang}
            onCheckout={openStarter3moDialog}
            loading={checkoutLoading === "starter"}
          />

          {/* Single-month fallback — collapsed by default. Reveals
              automatically when the API rejects a duplicate
              first_3mo_27 purchase (showSingleMonth flag), so users
              whose 3-month entry already expired have a one-click
              recovery path. Otherwise it's intentionally tucked away
              to keep the funnel pointing at the 3-month entry. */}
          <div className="mt-3">
            {showSingleMonth ? (
              <FirstMonthCard
                lang={lang}
                onCheckout={openFirstMonthDialog}
                loading={checkoutLoading === "first_month"}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowSingleMonth(true)}
                className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] underline-offset-2 hover:underline transition-colors"
              >
                {lang === "de"
                  ? "Brauchst du nur einen Monat? Einzelmonat zu €19 anzeigen ›"
                  : "Just need one month? Show single-month tier (€19) ›"}
              </button>
            )}
          </div>
        </section>

        {/* ══════════ Cost-anchor strip ══════════
            Anchors €114 against the real-world numbers a med doctor
            already knows: ~€370 per Kenntnisprüfung re-sit fee + ~€5,000
            forgone Assistenzarzt salary per delayed half-year (Funnel
            agent §9, Conversion Psychology agent §1, review-2026-04-25-B2).

            Numerical anchoring (Tversky/Kahneman): €114 next to
            €370+€5,000 reads cheap; €114 against "textbook chapter"
            reads as expense. This is the single biggest cheap-copy
            lever in the funnel. Honest numbers — Kenntnisprüfung fee
            is publicly listed by the Vienna Ärztekammer; salary range
            is the standard Assistenzarzt-1 figure.
          */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-3">
          <div
            className="rounded-xl px-5 py-4 text-sm md:text-[15px] leading-relaxed"
            style={{
              background: "var(--mp-warning-bg, rgba(244,162,97,0.08))",
              border: "1px solid rgba(244,162,97,0.22)",
              color: "var(--mp-fg-muted)",
            }}
          >
            {lang === "de" ? (
              <>
                <strong className="text-[var(--mp-fg)]">Die Kenntnisprüfung kostet ~€370 pro Versuch.</strong>{" "}
                Ein verlorenes halbes Jahr in Österreich:{" "}
                <strong className="text-[var(--mp-fg)]">~€5.000 entgangenes Assistenzarzt-Gehalt.</strong>{" "}
                Die Juni-26-Kohorte: <strong className="text-[var(--mp-viridian)]">114 € — einmalig.</strong>
              </>
            ) : (
              <>
                <strong className="text-[var(--mp-fg)]">The Kenntnisprüfung costs ~€370 per attempt.</strong>{" "}
                Half a year delayed in Austria:{" "}
                <strong className="text-[var(--mp-fg)]">~€5,000 in forgone Assistenzarzt salary.</strong>{" "}
                The June 26 Cohort: <strong className="text-[var(--mp-viridian)]">114 € — one time.</strong>
              </>
            )}
          </div>
        </section>

        {/* ══════════ Cohort featured card ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-6">
          <CohortFeaturedCard
            lang={lang}
            features={cohortFeatures}
            onCheckout={openCohortDialog}
            loading={checkoutLoading === "cohort"}
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
                  ? "Wie kann ich bezahlen?"
                  : "How can I pay?"
              }
              a={
                lang === "de"
                  ? "Du zahlst sicher mit Karte (auch Apple Pay), in wenigen Sekunden. Der Vollzugang wird sofort nach der Zahlung freigeschaltet."
                  : "You pay securely by card (Apple Pay too), in seconds. Full access unlocks right after payment."
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
                  ? "6 Monate Vollzugang, €114, zahlbar mit Karte. Inklusive Pass-Until-You-Pass-Garantie."
                  : "6 months of full access, €114, payable by card. Pass-Until-You-Pass guarantee included."}
              </p>
              <button
                type="button"
                onClick={openCohortDialog}
                disabled={checkoutLoading === "cohort"}
                className="mp-btn mp-btn--lg inline-flex items-center gap-2"
                style={{
                  background: "var(--mp-accent-teal)",
                  color: "var(--mp-oxford-blue-dk)",
                  opacity: checkoutLoading === "cohort" ? 0.6 : 1,
                }}
              >
                <Bitcoin className="w-4 h-4" />
                {checkoutLoading === "cohort"
                  ? lang === "de"
                    ? "Rechnung wird erstellt…"
                    : "Creating invoice…"
                  : lang === "de"
                    ? "Jetzt mit Karte zahlen"
                    : "Pay by card"}
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
              ? "Deine E-Mail wird ausschließlich verwendet, um dich zu benachrichtigen, sobald dieser Tarif startet. Du kannst dich jederzeit austragen."
              : "Your email is only used to notify you when this plan opens. You can unsubscribe any time."}
          </p>
        </div>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════ Free tier card ═══════════════════════ */

function FreeTierCard({ lang, examSource }: { lang: Lang; examSource: ExamSourceId }) {
  // The Free CTA used to hard-code Pharma. We now route to whichever exam the
  // user last selected (or kenntnispruefung if they're brand new), so KMP and
  // Kenntnisprüfung cohorts don't get parachuted into a Pharma quiz.
  const examLabel = examSource === "kenntnispruefung"
    ? (lang === "de" ? "Kenntnisprüfung-Fragen" : "Kenntnisprüfung questions")
    : examSource === "kmp_innsbruck"
    ? (lang === "de" ? "KMP-Innsbruck-Fragen" : "KMP-Innsbruck questions")
    : (lang === "de" ? "Pharma-Fragen" : "Pharmakologie questions");
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
          href={`/quiz?exam=${examSource}&free=1`}
          className="mp-btn mp-btn--primary inline-flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap"
        >
          {lang === "de"
            ? `Kostenlos starten — 150 ${examLabel}`
            : `Start free — 150 ${examLabel}`}
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

/* ═══════════════════════ €27 / 3-month starter card ═══════════════════════ */

/**
 * Primary entry tier as of 2026-04-28. €9-effective per month for 3
 * months, billed as a single €27 lump sum (NOWPayments has no
 * recurring billing, and Stripe Atlas hasn't cleared yet).
 *
 * Capped at one purchase per user — eligibility enforced server-side
 * in `/api/checkout/nowpayments` to prevent indefinite parking that
 * would erode the €114 Cohort tier (Integrator audit 2026-04-28).
 *
 * Visual posture: more prominent than the demoted €19 single-month
 * fallback (slightly larger price block, "Empfehlung für Einsteiger"
 * pill, viridian highlight) but still subordinate to the Cohort card —
 * Cohort keeps the 2px viridian border + glow, Starter uses a softer
 * accent.
 */
function Starter3MoCard({
  lang,
  onCheckout,
  loading,
}: {
  lang: Lang;
  onCheckout: () => void;
  loading: boolean;
}) {
  return (
    <article
      className="relative rounded-[var(--mp-r-card)] overflow-hidden p-6 md:p-7 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6 items-center"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-viridian-soft, rgba(0,123,95,0.35))",
        boxShadow: "0 1px 0 rgba(0,123,95,0.05)",
      }}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span
            className="mp-caption inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full normal-case tracking-[0.08em]"
            style={{
              background: "rgba(0,123,95,0.12)",
              color: "var(--mp-viridian)",
              border: "1px solid rgba(0,123,95,0.28)",
              fontSize: "10px",
              fontWeight: 700,
            }}
          >
            {lang === "de" ? "Einstieg · Empfehlung" : "Starter · Recommended"}
          </span>
          <h3 className="mp-h3 text-[20px]">
            {lang === "de"
              ? "3-Monats-Einstieg — ~9 € pro Monat"
              : "3-Month Starter — ~€9 per month"}
          </h3>
        </div>
        <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm leading-relaxed">
          {lang === "de"
            ? "Drei Monate Vollzugang für eine einmalige Zahlung von 27 €. Genug Zeit für einen echten Lernlauf — und schmal genug, um zu testen, bevor du dich zur Kohorte committest. Pro Konto einmal verfügbar."
            : "Three months of full access for one payment of €27. Long enough for a real prep run, narrow enough to test before committing to the Cohort. One purchase per account."}
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--mp-fg)]">
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Vollzugang · alle 3 Prüfungen · alle Pro-Features"
              : "Full access · all 3 exams · all Pro features"}
          </li>
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "90 Tage ab Zahlung · läuft automatisch aus, kein Abo"
              : "90 days from payment · expires automatically, no subscription"}
          </li>
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Empfiehl uns weiter — 15 € Gutschrift pro bezahltem Empfehlungs-Sign-up"
              : "Refer others — €15 credit per paid referral sign-up"}
          </li>
          <li className="flex items-start gap-2 text-[var(--mp-fg-subtle)]">
            <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
            {lang === "de"
              ? "Keine Pass-Until-You-Pass-Garantie (nur bei 6-Monats- und Kohorten-Tarifen)"
              : "No Pass-Until-You-Pass guarantee (6-month and Cohort plans only)"}
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 md:items-end">
        <div className="flex flex-col md:items-end">
          <div className="flex items-baseline gap-1.5 md:justify-end">
            <span className="mp-num font-display font-black text-[var(--mp-fg)] text-[36px] leading-none">
              27 €
            </span>
            <span className="text-sm text-[var(--mp-fg-subtle)]">
              {lang === "de" ? "einmalig" : "one-time"}
            </span>
          </div>
          <p
            className="mp-small mt-1 md:text-right"
            style={{ color: "var(--mp-viridian)", fontWeight: 600 }}
          >
            {lang === "de"
              ? "≈ 9 € pro Monat · keine Verlängerung"
              : "≈ €9 per month · no renewal"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCheckout}
          disabled={loading}
          className="mp-btn mp-btn--success inline-flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap"
          style={{ opacity: loading ? 0.7 : 1 }}
        >
          {loading ? (
            <>
              <BrandedLoader size={20} hideLabel />
              {lang === "de" ? "Rechnung wird erstellt…" : "Creating invoice…"}
            </>
          ) : (
            <>
              <Bitcoin className="w-3.5 h-3.5" />
              {lang === "de"
                ? "3 Monate für 27 € starten"
                : "Start 3 months for €27"}
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
        <p className="mp-small text-[var(--mp-fg-subtle)] md:text-right">
          {lang === "de"
            ? "Karte · sofort aktiv · läuft nach 90 Tagen aus"
            : "Card · active instantly · expires after 90 days"}
        </p>
      </div>
    </article>
  );
}

/* ═══════════════════════ €19 single-month fallback card ═══════════════════════ */

/**
 * Single-month fallback. Demoted from primary entry on 2026-04-28 in
 * favour of the €27 / 3-month starter. Stays available so users whose
 * 3-month entry expired (or who explicitly want a one-month bridge)
 * can buy a single month before upgrading to Cohort. Auto-revealed in
 * the UI when the checkout API rejects a duplicate first_3mo_27.
 */
function FirstMonthCard({
  lang,
  onCheckout,
  loading,
}: {
  lang: Lang;
  onCheckout: () => void;
  loading: boolean;
}) {
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
              background: "rgba(0,58,140,0.08)",
              color: "var(--mp-cta-blue)",
              border: "1px solid rgba(0,58,140,0.22)",
              fontSize: "10px",
              fontWeight: 700,
            }}
          >
            {lang === "de" ? "Einzelmonat · Fallback" : "Single month · fallback"}
          </span>
          <h3 className="mp-h3 text-[20px]">
            {lang === "de"
              ? "Einzelmonat — einmalig 19 €"
              : "Single month — €19 one-time"}
          </h3>
        </div>
        <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm leading-relaxed">
          {lang === "de"
            ? "30 Tage Vollzugang als Übergang — ideal, wenn dein 3-Monats-Einstieg ausgelaufen ist und du eine Brücke bis zur Kohorte brauchst, oder wenn du ganz gezielt nur einen Monat testen willst."
            : "30 days of full access as a bridge — ideal if your 3-month starter has expired and you need a stop-gap before Cohort, or if you specifically want a one-month try."}
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--mp-fg)]">
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Vollzugang · alle 3 Prüfungen · alle Pro-Features"
              : "Full access · all 3 exams · all Pro features"}
          </li>
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "30 Tage ab Zahlung · läuft automatisch aus"
              : "30 days from payment · expires automatically"}
          </li>
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Am Tag 25 schreiben wir dir — wähle dann selbst einen längeren Tarif"
              : "We email you on day 25 — pick a longer plan yourself, if you want"}
          </li>
          <li className="flex items-start gap-2 text-[var(--mp-fg-subtle)]">
            <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
            {lang === "de"
              ? "Keine Pass-Until-You-Pass-Garantie (nur bei 6-Monats- und 12-Monats-Tarifen)"
              : "No Pass-Until-You-Pass guarantee (6- and 12-month plans only)"}
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 md:items-end">
        <div className="flex flex-col md:items-end">
          <div className="flex items-baseline gap-1.5 md:justify-end">
            <span className="mp-num font-display font-black text-[var(--mp-fg)] text-[32px] leading-none">
              19 €
            </span>
            <span className="text-sm text-[var(--mp-fg-subtle)]">
              {lang === "de" ? "einmalig" : "one-time"}
            </span>
          </div>
          <p
            className="mp-small mt-1 md:text-right"
            style={{ color: "var(--mp-cta-blue)", fontWeight: 600 }}
          >
            {lang === "de"
              ? "keine automatische Verlängerung"
              : "no auto-renewal"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCheckout}
          disabled={loading}
          className="mp-btn mp-btn--secondary inline-flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap"
          style={{ opacity: loading ? 0.7 : 1 }}
        >
          {loading ? (
            <>
              <BrandedLoader size={20} hideLabel />
              {lang === "de" ? "Rechnung wird erstellt…" : "Creating invoice…"}
            </>
          ) : (
            <>
              <Bitcoin className="w-3.5 h-3.5" />
              {lang === "de"
                ? "Einen Monat für 19 € testen"
                : "Try one month for €19"}
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
        <p className="mp-small text-[var(--mp-fg-subtle)] md:text-right">
          {lang === "de"
            ? "Karte · sofort aktiv · läuft nach 30 Tagen aus"
            : "Card · active instantly · expires after 30 days"}
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
              ? "Ein einmaliger Preis, sechs Monate Vollzugang auf Kenntnisprüfung, KMP und Pharmakologie. Sieben Tage Geld-zurück-Garantie auf jede Bestellung. Wenn du nach 7 Tagen weiter lernst und dann durchfällst, verlängern wir deinen Zugang kostenlos — keine Cash-Rückerstattung in dem Fall, dafür Pass-Until-You-Pass. Aktiviert in Minuten, keine Kreditkarte."
              : "One upfront price, six months of full access across Kenntnisprüfung, KMP and Pharmakologie. 7-day money-back guarantee on every purchase. If you keep studying past day 7 and later fail, we extend your access free — no cash refund at that point, but Pass-Until-You-Pass kicks in. Activated in minutes, no credit card."}
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
                ? "Sichere Kartenzahlung, auch Apple Pay"
                : "Secure card payment, Apple Pay too"}
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
                {lang === "de" ? "Jetzt mit Karte zahlen" : "Pay by card"}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="mp-small text-[var(--mp-fg-subtle)] text-center">
            {lang === "de"
              ? "Sofort-Aktivierung · 7-Tage-Geld-zurück-Garantie · Pass-Until-You-Pass."
              : "Instant activation · 7-day money-back guarantee · Pass-Until-You-Pass."}
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
          ? "Empfiehl uns auf Telegram, WhatsApp & Social — bis zu 75 € pro Abschluss."
          : "Share on Telegram, WhatsApp & socials — up to €75 per signed-up referral."}
      </h3>
      <p className="text-sm text-[var(--mp-fg-muted)] mb-5 max-w-2xl leading-relaxed">
        {lang === "de"
          ? "Du bist wahrscheinlich schon in den richtigen Telegram-Kanälen für die Kenntnisprüfung. Teile dort deinen Empfehlungslink — 15 € pro 3-Monats-Einstieg, 25 € pro Monatstarif, 50 € pro Halbjahr/Jahr, 75 € pro Kohorte. Auszahlung in USDT oder Wise, 30 Tage nach Zahlungseingang."
          : "You're probably already in the right Telegram groups for the Kenntnisprüfung. Share your referral link there — €15 per 3-month starter, €25 per monthly, €50 per 6/12-month, €75 per Cohort sign-up. Paid in USDT or Wise, 30 days after their payment clears."}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/referrals"
          className="mp-btn mp-btn--success inline-flex items-center gap-1.5 text-sm"
        >
          <Share2 className="w-3.5 h-3.5" aria-hidden />
          {lang === "de"
            ? "Empfehlungslink öffnen"
            : "Open my referral link"}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </Link>
        <span className="text-xs text-[var(--mp-fg-subtle)]">
          {lang === "de"
            ? "Auf der nächsten Seite ein Klick zum Teilen via Telegram, WhatsApp oder Web Share."
            : "Next page: one-click share via Telegram, WhatsApp or Web Share."}
        </span>
      </div>
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
          ? "Zwei Schutz-Ebenen: 7-Tage-Geld-zurück-Garantie auf jede Bestellung — und wenn du nach 7 Tagen weiter lernst und dann beim ersten Versuch durchfällst, verlängern wir deinen Zugang kostenlos (Pass-Until-You-Pass). PUYP gilt für die Juni-26-Kohorte und den 12-Monats-Tarif."
          : "Two layers of protection: 7-day money-back guarantee on every purchase — and if you keep studying past day 7 and later fail your first attempt, we extend your access free (Pass-Until-You-Pass). PUYP applies to the June 26 Cohort and the 12-month plan."}
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
