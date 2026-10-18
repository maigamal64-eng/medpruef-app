"use client";
/**
 * "Telegram verbinden, um Ihre 3 Tage Pro zu starten" (a-trial-phone-gate,
 * TELEGRAM_LINK_ENABLED, default off). Never a gate: the free sample stays
 * open, the learner can close it.
 *
 * Flow: the button asks POST /api/telegram/link for a signed 15-minute bot
 * deep link and opens it in a tab opened synchronously in the tap (iOS blocks
 * a popup opened after an await), so this page keeps polling; on phones the
 * Telegram app opens, so no in-app browser session is involved. A blocked tab
 * leaves the link as a button. The bot binds the Telegram that presses Start.
 * This page then polls GET /api/telegram/link every 6 seconds while visible
 * (and at once on return to the tab), for at most 15 minutes, and pauses after
 * a 429; that GET starts the reverse trial from this browser.
 *
 * mode "trial": new accounts (the automatic reverse trial).
 * mode "claim": older accounts on the claim card; onLinked hands the fresh
 * claim status back, and the card offers its one-tap claim.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { claimEndText, fill } from "@/lib/trial-claim/copy";
import { telegramLinkCopy } from "@/lib/telegram-link/copy";

type Phase = "idle" | "opening" | "waiting" | "done" | "linked_no_trial" | "expired" | "error";
export interface LinkedStatus { trial: { ends_at: string } | null; claim?: { eligible: boolean; reason: string } }

const POLL_MS = 6_000;
const WINDOW_MS = 15 * 60_000;

export default function TelegramTrialLink({
  lang, mode = "trial", onLinked, onLater, className = "", embedded = false,
}: {
  lang: string;
  mode?: "trial" | "claim";
  onLinked?: (status: LinkedStatus) => void;
  onLater?: () => void;
  className?: string;
  /** Inside another card (claim card, pricing tile): no own frame or icon. */
  embedded?: boolean;
}) {
  const copy = telegramLinkCopy(lang);
  const { refresh } = useUserTier();
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const deadline = useRef(0);
  const inFlight = useRef(false);
  const settled = useRef(false);
  const pauseUntil = useRef(0);

  const poll = useCallback(async () => {
    if (inFlight.current || settled.current || pauseUntil.current > Date.now()) return;
    if (Date.now() > deadline.current) { setPhase("expired"); return; }
    inFlight.current = true;
    try {
      const r = await fetch("/api/telegram/link", { cache: "no-store", skipAuthRedirect: true });
      if (r.status === 429) {
        const wait = Number(r.headers.get("Retry-After"));
        pauseUntil.current = Date.now() + (Number.isFinite(wait) && wait > 0 ? wait * 1000 : 30_000);
        return;
      }
      if (!r.ok) return;
      const d = await r.json() as { linked?: boolean; trial?: { ends_at?: string | null } | null; claim?: { eligible: boolean; reason: string } };
      if (!d.linked || settled.current) return;
      settled.current = true;
      const endsAt = typeof d.trial?.ends_at === "string" ? d.trial.ends_at : null;
      if (endsAt) {
        setUntil(claimEndText(endsAt, lang));
        setPhase("done");
        refresh();
      } else if (mode === "claim" && d.claim) {
        setPhase("done");
      } else {
        setPhase("linked_no_trial");
        refresh();
      }
      onLinked?.({ trial: endsAt ? { ends_at: endsAt } : null, ...(d.claim ? { claim: d.claim } : {}) });
    } catch {
      /* the next tick tries again */
    } finally {
      inFlight.current = false;
    }
  }, [lang, mode, onLinked, refresh]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const tick = () => { if (document.visibilityState === "visible") void poll(); };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [phase, poll]);

  const start = async () => {
    if (phase === "opening") return;
    setPhase("opening");
    // Opened in the tap itself; pointed at the bot once the link exists.
    let win: Window | null = null;
    try { win = window.open("", "_blank"); } catch { win = null; }
    const closeWin = () => { try { win?.close(); } catch { /* already gone */ } };
    try {
      const r = await fetch("/api/telegram/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", skipAuthRedirect: true });
      if (r.status === 409) {
        closeWin();
        deadline.current = Date.now() + WINDOW_MS;
        setPhase("waiting");
        void poll();
        return;
      }
      const d = await r.json().catch(() => null) as { url?: string } | null;
      if (!r.ok || typeof d?.url !== "string" || !d.url.startsWith("https://t.me/")) { closeWin(); setPhase("error"); return; }
      setUrl(d.url);
      deadline.current = Date.now() + WINDOW_MS;
      settled.current = false;
      setPhase("waiting");
      // "noopener" as a window feature makes open() return null even when the
      // tab opened, so the opener is cut by hand. A blocked tab (null) leaves
      // the link as the button below; this page never navigates away.
      if (win) {
        try { win.opener = null; } catch { /* nothing to cut */ }
        win.location.href = d.url;
      }
    } catch {
      closeWin();
      setPhase("error");
    }
  };

  const frame = embedded
    ? `mt-3 ${className}`
    : `relative flex items-start gap-3 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 ${className}`;

  let body: React.ReactNode;
  if (phase === "done" && until) {
    body = <p className="m-0 text-sm font-semibold text-[var(--mp-fg)]" role="status">{fill(copy.success, { when: until })}</p>;
  } else if (phase === "done") {
    body = <p className="m-0 text-sm font-semibold text-[var(--mp-fg)]" role="status">{copy.linkedClaim}</p>;
  } else if (phase === "linked_no_trial") {
    body = <p className="m-0 text-sm text-[var(--mp-fg)]" role="status">{copy.linkedNoTrial}</p>;
  } else {
    body = (
      <>
        {!embedded && <p className="m-0 font-display font-bold text-[var(--mp-fg)]">{copy.title}</p>}
        {embedded && <p className="m-0 font-semibold text-[var(--mp-fg)]">{copy.title}</p>}
        <p className="m-0 mt-1 text-sm text-[var(--mp-fg-muted)]">{copy.body}</p>
        <p className="m-0 mt-1 text-xs text-[var(--mp-fg-muted)]">{copy.privacy}</p>
        {phase === "waiting" && <p className="m-0 mt-2 text-sm text-[var(--mp-fg)]" role="status">{copy.waiting}</p>}
        {phase === "expired" && <p className="m-0 mt-2 text-sm text-[var(--mp-error-text)]" role="alert">{copy.expired}</p>}
        {phase === "error" && <p className="m-0 mt-2 text-sm text-[var(--mp-error-text)]" role="alert">{copy.retry}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {phase === "waiting" && url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="mp-btn mp-btn--secondary min-h-11">{copy.openAgain}</a>
          ) : (
            <button type="button" onClick={start} aria-busy={phase === "opening" || undefined} aria-disabled={phase === "opening" || undefined} className="mp-btn mp-btn--primary min-h-11 inline-flex items-center gap-2">
              <Send className="w-4 h-4" aria-hidden="true" />
              {phase === "opening" ? copy.busy : copy.cta}
            </button>
          )}
          {onLater && phase !== "waiting" && (
            <button type="button" onClick={onLater} className="mp-btn mp-btn--ghost mp-btn--sm min-h-11">{copy.later}</button>
          )}
        </div>
      </>
    );
  }

  return (
    <div className={frame} role="region" aria-label={copy.region} data-telegram-trial-link={mode}>
      {!embedded && (
        <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0" aria-hidden="true">
          <Send className="w-5 h-5" />
        </span>
      )}
      <div className={embedded ? "" : "min-w-0 flex-1"}>{body}</div>
    </div>
  );
}
