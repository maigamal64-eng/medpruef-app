"use client";

/**
 * Exam picker for a campaign arrival whose link names an exam (a-first-five-1104,
 * NEXT_PUBLIC_ARRIVAL_EXAM_PICKER). The link's examSource is preselected, so a
 * Pharma or Gerichtsmedizin arrival no longer lands in the Vienna bank; the
 * choice feeds the free-start links on the landing page.
 */
import { useId } from "react";
import { EXAM_SOURCES, type ExamSourceId } from "@/lib/topics";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { arrivalExamCopy } from "@/lib/first-five/arrival-exam";

export default function ArrivalExamPicker({ lang, value, onChange, tone = "light" }: { lang: string; value: ExamSourceId; onChange: (id: ExamSourceId) => void; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  const name = useId();
  const copy = arrivalExamCopy(lang);
  return (
    <section data-testid="arrival-exam-picker" className="mb-5 max-w-md">
      <fieldset>
        <legend className={`text-[15px] font-semibold ${dark ? "text-white" : "text-[var(--mp-fg)]"}`}>{copy.title}</legend>
        <p className={`mt-1 text-[13px] ${dark ? "text-white/70" : "text-[var(--mp-fg-muted)]"}`}>{copy.hint}</p>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {EXAM_SOURCES.map((e) => (
            <label key={e.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[14px] ${value === e.id ? "border-[var(--mp-viridian)] bg-[var(--mp-success-bg)]" : "border-[var(--mp-border)] bg-[var(--mp-surface-raised)]"}`}>
              <input type="radio" name={name} value={e.id} checked={value === e.id} onChange={() => onChange(e.id)} />
              <span className="min-w-0 break-words text-[var(--mp-fg)]">{getExamLabel(e.id, "full", lang)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
