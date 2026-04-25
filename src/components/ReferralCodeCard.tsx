"use client";

/**
 * ReferralCodeCard — a quiet, passive dashboard card that shows the
 * user's referral code on day 1.
 *
 * Rescue-sprint §4 (2026-04-24) background:
 *
 * The old flow asked users to configure a payout method BEFORE any
 * referral could qualify → 0 activations ever shipped. The new flow:
 *
 *   1. Show the code on the dashboard from day 1 (this card).
 *   2. Defer payout-method setup until the first referee actually pays
 *      (the NOWPayments webhook sends the "pick how we pay you" email
 *      when a referral first qualifies).
 *
 * First-touch copy avoids €-figures. The dollar numbers live on
 * /referrals where the user lands with intent. This card is:
 *
 *   - Code (monospace, big, tap-to-select)
 *   - "Kopieren" button (primary)
 *   - One-line explainer — "Freund wird Pro → beide bekommen Bonus"
 *   - "Details" link to /referrals
 *
 * Coexistence with the announcement gate (see
 * `src/lib/announcements/useAnnouncementGate.ts`):
 *
 *   - This card is NOT elected by the gate — it's always rendered on
 *     the dashboard once the user has passed onboarding. It's a
 *     stationary surface (inline content card), not an interrupt,
 *     so the "one surface at a time" rule doesn't apply to it.
 *
 *   - If the gate has currently elected `referral_floater` we SKIP
 *     rendering the card to avoid duplicate referral pitches on the
 *     same viewport. Cohort banner and orientation modal don't
 *     conflict visually — different regions, different intent — but
 *     the floater DOES so we defer to it.
 *
 *   - Guest accounts (id starts with "guest_") never see this card
 *     because they don't have a persistent referral code.
 *
 * Analytics (fired client-side):
 *   - `referral_code_copied` — on successful copy click
 *   (also POSTs /api/referrals/mark-copied so the sidebar nudge-dot
 *    disappears on next render).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Gift } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { trackEvent } from "@/lib/tracker";
import { useAnnouncementGate } from "@/lib/announcements/useAnnouncementGate";

type Lang = "de" | "en";

interface ReferralCodeCardProps {
  /** The logged-in user's id. Required — card returns null for guest. */
  userId: string;
  /** UI language for copy. */
  lang: Lang;
  /**
   * Optional — if the parent already has the user's stored session it
   * can pass the referral code directly, saving a fetch. If omitted
   * we lazy-fetch from /api/referrals/status on mount.
   */
  initialReferralCode?: string | null;
  /**
   * Optional — parent can tell us whether the user has already copied
   * their code (NULL = never, ISO string = copied at). Used for the
   * "first copy" vs "copied again" micro-copy. Lazy-fetched if omitted.
   */
  initialCopiedAt?: string | null;
}

