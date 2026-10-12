"use client";

/**
 * Mock exams by subject (INF-04). Pro only (history detail is Pro). After
 * three comparable full runs: each subject's score history, the gap to 60
 * percent and the delta, plus the number of full runs. Text first; the line
 * "Das ist keine Vorhersage Ihres Ergebnisses." is always shown.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { checkedJson, isRecord } from "@/lib/async-data";
import { ts, studyPct, studyDate } from "@/lib/i18n-study";
import type { ExamTrend } from "@/lib/exam-trend";

function isTrend(v: unknown): v is ExamTrend {
  return isRecord(v) && typeof v.fullRuns === "number" && Array.isArray(v.subjects);
}

export default function MockTrendCard({ lang }: { lang: "de" | "en" }) {
  const [trend, setTrend] = useState<ExamTrend | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    authFetch("/api/history/exams/trend", { signal: controller.signal })
      .then((r) => checkedJson(r, isTrend))
      .then(setTrend)
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);

  if (!trend && !error) return null;
  if (trend && trend.fullRuns === 0) return null;

  return (
    <section className="mp-card p-5 mb-6" aria-labelledby="sims-title" data-testid="mock-trend">
      <h3 id="sims-title" className="font-display font-bold text-[16px] text-[var(--mp-fg)] mb-1">{ts("sims_title", lang)}</h3>
      {error && !trend ? (
        <div role="alert">
          <p className="text-[14px]">{ts("sims_error", lang)}</p>
          <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2" onClick={() => setRetry((x) => x + 1)}>{ts("weekly_retry", lang)}</button>
        </div>
      ) : trend ? (
        <>
          <p className="text-[14px] text-[var(--mp-fg)]">{trend.fullRuns === 1 ? ts("sims_count_one", lang) : ts("sims_count", lang, { n: trend.fullRuns })}</p>
          {trend.subjects.length === 0 ? (
            <p className="text-[13px] text-[var(--mp-fg-muted)] mt-1">{ts("sims_need_three", lang)}</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {trend.subjects.map((s) => {
                const series = s.points.map((p) => `${studyDate(p.at, lang, { day: "numeric", month: "short" })} ${p.pct === null ? "-" : studyPct(p.pct, lang)}`).join(", ");
                const gap = s.gapToMark === null ? null : s.gapToMark > 0 ? ts("sims_gap_over", lang, { n: s.gapToMark }) : s.gapToMark < 0 ? ts("sims_gap_under", lang, { n: -s.gapToMark }) : ts("sims_gap_at", lang);
                const delta = s.delta === null ? ts("sims_few", lang) : s.delta > 0 ? ts("sims_delta_up", lang, { n: s.delta }) : s.delta < 0 ? ts("sims_delta_down", lang, { n: -s.delta }) : ts("sims_delta_same", lang);
                return (
                  <li key={s.topic} className="text-[13.5px]">
                    <p lang="de" className="font-semibold text-[var(--mp-fg)] break-words hyphens-auto">{s.topic}</p>
                    <p className="text-[var(--mp-fg-muted)]">{series}</p>
                    <p className="text-[var(--mp-fg)]">{[gap, delta].filter(Boolean).join(". ")}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[13px] font-semibold text-[var(--mp-fg)]">{ts("sims_not_prediction", lang)}</p>
        </>
      ) : null}
    </section>
  );
}
