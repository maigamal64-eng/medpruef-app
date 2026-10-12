"use client";

/**
 * Next step on Fortschritt (UX-STU-35, pick-ux-stu-35 A: no new strip; the
 * existing action block moves above the radar). Weak subjects sorted weakest
 * first, every row a link with a chevron, and one named target instead of the
 * plural "Schwächen üben". Free learners practise the subject (mistake review
 * is named as Pro); Pro learners review their mistakes in it.
 */
import Link from "next/link";
import { ChevronRight, GraduationCap, TrendingUp } from "lucide-react";
import { canUse, type Audience } from "@/lib/entitlements";
import { gateSentence } from "@/lib/entitlement-copy";
import { weakTopicHref } from "@/lib/next-step";
import { ProPill } from "@/components/ui/ProPill";
import { ts, studyPct } from "@/lib/i18n-study";
import { te } from "@/lib/i18n-exam";
import { MIN_TOPIC_SAMPLE } from "@/lib/learning-metrics";

export interface WeakRow {
  topic: string;
  answered: number;
  correct: number;
}

/** Weakest first (lowest accuracy, then more answers first). */
export function sortWeakest(rows: readonly WeakRow[]): WeakRow[] {
  const acc = (r: WeakRow) => (r.answered > 0 ? r.correct / r.answered : 0);
  return [...rows].sort((a, b) => acc(a) - acc(b) || b.answered - a.answered || a.topic.localeCompare(b.topic));
}

export default function NextStepBlock({ weak, examSource, audience, lang }: { weak: WeakRow[]; examSource: string; audience: Audience; lang: "de" | "en" }) {
  const sorted = sortWeakest(weak);
  const pro = canUse("mistake_review", audience);
  const first = sorted[0];
  const mockHref = canUse("mock_exam", audience) ? `/exam?examSource=${encodeURIComponent(examSource)}` : "/pricing?gate=mock_exam";
  return (
    <section className="mp-card p-5 mb-6 space-y-4" aria-labelledby="next-step-title" data-testid="progress-next-step">
      <h3 id="next-step-title" className="font-display font-bold text-[16px] text-[var(--mp-fg)]">{ts("next_title", lang)}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {first && (
          <Link href={weakTopicHref(first.topic, examSource, audience)} className="mp-btn mp-btn--primary mp-btn--lg justify-center min-h-11">
            <TrendingUp className="w-5 h-5" aria-hidden />
            <span lang="de">{pro ? ts("next_weakest_pro", lang, { topic: first.topic }) : ts("next_weakest", lang, { topic: first.topic })}</span>
          </Link>
        )}
        <Link href={mockHref} className="mp-btn mp-btn--secondary mp-btn--lg justify-center min-h-11">
          <GraduationCap className="w-5 h-5" aria-hidden />
          {te("mock_entry", lang)}
          {!canUse("mock_exam", audience) && <span aria-hidden className="mp-pro-pill">Pro</span>}
        </Link>
      </div>
      {sorted.length > 0 && (
        <div>
          <p className="text-[13px] text-[var(--mp-fg-muted)] mb-2">{ts("next_weak_list", lang, { min: MIN_TOPIC_SAMPLE })}</p>
          <ul className="divide-y divide-[var(--mp-border)]">
            {sorted.map((r) => {
              const acc = studyPct((r.correct / Math.max(1, r.answered)) * 100, lang);
              return (
                <li key={r.topic}>
                  <Link href={weakTopicHref(r.topic, examSource, audience)} className="flex items-center justify-between gap-3 min-h-11 py-2">
                    <span className="min-w-0 text-[14px] text-[var(--mp-fg)]">
                      <span lang="de" className="font-semibold break-words hyphens-auto">{r.topic}</span>
                      <span className="block text-[12.5px] text-[var(--mp-fg-muted)]">{ts("next_weak_stat", lang, { acc, n: r.answered })}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-[var(--mp-fg-subtle)]" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {sorted.length > 0 && !pro && (
        <p className="flex items-center gap-2 text-sm text-[var(--mp-fg-muted)]">
          <ProPill label={gateSentence("mistake_review", lang)} href="/pricing?gate=mistakes" />
          <span>{gateSentence("mistake_review", lang)}</span>
        </p>
      )}
    </section>
  );
}
