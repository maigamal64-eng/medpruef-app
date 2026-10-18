"use client";

/**
 * Compact registration line under the hero (UX-STU-24, pick-ux-stu-24 B).
 * Shows only when a deadline is near or passed. A Stichprobentest sitting
 * lists both published deadlines with their publisher and source; the page
 * never picks one for the learner.
 */
import { CalendarClock, ExternalLink } from "lucide-react";
import { ts, studyDate } from "@/lib/i18n-study";
import { registrationLineVisible, type RegistrationRow } from "@/lib/study-plan-view";

export default function PlanRegistration({ rows, lang }: { rows: RegistrationRow[]; lang: "de" | "en" }) {
  if (!registrationLineVisible(rows)) return null;
  const two = rows.some((r) => r.publisher !== null);
  return (
    <div className="mp-card px-4 py-3 text-[13px] text-[var(--mp-fg)]" role="note" data-testid="plan-registration">
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const date = studyDate(r.closes, lang, { day: "numeric", month: "long", year: "numeric" });
          const text =
            r.opensLater
              ? ts("reg_window_future", lang, { from: studyDate(r.opensLater, lang, { day: "numeric", month: "long", year: "numeric" }), to: date })
              : r.level === "passed"
              ? ts("reg_passed", lang, { date })
              : r.daysLeft === 1
                ? ts("reg_line_day", lang, { date })
                : ts("reg_line_days", lang, { date, n: r.daysLeft });
          return (
            <li key={`${r.closes}-${r.publisher}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <CalendarClock className="w-4 h-4 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
              <span className={r.level === "urgent" ? "font-semibold" : undefined}>{text}</span>
              {r.publisher && <span className="text-[var(--mp-fg-muted)]">{ts(r.publisher === "muw" ? "reg_per_muw" : "reg_per_imed", lang)}</span>}
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-11 text-[var(--mp-cta-blue)] underline underline-offset-2">
                {ts("reg_source", lang)}
                <ExternalLink className="w-3 h-3" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
      {two && <p className="mt-1 text-[var(--mp-fg-muted)]">{ts("reg_two_publishers", lang)}</p>}
    </div>
  );
}
