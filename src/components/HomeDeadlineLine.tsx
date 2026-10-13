"use client";

/**
 * HomeDeadlineLine: the next official registration deadline for the learner's
 * bank as one calm line under the Home hero, for every tier (UX-HOME-17,
 * [name] 2026-10-11, option A). Informational, not a promotion: no gradient,
 * no amber, a visible source link on phones, and "hide" only collapses it to
 * a chip until the next deadline (stored per deadline in this browser).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { td } from "@/lib/i18n-dates";
import { readDeadlineDismissed, useOfficialDeadline } from "@/lib/hooks/useOfficialDeadline";

const HOME_HIDE_PREFIX = "medpruef_home_deadline_hidden:";

export default function HomeDeadlineLine({ className = "" }: { className?: string }) {
  const { content, pointer, lang } = useOfficialDeadline();
  const [hidden, setHidden] = useState(false);
  // U2: the Rez/GM pointer is a new deadline, so a line hidden before it
  // appeared shows again while it is open (hide is per set of deadlines).
  const hideKey = content ? (pointer ? `${content.key}|${pointer.key}` : content.key) : null;

  useEffect(() => {
    setHidden(Boolean(hideKey && readDeadlineDismissed(hideKey, HOME_HIDE_PREFIX)));
  }, [hideKey]);

  if (!content || !hideKey) return null;

  const setStored = (value: boolean) => {
    try {
      if (value) localStorage.setItem(HOME_HIDE_PREFIX + hideKey, "1");
      else localStorage.removeItem(HOME_HIDE_PREFIX + hideKey);
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
          {pointer && (
            <div className="mt-2 border-t border-[var(--mp-border)] pt-2" data-deadline-pointer={pointer.key}>
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
                {hideButton}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
