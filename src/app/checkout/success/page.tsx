"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { trackPurchase } from "@/lib/conversion-events";
import { TIER_BY_ID } from "@/lib/content-truth";
import { authFetch } from "@/lib/authFetch";

// Best-known value (in euros) if the tier is missing/unknown in the URL —
// the Cohort is the headline paid tier, so we report its price rather than 0.
const FALLBACK_PURCHASE_VALUE_EUR = 129;

/**
 * Whop checkout success landing (redirect target set on the checkout
 * configuration). Access is granted by the /api/webhooks/whop webhook on
 * `payment.succeeded`, not here — so this page polls /api/auth/me until
 * the tier flips to Pro, then routes the user home automatically.
 *
 * Polling is bounded at 30 s. If the webhook hasn't landed by then (rare),
 * we surface a manual-continue button rather than spinning forever.
 */

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const { isPaid, isLoading, refresh } = useUserTier();
  const [timedOut, setTimedOut] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const purchaseFiredRef = useRef(false);

  // Fire the Purchase conversion ONCE on mount. Landing on this page means
  // Whop already charged, so we report the sale here (not gated on the tier
  // flip, so the 30s-timeout path still records the conversion). Reads the
  // tier from the redirect URL (?tier=...) without useSearchParams, so the
  // page needs no Suspense boundary and next build stays clean. Value is
  // derived from the canonical price ledger, never hardcoded per tier.
  useEffect(() => {
    if (purchaseFiredRef.current) return;
    purchaseFiredRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const tier = params.get("tier") ?? "";
    const isTrial = params.get("trial") === "1";

    // A €0 trial start is NOT a purchase — reporting it at the paid fallback
    // value (€129) would badly inflate conversion value. Record it at €0 so the
    // trial-start conversion fires without polluting revenue signals; the real
    // charge happens at day 7 (payment.succeeded → the webhook).
    if (isTrial) {
      trackPurchase({ tier: tier || "notes_pro_trial", valueEur: 0 });
      return;
    }

    const priceCents = TIER_BY_ID[tier]?.price_cents;
    if (typeof priceCents === "number") {
      trackPurchase({ tier, valueEur: priceCents / 100 });
    } else {
      console.warn(
        `[checkout/success] Unknown tier "${tier}" in redirect URL; firing Purchase with fallback value €${FALLBACK_PURCHASE_VALUE_EUR}.`
      );
      trackPurchase({
        tier: tier || "unknown",
        valueEur: FALLBACK_PURCHASE_VALUE_EUR,
      });
    }
  }, []);

  // Trial grant: a €0 trial start fires no `payment.succeeded`, so the payment
  // webhook never grants at trial start. Verify the Whop membership server-side
  // and flip to Pro here. Idempotent + best-effort; retried a few times to ride
  // out membership-propagation lag, then the tier poll below takes over.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("trial") !== "1") return;
    let cancelled = false;
    let attempts = 0;
    const tryVerify = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await authFetch("/api/whop/trial/verify", { method: "POST" });
        const d = await res.json().catch(() => ({}));
        if (d?.granted) {
          void refresh();
          return; // granted — the isPaid effect will route home
        }
      } catch {
        /* keep retrying */
      }
      if (!cancelled && attempts < 6) setTimeout(tryVerify, 2_500);
    };
    void tryVerify();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Paid tiers: same deterministic treatment as the trial. Whop's webhook
  // delivery can lag (documented retries up to 12h; a real 2026-09-17
  // delivery landed ~3h late), and a buyer who returned and saw "free"
  // paid a second time. Server-side verify against Whop's ledger grants
  // immediately when the money is real; the webhook stays the backstop.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("trial") === "1") return;
    const tier = params.get("tier") ?? "";
    if (!tier) return;
    let cancelled = false;
    let attempts = 0;
    const tryVerify = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await authFetch("/api/whop/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        });
        const d = await res.json().catch(() => ({}));
        if (d?.granted) {
          void refresh();
          return; // granted — the isPaid effect will route home
        }
      } catch {
        /* keep retrying */
      }
      if (!cancelled && attempts < 6) setTimeout(tryVerify, 2_500);
    };
    void tryVerify();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Kick off an immediate refresh on mount so we don't wait for the
  // 5-minute background interval in useUserTier. Then poll every 2 s
  // so the tier flip registers as soon as the webhook lands.
  useEffect(() => {
    void refresh();

    pollingRef.current = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    // Safety net: after 30 s stop polling and show a manual-continue
    // button. The payment_events table will capture any drop for review.
    timeoutRef.current = setTimeout(() => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setTimedOut(true);
    }, POLL_TIMEOUT_MS);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [refresh]);

  // Once tier resolves to Pro (isPaid), stop polling and route home so
  // the user lands on a screen that already reflects their new access.
  useEffect(() => {
    if (isLoading || !isPaid) return;
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    router.push("/");
  }, [isPaid, isLoading, router]);

  const showSpinner = !timedOut && !isPaid;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[#F7F9FC] dark:bg-[#0F172A]">
      <div className="w-full max-w-md text-center rounded-2xl border border-[#E4E9F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-8 shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#007B5F]/10 text-[#007B5F]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold text-[#1A2B3C] dark:text-[#E2E8F0]">
          Zahlung erhalten, danke
        </h1>
        <p className="mt-3 text-[#4A5568] dark:text-[#A0AEC0]">
          {showSpinner
            ? "Wir schalten deinen MedPrüf-Pro-Zugang gerade frei. Einen Moment …"
            : "Dein Pro-Zugang ist aktiv. Du wirst gleich weitergeleitet."}
        </p>
        <p className="mt-2 text-sm text-[#4A5568] dark:text-[#A0AEC0]">
          {showSpinner
            ? "Activating your MedPrüf Pro access. Just a moment …"
            : "Your Pro access is active. Redirecting you now."}
        </p>
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
        {timedOut && (
          <Link
            href="/"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#003A8C] px-6 py-3 font-semibold text-white transition hover:opacity-90"
          >
            Weiter zu MedPrüf
          </Link>
        )}
        <p className="mt-4 text-xs text-[#A0AEC0]">
          Eine Frage? Schreib an user-b7e46e80@example.com
        </p>
      </div>
    </main>
  );
}
