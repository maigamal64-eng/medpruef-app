"use client";

/**
 * Entry information for /exam: the next sitting's announced format with its
 * source date (FMT-01, G06), and the "So läuft die Simulation ab" facts
 * (UX-EXM-17). Neutral surface, info icons, no amber.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock, Info, ListChecks, Smartphone, Pencil } from "lucide-react";
import { EXAM_FORMAT_DATA, formatDisplayDate } from "@/lib/exam-formats";
import { nextSittingFormat } from "@/lib/exam-run";
import { examLang, te, type ExamCopyKey } from "@/lib/i18n-exam";

const FORMAT_KEY: Record<string, ExamCopyKey> = {
  mc: "format_mc",
  kaf: "format_kaf",
  mixed: "format_mixed",
  oral: "format_oral",
  not_announced: "format_not_announced",
};

export function ExamFormatLine({ formatExamKey, lang, now }: { formatExamKey: string; lang: string; now?: Date }) {
  const l = examLang(lang);
  // "Next sitting" depends on today: computed after mount so server and client render the same.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const next = mounted ? nextSittingFormat(formatExamKey, now) : null;
  const label = EXAM_FORMAT_DATA.exams.find((e) => e.key === formatExamKey)?.label[l] ?? formatExamKey;
  if (!next) return null;
  const f = next.format;
  const formatText = !f || f.format === "not_announced"
    ? f?.expectedBy ? te("format_expected", lang, { date: formatDisplayDate(f.expectedBy, l) }) : te("format_not_announced", lang)
    : te(FORMAT_KEY[f.format] ?? "format_not_announced", lang);
  return (
    <div className="mp-card p-3 mb-4 text-sm text-[var(--mp-fg)]">
      <p className="flex items-start gap-2">
        <CalendarDays className="w-4 h-4 mt-0.5 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
        <span>
          {te("format_line", lang, { exam: label, date: formatDisplayDate(next.date, l), format: formatText })}
          {f && <span className="block text-[13px] text-[var(--mp-fg-muted)]">{te("format_checked", lang, { date: formatDisplayDate(f.verifiedOn, l) })}</span>}
        </span>
      </p>
      <Link href={`/exam-formats/${formatExamKey}${l === "en" ? "?lang=en" : ""}`} className="mt-1 inline-flex min-h-11 items-center underline">
        {te("format_rules_link", lang)}
      </Link>
    </div>
  );
}

export function ExamEntryFacts({ lang, untimed, scopeKey }: { lang: string; untimed: boolean; scopeKey?: ExamCopyKey | null }) {
  const rows: { icon: typeof Info; key: ExamCopyKey }[] = [
    { icon: Info, key: "fact_practice" },
    { icon: Clock, key: untimed ? "fact_untimed" : "fact_clock" },
    { icon: Pencil, key: "fact_change" },
    { icon: ListChecks, key: "fact_multi" },
    { icon: Smartphone, key: "fact_device" },
  ];
  return (
    <section className="mp-card p-4 mb-4" aria-labelledby="exam-facts-title">
      <h2 id="exam-facts-title" className="text-sm font-semibold text-[var(--mp-fg)] mb-2">{te("facts_title", lang)}</h2>
      <ul className="space-y-2">
        {rows.map(({ icon: Icon, key }) => (
          <li key={key} className="flex items-start gap-2 text-sm text-[var(--mp-fg)]">
            <Icon className="w-4 h-4 mt-0.5 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
            <span>{te(key, lang)}</span>
          </li>
        ))}
        {scopeKey && (
          <li className="flex items-start gap-2 text-sm text-[var(--mp-fg)]">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
            <span>{te(scopeKey, lang)}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
