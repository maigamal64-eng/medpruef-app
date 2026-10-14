"use client";

/**
 * a-d5b: one quiet line under the Home deadline line that turns on exam
 * deadline reminders by email for the account address. Not an announcement:
 * no modal, no banner, no queue slot, no cooldown. Shows only while the
 * surface is available, the account has an address, the bank is one the
 * sender serves and reminders are off; after the tap it says what happened,
 * and a pending opt-in keeps one line asking to confirm the link.
 */
import { MailCheck } from "lucide-react";
import { announce } from "@/lib/announce";
import { canOfferExamReminder, useExamReminder } from "@/lib/hooks/useExamReminder";
import { examReminderCopy } from "./exam-reminder-copy";

export default function HomeExamReminderLine({ lang, bank }: { lang: string; bank: string | null }) {
  const c = examReminderCopy(lang);
  const { view, busy, outcome, optIn } = useExamReminder();
  // The line sits under one bank's deadline: offer it only when the server
  // would subscribe that same bank (the browser pick can differ from the account's).
  if (!view || (bank !== null && view.exam !== null && bank !== view.exam)) return null;
  const bad = outcome === "failed" || outcome === "rate_limited" || outcome === "withheld" || outcome === "no_email" || outcome === "unsupported" || outcome === "managed_elsewhere";
  if (outcome && (bad || view.state !== "off")) {
    return <p data-testid="home-exam-reminder" className={`mt-1 text-xs ${bad ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg-muted)]"}`}>{c.outcome[outcome]}</p>;
  }
  if (view.state === "pending") return <p data-testid="home-exam-reminder" className="mt-1 text-xs text-[var(--mp-fg-muted)]">{c.homePending}</p>;
  if (!canOfferExamReminder(view)) return null;
  return (
    <button
      type="button"
      data-testid="home-exam-reminder"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        const next = await optIn();
        if (next) announce(c.outcome[next], next === "failed" || next === "rate_limited" ? "assertive" : "polite");
      }}
      className="inline-flex items-center gap-1.5 min-h-11 text-left text-xs font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2 disabled:opacity-60"
    >
      <MailCheck className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {c.homePrompt}
    </button>
  );
}
