"use client";

/**
 * a-d5b: exam deadline reminders by email in Settings. Renders nothing while
 * the surface is unavailable (no link signing secret), still loading or
 * unreadable, and for a bank the sender does not serve unless reminders are
 * already pending or on (then the status and the opt-out stay reachable).
 * Pending is shown as pending until the emailed link is confirmed, never as on.
 */
import { useId } from "react";
import { MailCheck } from "lucide-react";
import { announce } from "@/lib/announce";
import { useExamReminder } from "@/lib/hooks/useExamReminder";
import { examReminderCopy } from "@/components/reminders/exam-reminder-copy";

export default function ExamReminderCard({ lang }: { lang: string }) {
  const c = examReminderCopy(lang);
  const ids = useId();
  const { view, busy, outcome, optIn, optOut } = useExamReminder();
  if (!view) return null;
  if (view.state === "off" && !view.exam) return null;

  const run = async (action: () => Promise<string | null>) => {
    const next = await action();
    if (next) announce(c.outcome[next as keyof typeof c.outcome], next === "failed" || next === "rate_limited" ? "assertive" : "polite");
  };
  const status = view.state === "confirmed" && view.email ? c.on(view.email)
    : view.state === "pending" && view.email ? c.pending(view.email)
    : view.email ? c.off : c.noEmail;
  const message = outcome ? c.outcome[outcome] : null;
  const bad = outcome === "failed" || outcome === "rate_limited" || outcome === "withheld" || outcome === "no_email" || outcome === "unsupported";
  const btn = "mp-btn min-h-11 px-4 text-sm";

  return (
    <section id="fristen-mail" data-testid="settings-exam-reminder" aria-labelledby={`${ids}-title`} className="scroll-mt-24">
      <h2 id={`${ids}-title`} className="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--mp-fg-subtle)] px-1 pb-2">{c.title}</h2>
      <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <MailCheck className="w-5 h-5 mt-0.5 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            {view.exam && <p className="text-sm text-[var(--mp-fg-muted)]">{c.lead(c.exams[view.exam])}</p>}
            <p className="text-sm text-[var(--mp-fg)] break-words" data-testid="exam-reminder-status">{status}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {view.state === "off" && view.email && view.exam && (
            <button type="button" className={`${btn} mp-btn--primary`} disabled={busy} aria-busy={busy} onClick={() => void run(optIn)}>{c.turnOn}</button>
          )}
          {view.state === "pending" && view.exam && (
            <button type="button" className={`${btn} mp-btn--secondary`} disabled={busy} aria-busy={busy} onClick={() => void run(optIn)}>{c.resend}</button>
          )}
          {view.state !== "off" && (
            <button type="button" className={`${btn} mp-btn--ghost`} disabled={busy} aria-busy={busy} onClick={() => void run(optOut)}>{view.state === "pending" ? c.cancel : c.turnOff}</button>
          )}
        </div>
        {view.state === "confirmed" && <p className="text-xs text-[var(--mp-fg-muted)]">{c.footnote}</p>}
        {message && <p data-testid="exam-reminder-outcome" className={`text-sm ${bad ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg-muted)]"}`}>{message}</p>}
      </div>
    </section>
  );
}
