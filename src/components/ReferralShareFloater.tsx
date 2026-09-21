"use client";

/**
 * ReferralShareFloater — bottom-right pill nudging engaged users to
 * share their referral link.
 *
 * Post-soft-launch sprint §1.4.4 rewrite:
 *
 *   - Visibility is elected by the shared announcement gate. Never
 *     stacks with OrientationModal or CohortCountdownBanner. See
 *     `src/lib/announcements/useAnnouncementGate.ts`.
 *   - Gate enforces: session 3+ OR ≥25 Qs answered AND orientation
 *     modal seen AND cohort banner dismissed. So this never fires on
 *     first touch — only after the user has invested effort.
 *   - Copy no longer name-drops "€25–75" on the first-touch surface.
 *     The dollar figure stays on /referrals where the user lands with
 *     intent. Here we say "Empfehle MedPrüf" without a price anchor.
 *   - Safe-area inset on iPhone 14 Pro Max home indicator fixed via
 *     `env(safe-area-inset-bottom)`.
 *   - 30-day post-dismissal cooldown preserved, enforced server-side
 *     (raised from 7 days on 2026-09-21 so a dismissed nag stays
 *     quiet for at least a month).
 *   - 6s mount delay preserved so we don't greet the user with a nag.
 *
 * Still renders only on active-study paths (`/`, `/flashcards`,
 * `/quiz`) — no point pitching a referral while the user is reading
 * the privacy policy.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Gift, X } from "lucide-react";
import {
  useAnnouncementGate,
  type SurfaceKey,
} from "@/lib/announcements/useAnnouncementGate";
import { t, useLang } from "@/lib/i18n";
import { useUserTier } from "@/lib/hooks/useUserTier";

const SURFACE: SurfaceKey = "referral_floater";
const ALLOWED_PATHS = ["/", "/flashcards", "/quiz"];
const MOUNT_DELAY_MS = 6000;

export default function ReferralShareFloater() {
  const pathname = usePathname();
  const lang = useLang();
  const { activeSurface, markSeen } = useAnnouncementGate();
  // Invite-only gate (2026-06-25): belt-and-suspenders check alongside the
  // announcement gate's own referralsEnabled guard in computeActiveSurface.
  // Having both means the floater is hidden even if the gate evaluates
  // referral_floater for any reason while referralsEnabled is still false
  // (e.g. race on initial load).
  const { referralsEnabled } = useUserTier();
  const [mountedForLongEnough, setMountedForLongEnough] = useState(false);

  // 6-second mount delay: don't greet the user with a referral pitch.
  // The gate already enforces the 25-Qs threshold, but the delay is an
  // extra layer of politeness — they just loaded the page, let them
  // look at it first.
  useEffect(() => {
    const timer = setTimeout(() => setMountedForLongEnough(true), MOUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!pathname || !ALLOWED_PATHS.includes(pathname)) return null;
  if (activeSurface !== SURFACE) return null;
  // Invite-only: hide for accounts not enrolled in the referral program.
  if (!referralsEnabled) return null;
  if (!mountedForLongEnough) return null;

  const handleDismiss = () => {
    void markSeen(SURFACE);
  };

  return (
    <div
      role="region"
      aria-label={t("ref_floater_region_label", lang)}
      className="fixed z-[55] right-4 max-w-sm animate-fade-in"
      style={{
        // Respect the iPhone 14 Pro Max home-indicator inset. On
        // devices without a home indicator, `env(safe-area-inset-
        // bottom)` resolves to 0 and the calc falls back to the
        // existing 80px (mobile) / 16px (sm+) offset.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
      }}
    >
      <div className="relative rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border)] shadow-xl p-4 pr-10">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label={t("ref_floater_close", lang)}
        >
          <X className="w-4 h-4" aria-hidden />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-[var(--mp-r-card)] bg-[var(--mp-cta-blue)]/10 flex items-center justify-center flex-shrink-0">
            <Gift className="w-5 h-5 text-[var(--mp-cta-blue)]" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--mp-fg)] leading-snug">
              {t("ref_floater_title", lang)}
            </p>
            <p className="text-xs text-[var(--mp-fg-subtle)] mt-1 leading-relaxed">
              {t("ref_floater_body", lang)}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Link
                href="/referrals?utm_source=floater&utm_medium=floater&utm_campaign=post_launch"
                onClick={handleDismiss}
                className="mp-btn mp-btn--primary text-xs px-3 py-1.5 min-h-[44px] flex items-center justify-center"
              >
                {t("ref_floater_cta_details", lang)}
              </Link>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] px-2 py-1"
              >
                {t("ref_floater_cta_not_now", lang)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
