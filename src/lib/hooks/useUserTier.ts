"use client";

/**
 * useUserTier — React hook that returns the current authenticated
 * user's tier + role + email_status, refreshed live from /api/auth/me.
 *
 * Source of truth (review-2026-04-26-A2). Every client surface that
 * wants to gate UI by tier MUST use this hook instead of reading
 * `session.user.tier` from `getStoredSession()` — that path was
 * minted at login time and goes stale the moment an admin grants
 * Pro server-side.
 *
 * Mechanics (one shared store per tab since a-db-relief-1, see below):
 *   - First mount → fetch /api/auth/me with a cache-buster query param;
 *     later mounts share it (a mount within 30 s of the last answer
 *     fetches nothing).
 *   - On `document.visibilitychange` (user returns from another tab) →
 *     re-fetch once for the whole tab.
 *   - Every 5 min while any component is mounted → re-fetch.
 *   - `refresh()` exposed for callers that just performed a state
 *     change and want to surface the result instantly.
 *   - Mirrors the result back into localStorage.medpruef_session.user
 *     so legacy direct readers see fresh data within ≤5 min.
 *
 * Returns:
 *   { tier, tierExpiresAt, role, emailStatus, isPaid, isAdmin,
 *     isLoading, error, refresh }
 *
 * `isPaid` is true for tier='pro' / 'admin' AND (no expiry OR expiry > now).
 * `isAdmin` is true for role='admin'.
 *
 * SSR-safe — returns the stored session's tier as the initial value
 * to avoid the flicker of "Free" → "Pro" on first paint, then refreshes.
 */

