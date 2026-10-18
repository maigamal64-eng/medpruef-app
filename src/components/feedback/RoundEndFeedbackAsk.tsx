"use client";

/**
 * RoundEndFeedbackAsk (a-feedback-at-pause, 2026-10-17): one short optional
 * question inside the quiz round-end card, after a finished set. Never a
 * modal, never during a quiz, never takes focus.
 *
 * Mounted only while FEEDBACK_ASK_ENABLED is on (useUserTier().feedbackAsk)
 * and the round qualifies, so nothing is fetched while the flag is off.
 * Order, so the server row is written only when the block will render:
 *   1. no other announcement surface elected (useAnnouncementGate);
 *   2. the announcement queue grants the inline slot `feedback_ask` (one
 *      inline card per browser session);
 *   3. POST /api/feedback/ask: the server checks the sitting week and the
 *      14-day rule shared with the mail asks, then stores feedback_ask_shown.
 * The sitting week is decided on the server: the queue's marketingPaused
 * signal is set only while Home is mounted, so on /quiz it is always false.
 * The answer goes through POST /api/feedback with context.source
 * "round_end_ask" (and from there into the Intercom feedback ticket when
 * that flag is on). "Überspringen" hides it and quiets it 14 days here.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquareText } from "lucide-react";
import { Textarea } from "@/components/ui";
import { authFetch } from "@/lib/authFetch";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { useAnnouncementGate } from "@/lib/announcements/useAnnouncementGate";
import { FEEDBACK_MAX_MESSAGE_CHARS } from "@/lib/feedback-limits";
import { ROUND_END_ASK_SOURCE, ROUND_END_SURFACE } from "@/lib/feedback-ask/rules";
import { feedbackAskCopy } from "@/lib/i18n-feedback-ask";

type Phase = "checking" | "eligible" | "claiming" | "refused" | "open" | "sending" | "failed" | "sent" | "skipped";
const VISIBLE: readonly Phase[] = ["open", "sending", "failed", "sent"];
/** The queue settles in SETTLE_MS (1.5 s); a slot not granted after this goes to another surface. */
const GRANT_WAIT_MS = 4_000;

async function askServer(method: "GET" | "POST"): Promise<boolean> {
  try {
    const r = await authFetch("/api/feedback/ask", {
      method,
      ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ surface: ROUND_END_SURFACE }) } : {}),
      timeoutMs: 8_000,
      skipAuthRedirect: true,
    });
    const body = (await r.json().catch(() => null)) as { show?: unknown } | null;
    return r.ok && body?.show === true;
  } catch {
    return false;
  }
}

export default function RoundEndFeedbackAsk({ lang, examType, onResolved }: {
  lang: string;
  examType?: string | null;
  /** Tells the round-end card whether the ask took its one extra block (true) or stepped aside (false). */
  onResolved?: (shown: boolean) => void;
}) {
  const c = feedbackAskCopy(lang);
  const [phase, setPhase] = useState<Phase>("checking");
  const [text, setText] = useState("");
  const [tooShort, setTooShort] = useState(false);
  const started = useRef(false);
  const claimed = useRef(false);
  const inFlight = useRef(false);
  const { activeSurface, loading } = useAnnouncementGate();

  // 1. Server check first (writes nothing): a learner in the 14-day window or the
  //    sitting week never competes for the session's one inline slot.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void askServer("GET").then((ok) => setPhase((p) => (p === "checking" ? (ok ? "eligible" : "refused") : p)));
  }, []);

  // 2. Another announcement surface elected: step aside.
  useEffect(() => {
    if ((phase === "checking" || phase === "eligible") && !loading && activeSurface !== null) setPhase("refused");
  }, [phase, loading, activeSurface]);

  // 3. The announcement queue (sitting-week pause, one inline card per session).
  const visible = VISIBLE.includes(phase);
  const wants = visible || ((phase === "eligible" || phase === "claiming") && !loading && activeSurface === null);
  const granted = useAnnouncementSlot("feedback_ask", wants);

  useEffect(() => {
    if (phase !== "eligible" || !wants || granted) return;
    const timer = window.setTimeout(() => setPhase((p) => (p === "eligible" ? "refused" : p)), GRANT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, wants, granted]);

  // 4. Claim: the server re-checks and stores feedback_ask_shown; only then the block renders.
  useEffect(() => {
    if (!granted || claimed.current || phase !== "eligible") return;
    claimed.current = true;
    setPhase("claiming");
    void askServer("POST").then((ok) => setPhase(ok ? "open" : "refused"));
  }, [granted, phase]);

  useEffect(() => {
    if (phase === "refused") onResolved?.(false);
    else if (phase === "open") onResolved?.(true);
  }, [phase, onResolved]);

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const message = text.trim();
    if (message.length < 3) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    inFlight.current = true;
    setPhase("sending");
    let ok = false;
    try {
      const r = await authFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          context: {
            source: ROUND_END_ASK_SOURCE,
            surface: ROUND_END_SURFACE,
            exam_type: examType ?? null,
            lang,
            url: typeof window !== "undefined" ? window.location.pathname : "/quiz",
          },
        }),
        timeoutMs: 15_000,
        skipAuthRedirect: true,
      });
      ok = r.ok;
    } catch {
      ok = false;
    }
    inFlight.current = false;
    // The role="status" / role="alert" lines below announce the outcome.
    setPhase(ok ? "sent" : "failed");
  }, [text, examType, lang]);

  const skip = useCallback(() => {
    dismissSurface("feedback_ask", "later");
    setPhase("skipped");
  }, []);

  if (!visible) return null;
  const busy = phase === "sending";
  return (
    <section
      data-testid="round-end-ask"
      aria-label={c.region}
      className="mt-4 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 text-left"
    >
      {phase === "sent" ? (
        <p role="status" className="flex items-start gap-2 text-[14px] text-[var(--mp-fg)]">
          <MessageSquareText aria-hidden size={16} className="mt-0.5 shrink-0 text-[var(--mp-viridian)]" />
          <span>{c.thanks}</span>
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Textarea
            label={c.question}
            helper={c.hint}
            error={tooShort ? c.tooShort : undefined}
            value={text}
            onChange={(e) => { setText(e.target.value); if (tooShort) setTooShort(false); }}
            maxLength={FEEDBACK_MAX_MESSAGE_CHARS}
            rows={3}
          />
          {phase === "failed" && (
            <p role="alert" className="text-[13px] text-[var(--mp-error-text)]">{c.failed}</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={busy} aria-busy={busy} className="mp-btn mp-btn--primary min-h-11 sm:flex-none">
              {busy ? c.sending : c.send}
            </button>
            <button type="button" onClick={skip} disabled={busy} className="mp-btn mp-btn--ghost min-h-11 sm:flex-none">
              {c.skip}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
