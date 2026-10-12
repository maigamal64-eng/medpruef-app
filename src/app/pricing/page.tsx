"use client";
import { createActionGate } from "@/lib/account-request";
import PendingPaymentBanner from "@/components/PendingPaymentBanner";
import PublicStudyLink from "@/components/PublicStudyLink";
import FreeOfferDisclosure from "@/components/FreeOfferDisclosure";
import { buildAuthHref, parseAuthEntry } from "@/lib/auth-entry";
import { billingSurfaceText } from "@/lib/billing-copy";

import BillingReceipt from "@/components/BillingReceipt";
import { PaymentStatus } from "@/components/ui/PaymentStatus";
import { TIERS } from "@/lib/content-truth";
import { billingAmount, billingPlanLine } from "@/lib/billing-copy";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Sparkles,
  ChevronDown,
  CreditCard,
  Lock,
  ShieldCheck,
  Gift,
  Share2,
} from "lucide-react";
import { t, getLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { authFetch as fetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import {
  BILLING_SUPPORT_EMAIL,
  SUPPORT_REPLY_PROMISE,
  WHOP_MANAGE_TEXT,
  WHOP_MANAGE_URL,
} from "@/lib/billing-copy";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { Alert, AppLayout } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import UpcomingExams from "@/components/UpcomingExams";
import TrialActivation from "@/components/TrialActivation";
import CheckoutStallPrompt from "@/components/CheckoutStallPrompt";
import { BrandedLoader } from "@/components/ui";
import { claimsFor, claimText } from "@/lib/learning-claims";

type Lang = "de" | "en";

/**
 * /pricing — 2026-06-25 pricing update.
 *
 * Live tiers: €19/1 month (first_month_19), €49/3 months (first_3mo_27),
 * €129/6 months — Exam Cohort (premium_pass_guaranteed).
 * Free tier: 150 Qs × 3 exam types (450 total), no expiry, Qbank-only.
 *
 * Data flow:
 *   - All paid CTAs: POST /api/whop/checkout {tier} → Whop hosted card
 *     checkout (card + Apple Pay) → /dashboard?welcome=...
 *   - Free tier CTA: /quiz?free=1
 */
export default function PricingPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [trialResume, setTrialResume] = useState(false);
  // Pro-only features send learners here with ?gate= (mock exams and the
  // mistake review stay Pro-only for launch, [name] 2026-10-11).
  const [proGate, setProGate] = useState<"mock_exam" | "mistakes" | null>(null);
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [storedExam, setStoredExam] = useState<ExamSourceId>("kenntnispruefung");

  // Card checkout state.
  // `checkoutLoading` tracks which tier is currently spinning its CTA —
  // null = idle; "cohort" = €129 Cohort PUYP; "first_month" = €19;
  // "starter" = €49 / 3-month.
  const [checkoutLoading, setCheckoutLoading] = useState<
    null | "cohort" | "starter" | "first_month"
  >(null);
  const checkoutGate = useRef(createActionGate());
  const request = useRef<AbortController | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [checkoutSlow, setCheckoutSlow] = useState(false);
  const checkoutActionHandled = useRef(false);
  const [checkoutFailure, setCheckoutFailure] = useState<{ slot: string; state: "pending" | "failed" } | null>(null);

  const { isPaid, referralsEnabled, refresh: refreshTier } = useUserTier();
  useEffect(() => {
    const reset = () => { request.current?.abort(); checkoutGate.current.leave(); setCheckoutLoading(null); setCheckoutSlow(false); setTrialBusy(false); refreshTier(); };
    const visible = () => { if (document.visibilityState === 'visible') reset(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('pageshow', restored);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('pageshow', restored); };
  }, [refreshTier]);
  useEffect(() => {
    if (!checkoutLoading) return;
    const timer = setTimeout(() => setCheckoutSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [checkoutLoading]);

  useEffect(() => {
    setLangState(getLang());
    const s = getStoredSession();
    setSession(s);
    const params = new URLSearchParams(window.location.search);
    setStoredExam(parseAuthEntry(params).exam || getStoredExamSource());
    setTrialResume(params.get("action") === "trial" || params.get("intent") === "trial");
    const gate = params.get("gate");
    setProGate(gate === "mock_exam" ? "mock_exam" : gate === "mistakes" || gate === "wrong_only" ? "mistakes" : null);
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLangState(l);
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
  const startCardCheckout = useCallback(async (
    tier:
      | "premium_pass_guaranteed"
      | "first_3mo_27"
      | "first_month_19",
    slot: "cohort" | "starter" | "first_month",
    actionHint: string,
  ) => {
    if (!session?.user) {
      window.location.href = buildAuthHref({ exam: storedExam, next: `/pricing?action=${actionHint}` });
      return;
    }
    if (isPaid || trialBusy || !checkoutGate.current.enter()) return;
    const controller = new AbortController(); request.current = controller;
    setCheckoutLoading(slot); setCheckoutFailure(null); setCheckoutSlow(false);
    try {
      const r = await fetch("/api/whop/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }), timeoutMs: 15_000, signal: controller.signal,
      });
      const data = (await r.json().catch(() => ({}))) as {
        purchaseUrl?: string;
        error?: string;
      };
      if (controller.signal.aborted) return;
      if (r.ok && data?.purchaseUrl) {
        window.location.href = data.purchaseUrl;
        return;
      }
      setCheckoutFailure({ slot, state: r.status === 409 ? 'pending' : 'failed' });
    } catch {
      if (!controller.signal.aborted) setCheckoutFailure({ slot, state: 'failed' });
    }
    if (request.current === controller) { checkoutGate.current.leave(); setCheckoutLoading(null); }
  }, [session, storedExam, isPaid, trialBusy]);

  // Login preserves the requested plan in `next`. Resume that one deliberate
  // checkout action after the session is present, and remove the query first
  // so refresh/back navigation cannot submit it a second time.
  useEffect(() => {
    if (!mounted || !session?.user || checkoutActionHandled.current) return;
    const action = new URLSearchParams(window.location.search).get("action");
    const checkoutActions = {
      "cohort-checkout": {
        tier: "premium_pass_guaranteed",
        slot: "cohort",
      },
      "starter-3mo-checkout": { tier: "first_3mo_27", slot: "starter" },
      "first-month-checkout": {
        tier: "first_month_19",
        slot: "first_month",
      },
    } as const;
    if (!action || !(action in checkoutActions)) return;

    const checkout = checkoutActions[action as keyof typeof checkoutActions];
    checkoutActionHandled.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState(window.history.state, "", url.toString());
    void startCardCheckout(checkout.tier, checkout.slot, action);
  }, [mounted, session, startCardCheckout]);

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
      window.location.href = buildAuthHref({ exam: storedExam, next: "/pricing?action=cohort-checkout" });
      return;
    }
    void startCardCheckout("premium_pass_guaranteed", "cohort", "cohort-checkout");
  };

  const openStarter3moDialog = () => {
    if (!session?.user) {
      window.location.href = buildAuthHref({ exam: storedExam, next: "/pricing?action=starter-3mo-checkout" });
      return;
    }
    void startCardCheckout("first_3mo_27", "starter", "starter-3mo-checkout");
  };

  const openFirstMonthDialog = () => {
    if (!session?.user) {
      window.location.href = buildAuthHref({ exam: storedExam, next: "/pricing?action=first-month-checkout" });
      return;
    }
    void startCardCheckout("first_month_19", "first_month", "first-month-checkout");
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  const user = session?.user;

  /* Cohort feature bullets — the dominant card */
  // Every bullet renders from the claims register (LX-30); an unregistered
  // bullet cannot ship. Code path and test per id: learning-claims.data.json.
  const cohortFeatures: Array<{ de: string; en: string }> = claimsFor("pricing.cohort").map((c) => claimText(c.id));

  const checkoutProblem = (slot: string) => checkoutFailure?.slot === slot && <div data-plan={slot} className="my-4"><PaymentStatus state={checkoutFailure.state} check={() => { const tier = slot === 'cohort' ? 'premium_pass_guaranteed' : slot === 'starter' ? 'first_3mo_27' : 'first_month_19'; window.location.href = `/checkout/success?tier=${tier}`; }} />
    <a className="inline-flex min-h-11 items-center text-sm underline" href="mailto:user-b7e46e80@example.com">{lang === 'de' ? 'Hilfe zu Zahlung oder Zugang' : 'Payment or access help'}</a>
  </div>;

  return (
    <AppLayout
      className="pricing-layout"
      sidebar={<Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />}
      bottomNav={<BottomNav lang={lang} userId={user?.id} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        <PendingPaymentBanner />
        {(checkoutLoading || trialBusy) && <p role="status" className="mp-card p-4 m-4 text-sm">{t('account_checkout_opening', lang)} {t('account_return', lang)}</p>}
        {checkoutSlow && <Link className="mp-btn mp-btn--secondary min-h-11 m-4" href={`/checkout/success?tier=${checkoutLoading === 'cohort' ? 'premium_pass_guaranteed' : checkoutLoading === 'starter' ? 'first_3mo_27' : 'first_month_19'}`}>{t('account_checkout_retry', lang)}</Link>}
        <BillingReceipt />
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

        {proGate && (
          <div className="max-w-5xl mx-auto px-4 lg:px-8 pt-6">
            <Alert
              variant="info"
              title={
                proGate === "mock_exam"
                  ? lang === "de" ? "Prüfungssimulationen gehören zu Pro" : "Exam simulations are part of Pro"
                  : lang === "de" ? "Die Fehlerwiederholung gehört zu Pro" : "Mistake review is part of Pro"
              }
            >
              {lang === "de"
                ? "Mit dem kostenlosen Tarif üben Sie weiterhin Ihre freien Fragen je Prüfung. Für diese Funktion wählen Sie unten einen Pro-Tarif."
                : "On the free plan you can keep practising your free questions per exam. For this feature, choose a Pro plan below."}
            </Alert>
          </div>
        )}

        {/* ══════════ Hero ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-12 pb-6 text-center">
          <span className="mp-caption inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--mp-success-bg)] text-[var(--mp-viridian)] mb-5 normal-case tracking-[0.08em]">
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "de"
              ? "Klinisches Wissen üben · alle drei Fragenbanken"
              : "Clinical knowledge practice · all three question banks"}
          </span>
          <h2 className="mp-h1 mb-4 leading-[1.05]">
            {lang === "de"
              ? "Beim ersten Versuch bestehen, oder kostenlos weiterlernen, bis du es schaffst."
              : "Pass first try, or study free until you do."}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] max-w-2xl mx-auto">
            {lang === "de"
              ? "Übe mit den Fragenbanken Kenntnisprüfung Wien, Stichprobentest und Pharmakologie. Über 10.000 kuratierte Übungsfragen aus unterschiedlichen Quellen. Die Wiener Bank enthält SIP4a/SIP5a-basierte MCQ-Übungen, keine Simulation der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin."
              : "Practise with the Kenntnisprüfung Vienna, Stichprobentest and Pharmakologie question banks. Over 10,000 curated practice questions from different sources. The Vienna bank contains SIP4a/SIP5a-based MCQ exercises, not a simulation of the postgraduate ÖÄK general medicine exam."}
          </p>
        </section>

        {/* ══════════ Pro trial banner (flag-gated, signed-in eligible free users) ══════════ */}
        {/* Self-gating: TrialActivation renders nothing unless NOTES_TRIAL_ENABLED
            is on AND the caller is a signed-in, not-yet-trialed free user. Placed
            above the paid grid so the closest-to-convert audience sees the free
            week first. Anonymous top-of-funnel announcement is staged separately. */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
          <div id="pro-test" className="scroll-mt-24"><TrialActivation lang={lang} resume={trialResume} exam={storedExam} checkoutBusy={Boolean(checkoutLoading)} onWorkingChange={setTrialBusy} /></div>
        </section>

        {/* ══════════ Free tier card ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
          <FreeTierCard lang={lang} examSource={storedExam} />
        </section>

        {/* ══════════ Checkout-stall feedback prompt ══════════
            2026-07-11: one-tap question for signed-in users who recently
            reached Whop checkout and never completed. Self-gates via
            /api/checkout-feedback/eligibility — renders nothing for
            guests/anonymous or ineligible users. */}
        {user && !user.id.startsWith("guest_") && (
          <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
            <CheckoutStallPrompt />
          </section>
        )}

        {/* ══════════ Entry tier cards: 19 €/month (entry) → 49 €/3mo (step) ══════════ */}
        {/* Entry: 19 €/month single-month tier renders first, matching the
            landing-page headline ("ab 19 € im Monat"). The 49 €/3-month
            starter is the middle step below; the 129 € Cohort is the hero.
            The `first-month` anchor stays so the landing-page tertiary CTA
            still deep-links here. */}
        <section
          id="first-month"
          className="max-w-5xl mx-auto px-4 lg:px-8 pb-4 scroll-mt-20"
        >
          <FirstMonthCard
            lang={lang}
            onCheckout={openFirstMonthDialog}
            loading={Boolean(checkoutLoading) || trialBusy}
            isPaid={isPaid}
          />
          {checkoutProblem('first_month')}

          {/* Middle step: 49 € / 3 months (~16 €/month). One step up from
              the single-month entry for prospects who want a longer prep
              window before committing to the Cohort. */}
          <div className="mt-3">
            <Starter3MoCard
              lang={lang}
              onCheckout={openStarter3moDialog}
              loading={Boolean(checkoutLoading) || trialBusy}
              isPaid={isPaid}
              referralsEnabled={referralsEnabled}
            />
            {checkoutProblem('starter')}
          </div>

          {/* Billing truth: which plans renew, and how to cancel. Shared
              wording lives in src/lib/billing-copy.ts (FAQ + terms). */}
          <p className="mp-small text-[var(--mp-fg-muted)] mt-4 leading-relaxed">
            {lang === "de"
              ? "Einzelmonat und 3-Monats-Tarif sind Abos und verlängern sich automatisch alle 30 bzw. 90 Tage, bis du kündigst. Die Prüfungs-Kohorte ist eine Einmalzahlung. Kündigen kannst du bei Whop unter "
              : "The Single Month and 3-Month plans are subscriptions and renew automatically every 30 or 90 days until you cancel. The Exam Cohort is a one-time payment. You can cancel at Whop via "}
            <a
              href={WHOP_MANAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {WHOP_MANAGE_TEXT}
            </a>
            {lang === "de"
              ? ` oder per E-Mail an ${BILLING_SUPPORT_EMAIL}. ${SUPPORT_REPLY_PROMISE.de}`
              : ` or by email to ${BILLING_SUPPORT_EMAIL}. ${SUPPORT_REPLY_PROMISE.en}`}
          </p>
        </section>

        {/* Existing Cohort offer, without unrelated exam-fee or salary comparisons. */}
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
                <strong className="text-[var(--mp-fg)]">Drei Fragenbanken in einem Lernzugang.</strong>{" "}
                {billingSurfaceText("surface_9", "de")} {lang === "de" ? "einmalig." : "one time."}
              </>
            ) : (
              <>
                <strong className="text-[var(--mp-fg)]">Three question banks in one study plan.</strong>{" "}
                {billingSurfaceText("surface_9", "en")} one time.
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
            loading={Boolean(checkoutLoading) || trialBusy}
            isPaid={isPaid}
          />
          {checkoutProblem('cohort')}
        </section>

        {/* Fine print */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-6">
          <p className="text-center mp-small text-[var(--mp-fg-subtle)]">
            {lang === "de"
              ? "Preise in Euro, inkl. österreichischer USt. wo anwendbar. Jeder bezahlte Tarif enthält alle drei Prüfungstypen. Keine versteckten Gebühren."
              : "Prices in Euro, incl. Austrian VAT where applicable. Every paid tier includes all three exam types. No hidden fees."}
          </p>
        </section>

        {/* ══════════ Referral block — invite-only, gated on referralsEnabled ══════════ */}
        {referralsEnabled && (
          <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10">
            <ReferralBlock lang={lang} />
          </section>
        )}

        {/* ══════════ Exam calendar (self-aging) ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10">
          <UpcomingExams lang={lang} variant="compact" />
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
                  ? "Wie funktioniert „Beim ersten Versuch bestehen, oder kostenlos weiterlernen\"?"
                  : "How does \"Pass first try, or study free until you do\" work?"
              }
              a={
                lang === "de"
                  ? "Wenn du die Prüfungs-Kohorte hast, mindestens 70 % der relevanten Fragenbank bearbeitet hast und dann durchfällst, lädst du deinen offiziellen Bescheid hoch. Wir verifizieren innerhalb von 72 Stunden und verlängern deinen Zugang kostenlos bis zum nächsten Prüfungstermin: maximal zwei zusätzliche Zyklen."
                  : "If you're on the Exam Cohort, completed ≥70 % of the relevant Qbank and fail the real exam, you upload your official result. We verify within 72 hours and extend your access free through the next exam cycle, up to two additional cycles."
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
                  ? "Nein, jeder bezahlte Tarif enthält alle drei Prüfungstypen (Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie). Wenn du nur eine Prüfung brauchst, gibt dir der kostenlose Tarif 150 Fragen pro Prüfungstyp."
                  : "No, every paid tier unlocks all three exam types (Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie). If you only need one exam, the free tier gives you 150 questions per exam type."
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
              <h3 className="mp-h2 mb-3" style={{ color: "#ffffff" }}>
                {lang === "de"
                  ? "Bereit für deine nächste Prüfung?"
                  : "Ready for your next exam?"}
              </h3>
              <p className="mp-body max-w-xl mx-auto mb-6" style={{ color: "rgba(255,255,255,0.82)" }}>
                {lang === "de"
                  ? billingSurfaceText("surface_16", "de")
                  : billingSurfaceText("surface_17", "de")}
              </p>
              {isPaid ? (
                <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-white/10 text-white/70">
                  {lang === "de" ? "Du bist bereits auf Pro" : "You're already on Pro"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={openCohortDialog}
                  aria-disabled={Boolean(checkoutLoading) || trialBusy}
                  className="mp-btn mp-btn--lg inline-flex items-center gap-2"
                  style={{
                    background: "var(--mp-accent-teal)",
                    color: "var(--mp-oxford-blue-dk)",
                    opacity: checkoutLoading === "cohort" ? 0.6 : 1,
                  }}
                >
                  <CreditCard className="w-4 h-4" />
                  {checkoutLoading === "cohort"
                    ? lang === "de"
                      ? "Weiterleitung zur Kartenzahlung…"
                      : "Redirecting to card checkout…"
                    : lang === "de"
                      ? "Jetzt mit Karte zahlen"
                      : "Pay by card"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </section>
      </main>
    </AppLayout>
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
    ? (lang === "de" ? "Stichprobentest-Fragen" : "Stichprobentest questions")
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
              ? "Starte kostenlos: 150 Fragen pro Prüfungstyp"
              : "Start free: 150 questions per exam type"}
          </h3>
        </div>
        <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm leading-relaxed">
          {lang === "de"
            ? "150 Fragen je Prüfungstyp (Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie), 450 gesamt, mit Erklärungen, wo vorhanden. Nur Qbank-Modus, kein Ablaufdatum."
            : "150 questions per exam type (Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie), 450 in total, with explanations where available. Qbank-only, no expiry."}
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--mp-fg)]">
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Klinische Erklärungen, wo vorhanden"
              : "Clinical explanations where available"}
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
            0 €
          </span>
          <span className="text-sm text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "/ dauerhaft" : "/ forever"}
          </span>
        </div>
        <PublicStudyLink
          href={`/quiz?exam=${examSource}&free=1`}
          className="mp-btn mp-btn--primary inline-flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap"
        >
          {lang === "de"
            ? `Kostenlos starten: 150 ${examLabel}`
            : `Start free: 150 ${examLabel}`}
          <ArrowRight className="w-3.5 h-3.5" />
        </PublicStudyLink>
        <FreeOfferDisclosure lang={lang} className="md:max-w-sm md:text-right" />
      </div>
    </article>
  );
}

/* ═══════════════════════ €49 / 3-month starter card ═══════════════════════ */

/**
 * 3-month starter tier. €16-effective per month, billed as a single
 * €49 lump sum via Whop card checkout. Tier key: first_3mo_27 (never
 * rename — data key, not a price key).
 *
 * Capped at one purchase per user (server-side). Middle step between
 * the 19 €/month entry and the 129 € Cohort hero.
 */
function Starter3MoCard({
  lang,
  onCheckout,
  loading,
  isPaid,
  referralsEnabled,
}: {
  lang: Lang;
  onCheckout: () => void;
  loading: boolean;
  isPaid: boolean;
  referralsEnabled: boolean;
}) {
  return (
    <article
      aria-label={lang === "de" ? "Empfohlen: 3-Monats-Tarif" : "Recommended: 3-month plan"}
      className="relative rounded-[var(--mp-r-card)] overflow-hidden p-6 md:p-7 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6 items-center"
      style={{
        background: "var(--mp-surface-raised)",
        border: "2px solid var(--mp-viridian)",
        boxShadow: "var(--mp-shadow-elev)",
      }}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {/* Empfohlen sits on the 49 EUR 3-month plan ([name] 2026-10-11). */}
          <span
            className="mp-caption inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full normal-case tracking-[0.08em] text-[var(--mp-fg-on-viridian)]"
            style={{
              background: "var(--mp-viridian)",
              fontSize: "11px",
              fontWeight: 700,
            }}
          >
            {lang === "de" ? "Empfohlen" : "Recommended"}
          </span>
          <h3 className="mp-h3 text-[20px]">
            {lang === "de"
              ? billingSurfaceText("surface_18", "de")
              : billingSurfaceText("surface_19", "de")}
          </h3>
        </div>
        <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm leading-relaxed">
          {lang === "de"
            ? billingPlanLine(lang, { amountCents: TIERS.first_3mo_27.price_cents, cadenceDays: 90 })
            : billingPlanLine(lang, { amountCents: TIERS.first_3mo_27.price_cents, cadenceDays: 90 })}
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
              ? "90 Tage · automatische Verlängerung, bei Whop verwaltbar"
              : "90 days · auto-renews, manage cancellation at Whop"}
          </li>
          {/* Referral reward is invite-only (2026-06-25): only show this perk
              to accounts enrolled in the program (referralsEnabled). Reward
              is a non-cash mechanic (2026-07-11): free Pro through the exam
              window, not a payout, so no € figure here — see /referrals. */}
          {referralsEnabled && (
            <li className="flex items-start gap-2">
              <Check
                className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
                strokeWidth={3}
              />
              {lang === "de"
                ? "Lad zwei Kolleg:innen ein · Pro kostenlos durchs Prüfungsfenster"
                : "Invite two colleagues · Pro free through the exam window"}
            </li>
          )}
          <li className="flex items-start gap-2 text-[var(--mp-fg-subtle)]">
            <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
            {lang === "de"
              ? "Keine Pass-Until-You-Pass-Garantie (nur bei der Prüfungs-Kohorte)"
              : "No Pass-Until-You-Pass guarantee (Exam Cohort only)"}
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 md:items-end">
        <div className="flex flex-col md:items-end">
          <div className="flex items-baseline gap-1.5 md:justify-end">
            <span className="mp-num font-display font-black text-[var(--mp-fg)] text-[36px] leading-none">
              {billingAmount(TIERS.first_3mo_27.price_cents, lang)}
            </span>
            <span className="text-sm text-[var(--mp-fg-subtle)]">
              {lang === "de" ? "pro Quartal" : "per quarter"}
            </span>
          </div>
          <p
            className="mp-small mt-1 md:text-right"
            style={{ color: "var(--mp-viridian)", fontWeight: 600 }}
          >
            {lang === "de"
              ? `${billingAmount(Math.round(TIERS.first_3mo_27.price_cents / TIERS.first_3mo_27.duration_months), lang)} pro Monat · verlängert sich automatisch`
              : `${billingAmount(Math.round(TIERS.first_3mo_27.price_cents / TIERS.first_3mo_27.duration_months), lang)} per month · renews automatically`}
          </p>
        </div>
        {isPaid ? (
          <span className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-semibold w-full md:w-auto bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "Du bist auf Pro" : "You're on Pro"}
          </span>
        ) : (
          <button
            type="button"
            onClick={onCheckout}
            aria-disabled={loading}
            className="mp-btn mp-btn--success inline-flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? (
              <>
                <BrandedLoader size={20} hideLabel />
                {lang === "de" ? "Weiterleitung zur Kartenzahlung…" : "Redirecting to card checkout…"}
              </>
            ) : (
              <>
                <CreditCard className="w-3.5 h-3.5" />
                {lang === "de"
                  ? `${billingAmount(TIERS.first_3mo_27.price_cents, lang)} für 90 Tage starten`
                  : `Start 90 days for ${billingAmount(TIERS.first_3mo_27.price_cents, lang)}`}
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
        <p className="mp-small text-[var(--mp-fg-subtle)] md:text-right">
          {lang === "de"
            ? "Karte · sofort aktiv · bei Whop verwaltbar"
            : "Card · active instantly · manage cancellation at Whop"}
        </p>
      </div>
    </article>
  );
}

/* ═══════════════════════ €19 single-month card ═══════════════════════ */

/**
 * Single-month tier — advertised entry ("ab 19 € im Monat"). 30 days of
 * 19 EUR per month recurring. Tier key: first_month_19. Prospect steps up to the 49 EUR/quarter or the 129 EUR Cohort from here.
 * steps up to the 49 €/3-month starter or the 129 € Cohort from here.
 */
function FirstMonthCard({
  lang,
  onCheckout,
  loading,
  isPaid,
}: {
  lang: Lang;
  onCheckout: () => void;
  loading: boolean;
  isPaid: boolean;
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
            {lang === "de" ? "Einzelmonat · Einstieg" : "Single month · entry"}
          </span>
          <h3 className="mp-h3 text-[20px]">
            {lang === "de"
              ? billingSurfaceText("surface_20", "de")
              : billingSurfaceText("surface_21", "en")}
          </h3>
        </div>
        <p className="mp-body text-[var(--mp-fg-muted)] mb-4 text-sm leading-relaxed">
          {lang === "de"
            ? billingPlanLine(lang, { amountCents: TIERS.first_month_19.price_cents, cadenceDays: 30 })
            : billingPlanLine(lang, { amountCents: TIERS.first_month_19.price_cents, cadenceDays: 30 })}
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
              ? "30 Tage ab Zahlung · verlängert sich automatisch"
              : "30 days from payment · renews automatically"}
          </li>
          <li className="flex items-start gap-2">
            <Check
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]"
              strokeWidth={3}
            />
            {lang === "de"
              ? "Verlängert sich monatlich · bei Whop verwaltbar"
              : "Renews monthly · manage cancellation at Whop"}
          </li>
          <li className="flex items-start gap-2 text-[var(--mp-fg-subtle)]">
            <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
            {lang === "de"
              ? "Keine Pass-Until-You-Pass-Garantie (nur bei der Prüfungs-Kohorte)"
              : "No Pass-Until-You-Pass guarantee (Exam Cohort only)"}
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 md:items-end">
        <div className="flex flex-col md:items-end">
          <div className="flex items-baseline gap-1.5 md:justify-end">
            <span className="mp-num font-display font-black text-[var(--mp-fg)] text-[32px] leading-none">
              {billingAmount(TIERS.first_month_19.price_cents, lang)}
            </span>
            <span className="text-sm text-[var(--mp-fg-subtle)]">
              {lang === "de" ? "pro Monat" : "per month"}
            </span>
          </div>
          <p
            className="mp-small mt-1 md:text-right"
            style={{ color: "var(--mp-cta-blue)", fontWeight: 600 }}
          >
            {lang === "de"
              ? "automatische Verlängerung · bei Whop verwaltbar"
              : "auto-renews · manage cancellation at Whop"}
          </p>
        </div>
        {isPaid ? (
          <span className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-semibold w-full md:w-auto bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "Du bist auf Pro" : "You're on Pro"}
          </span>
        ) : (
          <button
            type="button"
            onClick={onCheckout}
            aria-disabled={loading}
            className="mp-btn mp-btn--secondary inline-flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? (
              <>
                <BrandedLoader size={20} hideLabel />
                {lang === "de" ? "Weiterleitung zur Kartenzahlung…" : "Redirecting to card checkout…"}
              </>
            ) : (
              <>
                <CreditCard className="w-3.5 h-3.5" />
                {lang === "de"
                  ? `${billingAmount(TIERS.first_month_19.price_cents, lang)} für 30 Tage starten`
                  : `Start 30 days for ${billingAmount(TIERS.first_month_19.price_cents, lang)}`}
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
        <p className="mp-small text-[var(--mp-fg-subtle)] md:text-right">
          {lang === "de"
            ? "Karte · sofort aktiv · bei Whop verwaltbar"
            : "Card · active instantly · manage cancellation at Whop"}
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
  isPaid,
}: {
  lang: Lang;
  features: Array<{ de: string; en: string }>;
  onCheckout: () => void;
  loading: boolean;
  isPaid: boolean;
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
            ? "Prüfungs-Kohorte"
            : "Exam Cohort"}
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
            {lang === "de" ? "Prüfungs-Kohorte" : "Exam Cohort"}
          </h3>
          <p className="mp-body text-[var(--mp-fg-muted)] mb-5 max-w-xl">
            {lang === "de"
              ? "Ein einmaliger Preis, sechs Monate Vollzugang auf Kenntnisprüfung, Stichprobentest und Pharmakologie. Sieben Tage Geld-zurück-Garantie auf jede Bestellung. Wenn du nach 7 Tagen weiter lernst und dann durchfällst, verlängern wir deinen Zugang kostenlos: keine Cash-Rückerstattung in dem Fall, dafür Pass-Until-You-Pass. Kartenzahlung läuft über Whop."
              : "One upfront price, six months of full access across Kenntnisprüfung, Stichprobentest and Pharmakologie. 7-day money-back guarantee on every purchase. If you keep studying past day 7 and later fail, we extend your access free: no cash refund at that point, but Pass-Until-You-Pass kicks in. Card checkout runs through Whop."}
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

        {/* RIGHT: Price + card CTA */}
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
                {billingAmount(TIERS.premium_pass_guaranteed.price_cents, lang)}
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
              <CreditCard className="w-3.5 h-3.5" />
              {lang === "de"
                ? "Sichere Kartenzahlung, auch Apple Pay"
                : "Secure card payment, Apple Pay too"}
            </p>
          </div>

          {isPaid ? (
            <div
              className="w-full text-center px-4 py-3 rounded-lg text-sm font-semibold"
              style={{
                background: "var(--mp-success-bg)",
                color: "var(--mp-viridian)",
                border: "1px solid rgba(0,123,95,0.25)",
              }}
            >
              {lang === "de" ? "Du bist bereits auf Pro" : "You're already on Pro"}
            </div>
          ) : (
            <button
              type="button"
              onClick={onCheckout}
              aria-disabled={loading}
              className="mp-btn mp-btn--success mp-btn--lg w-full inline-flex items-center justify-center gap-2"
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? (
                <>
                  <BrandedLoader size={24} hideLabel />
                  {lang === "de" ? "Weiterleitung zur Kartenzahlung…" : "Redirecting to card checkout…"}
                </>
              ) : (
                <>
                  {lang === "de" ? "Jetzt mit Karte zahlen" : "Pay by card"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}

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

/* ═══════════════════════ Referral block ═══════════════════════ */

function ReferralBlock({ lang }: { lang: Lang }) {
  // Non-cash referral mechanic (2026-07-11, supersedes the cash-tiered
  // copy this block used to carry): invite 2 colleagues who actually
  // study with you, both qualify by activity, you get Pro free through
  // your exam window. No € figure anywhere in this block by design —
  // MEDPRUF-SOT.md §2.x voice rules (referral copy never carries a price).
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
          ? "Lad zwei Kolleg:innen ein, bekomm Pro kostenlos durchs Prüfungsfenster."
          : "Invite two colleagues, get Pro free through the exam window."}
      </h3>
      <p className="text-sm text-[var(--mp-fg-muted)] mb-5 max-w-2xl leading-relaxed">
        {lang === "de"
          ? billingSurfaceText("surface_22", "de")
          : billingSurfaceText("surface_23", "en")}
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
          ? "Du fällst durch? Wir verlängern, kostenlos."
          : "Fail the exam? We extend, free."}
      </h3>
      <p className="text-sm text-[var(--mp-fg-muted)] mb-5 max-w-2xl leading-relaxed">
        {lang === "de"
          ? "Zwei Schutz-Ebenen: 7-Tage-Geld-zurück-Garantie auf jede Bestellung, und wenn du nach 7 Tagen weiter lernst und dann beim ersten Versuch durchfällst, verlängern wir deinen Zugang kostenlos (Pass-Until-You-Pass). PUYP gilt für die Prüfungs-Kohorte."
          : "Two layers of protection: 7-day money-back guarantee on every purchase, and if you keep studying past day 7 and later fail your first attempt, we extend your access free (Pass-Until-You-Pass). PUYP applies to the Exam Cohort."}
      </p>

      <ul className="space-y-2 mb-5">
        {[
          lang === "de"
            ? "Prüfungsergebnis (PDF oder Foto) hochladen, Admin prüft innerhalb 72 Stunden."
            : "Upload your official result (PDF or photo), admin verifies within 72 hours.",
          lang === "de"
            ? "Mindestens 70 % der relevanten Fragenbank müssen bearbeitet sein."
            : "At least 70 % of the relevant Qbank must be completed.",
          lang === "de"
            ? "Bis zu zwei zusätzliche Zyklen, also bis zu 18 Monate Zugang aus einer 129-€-Zahlung."
            : billingSurfaceText("surface_24", "en"),
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
