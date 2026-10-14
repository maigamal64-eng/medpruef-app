"use client";

/**
 * useAnnouncementGate — the single source of truth for which marketing
 * surface is allowed to render on the current page.
 *
 * Why this exists:
 *
 * The soft-launch shipped with three announcement surfaces
 * (CohortCountdownBanner + SoftLaunchWelcomeModal + ReferralShareFloater)
 * each self-gated via independent localStorage keys. Result: on first
 * touch to medpruef.com a logged-in post-onboarding user could see all
 * three simultaneously — two of them pitching the same €25-75 referral
 * bounty. Read as spammy. Post-soft-launch sprint §1.4 centralises the
 * gate so at most ONE non-modal surface renders at any time, behaviour-
 * earned, with a strict priority queue.
 *
 * Cadence (matches §1.4.2 of the sprint prompt):
 *
 *   Session 1, <5 Qs answered                → null (nothing)
 *   Session 1, ≥5 Qs                         → 'cohort_banner'
 *   Session 3+, ≥5 Qs, orientation not seen  → 'orientation_modal' (ONB-35)
 *   Session 3+ OR ≥25 Qs answered            → 'referral_floater'
 *     AND orientation_modal seen
 *     AND cohort_banner dismissed
 *     AND (30-day post-dismissal cooldown respected)
 *   Else                                     → 'cohort_banner' (if not dismissed)
 *                                              OR null
 *
 * PaywallUpgradeModal is orthogonal — caller-triggered by the 150Q cap
 * hit in /api/questions, never elected by this gate. GuestMigrationBanner
 * is likewise self-gated on the guest check; this hook only arbitrates
 * between the four non-guest surfaces.
 *
 * Cross-device coherence: the gate state lives in `user_announcements`
 * (server-side). Every page load hits /api/announcements/state which
 * returns the current row + bumps session_count if > 30 min idle.
 * Components use `markSeen(surface)` to dismiss server-side; the hook
 * returns an optimistic local update + POSTs in the background.
 *
 * Usage:
 *
 *     const { activeSurface, markSeen } = useAnnouncementGate();
 *     if (activeSurface !== 'cohort_banner') return null;   // surface filters itself
 *
 *     <button onClick={() => markSeen('cohort_banner')}>✕</button>
 *
 * Added 2026-04-23 post-soft-launch.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { authFetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { setAnnouncementContext } from "@/lib/announcements/queue";
import { getStoredSession } from "@/lib/auth";
import {
  ANNOUNCEMENT_STATE_CACHE_KEY,
  forgetAccountCache,
  readAccountCache,
  writeAccountCache,
} from "@/lib/client-read-cache";

// ── Shared deduped fetch ─────────────────────────────────────────
//
// B-09 fan-out fix (2026-06-23): six surfaces co-mount on `/`
// (CohortCountdownBanner in layout + ReferralCodeCard / OrientationModal
// / ReferralShareFloater via this hook, plus WhatsNewModal +
// UserSurveyModal fetching directly) and each used to fire its own GET
// /api/announcements/state — so one page load hit the row ~6 times.
//
// `fetchAnnouncementState()` collapses concurrent callers onto ONE
// in-flight request: the first caller starts the fetch, everyone who
// asks while it's still pending gets the SAME promise, and the cache is
// cleared the instant it settles. This is an IN-FLIGHT dedupe, not a
// permanent cache — a later navigation (or a same-tab return after the
// 30-min session gap) re-fetches, so the server can still bump
// session_count. The endpoint is still hit "every page load", just once
// per load instead of six times.
//
// It returns the RAW parsed body (`{ state: {...} }` with every column,
// including whatsNewSeenAt / feedbackSurveyShownAt / feedbackSurveyDismissedAt
// that the two modals read but `AnnouncementState` doesn't model), so a
// caller can pull whichever fields it needs. `null` on 401 (guest/anon)
// or any error — same fall-through the individual callers had.

/** Raw `/api/announcements/state` response, all columns. */
export interface AnnouncementStateResponse {
  state?: {
    userId: string;
    sessionCount: number;
    qsAnsweredTotal: number;
    orientationModalSeenAt: string | null;
    cohortBannerDismissedAt: string | null;
    referralFloaterDismissedAt: string | null;
    feedbackSurveyShownAt?: string | null;
    feedbackSurveyDismissedAt?: string | null;
    whatsNewSeenAt?: string | null;
    lastSessionAt: string;
  } | null;
}

let inFlightStateFetch: Promise<AnnouncementStateResponse | null> | null = null;

// a-fo-10: the row is also kept five minutes per tab and account
// (src/lib/client-read-cache.ts), so page-to-page navigation stops
// re-reading it. That is well under the server's 30-minute session gap, so
// session_count bumps still happen; an answer count can lag by up to five
// minutes. Every /seen write replaces or clears the cached row.
// Bumped by every forget, so a GET that started before a /seen write can
// never store its older row over the fresh one.
let cacheGeneration = 0;

function currentAccountId(): string | null {
  const id = getStoredSession()?.user?.id;
  return typeof id === "string" && id && !id.startsWith("guest_") ? id : null;
}

