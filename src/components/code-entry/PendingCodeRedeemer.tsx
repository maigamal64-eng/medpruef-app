"use client";

import { userTierStore } from "@/lib/hooks/useUserTier";
import { useEffect, useRef } from "react";
import { getStoredSession, getSessionToken } from "@/lib/auth";
import { getUiLang, renderLang } from "@/lib/i18n";
import { formatCreditDate } from "@/lib/free-credits-copy";
import { announce } from "@/lib/announce";
import { codeAtSignupSurfaceEnabled } from "@/lib/code-entry";
import { codeEntryCopy } from "@/lib/code-entry/copy";
import { clearPendingCode, isRetryable, readPendingEntry, redeemCode } from "@/lib/code-entry/client";
import { useToast } from "@/components/ui";

/**
 * Mounted once in the root layout (a-code-front-door). When a code was typed
 * before signup and the learner is now signed in, posts it once to
 * /api/code/redeem and says what happened. Every sign-in path ends in a full
 * page load (email, Telegram code, Telegram link), so one mount-time check
 * covers them all. A try that can still work later (rate limit, outage,
 * unconfirmed account) keeps the code; any other outcome ends it. Renders
 * nothing and reads no network while no code is pending.
 */
export default function PendingCodeRedeemer() {
  const toast = useToast();
  const started = useRef(false);

  useEffect(() => {
    if (!codeAtSignupSurfaceEnabled() || started.current) return;
    const pending = readPendingEntry();
    if (!pending) return;
    const s = getStoredSession();
    if (!s?.user || String(s.user.id ?? "").startsWith("guest_") || !getSessionToken()) return;
    started.current = true;
    // Read at post time: the hook still holds the hydration default (German) on the first effect.
    const lang = renderLang(getUiLang());
    const c = codeEntryCopy(lang);
    void (async () => {
      const r = await redeemCode(pending.code, pending.surface);
      if (r.ok) {
        // a-release-int-5: a seat grants Pro at once; refresh the tier store so Home shows it.
        if (r.kind === "seat") void userTierStore().refresh();
        clearPendingCode();
        const text = r.duplicate ? c.duplicate
          : r.kind === "referral" ? c.successReferral
          : r.kind === "seat" ? c.successSeat(formatCreditDate(r.expiresAt, lang), typeof r.credits === "number" ? r.credits : 0)
          : typeof r.credits === "number" && r.credits > 0 ? c.successCampaign(r.credits, formatCreditDate(r.expiresAt, lang))
          : c.successCampaignPlain;
        toast.success(text);
        return;
      }
      if (!isRetryable(r.reason)) clearPendingCode();
      const text = c.failures[r.reason];
      toast.error(text);
      announce(text, "assertive");
    })();
  }, [toast]);
  return null;
}
