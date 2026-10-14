"use client";
/**
 * Sidebar referral nudge-dot state: has this account copied its referral
 * code? `null` = unknown (dot hidden), `false` = not yet copied, `true` =
 * copied. a-fo-10: the /api/referrals/status answer is kept for five minutes
 * per tab and account (src/lib/client-read-cache.ts), so moving between pages
 * no longer re-reads it on every Sidebar mount. Copying the code clears the
 * entry (forgetReferralStatus) so the dot goes on the next mount.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import {
  REFERRAL_STATUS_CACHE_KEY,
  forgetAccountCache,
  readAccountCache,
  writeAccountCache,
} from "@/lib/client-read-cache";

type CachedStatus = { copied: boolean };

export function forgetReferralStatus(): void {
  forgetAccountCache(REFERRAL_STATUS_CACHE_KEY);
}

export function useReferralCodeCopied(userId: string | null | undefined): boolean | null {
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId || userId.startsWith("guest_")) return;
    const cached = readAccountCache<CachedStatus>(REFERRAL_STATUS_CACHE_KEY, userId);
    if (cached && typeof cached.copied === "boolean") {
      setCopied(cached.copied);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/referrals/status", { skipAuthRedirect: true });
        if (!r.ok) return;
        const data = await r.json();
        const value = Boolean(data?.referralCodeCopiedAt);
        writeAccountCache<CachedStatus>(REFERRAL_STATUS_CACHE_KEY, userId, { copied: value });
        if (!cancelled) setCopied(value);
      } catch {
        /* non-critical: the dot just stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return copied;
}