import { hasPackAccessStamp } from "@/lib/offline-pack-stamp";
import { useSyncExternalStore } from "react";
import { authFetch } from "@/lib/authFetch";
import { getStoredSession, storeSession, type StoredSession } from "@/lib/auth";
import { audienceOf, type Audience } from "@/lib/entitlements";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface UserTierState {
  tier: "free" | "pro" | "admin";
  tierExpiresAt: string | null;
  role: "user" | "admin";
  emailStatus: "valid" | "bounced" | "unverified" | null;
  isPaid: boolean;
  isAdmin: boolean;
  /** Entitlements audience (UX-GLOBAL-19): read `canUse(feature, audience)`. */
  audience: Audience;
  /**
   * Invite-only referral program (2026-06-25). True only for accounts an
   * admin has flagged (`users.referrals_enabled`); default false. Gate all
   * referral UI (blocks, floater) on this so the open, loss-making program
   * is off by default. Live-read from /api/auth/me; false until resolved.
   */
  referralsEnabled: boolean;
  /**
   * a-referral-surface: true only while REFERRAL_SURFACE_ENABLED is on, this
   * account is in the referral program and the exam reward is live (computed
   * by /api/auth/me). The invite surfaces fetch nothing while it is false.
   */
  referralSurface: boolean;
  /** a-free-credit-hooks: MENTOR_CAMPAIGN_CODES_ENABLED (from /api/auth/me, env only). */
  campaignCodes: boolean;
  /** a-free-credit-hooks: MENTOR_EXPERIENCE_REWARD_ENABLED (from /api/auth/me, env only). */
  experienceReward: boolean;
  /** a-activation-48h: ACTIVATION_48H_ENABLED (from /api/auth/me, env only). */
  activation: boolean;
  /** a-pricing-v2: end of the running no-card reverse trial, else null. */
  reverseTrialEndsAt: string | null;
  /** a-seed-seats: end of a running seed seat when the account's access comes only from it, else null. */
  seedSeatEndsAt: string | null;
  /** a-trial-end-decision: TRIAL_END_CARD_ENABLED (from /api/auth/me, env only). */
  trialEndCard: boolean;
  /** a-cram-card: HOME_CRAM_CARD_ENABLED (from /api/auth/me, env only). */
  homeCramCard: boolean;
  /** a-email-confirm-trial: the Home confirmation line may ask its status (from /api/auth/me, env and account age only). */
  emailConfirm: boolean;
  /** a-trial-phone-gate: the reverse trial waits only for a linked Telegram (TELEGRAM_LINK_ENABLED). */
  trialTelegramLink: boolean;
  /** a-feedback-at-pause: FEEDBACK_ASK_ENABLED (from /api/auth/me, env only). */
  feedbackAsk: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

interface MeResponse {
  user?: {
    id: string;
    tier: "free" | "pro" | "admin";
    tier_expires_at: string | null;
    role: "user" | "admin";
    email_status: "valid" | "bounced" | "unverified" | null;
    language_code: "de" | "en" | null;
    onboarding_completed_at: string | null;
    referrals_enabled?: boolean | null;
    referral_surface?: boolean | null;
    campaign_codes?: boolean | null;
    experience_reward?: boolean | null;
    activation?: boolean | null;
    reverse_trial?: { ends_at: string | null; started?: boolean } | null;
    seed_seat?: { ends_at: string | null } | null;
    trial_end_card?: boolean | null;
    home_cram_card?: boolean | null;
    email_confirm?: boolean | null;
    trial_telegram_link?: boolean | null;
    feedback_ask?: boolean | null;
  };
  fetched_at?: string;
}

/**
 * Paid-pack sync input (a28-finish). The expiry is judged on the server's
 * clock (the /api/auth/me Date header), never the device's: a phone clock
 * running ahead must not delete a paying learner's pack. Without a readable
 * server time only a tier the server no longer marks Pro counts as ended.
 */
export function livePackAccess(
  u: { tier: "free" | "pro" | "admin"; tier_expires_at: string | null; role: "user" | "admin" },
  dateHeader: string | null,
): { isPaid: boolean; tierExpiresAt: string | null; role: string } {
  const serverNow = Date.parse(dateHeader ?? "");
  return {
    isPaid: Number.isFinite(serverNow)
      ? computeIsPaid(u.tier, u.tier_expires_at, u.role, serverNow)
      : computeIsPaid(u.tier, null, u.role),
    tierExpiresAt: u.tier_expires_at,
    role: u.role,
  };
}

export function computeIsPaid(
  tier: "free" | "pro" | "admin",
  tierExpiresAt: string | null,
  role: "user" | "admin",
  now: number = Date.now(),
): boolean {
  // Admin role overrides tier — /admin/ operators may have tier='free'
  // because they don't pay. Mirror lib/auth.ts hasProAccess().
  if (role === "admin") return true;
  if (tier !== "pro" && tier !== "admin") return false;
  if (!tierExpiresAt) return true;
  try {
    return new Date(tierExpiresAt).getTime() > now;
  } catch {
    return true;
  }
}

// ── Shared store (a-db-relief-1) ─────────────────────────────────────
//
// Up to ten components on Home call this hook. Each used to fetch
// /api/auth/me on mount, on every tab return and every 5 minutes, and each
// call cost two users reads on the database. Now one store per tab owns the
// poller: the first subscriber starts it, later subscribers share its state,
// a mount within FRESH_MS of the last answer for the same account fetches
// nothing, and the last unsubscribe stops it.

/** A mount sooner than this after the last answer reuses it. */
export const USER_TIER_FRESH_MS = 30_000;

export interface UserTierSnapshot {
  tier: "free" | "pro" | "admin";
  tierExpiresAt: string | null;
  role: "user" | "admin";
  emailStatus: "valid" | "bounced" | "unverified" | null;
  referralsEnabled: boolean;
  referralSurface: boolean;
  campaignCodes: boolean;
  experienceReward: boolean;
  /** a-activation-48h: ACTIVATION_48H_ENABLED (env only). */
  activation: boolean;
  reverseTrialEndsAt: string | null;
  seedSeatEndsAt: string | null;
  /** a-trial-end-decision: TRIAL_END_CARD_ENABLED (env only). */
  trialEndCard: boolean;
  homeCramCard: boolean;
  /** a-email-confirm-trial (env and account age only). */
  emailConfirm: boolean;
  /** a-trial-phone-gate. */
  trialTelegramLink: boolean;
  /** a-feedback-at-pause: FEEDBACK_ASK_ENABLED (env only). */
  feedbackAsk: boolean;
  isLoading: boolean;
  error: string | null;
  /** Account the values belong to (null until known). */
  userId: string | null;
  /** Epoch ms of the last good answer. */
  fetchedAt: number | null;
}

export const SERVER_TIER_SNAPSHOT: UserTierSnapshot = {
  tier: "free", tierExpiresAt: null, role: "user", emailStatus: null, referralsEnabled: false, referralSurface: false, campaignCodes: false, experienceReward: false, activation: false, reverseTrialEndsAt: null, seedSeatEndsAt: null, trialEndCard: false, homeCramCard: false, emailConfirm: false, trialTelegramLink: false, feedbackAsk: false,
  isLoading: true, error: null, userId: null, fetchedAt: null,
};

export interface UserTierStoreDeps {
  fetchMe: (signal: AbortSignal) => Promise<Response>;
  /** The stored session's account and tier (seed for first paint). */
  readSession: () => { userId: string | null; tier?: string | null; tierExpiresAt?: string | null; role?: string | null } | null;
  /** Called once per good answer (session mirror, offline pack sync). */
  onUser?: (user: NonNullable<MeResponse["user"]>, res: Response) => void;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  /** Wire tab-return and payment events; returns the cleanup. */
  listen?: (onVisible: () => void, onPaymentResolved: () => void) => () => void;
}

export interface UserTierStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => UserTierSnapshot;
  refresh: () => Promise<void>;
}

