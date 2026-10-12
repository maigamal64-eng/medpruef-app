"use client";

/**
 * Weeks at a glance (LX-09-R, UX-STU-29): answers per week as single-hue bars
 * and accuracy as one neutral line, last 12 Vienna weeks of the active exam,
 * from /api/user/weekly-progress (own rows only). A text list carries every
 * value, so nothing depends on colour or the chart. Errors keep a retry.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { checkedJson, isRecord } from "@/lib/async-data";
import { ts, studyDate, studyNumber, studyPct } from "@/lib/i18n-study";
import type { WeekBucket } from "@/lib/master-learning/weekly-progress";

const W = 336;
const H = 120;
const PAD = 8;

function isWeeks(v: unknown): v is { weeks: WeekBucket[] } {
  return isRecord(v) && Array.isArray(v.weeks) && v.weeks.every((w) => isRecord(w) && typeof w.weekStart === "string" && typeof w.answered === "number" && typeof w.correct === "number");
}

export default function WeeklyProgressCard({ lang, examSource }: { lang: "de" | "en"; examSource: string }) {
  const [weeks, setWeeks] = useState<WeekBucket[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    authFetch("/api/user/weekly-progress", { signal: controller.signal })
      .then((r) => checkedJson(r, isWeeks))
      .then((data) => setWeeks(data.weeks))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry, examSource]);

  const total = weeks?.reduce((s, w) => s + w.answered, 0) ?? 0;
  const max = Math.max(1, ...(weeks ?? []).map((w) => w.answered));
  const n = weeks?.length ?? 0;
  const slot = n > 0 ? (W - PAD * 2) / n : 0;
  const barW = Math.max(4, slot * 0.6);
  const y = (frac: number) => PAD + (1 - frac) * (H - PAD * 2);
  const line = (weeks ?? [])
    .map((w, i) => (w.accuracy === null ? null : `${(PAD + slot * i + slot / 2).toFixed(1)},${y(w.accuracy).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const short = (iso: string) => studyDate(iso, lang, { day: "numeric", month: "short" });

  return (
    <section className="mp-card p-5 mb-6" aria-labelledby="weekly-title" data-testid="weekly-progress">
      <h3 id="weekly-title" className="font-display font-bold text-[16px] text-[var(--mp-fg)] mb-1">{ts("weekly_title", lang)}</h3>
      <p className="text-[13px] text-[var(--mp-fg-muted)] mb-3">{ts("weekly_basis", lang)}</p>
      {error && !weeks ? (
        <div role="alert" className="text-[14px] text-[var(--mp-fg)]">
          <p>{ts("weekly_error", lang)}</p>
          <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2" onClick={() => setRetry((x) => x + 1)}>{ts("weekly_retry", lang)}</button>
        </div>
      ) : !weeks ? (
        <div className="h-[120px] rounded-xl bg-[var(--mp-surface-sunken)] animate-pulse" aria-hidden />
      ) : total === 0 ? (
        <p className="text-[14px] text-[var(--mp-fg-muted)]">{ts("weekly_empty", lang)}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--mp-fg-muted)] mb-2" aria-hidden>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-[var(--mp-cta-blue)] opacity-70" />{ts("weekly_volume", lang)}</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-[var(--mp-fg)]" />{ts("weekly_accuracy", lang)}</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-w-[560px]" role="img" aria-label={ts("weekly_alt", lang, { n, list: weeks.map((w) => `${short(w.weekStart)} ${w.answered}`).join(", ") })}>
            {weeks.map((w, i) => {
              const h = (w.answered / max) * (H - PAD * 2);
              return <rect key={w.weekStart} x={PAD + slot * i + (slot - barW) / 2} y={H - PAD - h} width={barW} height={Math.max(0, h)} rx={2} fill="var(--mp-cta-blue)" opacity={0.7} />;
            })}
            {line && <polyline points={line} fill="none" stroke="var(--mp-fg)" strokeWidth={1.5} strokeLinejoin="round" />}
          </svg>
          <details className="mt-2">
            <summary className="cursor-pointer min-h-11 inline-flex items-center text-[13px] font-semibold text-[var(--mp-cta-blue)]">{ts("weekly_values", lang)}</summary>
            <ul className="mt-1 space-y-1 text-[13px] text-[var(--mp-fg)]">
              {weeks.map((w) => (
                <li key={w.weekStart}>
                  {ts("weekly_week", lang, {
                    date: short(w.weekStart),
                    answered: studyNumber(w.answered, lang),
                    acc: w.accuracy === null ? ts("weekly_none", lang) : studyPct(w.accuracy * 100, lang),
                  })}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