function applyContext(body: AnnouncementStateResponse | null): void {
  // UX-GLOBAL-12: the queue's first-session and first-answer rules read
  // the same server row the cadence uses.
  if (body?.state) setAnnouncementContext({ firstSession: body.state.sessionCount <= 1, answeredTotal: body.state.qsAnsweredTotal });
}

/** Store a row the server just returned (GET /state or POST /seen) for its own account. */
export function rememberAnnouncementState(body: AnnouncementStateResponse | null): void {
  const owner = currentAccountId();
  if (owner && body?.state && body.state.userId === owner) {
    writeAccountCache(ANNOUNCEMENT_STATE_CACHE_KEY, owner, body);
  } else {
    forgetAccountCache(ANNOUNCEMENT_STATE_CACHE_KEY);
  }
}

/** Drop the cached row, e.g. after a /seen write whose answer was not read. */
export function forgetAnnouncementState(): void {
  cacheGeneration += 1;
  forgetAccountCache(ANNOUNCEMENT_STATE_CACHE_KEY);
}

/**
 * Fetch the caller's announcement-state row, deduping concurrent
 * callers onto one in-flight request. Returns the raw parsed body, or
 * `null` on 401 / non-OK / network error.
 */
export function fetchAnnouncementState(): Promise<AnnouncementStateResponse | null> {
  const owner = currentAccountId();
  const cached = readAccountCache<AnnouncementStateResponse>(ANNOUNCEMENT_STATE_CACHE_KEY, owner);
  if (cached?.state && cached.state.userId === owner) {
    applyContext(cached);
    return Promise.resolve(cached);
  }
  if (inFlightStateFetch) return inFlightStateFetch;
  const generation = cacheGeneration;

  inFlightStateFetch = authFetch("/api/announcements/state", {
    // Skip the 401 redirect — unauthenticated callers shouldn't see
    // announcements but they shouldn't be bounced to /login either.
    skipAuthRedirect: true,
  })
    .then((r) => {
      if (r.status === 401) return null; // anon / guest — no gate
      if (!r.ok) return null;
      return r.json() as Promise<AnnouncementStateResponse>;
    })
    .then((body) => {
      applyContext(body);
      if (body?.state && generation === cacheGeneration) rememberAnnouncementState(body);
      return body;
    })
    .catch(() => null)
    .finally(() => {
      // Clear immediately on settle so the NEXT page load / navigation
      // re-fetches (and the server can bump session_count again). Only
      // the concurrent co-mounts of a single load share the promise.
      inFlightStateFetch = null;
    });

  return inFlightStateFetch;
}

// ── Types ────────────────────────────────────────────────────────

export type ActiveSurface =
  | "cohort_banner"
  | "orientation_modal"
  | "referral_floater"
  | null;

export type SurfaceKey = "orientation_modal" | "cohort_banner" | "referral_floater";

export interface AnnouncementState {
  userId: string;
  sessionCount: number;
  qsAnsweredTotal: number;
  orientationModalSeenAt: string | null;
  cohortBannerDismissedAt: string | null;
  referralFloaterDismissedAt: string | null;
  lastSessionAt: string;
}

export interface UseAnnouncementGateResult {
  /** The one surface elected for this page load, or null if nothing is allowed. */
  activeSurface: ActiveSurface;
  /** Raw server state, useful for debug or deep conditional rendering. */
  state: AnnouncementState | null;
  /** True while the initial /state fetch is in flight. */
  loading: boolean;
  /**
   * Mark a surface as seen / dismissed. Optimistically updates local
   * state so the next render drops the surface, then POSTs to
   * /api/announcements/seen in the background.
   */
  markSeen: (surface: SurfaceKey) => Promise<void>;
}

// ── Cadence thresholds ───────────────────────────────────────────

const MIN_QS_FOR_COHORT_BANNER = 5;
const MIN_SESSION_FOR_ORIENTATION = 3;
const MIN_QS_FOR_REFERRAL_FLOATER = 25;
const MIN_SESSION_FOR_REFERRAL_FLOATER = 3;
// 30 days (2026-09-21): the cooldown only ever applies to a DISMISSAL
// (referralFloaterDismissedAt), so a user who never dismissed stays
// re-eligible exactly as before. Raised from 7 days so a dismissed
// referral nag stays quiet for at least a month.
const REFERRAL_FLOATER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * True while a referral-floater DISMISSAL is still inside its 30-day
 * cooldown window. Never-dismissed users (null) are always eligible.
 * Exported so the dashboard ReferralCodeCard can honour the exact same
 * window as the gate's floater election.
 */
export function isReferralDismissalCooldownActive(
  dismissedAtIso: string | null,
): boolean {
  return !cooldownElapsed(dismissedAtIso, REFERRAL_FLOATER_COOLDOWN_MS);
}

// ── Gate computation ─────────────────────────────────────────────

