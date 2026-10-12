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
 * Mechanics:
 *   - On mount → fetch /api/auth/me with a cache-buster query param.
 *   - On `document.visibilitychange` (user returns from another tab) →
 *     re-fetch.
 *   - Every 5 min while mounted → re-fetch.
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

import { useCallback, useEffect, useRef, useState } from "react";
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
  };
  fetched_at?: string;
}

function computeIsPaid(
  tier: "free" | "pro" | "admin",
  tierExpiresAt: string | null,
  role: "user" | "admin",
): boolean {
  // Admin role overrides tier — /admin/ operators may have tier='free'
  // because they don't pay. Mirror lib/auth.ts hasProAccess().
  if (role === "admin") return true;
  if (tier !== "pro" && tier !== "admin") return false;
  if (!tierExpiresAt) return true;
  try {
    return new Date(tierExpiresAt).getTime() > Date.now();
  } catch {
    return true;
  }
}

export function useUserTier(): UserTierState {
  const [tier, setTier] = useState<"free" | "pro" | "admin">("free");
  const [tierExpiresAt, setTierExpiresAt] = useState<string | null>(null);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [emailStatus, setEmailStatus] = useState<
    "valid" | "bounced" | "unverified" | null
  >(null);
  const [referralsEnabled, setReferralsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  // Seed initial state from the stored session blob to avoid a
  // free→paid flicker on first paint. /api/auth/me will overwrite
  // within milliseconds.
  useEffect(() => {
    const s = getStoredSession();
    if (s?.user) {
      setTier((s.user.tier as "free" | "pro" | "admin") ?? "free");
      setTierExpiresAt(s.user.tier_expires_at ?? null);
      setRole((s.user.role as "user" | "admin") ?? "user");
    }
  }, []);

  const fetchNow = useCallback(async () => {
    if (typeof window === "undefined") return;
    // Cancel any in-flight request before starting a new one.
    if (inFlightRef.current) inFlightRef.current.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;

    setIsLoading(true);
    setError(null);
    try {
      // Cache-buster query param defeats any intermediate cache that
      // ignores Cache-Control: no-store (e.g. service worker fallback).
      const r = await authFetch(`/api/auth/me?t=${Date.now()}`, {
        signal: ctrl.signal,
        skipAuthRedirect: true,
      });
      if (ctrl.signal.aborted) return;

      if (!r.ok) {
        // 401/410 — let the global authFetch handler take care of the
        // redirect. We just stop loading.
        if (mountedRef.current) {
          setError(`HTTP ${r.status}`);
          setIsLoading(false);
        }
        return;
      }
      const body = (await r.json()) as MeResponse;
      const u = body.user;
      if (!u) {
        if (mountedRef.current) {
          setError("malformed");
          setIsLoading(false);
        }
        return;
      }

      if (!mountedRef.current) return;
      setTier(u.tier);
      setTierExpiresAt(u.tier_expires_at);
      setRole(u.role);
      setEmailStatus(u.email_status);
      setReferralsEnabled(u.referrals_enabled ?? false);
      setIsLoading(false);

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
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "fetch_failed");
        setIsLoading(false);
      }
    } finally {
      if (inFlightRef.current === ctrl) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchNow();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchNow();
    };
    window.addEventListener("medpruef:payment-resolved", fetchNow);
    document.addEventListener("visibilitychange", onVisibility);
    const id = setInterval(() => void fetchNow(), REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("medpruef:payment-resolved", fetchNow);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(id);
      if (inFlightRef.current) inFlightRef.current.abort();
    };
  }, [fetchNow]);

  return {
    tier,
    tierExpiresAt,
    role,
    emailStatus,
    isPaid: computeIsPaid(tier, tierExpiresAt, role),
    isAdmin: role === "admin",
    audience: audienceOf({ signedIn: Boolean(getStoredSession()), role, tier, tierExpiresAt }),
    referralsEnabled,
    isLoading,
    error,
    refresh: fetchNow,
  };
}