export function createUserTierStore(deps: UserTierStoreDeps): UserTierStore {
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: UserTierSnapshot = SERVER_TIER_SNAPSHOT;
  let inFlight: AbortController | null = null;
  let stopTimers: (() => void) | null = null;

  const set = (patch: Partial<UserTierSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const l of [...listeners]) l();
  };

  const seedFromSession = () => {
    const s = deps.readSession();
    set({
      ...SERVER_TIER_SNAPSHOT,
      userId: s?.userId ?? null,
      tier: ((s?.tier as UserTierSnapshot["tier"]) || "free"),
      tierExpiresAt: s?.tierExpiresAt ?? null,
      role: ((s?.role as UserTierSnapshot["role"]) || "user"),
    });
  };

  const fetchNow = async (): Promise<void> => {
    // A forced refresh supersedes the request in flight.
    inFlight?.abort();
    const ctrl = new AbortController();
    inFlight = ctrl;
    set({ isLoading: true, error: null });
    try {
      const r = await deps.fetchMe(ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!r.ok) {
        // 401/410: the global authFetch handler takes care of the redirect.
        set({ error: `HTTP ${r.status}`, isLoading: false });
        return;
      }
      const body = (await r.json()) as MeResponse;
      if (ctrl.signal.aborted) return;
      const u = body.user;
      if (!u) {
        set({ error: "malformed", isLoading: false });
        return;
      }
      // An answer for another account than the session's (the account
      // changed while this request ran) is dropped; the switch refetches.
      const sessionUser = deps.readSession()?.userId ?? null;
      if (u.id && sessionUser && u.id !== sessionUser) return;
      try { deps.onUser?.(u, r); } catch { /* mirrors are best-effort */ }
      set({
        tier: u.tier, tierExpiresAt: u.tier_expires_at, role: u.role, emailStatus: u.email_status,
        referralsEnabled: u.referrals_enabled ?? false, referralSurface: u.referral_surface === true,
        campaignCodes: u.campaign_codes === true, experienceReward: u.experience_reward === true, activation: u.activation === true,
        reverseTrialEndsAt: typeof u.reverse_trial?.ends_at === "string" ? u.reverse_trial.ends_at : null,
        seedSeatEndsAt: typeof u.seed_seat?.ends_at === "string" ? u.seed_seat.ends_at : null,
        trialEndCard: u.trial_end_card === true,
        homeCramCard: u.home_cram_card === true,
        emailConfirm: u.email_confirm === true,
        trialTelegramLink: u.trial_telegram_link === true,
        feedbackAsk: u.feedback_ask === true,
        isLoading: false, error: null,
        userId: u.id ?? snapshot.userId, fetchedAt: now(),
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || ctrl.signal.aborted) return;
      set({ error: err instanceof Error ? err.message : "fetch_failed", isLoading: false });
    } finally {
      if (inFlight === ctrl) inFlight = null;
    }
  };

  const start = () => {
    const setI = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    const clearI = deps.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
    const id = setI(() => void fetchNow(), REFRESH_INTERVAL_MS);
    const unlisten = deps.listen?.(() => void fetchNow(), () => void fetchNow()) ?? (() => undefined);
    stopTimers = () => { clearI(id); unlisten(); };
  };

  const stop = () => {
    stopTimers?.();
    stopTimers = null;
    inFlight?.abort();
    inFlight = null;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      const sessionUser = deps.readSession()?.userId ?? null;
      // Another account, or signed out since the last answer: never show the old account's tier.
      const otherAccount = snapshot.userId !== null && sessionUser !== snapshot.userId;
      if (snapshot === SERVER_TIER_SNAPSHOT || otherAccount) seedFromSession();
      if (!stopTimers) start();
      const fresh = snapshot.fetchedAt !== null && now() - snapshot.fetchedAt < USER_TIER_FRESH_MS && !otherAccount && !snapshot.isLoading;
      // An account switch supersedes a request in flight for the old account.
      if (otherAccount || (!fresh && !inFlight)) void fetchNow();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
    refresh: fetchNow,
  };
}

