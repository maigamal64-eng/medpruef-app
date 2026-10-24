"use client";
/**
 * /pricing (a21, 2026-10-12).
 *
 * Offer ([name]'s picks): the 49 € 3-month plan carries the one "Empfohlen"
 * badge and leads; the monthly plan and the Exam Cohort follow in the same
 * anatomy (pick-offer-order A, UX-PUB-21 A); the Pro-Test and the free start
 * stay visible (pick-trial-shape A). The guarantee appears only inside the
 * Kohorte card (UX-PUB-20, UX-PUB-23). Copy in formal Sie.
 *
 * Money path:
 *   - paid CTAs POST /api/whop/checkout {tier} and redirect to Whop; signed-out
 *     visitors register first and the chosen plan resumes after login
 *   - with NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED the confirm sheet (UX-PUB-25 B)
 *     stands before every checkout and is the resume stop after login; with
 *     the flag off (default) the resume opens checkout directly, as before
 *   - active one-time Pro may extend from its current end date (flag
 *     WHOP_EXTENSIONS_ENABLED, default off); a plan Whop confirms renews by
 *     itself gets ALREADY_RENEWING, an unverifiable plan PLAN_UNVERIFIED, and
 *     neither is offered a second plan; the resume after login runs the
 *     same per-plan check
 *   - a pending payment guards every pay button (UX-ACC-07)
 *   - responses are read by `code`, never by status alone (UX-ACC-09, LX-26)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Crown, Gift, Share2 } from "lucide-react";
import { createActionGate } from "@/lib/account-request";
import { featureFromGate, type Feature } from "@/lib/entitlements";
import { gateSentence } from "@/lib/entitlement-copy";
import { buildAuthHref, parseAuthEntry } from "@/lib/auth-entry";
import { billingAccountSentence, billingAmount, BILLING_SUPPORT_EMAIL, SUPPORT_REPLY_PROMISE, WHOP_MANAGE_URL } from "@/lib/billing-copy";
import { claimsFor, claimText } from "@/lib/learning-claims";
import { FREE_TIER } from "@/lib/content-truth";
import { referralRewardBullets, referralDisclosure } from "@/lib/referral-copy";
import { puypScopeLine } from "@/lib/puyp-copy";
import { t, getLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { authFetch as fetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { goBack } from "@/lib/go-back";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import type { SubscriptionCardSnapshot } from "@/lib/subscription-display";
import PendingPaymentBanner from "@/components/PendingPaymentBanner";
import BillingReceipt from "@/components/BillingReceipt";
import PublicStudyLink from "@/components/PublicStudyLink";
import FreeOfferDisclosure from "@/components/FreeOfferDisclosure";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { Alert, AppLayout, Skeleton } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import UpcomingExams from "@/components/UpcomingExams";
import TrialActivation from "@/components/TrialActivation";
import CheckoutStallPrompt from "@/components/CheckoutStallPrompt";
import { CHECKOUT_RETURN_READ_BUILD, markCheckoutLeft, pricingPromptArmed, RETURN_EVENT } from "@/lib/checkout-return-marker";
import SupportContactForm from "@/components/SupportContactForm";
import LocalizedBillingTerms from "@/components/billing/LocalizedBillingTerms";
import PlanCard, { type PlanAction } from "./_parts/PlanCard";
import PlanCoverBlock from "./_parts/PlanCoverBlock";
import { METHOD_SENTENCE } from "@/lib/checkout-confirm-copy";
import { detectCheckoutContext, openCheckout } from "@/lib/checkout-context-client";
import { tgCheckoutCopy } from "@/lib/tg-checkout-copy";
import CheckoutConfirmSheet, { CHECKOUT_CONFIRM_ENABLED } from "./_parts/CheckoutConfirmSheet";
import CheckoutProblem, { type CheckoutProblemState } from "./_parts/CheckoutProblem";
import { ACTION_FOR, PLAN_ORDER, RECOMMENDED, SLOT_FOR, TIER_FOR_ACTION, longDate, type PaidTier, type Slot } from "./_parts/plans";
import ExamTimingPicker, { timingOf, type TimingChoice } from "./_parts/ExamTimingPicker";
import ReverseTrialTile from "./_parts/ReverseTrialTile";
import { V2_PLAN_ORDER, isV2Tier, recommendTier, type V2Tier } from "@/lib/pricing-v2/offer";
import type { V2Readiness } from "@/lib/pricing-v2/readiness";
import { sittingOptions, sittingPassEnd } from "@/lib/pricing-v2/sitting-pass";
import { sittingFit } from "@/lib/pricing-v2/fit";
import { RETURNING_TIERS } from "@/lib/pricing-v2/price-facts";
import { fitLines } from "./_parts/fit-copy";
import { ticketScopeLine } from "@/lib/pricing-v2/ticket";
import { asPuypExamType, type PuypExamType } from "@/lib/exam-dates";
import { trackCardTrialClick, trackCardTrialView } from "@/lib/card-trial-events";

type Lang = "de" | "en";
type RenewalState = "renews" | "unknown" | "cancelled" | "one_time";
type SubInfo = { renewal: RenewalState; extendable: boolean; switchTiers: string[]; subscription: SubscriptionCardSnapshot | null } | "error" | null;

/**
 * Server-read switches (page.tsx). v2 false = today's offer, unchanged.
 * a-pricing-v2: v2 shows the four new plans, "When is your exam?" and the
 * Guarantee Ticket terms; reverseTrial swaps the card-trial tile for the
 * no-card 3-day trial.
 */
export interface PricingOffer {
  v2: boolean;
  reverseTrial: boolean;
  ready: V2Readiness;
  /** The ticket's included Mentor credits, null while the Mentor is not ready. */
  ticketMentorCredits: number | null;
  /** a-pricing-v2-fit: the 6-month renewal guard runs for real (the totals count on it). */
  halfYearGuard: boolean;
}

const V1_OFFER: PricingOffer = { v2: false, reverseTrial: false, ready: { flex_month: false, sitting_pass: false, half_year: false, guarantee_ticket: false }, ticketMentorCredits: null, halfYearGuard: false };

/** The method wording of the footer and FAQ follows the confirm step (same flag), so flag off keeps today's page. */
const CONFIRM_ON = CHECKOUT_CONFIRM_ENABLED;

