import Link from "next/link";
import { ArrowRight, CalendarRange } from "lucide-react";
import type { Lang } from "@/lib/i18n";

/**
 * a-home-lernplan-link-1018: the one quiet entry to the public /lernplan page,
 * rendered as the last block of the landing exam calendar (the learner who has
 * just found a sitting asks next how to fill the weeks up to it).
 *
 * The caller renders it only while STUDY_PLAN_PUBLIC_ENABLED is on (the page
 * 404s otherwise). The anchor text starts with "Lernplan" in both languages:
 * the founder note sends readers to "Lernplan" on the site, and track-A's C1
 * probe matches that label inside the link. Copy: Lektor APPROVE 18 Oct (after one EDIT: eyebrow and Sie body).
 */
export const LERNPLAN_ENTRY_COPY = {
  eyebrow: { de: "Bis zum Termin", en: "Up to your sitting" },
  body: {
    de: "Wählen Sie Fragenbank, offiziellen Termin und Lernstunden pro Woche und sehen Sie, wie sich die Fragen auf die Wochen verteilen. Ohne Konto. Eine Planungshilfe, keine Prognose.",
    en: "Pick your question bank, an official sitting and your study hours a week, and see how the questions spread over the weeks. No account needed. A planning aid, not a forecast.",
  },
  link: { de: "Lernplan bis zu Ihrem Termin", en: "Lernplan: study plan to your sitting" },
} as const;

export function lernplanEntryHref(lang: Lang): string {
  return lang === "en" ? "/lernplan?lang=en" : "/lernplan";
}

export default function LernplanEntry({ lang }: { lang: Lang }) {
  const l = lang === "en" ? "en" : "de";
  return (
    <div
      data-testid="landing-lernplan-entry"
      className="lp-reveal relative mt-8 flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] py-4 pl-5 pr-4 sm:flex-row sm:items-center sm:gap-5 sm:py-5 sm:pl-6 sm:pr-5"
    >
      {/* A viridian spine ties the entry to the calendar cards above it. */}
      <span className="absolute inset-y-0 left-0 w-1 bg-[var(--mp-viridian)]" aria-hidden="true" />
      <span
        className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]"
        aria-hidden="true"
      >
        <CalendarRange className="h-5 w-5 text-[var(--mp-viridian)]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="lp-eyebrow mb-1.5 text-[var(--mp-viridian)]">{LERNPLAN_ENTRY_COPY.eyebrow[l]}</p>
        <p className="text-[var(--mp-fg-muted)]" style={{ fontSize: "14.5px", lineHeight: 1.55 }}>
          {LERNPLAN_ENTRY_COPY.body[l]}
        </p>
      </div>
      <Link
        href={lernplanEntryHref(l)}
        data-testid="landing-lernplan-link"
        className="lp-link mp-focusable shrink-0 self-start min-h-11 rounded font-semibold text-[var(--mp-viridian)] sm:self-center"
        style={{ fontSize: "15px" }}
      >
        {LERNPLAN_ENTRY_COPY.link[l]}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