let browserStore: UserTierStore | null = null;

/** The tab's store (browser only). */
export function userTierStore(): UserTierStore {
  if (browserStore) return browserStore;
  browserStore = createUserTierStore({
    // Cache-buster query param defeats any intermediate cache that
    // ignores Cache-Control: no-store (e.g. service worker fallback).
    fetchMe: (signal) => authFetch(`/api/auth/me?t=${Date.now()}`, { signal, skipAuthRedirect: true }),
    readSession: () => {
      const s = getStoredSession();
      if (!s?.user) return null;
      return { userId: s.user.id ?? null, tier: s.user.tier, tierExpiresAt: s.user.tier_expires_at ?? null, role: s.user.role };
    },
    onUser: (u, r) => {
      // a28: a paid offline pack follows the live access (renewal moves its
      // end date, a confirmed end clears it). Fire and forget. Only devices
      // that hold a paid pack load the downloader; everyone else pays no
      // request and no extra bundle for it.
      if (hasPackAccessStamp()) {
        const live = livePackAccess(u, r.headers.get("date"));
        void import("@/lib/offline-pack")
          .then((m) => m.syncPackAccess(live))
          .catch(() => undefined);
      }
      // Mirror back into the stored session blob so non-migrated
      // surfaces (or the next session.read) see fresh values without
      // round-tripping. storeSession runs the sanitizer for us.
      try {
        const s = getStoredSession();
        if (s) {
          const next: StoredSession = {
            ...s,
            user: {
              ...s.user,
              tier: u.tier,
              tier_expires_at: u.tier_expires_at,
              role: u.role,
              email_status: u.email_status,
            },
          };
          storeSession(next);
        }
      } catch {
        /* localStorage may be disabled — non-fatal */
      }
    },
    listen: (onVisible, onPaymentResolved) => {
      const visibility = () => { if (document.visibilityState === "visible") onVisible(); };
      window.addEventListener("medpruef:payment-resolved", onPaymentResolved);
      document.addEventListener("visibilitychange", visibility);
      return () => {
        window.removeEventListener("medpruef:payment-resolved", onPaymentResolved);
        document.removeEventListener("visibilitychange", visibility);
      };
    },
  });
  return browserStore;
}

const noopSubscribe = () => () => undefined;
const noopRefresh = () => undefined;

export function useUserTier(): UserTierState {
  const store = typeof window === "undefined" ? null : userTierStore();
  const snap = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => SERVER_TIER_SNAPSHOT,
    () => SERVER_TIER_SNAPSHOT,
  );
  const { tier, tierExpiresAt, role } = snap;
  return {
    tier,
    tierExpiresAt,
    role,
    emailStatus: snap.emailStatus,
    isPaid: computeIsPaid(tier, tierExpiresAt, role),
    isAdmin: role === "admin",
    audience: audienceOf({ signedIn: Boolean(getStoredSession()), role, tier, tierExpiresAt }),
    referralsEnabled: snap.referralsEnabled,
    referralSurface: snap.referralSurface,
    campaignCodes: snap.campaignCodes,
    experienceReward: snap.experienceReward,
    activation: snap.activation,
    reverseTrialEndsAt: snap.reverseTrialEndsAt,
    seedSeatEndsAt: snap.seedSeatEndsAt,
    trialEndCard: snap.trialEndCard,
    homeCramCard: snap.homeCramCard,
    emailConfirm: snap.emailConfirm,
    trialTelegramLink: snap.trialTelegramLink,
    feedbackAsk: snap.feedbackAsk,
    isLoading: snap.isLoading,
    error: snap.error,
    // Stable reference (callers keep it in effect dependencies).
    refresh: store ? store.refresh : noopRefresh,
  };
}
