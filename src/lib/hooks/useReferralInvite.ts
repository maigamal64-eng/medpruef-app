"use client";

/**
 * useReferralInvite (a-referral-surface): the signed learner's invite from
 * GET /api/referrals/invite. Asks only while `active` (callers pass
 * useUserTier().referralSurface and their own condition), so nothing is
 * requested while the surfaces are off or the learner is outside the program. Concurrent callers share one request and a
 * result is reused for 60 s in this tab (the mentor note, the result line and
 * the Home card may mount together). Anything but a 2xx JSON body reads as
 * "not enabled": the surfaces then render nothing new.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";

export interface ReferralInvite {
  enabled: boolean;
  link?: string;
  mentorCredits?: number | null;
  card?: { activeDays14: number; eligible: boolean };
}

const REUSE_MS = 60_000;
const DISABLED: ReferralInvite = { enabled: false };

type Entry = { at: number; value: ReferralInvite } | { at: number; pending: Promise<ReferralInvite> };
const cache = new Map<string, Entry>();

/** Shape check: an enabled answer must carry an http(s) link. */
export function parseReferralInvite(body: unknown): ReferralInvite {
  if (!body || typeof body !== "object") return DISABLED;
  const b = body as Record<string, unknown>;
  if (b.enabled !== true || typeof b.link !== "string" || !/^https?:\/\//.test(b.link)) return DISABLED;
  const credits = typeof b.mentorCredits === "number" && b.mentorCredits > 0 ? b.mentorCredits : null;
  const card = b.card && typeof b.card === "object" ? b.card as Record<string, unknown> : null;
  return {
    enabled: true,
    link: b.link,
    mentorCredits: credits,
    ...(card && typeof card.activeDays14 === "number" && typeof card.eligible === "boolean"
      ? { card: { activeDays14: card.activeDays14, eligible: card.eligible } } : {}),
  };
}

export function fetchReferralInvite(withCard: boolean): Promise<ReferralInvite> {
  // Keyed by account: the cached link is personal (shared-device rule).
  const key = `${getStoredSession()?.user?.id ?? "anon"}:${withCard ? "card" : "plain"}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && "pending" in hit) return hit.pending;
  if (hit && now - hit.at < REUSE_MS) return Promise.resolve(hit.value);
  const pending = authFetch(`/api/referrals/invite${withCard ? "?card=1" : ""}`, { skipAuthRedirect: true })
    .then(async (r) => (r.ok ? parseReferralInvite(await r.json().catch(() => null)) : DISABLED))
    .catch(() => DISABLED)
    .then((value) => { cache.set(key, { at: Date.now(), value }); return value; });
  cache.set(key, { at: now, pending });
  return pending;
}

/** Test hook: forget cached answers. */
export function resetReferralInviteCache() {
  cache.clear();
}

export function useReferralInvite(active: boolean, withCard = false): ReferralInvite | null {
  const [invite, setInvite] = useState<ReferralInvite | null>(null);
  useEffect(() => {
    if (!active) { setInvite(null); return; }
    let cancelled = false;
    void fetchReferralInvite(withCard).then((value) => { if (!cancelled) setInvite(value); });
    return () => { cancelled = true; };
  }, [active, withCard]);
  return active ? invite : null;
}
