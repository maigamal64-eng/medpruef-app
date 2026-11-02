"use client";

/**
 * A3 reminder block of the SIP and Rez/GM answer pages (a-growth-lines-1102,
 * ANSWER_REMINDER_LINE_ENABLED, default OFF; the page decides the flag and the
 * exams, this island decides the reader). A logged-out reader gets the account
 * CTA; a signed-in reader gets the Settings CTA only while reminders can be
 * turned on for the account's bank (off, an address on file, a bank the sender
 * serves), so a reader who already has them, or sits the Stichprobentest,
 * sees nothing. Copy: src/lib/reminder-lines/copy.ts (Lektor APPROVE).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSessionToken, getStoredSession } from "@/lib/auth";
import { buildAuthHref } from "@/lib/auth-entry";
import { useExamReminder } from "@/lib/hooks/useExamReminder";
import { trackEvent } from "@/lib/tracker";
import { A3_ANSWER_LINE, reminderLang } from "@/lib/reminder-lines/copy";
import { signedInCanTurnOn } from "@/lib/reminder-lines/rules";

export default function AnswerReminderLine({ lang }: { lang: string }) {
  const c = A3_ANSWER_LINE[reminderLang(lang)];
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { view } = useExamReminder();
  useEffect(() => {
    const user = getStoredSession()?.user;
    setSignedIn(!!user && !user.id.startsWith("guest_") && !!getSessionToken());
  }, []);
  if (signedIn === null) return null;
  if (signedIn && !signedInCanTurnOn(view)) return null;
  const href = signedIn ? "/settings#fristen-mail" : buildAuthHref({ intent: "free", next: "/settings" });
  return (
    <section aria-label={c.cta} data-answer-reminder className="not-prose my-3 rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 sm:p-5">
      <p className="text-sm text-[var(--mp-fg-muted)]">{c.body}</p>
      <Link
        href={href}
        onClick={() => trackEvent("cta_click", { surface: "answer_reminder", cta: signedIn ? "settings" : "register" })}
        className="mp-btn mp-btn--secondary mt-3 inline-flex min-h-11 items-center justify-center !no-underline"
      >
        {signedIn ? c.ctaSignedIn : c.cta}
      </Link>
    </section>
  );
}