/** renderedAt: ISO instant of the server render; /pricing is prerendered, so the calendar hydrates with it (a-landing-418-fix). */
export default function PricingPage({ offer = V1_OFFER, renderedAt }: { offer?: PricingOffer; renderedAt: string }) {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>("de");
  const [trialResume, setTrialResume] = useState(false);
  const [proGate, setProGate] = useState<Feature | null>(null);
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [storedExam, setStoredExam] = useState<ExamSourceId>("kenntnispruefung");
  const [examDate, setExamDate] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<Slot | null>(null);
  const [checkoutSlow, setCheckoutSlow] = useState(false);
  const [openedExternal, setOpenedExternal] = useState<{ tier: PaidTier; url: string } | null>(null);
  const openedNote = useRef<HTMLDivElement>(null);
  // The plan buttons sit far below the note: bring it into view once Telegram has taken the page.
  // release-int-8: with the confirm sheet (NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED) the
  // Dialog returns focus to the plan button on the next frame; land after it.
  useEffect(() => {
    if (!openedExternal) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => { openedNote.current?.scrollIntoView({ block: "center" }); openedNote.current?.focus({ preventScroll: true }); });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [openedExternal]);
  const [checkoutFailure, setCheckoutFailure] = useState<{ tier: PaidTier; state: CheckoutProblemState } | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  // a-checkout-return-read: the return from Whop landed here; the one-tap reasons show inline, once.
  const [returnArmed, setReturnArmed] = useState(false);
  useEffect(() => {
    const sync = () => { if (pricingPromptArmed()) setReturnArmed(true); };
    sync();
    window.addEventListener(RETURN_EVENT, sync);
    return () => window.removeEventListener(RETURN_EVENT, sync);
  }, []);
  const [subInfo, setSubInfo] = useState<SubInfo>(null);
  const [confirmTier, setConfirmTier] = useState<PaidTier | null>(null);
  // a-pricing-v2: "When is your exam?" (v2 only).
  const [timingBank, setTimingBank] = useState<PuypExamType>("kenntnispruefung");
  const [timing, setTiming] = useState<TimingChoice | null>(null);
  const [sittingNeeded, setSittingNeeded] = useState(false);
  // a-pricing-v2-fit (decision returning-payer-price, D-A): a learner with a
  // succeeded Whop payment also sees the old recurring plans. The server
  // decides (GET /api/pricing/returning) and checkout checks it again.
  const [returningPayer, setReturningPayer] = useState(false);
  const checkoutGate = useRef(createActionGate());
  const request = useRef<AbortController | null>(null);
  const checkoutActionHandled = useRef(false);
  const [tierSettled, setTierSettled] = useState(false);

  const { isPaid: paidOrTrial, isAdmin, tierExpiresAt, referralsEnabled, reverseTrialEndsAt, seedSeatEndsAt, trialTelegramLink, isLoading: tierLoading, refresh: refreshTier } = useUserTier();
  // a-pricing-v2: access that only comes from the no-card reverse trial buys
  // like a free account (the checkout route applies the same rule).
  // a-seed-seats: a seed seat is never a payment; its holder buys like a trialist (checkout agrees).
  const isPaid = paidOrTrial && !reverseTrialEndsAt && !seedSeatEndsAt;
  // The first account answer has arrived (the stored session may be stale).
  useEffect(() => { if (!tierLoading) setTierSettled(true); }, [tierLoading]);
  const user = session?.user;
  const signedIn = Boolean(user && !user.id.startsWith("guest_"));

  // Reset on a bfcache return or a tab coming back: never a dead page (UX-ACC-09).
  useEffect(() => {
    const reset = () => { request.current?.abort(); request.current = null; checkoutGate.current.leave(); setCheckoutLoading(null); setCheckoutSlow(false); setTrialBusy(false); refreshTier(); };
    // A tab switch during the checkout request must not abort it: the server
    // has already logged the redirect, so an abort would leave a 30-minute
    // pending lock without a Whop page. Only a settled or bfcache page resets.
    const visible = () => { if (document.visibilityState === "visible" && !request.current) reset(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    document.addEventListener("visibilitychange", visible); window.addEventListener("pageshow", restored);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("pageshow", restored); };
  }, [refreshTier]);
  useEffect(() => {
    if (!checkoutLoading) return;
    const timer = setTimeout(() => setCheckoutSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [checkoutLoading]);

  useEffect(() => {
    setLangState(getLang());
    setSession(getStoredSession());
    const params = new URLSearchParams(window.location.search);
    const exam = parseAuthEntry(params).exam || getStoredExamSource();
    setStoredExam(exam);
    const bank = asPuypExamType(params.get("bank")) ?? asPuypExamType(exam);
    if (bank) setTimingBank(bank);
    const sittingDate = params.get("sitting");
    const sittingEnd = params.get("sitting_end");
    if (bank && sittingDate && /^\d{4}-\d{2}-\d{2}$/.test(sittingDate) && sittingEnd && /^\d{4}-\d{2}-\d{2}$/.test(sittingEnd)) {
      setTiming({ kind: "sitting", bank, date: sittingDate, lastDay: sittingEnd });
    }
    setTrialResume(params.get("action") === "trial" || params.get("intent") === "trial");
    setProGate(featureFromGate(params.get("gate")));
    setMounted(true);
  }, []);

  // a-v2-copy-surfaces-1021: the page body renders only after mount, so a
  // plain #anchor link (FAQ, exam result: #plan-guarantee-ticket) finds its
  // target only now. Resume flows (?action=) do their own scrolling.
  useEffect(() => {
    if (!mounted) return;
    // Plain ASCII ids only, never decoded (a bad percent sequence would throw).
    const id = window.location.hash.slice(1);
    if (!/^[\w-]{1,64}$/.test(id) || new URLSearchParams(window.location.search).has("action")) return;
    const raf = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  // Billing state and exam date for signed-in learners.
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    fetch("/api/user/exam-preference", { timeoutMs: 8_000, skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active && typeof d?.examDate === "string") setExamDate(d.examDate); })
      .catch(() => {});
    return () => { active = false; };
  }, [signedIn]);
  const loadSub = useCallback(async () => {
    if (!signedIn || !isPaid) { setSubInfo(null); return; }
    try {
      const r = await fetch("/api/user/subscription", { timeoutMs: 8_000, skipAuthRedirect: true });
      if (!r.ok) throw new Error("subscription unavailable");
      const d = await r.json();
      // The server owns both answers: "renews" only when Whop confirms it
      // (src/lib/renewal-state.ts); extension is off by default and limited
      // to Whop-owned access (src/lib/whop-extension.ts).
      const sub = d?.subscription ?? null;
      const renewal: RenewalState = ["renews", "cancelled", "one_time"].includes(d?.renewal_state) ? d.renewal_state : "unknown";
      const extendable = d?.extension_available === true;
      // a-renew-early: a renewing plan may switch only to these longer plans.
      const switchTiers = Array.isArray(d?.switch_tiers) ? (d.switch_tiers as unknown[]).filter((x): x is string => typeof x === "string") : [];
      setSubInfo({ renewal, extendable, switchTiers, subscription: sub });
    } catch { setSubInfo("error"); }
  }, [signedIn, isPaid]);
  useEffect(() => { void loadSub(); }, [loadSub]);
  useEffect(() => {
    if (!signedIn || !offer.v2) { setReturningPayer(false); return; }
    let active = true;
    fetch("/api/pricing/returning", { timeoutMs: 8_000, skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active) setReturningPayer(d?.eligible === true); })
      .catch(() => { if (active) setReturningPayer(false); });
    return () => { active = false; };
  }, [signedIn, offer.v2]);

  // a-pricing-v2: a saved exam date that is an official sitting of the bank
  // preselects it (never overrides a choice the learner already made).
  useEffect(() => {
    if (!offer.v2 || !examDate || timing) return;
    const match = sittingOptions(timingBank).find((o) => o.date === examDate.slice(0, 10) || o.lastDay === examDate.slice(0, 10));
    if (match) setTiming((current) => current ?? { kind: "sitting", bank: match.bank, date: match.date, lastDay: match.lastDay });
  }, [offer.v2, examDate, timing, timingBank]);

  /** The sitting this checkout carries (v2 Sitting Pass and 6 months). */
  const sittingFor = useCallback((tier: PaidTier) => {
    if (!offer.v2 || (tier !== "sitting_pass" && tier !== "half_year") || timing?.kind !== "sitting") return null;
    return { bank: timing.bank, date: timing.date, lastDay: timing.lastDay };
  }, [offer.v2, timing]);
  /** Login keeps the plan and, for a pass, the chosen sitting. */
  const resumeNext = useCallback((tier: PaidTier) => {
    const sitting = sittingFor(tier);
    const extra = sitting ? `&bank=${sitting.bank}&sitting=${sitting.date}&sitting_end=${sitting.lastDay}` : "";
    return `/pricing?action=${ACTION_FOR[tier]}${extra}`;
  }, [sittingFor]);

  // Only a server-confirmed extension starts from the current end date; the
  // confirm sheet never promises a later start the checkout would refuse.
  const extendsFrom = isPaid && tierExpiresAt && subInfo && subInfo !== "error" && subInfo.extendable ? tierExpiresAt : null;
  /** a-renew-early: this plan replaces a plan that still renews (the old renewal stops after the payment). */
  const isSwitch = useCallback((tier: PaidTier) =>
    Boolean(isPaid && subInfo && subInfo !== "error" && subInfo.renewal === "renews" && subInfo.extendable && subInfo.switchTiers.includes(tier)),
  [isPaid, subInfo]);

  /**
   * What a paid click may do for this account. The same answer holds for
   * every plan today (the server checks the account, not the plan); the
   * resume after login runs this check too. "checking" waits for the answer.
   */
  const actionFor = useCallback((tier?: PaidTier): PlanAction | { kind: "checking" } => {
    const isDe = lang === "de";
    if (!signedIn) return { kind: "signin" };
    if (isAdmin) return { kind: "none", note: isDe ? "Admin-Konto: kein Kauf nötig." : "Admin account: no purchase needed." };
    if (!isPaid) return { kind: "buy" };
    if (!tierExpiresAt) return { kind: "none", note: t("account_checkout_already", lang) };
    if (subInfo === null) return { kind: "checking" };
    if (subInfo === "error" || subInfo.renewal === "unknown") return { kind: "none", note: t("account_plan_unverified", lang) };
    if (subInfo.renewal === "renews") {
      // a-renew-early: a strictly longer plan may replace it (server list).
      if (tier && subInfo.extendable && subInfo.switchTiers.includes(tier)) return { kind: "extend" };
      return { kind: "none", note: t(subInfo.extendable && subInfo.switchTiers.length > 0 ? "account_plan_renews_switch" : "account_plan_renews", lang) };
    }
    // Not Whop-owned (comp or manual access) or flag off: no extension
    // (whop-extension.ts). A plan cancelled at Whop is extendable since
    // a-renew-early (its own row and pin).
    if (!subInfo.extendable) return { kind: "none", note: t("account_extension_unavailable", lang) };
    // The Sitting Pass is never added onto running access (checkout says the same).
    if (tier === "sitting_pass") return { kind: "none", note: t("account_extension_unavailable", lang) };
    return { kind: "extend" };
  }, [lang, signedIn, isPaid, isAdmin, tierExpiresAt, subInfo]);

  const createCheckout = useCallback(async (tier: PaidTier) => {
    const slot = SLOT_FOR[tier];
    // a-pricing-v2: the Sitting Pass and 6 months need a sitting before anything else.
    if ((tier === "sitting_pass" || tier === "half_year") && !sittingFor(tier)) {
      setSittingNeeded(true);
      document.getElementById("exam-timing")?.scrollIntoView({ block: "start" });
      return;
    }
    if (!signedIn) { window.location.href = buildAuthHref({ exam: storedExam, next: resumeNext(tier) }); return; }
    if (paymentPending || trialBusy || !checkoutGate.current.enter()) return;
    const controller = new AbortController(); request.current = controller;
    setCheckoutLoading(slot); setCheckoutFailure(null); setCheckoutSlow(false); setOpenedExternal(null);
    try {
      const r = await fetch("/api/whop/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(sittingFor(tier) ? { tier, sitting: sittingFor(tier), context: detectCheckoutContext() } : { tier, context: detectCheckoutContext() }), timeoutMs: 15_000, signal: controller.signal, skipAuthRedirect: true,
      });
      const data = (await r.json().catch(() => ({}))) as { purchaseUrl?: string; code?: string };
      if (controller.signal.aborted) return;
      if (r.ok && data?.purchaseUrl) {
        request.current = null;
        // a-tg-checkout-context: in a Mini App (flag on) Telegram opens the page outside; this page stays.
        // The return marker is only for a page that really leaves (else the stall prompt would arm here).
        if (openCheckout(data.purchaseUrl) === "opened_external") { checkoutGate.current.leave(); setCheckoutLoading(null); setOpenedExternal({ tier, url: data.purchaseUrl }); }
        else if (CHECKOUT_RETURN_READ_BUILD) markCheckoutLeft(tier);
        return;
      }
      const state: CheckoutProblemState = data?.code === "CHECKOUT_PENDING" ? "pending"
        : data?.code === "ALREADY_RENEWING" ? "renewing"
        : data?.code === "ALREADY_PRO" ? "already"
        : data?.code === "EXTENSION_UNAVAILABLE" ? "extension"
        : data?.code === "PLAN_UNVERIFIED" ? "unverified"
        : data?.code === "PLAN_NOT_READY" ? "not_ready"
        : data?.code === "SITTING_REQUIRED" ? "sitting"
        : r.status === 401 ? "signin"
        : "failed";
      setCheckoutFailure({ tier, state });
      if (state === "pending") setPaymentPending(true);
      if (state === "renewing" || state === "already" || state === "extension" || state === "unverified") { refreshTier(); void loadSub(); }
    } catch {
      if (!controller.signal.aborted) setCheckoutFailure({ tier, state: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "failed" });
    }
    if (request.current === controller) { request.current = null; checkoutGate.current.leave(); setCheckoutLoading(null); }
  }, [signedIn, storedExam, paymentPending, trialBusy, refreshTier, loadSub, sittingFor, resumeNext]);

  /** Every paid click: the confirm sheet when the flag is on, else straight to checkout. */
  const chooseTier = useCallback((tier: PaidTier) => {
    if (!signedIn) { void createCheckout(tier); return; }
    if (paymentPending || checkoutLoading || trialBusy) return;
    // a-renew-early: a switch always shows the sheet, so the learner reads
    // that the old renewal stops before paying.
    if (CHECKOUT_CONFIRM_ENABLED || isSwitch(tier)) setConfirmTier(tier);
    else void createCheckout(tier);
  }, [signedIn, paymentPending, checkoutLoading, trialBusy, createCheckout, isSwitch]);

  // Login preserves the requested plan in `next`. The resume waits for the
  // account and plan answers and runs the same per-plan check as a click:
  // only "buy" or "extend" resumes; active Pro sees the status card instead
  // of a confirm sheet that a 409 would contradict. Remove the query first so
  // refresh or Back cannot submit it twice; with the confirm flag on, the
  // sheet is the resume stop (UX-PUB-25 B), never a silent redirect.
  useEffect(() => {
    if (!mounted || !signedIn || checkoutActionHandled.current) return;
    const action = new URLSearchParams(window.location.search).get("action");
    if (action === "renew") {
      checkoutActionHandled.current = true;
      document.getElementById("plans")?.scrollIntoView({ block: "start" });
      return;
    }
    const tier = action ? TIER_FOR_ACTION[action] : undefined;
    if (!tier) return;
    // a-pricing-v2: a link from the other offer opens the plans instead of a checkout the server would refuse.
    if (isV2Tier(tier) !== offer.v2) {
      checkoutActionHandled.current = true;
      document.getElementById("plans")?.scrollIntoView({ block: "start" });
      return;
    }
    if (!tierSettled) return;
    const next = actionFor(tier);
    if (next.kind === "checking") return;
    checkoutActionHandled.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState(window.history.state, "", url.toString());
    if (next.kind === "buy" || next.kind === "extend") chooseTier(tier);
    else (document.getElementById("pro-status") ?? document.getElementById("plans"))?.scrollIntoView({ block: "start" });
  }, [mounted, signedIn, tierSettled, actionFor, chooseTier, offer.v2]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[var(--mp-surface-sunken)] p-4 space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  const de = lang === "de";

  // Pro status card (signed-in, paid, not admin) carries the account note
  // once; the plan cards then show no button and no repeated note.
  const statusCard = signedIn && isPaid && !isAdmin;
  const accountAction = actionFor();
  const accountNote = accountAction.kind === "checking" ? (de ? "Ihr Abo wird geprüft." : "Checking your plan.")
    : accountAction.kind === "none" ? accountAction.note : null;
  // "checking" only arises for signed-in paid accounts, so it has a status card.
  const cardAction = (tier: PaidTier): PlanAction => {
    const a = actionFor(tier);
    if (a.kind === "checking" || (a.kind === "none" && statusCard)) return { kind: "none", note: "" };
    return a;
  };
  const busy = Boolean(checkoutLoading) || trialBusy || paymentPending;
  // a-pricing-v2: the one plan "When is your exam?" marks (none before an answer).
  // a-pricing-v2-fit: for a sitting, the cheapest plan that covers it among
  // the plans on sale, with each plan's total (fit.ts).
  const fitOptions = { guard: offer.halfYearGuard, ready: offer.ready };
  const recommendedTiming = timingOf(timing);
  const recommended: V2Tier | null = recommendedTiming ? recommendTier(recommendedTiming, new Date(), fitOptions) : null;
  const fit = timing?.kind === "sitting" ? sittingFit({ date: timing.date, lastDay: timing.lastDay }, new Date(), fitOptions) : null;
  const passEnd = timing?.kind === "sitting" ? sittingPassEnd(timing.lastDay).toISOString() : null;
  // The 3-month cap cuts the pass before the sitting itself: say so (Lektor).
  const passEndsBeforeSitting = Boolean(passEnd && timing?.kind === "sitting" && Date.parse(passEnd) < Date.parse(`${timing.lastDay}T23:59:59Z`));
  // A plan whose promise is not running yet shows no button (readiness.ts).
  const v2Action = (tier: V2Tier): PlanAction => {
    const a = cardAction(tier);
    if ((a.kind === "buy" || a.kind === "signin" || a.kind === "extend") && !offer.ready[tier]) return { kind: "none", note: de ? "Noch nicht verfügbar." : "Not available yet." };
    return a;
  };
  const problemFor = (tier: PaidTier) => checkoutFailure?.tier === tier && (
    <CheckoutProblem
      state={checkoutFailure.state}
      lang={lang}
      onRetry={() => void createCheckout(tier)}
      onCheck={() => { window.location.href = `/checkout/success?tier=${tier}`; }}
      onSignIn={() => { window.location.href = buildAuthHref({ exam: storedExam, next: resumeNext(tier) }, "signin_required"); }}
    />
  );
  const subscription = subInfo && subInfo !== "error" ? subInfo.subscription : null;
  // Every bullet renders from the claims register (LX-30); an unregistered
  // bullet cannot ship. Code path and test per id: learning-claims.data.json.
  const cohortFeatures: Array<{ de: string; en: string }> = claimsFor("pricing.cohort").map((c) => claimText(c.id));
  // Guarantee and 6-month validity belong to the Kohorte card; the rest is
  // what every paid plan includes, stated once (UX-ACC-12).
  const cohortIds = claimsFor("pricing.cohort").map((c) => c.id);
  const COHORT_ONLY = new Set(["pricing.puyp", "pricing.validity"]);
  const proIncludes = cohortFeatures.filter((_, i) => !COHORT_ONLY.has(cohortIds[i])).map((f) => f[lang]);
  const cohortOnly = cohortFeatures.filter((_, i) => COHORT_ONLY.has(cohortIds[i])).map((f) => f[lang]);

  return (
    <AppLayout
      mode={user ? "standard" : "public"}
      className="pricing-layout"
      sidebar={<Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />}
      bottomNav={<BottomNav lang={lang} userId={user?.id} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)] pb-24">
        {/* Header: Back, title, controls; visitors also get sign-in links (UX-ACC-14). */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
          <button type="button" onClick={() => goBack(router, signedIn)} className="inline-flex min-h-11 items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm">
            <ArrowLeft className="w-4 h-4" aria-hidden />
            {de ? "Zurück" : "Back"}
          </button>
          <p className="text-base font-bold text-[var(--mp-fg)] flex items-center gap-2 m-0">
            <Crown className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
            {de ? "Preise" : "Pricing"}
          </p>
          {/* Wraps on phones: a longer language label (ru/uk/tr/ar readers) must never widen the page (a29). */}
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
            {!signedIn && (
              <>
                <Link href={`/login?mode=login&next=${encodeURIComponent("/pricing")}`} className="inline-flex min-h-11 items-center px-2 text-sm underline">{de ? "Einloggen" : "Sign in"}</Link>
                <Link href={buildAuthHref({ exam: storedExam, next: "/pricing" })} className="mp-btn mp-btn--secondary min-h-11 text-sm">{de ? "Registrieren" : "Register"}</Link>
              </>
            )}
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={(l: Lang) => setLangState(l)} />
          </div>
        </div>

        <PendingPaymentBanner onPendingChange={setPaymentPending} />
        {signedIn && !paymentPending && returnArmed && (
          <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-4">
            <CheckoutStallPrompt surface="pricing" armed />
          </section>
        )}
        {(checkoutLoading || trialBusy) && <p role="status" className="mp-card p-4 m-4 text-sm">{t("account_checkout_opening", lang)}. {t("account_return", lang)}</p>}
        {openedExternal && !checkoutLoading && <div ref={openedNote} tabIndex={-1} role="status" className="mp-card p-4 m-4 text-sm space-y-2 outline-none" data-testid="checkout-opened-external">
          <p className="m-0">{tgCheckoutCopy("opened_note", lang)}</p>
          <div className="flex flex-wrap gap-2">
            <Link className="mp-btn mp-btn--secondary min-h-11" href={`/checkout/success?tier=${encodeURIComponent(openedExternal.tier)}`}>{tgCheckoutCopy("check_payment", lang)}</Link>
            <button type="button" className="mp-btn mp-btn--ghost min-h-11" onClick={() => { openCheckout(openedExternal.url); }}>{tgCheckoutCopy("reopen", lang)}</button>
          </div>
        </div>}
        {checkoutSlow && checkoutLoading && (
          <button type="button" className="mp-btn mp-btn--secondary min-h-11 m-4" onClick={() => {
            const slot = checkoutLoading;
            request.current?.abort(); checkoutGate.current.leave(); setCheckoutLoading(null); setCheckoutSlow(false);
            void createCheckout([...PLAN_ORDER, ...V2_PLAN_ORDER].find((tier) => SLOT_FOR[tier] === slot) ?? RECOMMENDED);
          }}>{t("account_checkout_retry", lang)}</button>
        )}

        {proGate && (
          <div className="max-w-5xl mx-auto px-4 lg:px-8 pt-6">
            <Alert variant="info" title={gateSentence(proGate, lang)} onClose={() => setProGate(null)}>
              {de
                ? "Mit dem kostenlosen Tarif üben Sie weiterhin Ihre freien Fragen je Fragenbank. Für diese Funktion wählen Sie unten einen Pro-Tarif."
                : "On the free plan you can keep practising your free questions per question bank. For this feature, choose a Pro plan below."}
              <Link href="/quiz" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">{de ? "Zurück zur Übung" : "Back to practice"}</Link>
            </Alert>
          </div>
        )}

        {/* Hero (UX-PUB-20, UX-ACC-11): H1, one scope line, plans right below. */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-6 pb-3">
          <h1 className="font-display font-extrabold text-[var(--mp-fg)] leading-tight m-0" style={{ fontSize: "clamp(26px, 7vw, 30px)" }}>
            {de ? "Wählen Sie, wie lange Sie üben möchten." : "Choose how long you want to practise."}
          </h1>
          <p className="mp-body text-[var(--mp-fg-muted)] mt-2 mb-0">{offer.v2 ? ticketScopeLine(lang) : puypScopeLine(lang)}</p>
        </section>

        {/* Signed-in Pro: what they have and what a new payment would do. */}
        {signedIn && isPaid && !isAdmin && (
          <section id="pro-status" className="max-w-5xl mx-auto px-4 lg:px-8 pb-3 scroll-mt-20">
            <div className="mp-card p-4 text-sm space-y-1" role="status">
              {subscription ? <p className="m-0">{billingAccountSentence(subscription, lang)}</p>
                : tierExpiresAt ? <p className="m-0">{de ? `Ihr Pro-Zugang läuft bis ${longDate(tierExpiresAt, lang)}.` : `Your Pro access runs until ${longDate(tierExpiresAt, lang)}.`}</p>
                : <p className="m-0">{t("account_checkout_already", lang)}</p>}
              {accountNote && <p className="m-0 text-[var(--mp-fg-muted)]" data-account-note>{accountNote}</p>}
              {(subInfo === "error" || (subInfo !== null && subInfo.renewal === "unknown")) && (
                <button type="button" className="inline-flex min-h-11 items-center underline text-sm" onClick={() => { setSubInfo(null); void loadSub(); }}>{t("account_check_again", lang)}</button>
              )}
              {accountAction.kind === "extend" && tierExpiresAt && (
                <p className="m-0 text-[var(--mp-fg-muted)]">{de ? `Sie können jetzt verlängern. Die neue Laufzeit beginnt, wenn Ihr jetziger Zugang am ${longDate(tierExpiresAt, lang)} endet.` : `You can extend now. The new period starts when your current access ends on ${longDate(tierExpiresAt, lang)}.`}</p>
              )}
              <BillingReceipt />
              {/* a-pricing-v2: a ticket holder reaches the renewal form from here (and from the reminder email). */}
              {offer.v2 && subscription?.tier === "guarantee_ticket" && (
                <Link href="/ticket-renewal" className="inline-flex min-h-11 items-center underline">{de ? "Kostenloses Verlängerungsjahr beantragen" : "Request a free renewal year"}</Link>
              )}
              {subInfo !== null && subInfo !== "error" && subInfo.renewal !== "one_time" && (
                <a className="inline-flex min-h-11 items-center underline" href={WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer">{de ? "Abo bei Whop verwalten (öffnet einen neuen Tab, Seite auf Englisch)" : "Manage your plan at Whop (opens a new tab)"}</a>
              )}
            </div>
          </section>
        )}

        {/* a-pricing-v2: "When is your exam?" marks the fitting plan; all stay visible. */}
        {offer.v2 && (
          <div id="exam-timing" className="max-w-5xl mx-auto px-4 lg:px-8 pb-4 scroll-mt-20">
            <ExamTimingPicker
              lang={lang}
              renderedAt={renderedAt}
              bank={timingBank}
              onBankChange={(bank) => { setTimingBank(bank); setTiming((t) => (t?.kind === "sitting" ? null : t)); }}
              value={timing}
              onChange={(choice) => { setTiming(choice); setSittingNeeded(false); }}
            />
            {sittingNeeded && (
              <p role="alert" className="mp-card p-4 mt-3 text-sm m-0" data-sitting-needed>
                {t("account_sitting_required", lang)}
              </p>
            )}
          </div>
        )}

        {/* Paid plans in one anatomy, recommended first (pick-offer-order A). */}
        <section id="plans" aria-label={de ? "Tarife" : "Plans"} className="max-w-5xl mx-auto px-4 lg:px-8 pb-4 space-y-3 scroll-mt-20">
          {offer.v2 && V2_PLAN_ORDER.map((tier) => (
            <div key={tier} id={`plan-${tier.replace("_", "-")}`} className="scroll-mt-20">
              <PlanCard
                tier={tier}
                lang={lang}
                featured={tier === recommended}
                action={v2Action(tier)}
                loading={checkoutLoading === SLOT_FOR[tier]}
                busy={busy}
                onCheckout={() => chooseTier(tier)}
                ticketMentorCredits={offer.ticketMentorCredits}
              >
                {tier === "sitting_pass" && passEnd && (
                  <p className="text-sm text-[var(--mp-fg)] mt-2 mb-0" data-pass-end>
                    {passEndsBeforeSitting
                      ? de ? `Ihr Termin liegt mehr als 3 Monate entfernt: Der Prüfungspass endet am ${longDate(passEnd, lang)}, also vor Ihrem Termin.` : `Your sitting is more than 3 months away: the Sitting Pass ends on ${longDate(passEnd, lang)}, before your sitting.`
                      : de ? `Mit Ihrem gewählten Termin: Zugang bis ${longDate(passEnd, lang)}.` : `With your chosen sitting: access until ${longDate(passEnd, lang)}.`}
                  </p>
                )}
                {fit && fitLines(fit.plans[tier], lang).map((line) => (
                  <p key={line} className="text-sm text-[var(--mp-fg)] mt-2 mb-0" data-fit-total={tier}>{line}</p>
                ))}
              </PlanCard>
              {problemFor(tier)}
            </div>
          ))}
          {offer.v2 && returningPayer && (
            <div id="returning-plans" className="scroll-mt-20 space-y-3 pt-2" data-returning-plans>
              <h2 className="mp-h3 m-0">{de ? "Unsere bisherigen Tarife" : "Our earlier plans"}</h2>
              <p className="text-sm text-[var(--mp-fg-muted)] m-0">{de
                ? "Weil Sie schon bei uns gebucht haben, können Sie auch diese Tarife buchen."
                : "Because you have booked with us before, you can also book these plans."}</p>
              {RETURNING_TIERS.map((tier) => (
                <div key={tier}>
                  <PlanCard
                    tier={tier}
                    lang={lang}
                    featured={false}
                    returning
                    action={cardAction(tier)}
                    loading={checkoutLoading === SLOT_FOR[tier]}
                    busy={busy}
                    onCheckout={() => chooseTier(tier)}
                  />
                  {problemFor(tier)}
                </div>
              ))}
            </div>
          )}
          {!offer.v2 && PLAN_ORDER.map((tier) => (
            <div key={tier} id={tier === "first_month_19" ? "first-month" : tier === "premium_pass_guaranteed" ? "cohort" : "three-months"} className="scroll-mt-20">
              <PlanCard
                tier={tier}
                lang={lang}
                featured={tier === RECOMMENDED}
                action={cardAction(tier)}
                loading={checkoutLoading === SLOT_FOR[tier]}
                busy={busy}
                onCheckout={() => chooseTier(tier)}
              >
                {tier === "premium_pass_guaranteed" && (
                  <ul className="mt-2 space-y-1 m-0 ps-0 list-none text-sm text-[var(--mp-fg)]">
                    {cohortOnly.map((line) => <li key={line} className="flex items-start gap-2"><Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]" strokeWidth={3} aria-hidden />{line}</li>)}
                  </ul>
                )}
              </PlanCard>
              {problemFor(tier)}
            </div>
          ))}
        </section>

        {/* Pro-Test: signed-in eligible learners get the live tile; visitors see its terms and register first. */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
          <div id="pro-test" className="scroll-mt-24">
            {offer.reverseTrial
              ? <ReverseTrialTile lang={lang} exam={storedExam} signedIn={signedIn} endsAt={reverseTrialEndsAt} mentor={offer.ticketMentorCredits !== null} telegramLink={trialTelegramLink} />
              : signedIn
                ? <TrialActivation lang={lang} resume={trialResume} exam={storedExam} checkoutBusy={busy} onWorkingChange={setTrialBusy} />
                : <VisitorTrialTile lang={lang} exam={storedExam} />}
          </div>
        </section>

        {/* Free start, a slim row with a visible button (UX-ACC-12, UX-PUB-30). */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
          <FreeTierRow lang={lang} examSource={storedExam} />
        </section>

        {/* What Pro includes, defined once. */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
          <ProIncludes lang={lang} rows={proIncludes} v2={offer.v2} />
        </section>

        {/* a-pricing-v2: "When is your exam?" replaces the cost table. */}
        {!offer.v2 && (
          <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
            <PlanCoverBlock lang={lang} examDate={examDate} />
          </section>
        )}

        {/* Full money terms in the learner's language once reviewed (LX-20, a29); renders nothing until then. */}
        <div className="max-w-5xl mx-auto px-4 lg:px-8 empty:hidden">
          <LocalizedBillingTerms className="mb-4" />
        </div>

        {/* Payment methods and exclusions (LX-25), support and fine print. */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-6 space-y-2 text-sm text-[var(--mp-fg-muted)]">
          <p className="m-0">
            {de
              ? `${CONFIRM_ON ? METHOD_SENTENCE.de : "Akzeptiert: Visa, Mastercard und Apple Pay über Whop."} Karten aus Russland und Belarus werden von Whop nicht angenommen. Wenn Ihre Karte abgelehnt wird, schreiben Sie uns an `
              : `${CONFIRM_ON ? METHOD_SENTENCE.en : "Accepted: Visa, Mastercard and Apple Pay through Whop."} Cards from Russia and Belarus are not accepted by Whop. If your card is declined, write to us at `}
            <a className="underline" href={`mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent(de ? "Karte abgelehnt" : "Card declined")}`}>{BILLING_SUPPORT_EMAIL}</a>. {SUPPORT_REPLY_PROMISE[lang]}
          </p>
          <p className="m-0">
            {de
              ? "Preise in Euro, inkl. österreichischer USt. wo anwendbar. Jeder bezahlte Tarif enthält alle drei Fragenbanken. Die Wiener Bank enthält SIP4a/SIP5a-basierte Übungsfragen, keine Simulation der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin. Lernmaterial, keine Originalfragen der Prüfung."
              : "Prices in euro, incl. Austrian VAT where applicable. Every paid plan includes all three question banks. The Vienna bank contains SIP4a/SIP5a-based practice questions, not a simulation of the postgraduate ÖÄK general medicine exam. Study material, not original exam questions."}
          </p>
        </section>

        {/* Checkout stall question below the plans (UX-ACC-29). */}
        {signedIn && !paymentPending && !returnArmed && (
          <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-4">
            <CheckoutStallPrompt surface="pricing" />
          </section>
        )}

        {/* Referral block: only for enrolled accounts, three bullets (UX-PUB-39). */}
        {referralsEnabled && (
          <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-8">
            <ReferralBlock lang={lang} />
          </section>
        )}

        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-8">
          <UpcomingExams lang={lang} renderedAt={renderedAt} variant="compact" />
        </section>

        <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-8">
          <h2 className="mp-h2 mb-5 text-center">{de ? "Häufige Fragen" : "Common questions"}</h2>
          <div className="space-y-3">
            <FAQItem
              q={de ? "Wie kann ich bezahlen?" : "How can I pay?"}
              a={de
                ? `${CONFIRM_ON ? METHOD_SENTENCE.de : "Mit Karte (Visa, Mastercard) oder Apple Pay über Whop."} Ihr Zugang ist meist innerhalb weniger Minuten aktiv. Wenn nach 10 Minuten noch Free angezeigt wird, tippen Sie auf „Zahlung prüfen“ oder schreiben Sie uns mit der E-Mail Ihres Whop-Kontos.`
                : `${CONFIRM_ON ? METHOD_SENTENCE.en : "By card (Visa, Mastercard) or Apple Pay through Whop."} Your access is usually active within a few minutes. If you still see Free after 10 minutes, tap “Check payment” or write to us with the email of your Whop account.`}
            />
            <FAQItem
              q={de ? "Wie kündige ich ein Abo?" : "How do I cancel a subscription?"}
              a={offer.v2
                ? de
                  ? "Bei Whop mit derselben E-Mail anmelden, die Mitgliedschaft wählen und „Cancel membership“ tippen (die Seite ist auf Englisch). Whop beendet die Mitgliedschaft in der Regel zum Ende des bezahlten Zeitraums, dann endet auch Pro. Prüfungspass und Garantie-Ticket sind Einmalzahlungen und müssen nicht gekündigt werden."
                  : "Sign in to Whop with the same email, choose your membership and tap “Cancel membership”. Whop usually ends the membership at the end of the paid period, then Pro ends too. The Sitting Pass and the Guarantee Ticket are one-time payments and need no cancellation."
                : de
                ? "Bei Whop mit derselben E-Mail anmelden, die Mitgliedschaft wählen und „Cancel membership“ tippen (die Seite ist auf Englisch). Whop beendet die Mitgliedschaft in der Regel zum Ende des bezahlten Zeitraums, dann endet auch Pro. Die Prüfungs-Kohorte ist eine Einmalzahlung und muss nicht gekündigt werden."
                : "Sign in to Whop with the same email, choose your membership and tap “Cancel membership”. Whop usually ends the membership at the end of the paid period, then Pro ends too. The Exam Cohort is a one-time payment and needs no cancellation."}
            />
            <FAQItem
              q={de ? "Gibt es Tarife pro Prüfung?" : "Is there per-exam pricing?"}
              a={de
                ? `Nein, jeder bezahlte Tarif enthält alle drei Fragenbanken (${getExamLabel("kenntnispruefung", "full", "de")}, ${getExamLabel("kmp_innsbruck", "full", "de")}, ${getExamLabel("pharma", "full", "de")}). Kostenlos üben Sie ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank.`
                : `No, every paid plan unlocks all three question banks (${getExamLabel("kenntnispruefung", "full", "en")}, ${getExamLabel("kmp_innsbruck", "full", "en")}, ${getExamLabel("pharma", "full", "en")}). Free, you practise ${FREE_TIER.questions_per_exam_type} questions per question bank.`}
            />
          </div>
          <div className="text-center mt-6">
            <Link href="/faq" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--mp-accent-text)] hover:underline">
              {de ? "Alle Fragen ansehen" : "See all questions"}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </Link>
          </div>
        </section>

        {!signedIn && (
          <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-12">
            <SupportContactForm lang={lang} defaultTopic="payment" />
          </section>
        )}

        <CheckoutConfirmSheet
          tier={confirmTier}
          lang={lang}
          extendsFrom={extendsFrom}
          switching={confirmTier ? isSwitch(confirmTier) : false}
          sittingLastDay={timing?.kind === "sitting" ? timing.lastDay : null}
          email={user?.email ?? null}
          onClose={() => setConfirmTier(null)}
          onConfirm={(tier) => { setConfirmTier(null); void createCheckout(tier); }}
        />
      </main>
    </AppLayout>
  );
}

/* ═══════════════════════ Visitor trial tile ═══════════════════════ */

function VisitorTrialTile({ lang, exam }: { lang: Lang; exam: ExamSourceId }) {
  const de = lang === "de";
  const [terms, setTerms] = useState<{ trial_days: number; price_after_cents: number; charge_at?: string; tier?: string | null } | null>(null);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { if (enabled && terms) trackCardTrialView("pricing_visitor", terms.tier ?? null); }, [enabled, terms]);
  useEffect(() => {
    const controller = new AbortController();
    window.fetch("/api/trial/status", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.enabled && Number.isInteger(d.trial_days) && Number.isInteger(d.price_after_cents)) { setTerms(d); setEnabled(true); }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!enabled || !terms) return null;
  const amount = billingAmount(terms.price_after_cents, lang);
  return (
    <article aria-labelledby="visitor-trial" className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5">
      <h2 id="visitor-trial" className="mp-h3 mb-1">{de ? "Pro-Test" : "Pro trial"}</h2>
      <p className="text-sm text-[var(--mp-fg-muted)] m-0">
        {de
          ? `${terms.trial_days} Tage Pro mit vollem Zugang. Karte nötig, heute ${billingAmount(0, lang)}. Danach ${amount} alle 30 Tage, wenn Sie nicht vorher kündigen.`
          : `${terms.trial_days} days of Pro with full access. Card required, ${billingAmount(0, lang)} today. Then ${amount} every 30 days unless you cancel before.`}
      </p>
      <Link href={buildAuthHref({ intent: "trial", exam, next: "/pricing" })} onClick={() => trackCardTrialClick("pricing_visitor", terms.tier ?? null)} className="mp-btn mp-btn--secondary min-h-12 mt-3 inline-flex">
        {de ? `Pro ${terms.trial_days} Tage testen` : `Try Pro for ${terms.trial_days} days`}
      </Link>
      <p className="mp-small text-[var(--mp-fg-muted)] mt-2 mb-0">{de ? "Sie registrieren sich zuerst. Gestartet wird der Pro-Test erst mit Ihrem Tipp auf der nächsten Seite." : "You register first. The Pro trial only starts with your tap on the next page."}</p>
    </article>
  );
}

/* ═══════════════════════ Free tier row ═══════════════════════ */

function FreeTierRow({ lang, examSource }: { lang: Lang; examSource: ExamSourceId }) {
  const de = lang === "de";
  return (
    <article aria-labelledby="free-tier" className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-3 items-center">
      <div>
        <h2 id="free-tier" className="mp-h3 mb-1">{de ? "Kostenlos starten" : "Start free"}</h2>
        <p className="text-sm text-[var(--mp-fg-muted)] m-0">
          {de ? `${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank mit Erklärungen, wo vorhanden. Keine Zahlung nötig, keine Karte.` : `${FREE_TIER.questions_per_exam_type} questions per question bank with explanations where available. No payment needed, no card.`}
        </p>
      </div>
      <div className="flex flex-col gap-2 md:items-end">
        <PublicStudyLink href={`/quiz?exam=${examSource}&free=1`} className="mp-btn mp-btn--secondary min-h-12 inline-flex items-center justify-center gap-2 w-full md:w-auto">
          {de ? "Kostenlos starten" : "Start free"}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </PublicStudyLink>
        <FreeOfferDisclosure lang={lang} className="md:max-w-sm md:text-right" />
      </div>
    </article>
  );
}

/* ═══════════════════════ What Pro includes ═══════════════════════ */

function ProIncludes({ lang, rows, v2 = false }: { lang: Lang; rows: string[]; v2?: boolean }) {
  const de = lang === "de";
  return (
    <section aria-labelledby="pro-includes" className="mp-card p-5">
      <h2 id="pro-includes" className="mp-h3 mb-2">{de ? "Was jeder bezahlte Tarif enthält" : "What every paid plan includes"}</h2>
      <ul className="space-y-1.5 m-0 ps-0 list-none text-sm">
        {rows.map((row) => (
          <li key={row} className="flex items-start gap-2"><Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]" strokeWidth={3} aria-hidden />{row}</li>
        ))}
      </ul>
      <p className="mp-small text-[var(--mp-fg-muted)] mt-2 mb-0">{v2
        ? de ? "Die Tarife unterscheiden sich nur in Laufzeit, Verlängerung und den kostenlosen Verlängerungsjahren des Garantie-Tickets." : "Plans differ only in length, renewal and the Guarantee Ticket's free renewal years."
        : de ? "Die Tarife unterscheiden sich nur in Laufzeit, Verlängerung und der Garantie der Prüfungs-Kohorte." : "Plans differ only in length, renewal and the Exam Cohort guarantee."}</p>
    </section>
  );
}

/* ═══════════════════════ Referral block ═══════════════════════ */

function ReferralBlock({ lang }: { lang: Lang }) {
  const de = lang === "de";
  return (
    <div className="rounded-[var(--mp-r-card)] p-6 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)]">
      <div className="flex items-center gap-2 mb-2">
        <Gift className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
        <h2 className="mp-h3 m-0">{de ? "Empfehlungsprogramm" : "Referral programme"}</h2>
      </div>
      <ul className="list-disc ps-5 text-sm text-[var(--mp-fg-muted)] space-y-1 mb-3">
        {referralRewardBullets(lang).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="mp-small text-[var(--mp-fg-muted)] mb-3">{referralDisclosure(lang)}</p>
      <Link href="/referrals" className="mp-btn mp-btn--secondary min-h-11 inline-flex items-center gap-1.5 text-sm">
        <Share2 className="w-3.5 h-3.5" aria-hidden />
        {de ? "Empfehlungslink öffnen" : "Open my referral link"}
      </Link>
    </div>
  );
}

/* ═══════════════════════ FAQ item ═══════════════════════ */

function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-[var(--mp-r-card)] overflow-hidden bg-[var(--mp-surface-raised)] border border-[var(--mp-border-subtle)]">
      <summary className="flex items-center justify-between gap-4 px-5 py-4 min-h-11 cursor-pointer list-none hover:bg-[var(--mp-surface-sunken)]">
        <span className="text-sm font-semibold text-[var(--mp-fg)] pe-2">{q}</span>
        <span aria-hidden className="text-[var(--mp-viridian)] transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="px-5 pb-5 -mt-1 text-sm text-[var(--mp-fg-muted)] leading-relaxed">{a}</div>
    </details>
  );
}
