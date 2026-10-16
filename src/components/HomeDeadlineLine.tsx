"use client";

/**
 * HomeDeadlineLine: the next official registration deadline for the learner's
 * bank as one calm line under the Home hero, for every tier (UX-HOME-17,
 * [name] 2026-10-11, option A). Informational, not a promotion: no gradient,
 * no amber, a visible source link on phones, and "hide" only collapses it to
 * a chip until the next deadline (stored per deadline in this browser).
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { td } from "@/lib/i18n-dates";
import { deadlineHideKeys, readDeadlineDismissed, useOfficialDeadline, type DeadlineRestriction } from "@/lib/hooks/useOfficialDeadline";
import HomeExamReminderLine from "@/components/reminders/HomeExamReminderLine";

const HOME_HIDE_PREFIX = "medpruef_home_deadline_hidden:";

/**
 * a-journey-engine (MOMENTS_ENABLED): `restrict` names the learner's own
 * sitting and `action` renders under the line (the M3 "Ich habe mich
 * angemeldet" button). Without them the line is unchanged.
 */
export default function HomeDeadlineLine({ className = "", restrict = null, action = null, onContent }: {
  className?: string;
  restrict?: DeadlineRestriction | null;
  action?: ReactNode;
  /** Reports whether the deadline text is on screen (not hidden to the chip). */
  onContent?: (shown: boolean) => void;
}) {
  const { content, pointer, lang } = useOfficialDeadline(restrict);
  const [hidden, setHidden] = useState(false);
  const hideKeys = deadlineHideKeys(content?.key ?? null, pointer?.key ?? null);
  const readKey = hideKeys[0] ?? null;

  useEffect(() => {
    setHidden(Boolean(readKey && readDeadlineDismissed(readKey, HOME_HIDE_PREFIX)));
  }, [readKey]);

  const contentShown = Boolean(readKey && content && !hidden);
  useEffect(() => {
    onContent?.(contentShown);
  }, [contentShown, onContent]);

  if (!readKey) return null;

  const setStored = (value: boolean) => {
    try {
      for (const key of hideKeys) {
        if (value) localStorage.setItem(HOME_HIDE_PREFIX + key, "1");
        else localStorage.removeItem(HOME_HIDE_PREFIX + key);
      }
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
    setHidden(value);
  };

  const hideButton = (
    <button
      type="button"
      onClick={() => setStored(true)}
      className="inline-flex items-center min-h-11 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
    >
      {td("home_deadline_hide", lang)}
    </button>
  );

  if (hidden) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setStored(false)}
          className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] text-xs font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
        >
          <CalendarClock className="w-4 h-4" aria-hidden />
          {td("home_deadline_chip", lang)}
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label={td("home_deadline_region", lang)}
      className={`rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <CalendarClock className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
        <div className="min-w-0 flex-1">
          {content && (
            <>
              <p className="text-sm leading-snug text-[var(--mp-fg)]">{content.text}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4">
                {content.sources.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center min-h-11 text-xs font-semibold text-[var(--mp-viridian)] underline underline-offset-2"
                  >
                    {source.text}
                  </a>
                ))}
                {!pointer && hideButton}
              </div>
              {/* The action belongs to the learner's own sitting: never under the bank fallback line. */}
              {content.key.startsWith("named:") && action}
            </>
          )}
          {pointer && (
            <div
              className={content ? "mt-1 border-t border-[var(--mp-border)] pt-2" : ""}
              data-deadline-pointer={pointer.key}
            >
              <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{pointer.scope}</p>
              <p className="mt-0.5 text-sm leading-snug text-[var(--mp-fg)]">{pointer.text}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4">
                {pointer.sources.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center min-h-11 text-xs font-semibold text-[var(--mp-viridian)] underline underline-offset-2"
                  >
                    {source.text}
                  </a>
                ))}
                <Link
                  href={pointer.link.href}
                  className="inline-flex items-center gap-1 min-h-11 text-xs font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
                >
                  {pointer.link.label}
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          )}
          {pointer && hideButton}
          {/* a-d5b: the opt-in to these deadlines by email (renders nothing without the secret). */}
          <HomeExamReminderLine lang={lang} bank={content?.key.split(":")[0] ?? null} />
        </div>
      </div>
    </section>
  );
}
