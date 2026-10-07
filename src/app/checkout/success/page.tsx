"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { trackPurchase } from "@/lib/conversion-events";
import { authFetch } from "@/lib/authFetch";

/**
 * Whop checkout success landing (redirect target set on the checkout
 * configuration). Access is granted by the /api/webhooks/whop webhook on
 * `payment.succeeded` OR by POST /api/whop/checkout/verify (server-side read
 * of Whop's ledger), not here.
 *
 * HONESTY CONTRACT (2026-09-21, after the double-payment incident): this page
 * may NEVER claim access is active until isPaid is actually true. The buyer
 * below (Munir) saw a false "aktiv" line at the 30s timeout, concluded the
 * payment failed, and paid again. So:
 *   - The verify schedule rides a single backoff array (mount, 2.5s, 5s, 10s,
 *     20s, 40s, 60s, then every 60s) up to a 5-minute ceiling, plus one extra
 *     check when the tab becomes visible again. Whop's webhook delivery can
 *     lag by hours, so we do NOT give up at 12.5s or print a dead end.
 *   - Every state keeps a "weiterlernen" path; nothing dead-ends.
 *   - trackPurchase requires a verified paid receipt and amount. Existing
 *     access, a free trial, or a query string cannot prove a purchase.
 */

const VERIFY_RETRIES_MS = [2_500, 5_000, 10_000, 20_000, 40_000, 60_000];
const VERIFY_STEADY_MS = 60_000;
const VERIFY_CEILING_MS = 5 * 60 * 1000;
const TIER_POLL_MS = 5_000;
const GRANTED_REDIRECT_MS = 1_200;

type Outcome = "pending" | "granted" | "unmatched";

