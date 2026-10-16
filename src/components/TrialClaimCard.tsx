"use client";
/**
 * Home card for the one-time 3-day claim (a-reverse-trial-claim). Shows only
 * when the server says this account may claim (GET /api/trial/claim, flag
 * TRIAL_CLAIM_ENABLED, default off) and the announcement queue grants the
 * session's inline slot. The status is asked only for an account without
 * paid access and not during the "Später" cooldown, so a paying or
 * trialling learner sends no request. Claiming is one POST without
 * a token; it creates no checkout session. Copy: src/lib/trial-claim/copy.ts.
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { authFetch as fetch } from "@/lib/authFetch";
import { renderLang, useLang } from "@/lib/i18n";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { dismissSurface, isSurfaceDismissed, useAnnouncementSlot } from "@/lib/announcements/queue";
import { claimCopy, claimEndText, claimReasonLine, fill } from "@/lib/trial-claim/copy";
import { reverseTrialCopyEnabled } from "@/lib/pricing-v2/flag";

type Status = { enabled: boolean; eligible?: boolean; days?: number };

export default function TrialClaimCard({ userId, className = "" }: { userId: string; className?: string }) {
  const lang = renderLang(useLang());
  const copy = claimCopy(lang);
  const { isPaid, role, isLoading, refresh } = useUserTier();
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const isGuest = userId.startsWith("guest_");
  // The claim needs the reverse trial (build mirror NEXT_PUBLIC_REVERSE_TRIAL);
  // without it nothing is asked (release-int-3 reviewer P2-2).
  const askable = reverseTrialCopyEnabled() && !isGuest && !isLoading && !isPaid && role !== "admin";

  useEffect(() => {
    try { setDismissed(isSurfaceDismissed("trial_claim")); } catch { setDismissed(false); }
  }, []);

  useEffect(() => {
    // Nothing is asked after "Später" (the cooldown) or for paying accounts.
    if (!askable || dismissed) return;
    let cancelled = false;
    fetch("/api/trial/claim", { skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => { if (!cancelled && d) setStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [askable, dismissed, userId]);

  const days = status?.days ?? 3;
  const wants = (askable || done !== null) && !dismissed && status?.enabled === true && (status.eligible === true || done !== null);
  const granted = useAnnouncementSlot("trial_claim", wants);
  if (!granted) return null;

  const claim = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/trial/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", skipAuthRedirect: true });
      const d = await r.json().catch(() => null) as { claimed?: boolean; ends_at?: string; reason?: string } | null;
      if (r.ok && d?.claimed && d.ends_at) {
        setDone(claimEndText(d.ends_at, lang));
        refresh();
      } else {
        setError(claimReasonLine(copy, r.status === 404 ? "off" : d?.reason ?? null));
      }
    } catch {
      setError(copy.reasons.retry);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const later = () => { dismissSurface("trial_claim", "later"); setDismissed(true); };

  return (
    <div
      className={`relative flex items-start gap-3 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 ${className}`}
      role="region"
      aria-label={copy.region}
      data-trial-claim-card
    >
      <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0" aria-hidden="true">
        <Sparkles className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1 pe-8">
        <p className="m-0 font-display font-bold text-[var(--mp-fg)]">{fill(copy.title, { days })}</p>
        {done ? (
          <p className="m-0 mt-1 text-sm text-[var(--mp-fg)]" role="status">{fill(copy.success, { when: done })}</p>
        ) : (
          <>
            <p className="m-0 mt-1 text-sm text-[var(--mp-fg-muted)]">{fill(copy.offer, { days })}</p>
            <p className="m-0 mt-1 text-sm text-[var(--mp-fg-muted)]">{copy.includes}</p>
            {error && <p className="m-0 mt-2 text-sm text-[var(--mp-error-text)]" role="alert">{error}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={claim} aria-busy={busy || undefined} aria-disabled={busy || undefined} className="mp-btn mp-btn--primary min-h-11">
                {busy ? copy.busy : fill(copy.cta, { days })}
              </button>
              <button type="button" onClick={later} className="mp-btn mp-btn--ghost mp-btn--sm min-h-11">{copy.later}</button>
            </div>
          </>
        )}
      </div>
      <IconButton label={copy.later} onClick={later} className="absolute top-1 end-1" />
    </div>
  );
}