export default function ReferralCodeCard({
  userId,
  lang,
  initialReferralCode,
  initialCopiedAt,
}: ReferralCodeCardProps) {
  const [code, setCode] = useState<string | null>(initialReferralCode ?? null);
  const [loading, setLoading] = useState(!initialReferralCode);
  const [copied, setCopied] = useState(false);
  const [copiedAt, setCopiedAt] = useState<string | null>(initialCopiedAt ?? null);
  const { activeSurface } = useAnnouncementGate();

  // Skip entirely for guests — they don't have a persistent code.
  const isGuest = userId.startsWith("guest_");

  // Fetch referral code lazily if the parent didn't pass it. The status
  // endpoint already handles code generation for users who don't yet
  // have one, so we get a valid code even on first touch.
  useEffect(() => {
    if (isGuest) return;
    if (initialReferralCode) return;

    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/referrals/status", {
          skipAuthRedirect: true,
        });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setCode(data.referralCode ?? null);
        setCopiedAt(data.referralCodeCopiedAt ?? null);
      } catch {
        /* non-critical — card silently hides if we can't fetch */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isGuest, initialReferralCode]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard may fail in insecure contexts (http:// previews).
      // Fall back to a temporary text input selection.
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      } catch {
        /* give up — at least the code is visible in the card */
      }
    }

    // Fire analytics. Even if the clipboard write failed above, the
    // intent-to-share signal is useful for the funnel.
    try {
      trackEvent("referral_code_copied", {
        userId,
        source: "dashboard_card",
      });
    } catch {
      /* non-critical */
    }

    // Stamp the server-side "copied at" so the sidebar nudge-dot clears
    // on next render. Idempotent — safe to call every time.
    try {
      const r = await authFetch("/api/referrals/mark-copied", {
        method: "POST",
        headers: { "content-type": "application/json" },
        skipAuthRedirect: true,
      });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        if (data?.copiedAt) setCopiedAt(data.copiedAt);
      }
    } catch {
      /* non-critical */
    }
  }, [code, userId]);

  // ── Visibility gates ────────────────────────────────────────────

  if (isGuest) return null;

  // If the gate has elected the referral floater right now, skip the
  // dashboard card — the floater is the louder surface, no point
  // duplicating the pitch. Other surfaces (cohort banner, orientation
  // modal) live in different regions and don't conflict.
  if (activeSurface === "referral_floater") return null;

  // Loading shimmer — don't flash "empty" before the fetch lands.
  if (loading && !code) {
    return (
      <div
        className="mp-card rounded-2xl p-5 mb-8"
        aria-busy="true"
        aria-label={lang === "de" ? "Empfehlungscode lädt" : "Loading referral code"}
      >
        <div className="h-5 w-40 rounded bg-[var(--mp-surface-sunken)] animate-pulse mb-3" />
        <div className="h-12 rounded-xl bg-[var(--mp-surface-sunken)] animate-pulse" />
      </div>
    );
  }

  if (!code) return null;

  const explainer =
    lang === "de"
      ? "Freund wird Pro → beide bekommen Bonus."
      : "Friend goes Pro → both get a bonus.";
  const title =
    lang === "de"
      ? "Dein Empfehlungscode"
      : "Your referral code";
  const detailsLabel =
    lang === "de" ? "Details" : "Details";
  const copyLabel =
    lang === "de" ? "Kopieren" : "Copy";
  const copiedLabel =
    lang === "de" ? "Kopiert" : "Copied";

  return (
    <section
      className="mp-card rounded-2xl p-5 mb-8"
      aria-label={title}
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: "var(--mp-viridian)",
            color: "#FFFFFF",
            boxShadow: "var(--mp-shadow-xs)",
          }}
          aria-hidden
        >
          <Gift className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--mp-fg)]">
              {title}
            </p>
            <Link
              href="/referrals"
              className="text-xs font-semibold text-[var(--mp-viridian)] hover:underline flex-shrink-0"
            >
              {detailsLabel} →
            </Link>
          </div>
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5 leading-relaxed">
            {explainer}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch gap-2">
        <div
          className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] font-mono text-base font-bold text-[var(--mp-fg)] tracking-wider select-all"
          aria-label={lang === "de" ? "Empfehlungscode" : "Referral code"}
        >
          {code}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="mp-btn mp-btn--primary justify-center gap-2"
          aria-label={copyLabel}
          data-copied={copied ? "true" : "false"}
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              {copiedLabel}
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              {copyLabel}
            </>
          )}
        </button>
      </div>

      {/* Subtle "first copy ever" confirmation once they've copied.
          Uses copiedAt from the server (not the `copied` ephemeral
          flash flag) so the line persists across renders. */}
      {copiedAt && (
        <p className="text-[11px] text-[var(--mp-fg-subtle)] mt-2">
          {lang === "de"
            ? "Teile ihn mit anderen Prüflingen — sobald sie Pro werden, bekommt ihr beide einen Bonus."
            : "Share it with fellow candidates — once they go Pro, you both get a bonus."}
        </p>
      )}
    </section>
  );
}