interface VerifyPayload {
  granted?: boolean;
  already?: boolean;
  reason?: string;
  payment_ref?: string | null;
  amount_cents?: number | null;
  tier_expires_at?: string | null;
}

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const { isPaid, isLoading, error: tierError, refresh } = useUserTier();
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const purchaseFiredRef = useRef(false);
  const grantedRedirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paramsRef = useRef<URLSearchParams | null>(null);
  const getParams = useCallback(() => {
    if (!paramsRef.current) {
      // SSR/prerender safe: no window there, empty params render fine.
      paramsRef.current =
        typeof window === "undefined"
          ? new URLSearchParams()
          : new URLSearchParams(window.location.search);
    }
    return paramsRef.current;
  }, []);

  const firePurchase = useCallback(
    (tier: string, amountCents: number | null, paymentId: string | null) => {
      if (purchaseFiredRef.current) return;
      if (!paymentId || typeof amountCents !== "number" || !Number.isFinite(amountCents) || amountCents <= 0) return;
      purchaseFiredRef.current = true;
      trackPurchase({
        tier: tier || "unknown",
        valueEur: amountCents / 100,
        conversionId: paymentId,
      });
    },
    []
  );

  // ── Verify schedule (paid tiers): backoff array, granted or 5-min ceiling ──
  useEffect(() => {
    const params = getParams();
    const isTrial = params.get("trial") === "1";
    const tier = params.get("tier") ?? "";
    if (isTrial || !tier) return;

    let cancelled = false;
    let inFlight = false;
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const run = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await authFetch("/api/whop/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        });
        const d = (await res.json().catch(() => ({}))) as VerifyPayload;
        if (cancelled) return;
        if (res.ok && d?.granted) {
          setOutcome("granted");
          setPaymentRef(d.payment_ref ?? null);
          if (!d.already) firePurchase(tier, d.amount_cents ?? null, d.payment_ref ?? null);
          void refresh();
          return; // granted: stop the schedule
        }
        if (d?.reason === "payment_unmatched") {
          setOutcome("unmatched");
          setPaymentRef(d.payment_ref ?? null);
          // Keep polling: the webhook may still tie it later.
        }
      } catch {
        /* keep retrying */
      }
      inFlight = false;
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= VERIFY_CEILING_MS) return; // ceiling: page shows the 60s+ state
      const delay =
        idx < VERIFY_RETRIES_MS.length ? VERIFY_RETRIES_MS[idx] : VERIFY_STEADY_MS;
      idx += 1;
      timer = setTimeout(() => void run(), delay);
    };

    // One extra check when the buyer returns to this tab (e.g. after opening
    // their bank app or the Whop receipt mail).
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [getParams, firePurchase, refresh]);

  // ── Trial grant path: same deterministic verify, same backoff shape ──
  useEffect(() => {
    const params = getParams();
    if (params.get("trial") !== "1") return;

    let cancelled = false;
    let inFlight = false;
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const run = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await authFetch("/api/whop/trial/verify", { method: "POST" });
        const d = (await res.json().catch(() => ({}))) as VerifyPayload;
        if (cancelled) return;
        if (res.ok && d?.granted) {
          setOutcome("granted");
          void refresh();
          return;
        }
      } catch {
        /* keep retrying */
      }
      inFlight = false;
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= VERIFY_CEILING_MS) return;
      const delay =
        idx < VERIFY_RETRIES_MS.length ? VERIFY_RETRIES_MS[idx] : VERIFY_STEADY_MS;
      idx += 1;
      timer = setTimeout(() => void run(), delay);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [getParams, firePurchase, refresh]);

  // ── Tier poll: refresh every 5s so the grant registers fast (webhook or
  //    a parallel verify), for the full 5-minute window. Also drives the
  //    phase copy via elapsedSec. ──
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      setElapsedSec((s) => s + TIER_POLL_MS / 1000);
      void refresh();
    }, TIER_POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Existing access or a webhook-side grant can redirect without proving
  // that this page visit represents a new payment.
  useEffect(() => {
    if (isLoading || tierError || !isPaid) return;
    setOutcome("granted");
    grantedRedirectRef.current = setTimeout(() => router.push("/"), GRANTED_REDIRECT_MS);
    return () => {
      if (grantedRedirectRef.current) clearTimeout(grantedRedirectRef.current);
    };
  }, [isPaid, isLoading, tierError, router]);

  const granted = outcome === "granted" || (!isLoading && !tierError && isPaid);
  const unmatched = outcome === "unmatched" && !granted;
  const showSpinner = !granted && !unmatched;

  // Honest phase copy while unconfirmed. NOTHING here says "aktiv".
  let de = "";
  let en = "";
  if (showSpinner) {
    if (elapsedSec < 10) {
      de = "Wir prüfen deine Zahlung gerade. Das dauert meist nur wenige Sekunden.";
      en = "We are verifying your payment. This usually takes only a few seconds.";
    } else if (elapsedSec < 30) {
      de = "Deine Zahlung wird noch bestätigt. Bei Kartenzahlung kann das ein paar Minuten dauern.";
      en = "Your payment is still being confirmed. Card payments can take a few minutes.";
    } else if (elapsedSec < 60) {
      de = "Die Zahlungsbestätigung dauert länger als üblich. Wir prüfen weiter.";
      en = "Payment confirmation is taking longer than usual. We are still checking.";
    } else {
      de = "Deine Zahlung ist noch nicht bestätigt. Wir prüfen weiter. Du kannst inzwischen weiterlernen oder uns kontaktieren.";
      en = "Your payment has not been confirmed yet. We are still checking. You can keep learning or contact us.";
    }
  } else if (unmatched) {
    de =
      "Deine Zahlung ist bei uns eingegangen, aber die Zuordnung hat noch nicht geklappt. Wir melden uns per E-Mail und schalten dich frei.";
    en =
      "We received your payment but could not tie it to your account yet. We will email you and unlock your access.";
  } else {
    de = "Dein Pro-Zugang ist aktiv. Du wirst weitergeleitet.";
    en = "Your Pro access is active. Redirecting you now.";
  }

  // Support mail: tier, the ch_ session id from the URL, and any pay_ ref
  // returned by verify, so [name] can trace the payment immediately.
  const supportMailto = (() => {
    const params = getParams();
    const tier = params.get("tier") ?? "";
    let sessionId = params.get("session");
    if (!sessionId) {
      for (const v of params.values()) {
        if (v.startsWith("ch_")) {
          sessionId = v;
          break;
        }
      }
    }
    const lines = [
      `tier: ${tier || "unbekannt"}`,
      sessionId ? `checkout_session: ${sessionId}` : null,
      paymentRef ? `payment_ref: ${paymentRef}` : null,
    ].filter(Boolean);
    return `mailto:user-b7e46e80@example.com?subject=${encodeURIComponent(
      "MedPrüf Zahlung prüfen"
    )}&body=${encodeURIComponent(lines.join("\n"))}`;
  })();

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[#F7F9FC] dark:bg-[#0F172A]">
      <div className="w-full max-w-md text-center rounded-2xl border border-[#E4E9F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-8 shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#007B5F]/10 text-[#007B5F]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold text-[#1A2B3C] dark:text-[#E2E8F0]">
          {granted ? "Dein Pro-Zugang ist aktiv" : "Zahlung wird geprüft"}
        </h1>
        <p className="mt-3 text-[#4A5568] dark:text-[#A0AEC0]">{de}</p>
        <p className="mt-2 text-sm text-[#4A5568] dark:text-[#A0AEC0]">{en}</p>
        {showSpinner && (
          <div className="mt-6 flex justify-center" aria-label="Bitte warten" role="status">
            <svg
              className="animate-spin h-6 w-6 text-[#003A8C]"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
        )}
        {!granted && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <Link
              href="/"
              className={
                elapsedSec >= 60 || unmatched
                  ? "inline-flex items-center justify-center rounded-xl bg-[#003A8C] px-6 py-3 font-semibold text-white transition hover:opacity-90"
                  : "text-sm font-medium text-[#003A8C] underline underline-offset-2 hover:opacity-80"
              }
            >
              {unmatched ? "Kostenlos weiterlernen" : elapsedSec >= 60 ? "Jetzt weiterlernen" : "In der Zwischenzeit weiterlernen"}
            </Link>
            {(elapsedSec >= 60 || unmatched) && (
              <a
                href={supportMailto}
                className="text-sm text-[#003A8C] underline underline-offset-2 hover:opacity-80"
              >
                Das stimmt nicht?
              </a>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-[#A0AEC0]">
          Eine Frage? Schreib an user-b7e46e80@example.com
        </p>
      </div>
    </main>
  );
}
