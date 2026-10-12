"use client";
/**
 * /checkout/success (UX-ACC-03, UX-ACC-05, UX-ACC-06).
 *
 * States: pending (spinner, static under reduced motion), unmatched (clock),
 * failed, granted (check). Text carries the state inside one persistent
 * role=status region; focus moves to the h1 on unmatched and granted. Every
 * non-granted state says "do not pay again". Granted shows a receipt card
 * (plan, access end, renewal or one-time line, receipt by email, manage
 * link for renewing plans) and never redirects on a timer. The trial branch
 * names the server end date and the first charge; an extension is granted
 * only once the access end has moved past `extends_from`. All strings live
 * in lib/i18n (Sie); the reference stays language-neutral.
 *
 * Issue 7 (2026-10-12): a "no payment" verify answer is its own state
 * (no_payment), never success or "Pro appears automatically". Until the
 * settle window passes it says no payment has arrived yet and keeps
 * checking; once settled it says no payment arrived and offers to try
 * again on /pricing, where the second-checkout guard is released at the
 * same moment (lib/checkout-pending noPaymentSettled).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { trackPurchase } from "@/lib/conversion-events";
import { renderLang, t, useLang } from "@/lib/i18n";
import { billingAccountSentence, billingAmount, BILLING_SUPPORT_EMAIL, WHOP_MANAGE_URL } from "@/lib/billing-copy";
import { shortSubscriptionLabel, type SubscriptionCardSnapshot } from "@/lib/subscription-display";
import { getStoredSession } from "@/lib/auth";
import { authDestination, readAuthEntry, buildAuthHref } from "@/lib/auth-entry";
import { authFetch } from "@/lib/authFetch";
import { confirmedUnmatchedPayment, createActionGate, PAYMENT_CHECK_CEILING_MS, PAYMENT_CHECK_COOLDOWN_MS, safeCheckoutReference } from "@/lib/account-request";
import { longDate } from "@/app/pricing/_parts/plans";
import { PENDING_GUARD_MS, noPaymentSettledOnPage, verifyOutcome, type ReturnOutcome } from "@/lib/checkout-return";

type Outcome = ReturnOutcome;
type VerifyPayload = { granted?: boolean; already?: boolean; paid_after_checkout?: boolean; reason?: string; settled?: boolean | null; payment_ref?: string | null; amount_cents?: number | null };

export default function CheckoutSuccessPage() {
  const lang = renderLang(useLang());
  const { isPaid, isLoading, error: tierError, refresh } = useUserTier();
  const [params, setParams] = useState<URLSearchParams | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [receiptAmount, setReceiptAmount] = useState<number | null>(null);
  // verify answered already:true and found no payment after the latest
  // checkout: access was active before this visit, so no new Whop receipt is
  // promised. A webhook-first buyer (already:true, paid_after_checkout) keeps it.
  const [alreadyActive, setAlreadyActive] = useState(false);
  const [paymentSeen, setPaymentSeen] = useState(false);
  const [noPaymentSettled, setNoPaymentSettled] = useState(false);
  const firstNoPaymentAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sub, setSub] = useState<SubscriptionCardSnapshot | null | "error">(null);
  const mounted = useRef(false);
  const startedAt = useRef(Date.now());
  const gate = useRef(createActionGate(PAYMENT_CHECK_COOLDOWN_MS));
  const purchaseFired = useRef(false);
  const grantedRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    setParams(new URLSearchParams(window.location.search));
    setSignedIn(Boolean(getStoredSession()?.user.id));
    return () => { mounted.current = false; };
  }, []);

  const trial = params?.get("trial") === "1";
  const tier = params?.get("tier") ?? null;
  const extendsFrom = params?.get("extends_from") ?? null;
  const hasPurchase = Boolean(trial || tier);

  const verify = useCallback(async () => {
    if (!signedIn || !params || grantedRef.current || !gate.current.enter()) return;
    setChecking(true);
    try {
      if (!trial && !tier) { void refresh(); return; }
      const response = await authFetch(trial ? "/api/whop/trial/verify" : "/api/whop/checkout/verify", {
        method: "POST", timeoutMs: 15_000,
        ...(trial ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify({ tier, ...(extendsFrom ? { extends_from: extendsFrom } : {}) }) }),
      });
      const data: VerifyPayload = await response.json();
      if (!mounted.current) return;
      const next = verifyOutcome(response.ok, data);
      if (next === "failed") { setOutcome("failed"); return; }
      if (next === "granted") {
        grantedRef.current = true;
        setOutcome("granted");
        setPaymentRef(data.payment_ref ?? null);
        setReceiptAmount(typeof data.amount_cents === "number" ? data.amount_cents : null);
        setAlreadyActive(data.already === true && data.paid_after_checkout === false);
        if (!trial && !data.already && !purchaseFired.current && data.payment_ref && typeof data.amount_cents === "number" && data.amount_cents > 0) {
          purchaseFired.current = true;
          trackPurchase({ tier: tier || "unknown", valueEur: data.amount_cents / 100, conversionId: data.payment_ref });
        }
        void refresh();
      } else if (next === "unmatched") {
        setOutcome("unmatched"); setPaymentRef(data.payment_ref ?? null);
        setPaymentSeen(confirmedUnmatchedPayment(data));
      } else if (next === "no_payment") {
        if (firstNoPaymentAt.current === null) firstNoPaymentAt.current = Date.now();
        setOutcome("no_payment");
        setNoPaymentSettled(noPaymentSettledOnPage(data.settled, firstNoPaymentAt.current, Date.now(), trial ? PENDING_GUARD_MS : undefined));
      } else {
        setOutcome("pending");
      }
    } catch { if (mounted.current) setOutcome("failed"); }
    finally { gate.current.leave(); if (mounted.current) setChecking(false); }
  }, [params, signedIn, refresh, trial, tier, extendsFrom]);

  useEffect(() => {
    if (!params || !signedIn) return;
    void verify();
    const tick = setInterval(() => {
      const age = Date.now() - startedAt.current;
      setElapsed(age);
      if (age < PAYMENT_CHECK_CEILING_MS && !grantedRef.current) void verify();
    }, 10_000);
    const visible = () => { if (document.visibilityState === "visible") void verify(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) void verify(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", pageshow);
    return () => { clearInterval(tick); document.removeEventListener("visibilitychange", visible); window.removeEventListener("pageshow", pageshow); };
  }, [params, signedIn, verify]);

  // A purchase is granted only by verify (an extension needs the moved end
  // date); a revisit without a purchase shows the receipt of active Pro.
  const granted = outcome === "granted" || (!hasPurchase && !isLoading && !tierError && isPaid);
  useEffect(() => {
    if (!granted || !signedIn) return;
    grantedRef.current = true;
    let active = true;
    authFetch("/api/user/subscription", { timeoutMs: 8_000, skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((d) => { if (active) setSub(d?.subscription ?? "error"); })
      .catch(() => { if (active) setSub("error"); });
    return () => { active = false; };
  }, [granted, signedIn]);
  useEffect(() => {
    if (granted || outcome === "unmatched" || (outcome === "no_payment" && noPaymentSettled)) heading.current?.focus();
  }, [granted, outcome, noPaymentSettled]);

  const reference = paymentRef || (params ? safeCheckoutReference(params) : null);
  const help = `mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent("MedPrüf payment/access")}&body=${encodeURIComponent([
    `tier: ${tier || (trial ? "notes_pro_trial" : "unknown")}`,
    reference ? `reference: ${reference}` : "",
  ].filter(Boolean).join("\n"))}`;
  // No purchase parameter and no active Pro: nothing to check (no fake pending).
  const unidentified = params !== null && !hasPurchase && !granted && (!signedIn || (!isLoading && !isPaid));
  const noPayment = !granted && !unidentified && outcome === "no_payment";
  const noPaymentFinal = noPayment && noPaymentSettled;
  const title = unidentified ? t("checkout_unidentified", lang) : granted
    ? t(trial ? "checkout_trial_title" : extendsFrom ? "checkout_extended_title" : "checkout_granted_title", lang)
    : outcome === "unmatched" ? t("account_unmatched", lang)
    : noPaymentFinal ? t(trial ? "checkout_no_trial_title" : "checkout_no_payment_title", lang)
    : noPayment ? t("checkout_no_payment_yet_title", lang)
    : t("checkout_pending_title", lang);
  const pendingLine = trial ? t("checkout_trial_pending", lang) : extendsFrom ? t("checkout_extension_pending", lang) : null;
  const snapshot = sub && sub !== "error" ? sub : null;
  const accessEnd = longDate(snapshot?.expires_at ?? null, lang);
  const trialEnd = snapshot?.is_trial ? longDate(snapshot.next_charge_at ?? snapshot.expires_at, lang) : null;
  const renews = snapshot?.billing_cadence === "auto_renews";
  const ceiling = elapsed >= PAYMENT_CHECK_CEILING_MS;

  return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]">
    <div className="mp-card mx-auto max-w-lg p-5 sm:p-8 space-y-4">
      <div role="status" aria-live="polite" className="space-y-3">
        {granted ? <CheckCircle2 aria-hidden className="h-10 w-10 text-[var(--mp-success)]" />
          : !unidentified && outcome === "pending" && elapsed < 60_000 ? <>
            <Loader2 aria-hidden className="h-10 w-10 text-[var(--mp-accent-text)] animate-spin motion-reduce:hidden" />
            <span aria-hidden className="hidden motion-reduce:inline text-2xl tracking-widest text-[var(--mp-fg-muted)]">···</span>
          </>
          : <Clock aria-hidden className="h-10 w-10 text-[var(--mp-fg-muted)]" />}
        <h1 ref={heading} tabIndex={-1} className="mp-h2" style={{ outline: "none" }}>{title}</h1>
        {unidentified && <p className="mp-body">{t("checkout_unidentified_body", lang)}</p>}
        {noPaymentFinal && <p className="mp-body" data-testid="checkout-no-payment">{t(trial ? "checkout_no_trial_body" : "checkout_no_payment_body", lang)}</p>}
        {noPaymentFinal && <p className="mp-body">{t("checkout_no_payment_paid", lang)}</p>}
        {noPayment && !noPaymentFinal && <p className="mp-body" data-testid="checkout-no-payment-yet">{t("checkout_no_payment_yet_body", lang)}</p>}
        {!granted && !unidentified && !noPayment && pendingLine && <p className="mp-body">{pendingLine}</p>}
        {!granted && !unidentified && !noPaymentFinal && <p className="mp-body">{t(ceiling ? "account_pending_ceiling" : "account_do_not_pay_again", lang)}</p>}
        {!granted && paymentSeen && <p className="mp-body">{t("account_received_unmatched", lang)}</p>}
        {!granted && !noPayment && elapsed >= 60_000 && !ceiling && <p className="mp-body">{t("account_pending_later", lang)}</p>}
        {outcome === "failed" && !granted && <p className="text-sm text-[var(--mp-error-text)]">{t("request_error", lang)}</p>}
      </div>

      {granted && (
        <section aria-label={lang === "de" ? "Beleg" : "Receipt"} className="rounded-lg border border-[var(--mp-border-subtle)] p-4 space-y-1 text-sm">
          {snapshot ? <>
            <p className="m-0 font-semibold text-[var(--mp-fg)]">{shortSubscriptionLabel(snapshot, lang)}</p>
            {snapshot.is_trial && trialEnd && snapshot.next_charge_amount_cents != null
              ? <p className="m-0">{t("checkout_trial_line", lang).replaceAll("{date}", trialEnd).replace("{amount}", billingAmount(snapshot.next_charge_amount_cents, lang))}</p>
              : <>
                {/* The one-time sentence already names the end date; renewing plans name the next charge instead. */}
                {accessEnd && snapshot.billing_cadence !== "one_time" && <p className="m-0">{t("checkout_access_until", lang).replace("{date}", accessEnd)}</p>}
                <p className="m-0">{billingAccountSentence(snapshot, lang)}</p>
              </>}
          </> : <p className="m-0">{t("checkout_receipt_fallback", lang)}</p>}
          {receiptAmount !== null && receiptAmount > 0 && <p className="m-0">{t("checkout_charged", lang)}: <bdi className="tabular-nums">{billingAmount(receiptAmount, lang)}</bdi></p>}
          {hasPurchase && !trial && !alreadyActive && <p className="m-0 text-[var(--mp-fg-muted)]">{t("checkout_receipt_email", lang)}</p>}
          {renews && <a className="inline-flex min-h-11 items-center underline" href={WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer">{t("checkout_manage", lang)}</a>}
        </section>
      )}

      {reference && <div className="break-all text-sm"><p className="m-0">{t("checkout_reference", lang)}: <bdi>{reference}</bdi></p>
        <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2" onClick={async () => { try { await navigator.clipboard.writeText(reference); setCopied(true); } catch { setCopied(false); } }}>{t("checkout_copy_reference", lang)}</button>
        <span role="status" className="sr-only">{copied ? t("checkout_reference_copied", lang) : ""}</span>
      </div>}

      {noPaymentFinal
        ? <>
          <Link className="mp-btn mp-btn--primary min-h-12 w-full justify-center" href="/pricing" data-testid="checkout-retry">{t("checkout_no_payment_retry", lang)}</Link>
          <Link className="inline-flex min-h-11 items-center underline text-sm" href="/">{t("checkout_home", lang)}</Link>
        </>
        : <Link className="mp-btn mp-btn--primary min-h-12 w-full justify-center" href={granted ? authDestination(readAuthEntry()) : "/"}>{t("account_continue", lang)}</Link>}
      {granted && <div className="flex flex-wrap gap-3">
        <Link className="inline-flex min-h-11 items-center underline text-sm" href="/">{t("checkout_home", lang)}</Link>
        <Link className="inline-flex min-h-11 items-center underline text-sm" href="/settings#subscription">{t("checkout_to_settings", lang)}</Link>
      </div>}
      {!granted && signedIn && !unidentified && <button type="button" aria-disabled={checking || !gate.current.available()} className="mp-btn mp-btn--secondary min-h-11" onClick={() => void verify()}>{checking ? t("account_checking", lang) : t("account_check_again", lang)}</button>}
      {!granted && !signedIn && params && <Link className="mp-btn mp-btn--secondary min-h-11" href={buildAuthHref({ next: `/checkout/success?${params.toString()}` }, "signin_required")}>{t("checkout_signin_check", lang)}</Link>}
      {!granted && <a className="inline-flex min-h-11 items-center text-sm text-[var(--mp-fg-muted)] underline" href={help}>{t("account_payment_help", lang)}</a>}
    </div>
  </main>;
}
