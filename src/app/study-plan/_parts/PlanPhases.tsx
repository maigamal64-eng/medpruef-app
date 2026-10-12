"use client";

/**
 * "Phasen bis zur Prüfung" (UX-STU-18/24): the generator's own phases with
 * their dates, current phase marked in text, upcoming rows at full contrast.
 */
import { ts, studyDate } from "@/lib/i18n-study";
import type { PlanPhase } from "@/lib/study-plan-view";

const NAME = { new: "phase_new", review: "phase_review", exam: "phase_exam" } as const;

export default function PlanPhases({ phases, lang }: { phases: PlanPhase[]; lang: "de" | "en" }) {
  const short = (iso: string) => studyDate(iso, lang, { day: "numeric", month: "short" });
  return (
    <section className="mp-card p-4" aria-labelledby="plan-phases-title">
      <h3 id="plan-phases-title" className="font-display font-bold text-[15px] text-[var(--mp-fg)] mb-3">{ts("phases_title", lang)}</h3>
      <ol className="space-y-2.5">
        {phases.map((ph) => (
          <li key={ph.key} className="flex items-start gap-3" aria-current={ph.status === "current" ? "step" : undefined}>
            <span
              className="mt-1 w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: ph.status === "current" ? "var(--mp-viridian)" : ph.status === "past" ? "var(--mp-fg-subtle)" : "var(--mp-border-strong, var(--mp-fg-muted))" }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[var(--mp-fg)]">
                {ts(NAME[ph.key], lang)}
                {ph.status === "current" && <span className="ml-2 text-[12px] font-semibold text-[var(--mp-viridian)]">{ts("phase_now", lang)}</span>}
              </p>
              <p className="text-[13px] text-[var(--mp-fg-muted)]">
                {ph.key === "exam" ? studyDate(ph.from, lang) : ts("phase_range", lang, { from: short(ph.from), to: short(ph.to) })}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
