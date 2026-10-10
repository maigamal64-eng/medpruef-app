"use client";

/**
 * /mentor/checkout/success: where Whop sends the buyer back.
 *
 * HONESTY CONTRACT (copied from the Pro checkout success page after the
 * 2026-09-21 double-payment incident): this page never says credits are
 * active until the server's verify call returns `granted`. It polls on a
 * backoff to a ceiling, offers a manual re-check, and keeps a way back to the
 * Mentor and to learning in every state. Whatever query string Whop appended
 * is forwarded to the verify route untouched (its parameters are not frozen
 * in the contract).
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from "lucide-react";
import { mentorT, type MentorKey } from "@/lib/i18n-mentor";
import { loadMentorApi } from "./client";
import MentorFrame, { useMentorSession } from "./MentorFrame";
import { verifyProgress, type VerifyProgress } from "./view-model";

export default function CheckoutSuccessScreen() {
  const session = useMentorSession();
  const lang = session.uiLang;
  const [progress, setProgress] = useState<VerifyProgress>({ state: "pending", credits: 0, nextDelayMs: 0 });

  const startedAt = useRef<number>(0);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const stopped = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current || stopped.current) return;
    inFlight.current = true;
    const api = await loadMentorApi();
    const r = await api.verify(typeof window === "undefined" ? "" : window.location.search);
    inFlight.current = false;
    if (stopped.current) return;
    const next = verifyProgress(
      r.ok ? { kind: "verify", status: r.verify.status, credits: r.verify.credits_left } : { kind: "error", error: r.error },
      attempt.current,
      Date.now() - startedAt.current,
    );
    attempt.current += 1;
    setProgress(next);
    if (next.nextDelayMs !== null) timer.current = setTimeout(() => void check(), next.nextDelayMs);
  }, []);

  const restart = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    stopped.current = false;
    attempt.current = 0;
    startedAt.current = Date.now();
    setProgress({ state: "pending", credits: 0, nextDelayMs: 0 });
    void check();
  }, [check]);

  useEffect(() => {
    if (!session.resolved || !session.userId) return;
    restart();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped.current) {
        if (timer.current) clearTimeout(timer.current);
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session.resolved, session.userId, restart, check]);

  const s = progress.state;
  const Icon = s === "granted" ? CheckCircle2 : s === "failed" ? XCircle : s === "slow" ? Clock : Loader2;
  const tone =
    s === "granted"
      ? "border-[var(--mp-viridian)]/30 bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]"
      : s === "failed"
        ? "border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] text-[var(--mp-error)]"
        : "border-[var(--mp-status-warning)]/30 bg-[var(--mp-warning-bg)] text-[var(--mp-warning-dk)]";

  const title: MentorKey =
    s === "granted" ? "ok_title_granted" : s === "failed" ? "ok_title_failed" : s === "slow" ? "ok_title_slow" : s === "signin" ? "err_unauthenticated" : "ok_title_pending";
  const body: MentorKey | null =
    s === "granted" ? "ok_body_granted" : s === "failed" ? "ok_body_failed" : s === "slow" ? "ok_body_slow" : s === "pending" ? "ok_body_pending" : null;

  return (
    <MentorFrame session={session}>
      <main className="main-content safe-area-top flex min-h-dvh flex-col items-center justify-center bg-[var(--mp-bg)] px-4 pb-8">
        <div className="w-full max-w-md rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-6 text-center shadow-[var(--shadow-card)]" role="status" aria-live="polite">
          <span aria-hidden className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border ${tone}`}>
            <Icon className={`h-7 w-7 ${s === "pending" ? "motion-safe:animate-spin" : ""}`} />
          </span>
          <h1 className="mp-h2 text-[var(--mp-fg)]">{mentorT(title, lang)}</h1>
          {body && <p className="mt-2 text-[14px] leading-relaxed text-[var(--mp-fg-muted)]">{mentorT(body, lang, { n: progress.credits })}</p>}

          <div className="mt-5 flex flex-col gap-2">
            <Link href="/mentor" className="mp-btn mp-btn--primary min-h-12">
              {mentorT("btn_back_to_mentor", lang)}
            </Link>
            {(s === "slow" || s === "failed") && (
              <button type="button" onClick={restart} className="mp-btn mp-btn--secondary min-h-12">
                <RotateCcw className="h-4 w-4" aria-hidden />
                {mentorT("btn_retry", lang)}
              </button>
            )}
            {s === "signin" && (
              <Link href="/login?next=%2Fmentor%2Fcheckout%2Fsuccess" className="mp-btn mp-btn--secondary min-h-12">
                {mentorT("btn_signin", lang)}
              </Link>
            )}
            <Link href="/" className="mp-btn mp-btn--ghost min-h-12">
              {mentorT("btn_keep_learning", lang)}
            </Link>
          </div>
        </div>
      </main>
    </MentorFrame>
  );
}