export function computeActiveSurface(
  state: AnnouncementState | null,
  isPaid = false,
  referralsEnabled = false,
): ActiveSurface {
  if (!state) return null;

  // Paying users (Pro/admin) never see upgrade banners, referral
  // pitches, or orientation nudges — they are already in. Short-circuit
  // before any cadence logic so the rule is unconditional.
  if (isPaid) return null;

  const {
    sessionCount,
    qsAnsweredTotal,
    orientationModalSeenAt,
    cohortBannerDismissedAt,
    referralFloaterDismissedAt,
  } = state;

  // Session 1, fewer than 5 Qs → nothing. Let the user experience
  // the product before asking for anything.
  if (sessionCount <= 1 && qsAnsweredTotal < MIN_QS_FOR_COHORT_BANNER) {
    return null;
  }

  // ONB-35 (a12): the orientation modal never appears in the first two
  // sessions and only after at least 5 answers; it fires once ever.
  if (sessionCount >= MIN_SESSION_FOR_ORIENTATION && qsAnsweredTotal >= MIN_QS_FOR_COHORT_BANNER && !orientationModalSeenAt) {
    return "orientation_modal";
  }

  // Referral floater is eligible when the user is genuinely engaged:
  // either they've started their third session OR they've answered at
  // least 25 questions cumulatively — AND they've already cleared the
  // orientation modal + dismissed the cohort banner once — AND they're
  // outside the 30-day post-dismissal cooldown on the floater itself —
  // AND the account has the invite-only referral program enabled
  // (referralsEnabled).
  const referralFloaterEligible =
    referralsEnabled &&
    (sessionCount >= MIN_SESSION_FOR_REFERRAL_FLOATER ||
      qsAnsweredTotal >= MIN_QS_FOR_REFERRAL_FLOATER) &&
    orientationModalSeenAt !== null &&
    cohortBannerDismissedAt !== null &&
    cooldownElapsed(referralFloaterDismissedAt, REFERRAL_FLOATER_COOLDOWN_MS);

  if (referralFloaterEligible) {
    return "referral_floater";
  }

  // Default: cohort banner if it hasn't been dismissed yet, else nothing.
  // The banner stays informational — the sprint prompt explicitly calls
  // for removing price-drop copy from it.
  if (!cohortBannerDismissedAt && qsAnsweredTotal >= MIN_QS_FOR_COHORT_BANNER) {
    return "cohort_banner";
  }

  return null;
}

function cooldownElapsed(timestampIso: string | null, cooldownMs: number): boolean {
  if (!timestampIso) return true; // never dismissed → eligible
  const dismissedAt = new Date(timestampIso).getTime();
  return Date.now() - dismissedAt >= cooldownMs;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useAnnouncementGate(): UseAnnouncementGateResult {
  const [state, setState] = useState<AnnouncementState | null>(null);
  const [loading, setLoading] = useState(true);
  // Track in-flight markSeen requests so we don't fire the same POST
  // twice on a double-click.
  const inFlight = useRef<Set<SurfaceKey>>(new Set());

  // Live tier read — used to short-circuit the gate for paid users and
  // to restrict the referral floater to invite-only accounts.
  const { isPaid, referralsEnabled } = useUserTier();

  // Fetch initial state on mount. The server also bumps session_count
  // if this is a new session, which is why we must hit it every page
  // load (not just first render of the whole SPA lifecycle).
  useEffect(() => {
    let cancelled = false;

    // Shared, in-flight-deduped fetch (B-09): the ~4 hook consumers +
    // the 2 direct-fetching modals that co-mount on `/` now collapse
    // onto ONE GET. Each consumer still keeps its OWN `state` below, so
    // a markSeen optimistic update on one surface doesn't re-gate the
    // others mid-page (cadence behaviour preserved exactly).
    fetchAnnouncementState()
      .then((data) => {
        if (cancelled) return;
        if (data && data.state) {
          setState(data.state);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const markSeen = useCallback(async (surface: SurfaceKey): Promise<void> => {
    if (inFlight.current.has(surface)) return;
    inFlight.current.add(surface);
    // A surface mounting while this write is in flight must not read the
    // cached row from before it.
    forgetAnnouncementState();

    // Optimistic update — flip the local timestamp so the gate re-
    // evaluates immediately. If the POST fails, the next page load
    // will reconcile from the server.
    setState((prev) => {
      if (!prev) return prev;
      const nowIso = new Date().toISOString();
      if (surface === "orientation_modal") {
        return { ...prev, orientationModalSeenAt: nowIso };
      }
      if (surface === "cohort_banner") {
        return { ...prev, cohortBannerDismissedAt: nowIso };
      }
      if (surface === "referral_floater") {
        return { ...prev, referralFloaterDismissedAt: nowIso };
      }
      return prev;
    });

    try {
      const res = await authFetch("/api/announcements/seen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surface }),
        skipAuthRedirect: true,
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.state) {
          setState(data.state);
          rememberAnnouncementState(data);
        } else {
          forgetAnnouncementState();
        }
      } else {
        forgetAnnouncementState();
      }
    } catch {
      forgetAnnouncementState();
      // The optimistic update already landed; the next mount will
      // reconcile from the server.
    } finally {
      inFlight.current.delete(surface);
    }
  }, []);

  const activeSurface = computeActiveSurface(state, isPaid, referralsEnabled);

  return { activeSurface, state, loading, markSeen };
}
