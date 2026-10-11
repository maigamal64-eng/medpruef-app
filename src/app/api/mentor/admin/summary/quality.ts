import { MENTOR_TURN_OUTCOMES, type MentorQualitySummary, type MentorTurnOutcome } from "@/lib/mentor/contract";
import type { MentorTurnRow } from "@/lib/mentor/outcomes";

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * pct) - 1)];
}
export function buildMentorQuality(rows: readonly MentorTurnRow[]): MentorQualitySummary {
  const days = new Map<string, Record<MentorTurnOutcome, number>>();
  const languages: Record<string, number> = {};
  const payers = new Set<string>();
  let replaced = 0, errors = 0, cost = 0, cold = 0, paidMessages = 0;
  const reached = rows.filter((r) => r.calls > 0);
  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    const outcomes = days.get(day) ?? Object.fromEntries(MENTOR_TURN_OUTCOMES.map((o) => [o, 0])) as Record<MentorTurnOutcome, number>;
    outcomes[row.outcome]++;
    days.set(day, outcomes);
    if (row.outcome === "replaced_partial" || row.outcome === "notice_only") replaced++;
    if (row.outcome === "error") errors++;
    if (row.outcome === "answered" || row.outcome === "replaced_partial") languages[row.lang] = (languages[row.lang] ?? 0) + 1;
    cost += Number(row.charged_micro) + Number(row.house_micro);
    if (row.cold_cache) cold++;
    if (row.charged) { payers.add(row.user_id); paidMessages++; }
  }
  const replacedPct = rows.length ? replaced / rows.length * 100 : 0;
  const errorPct = rows.length ? errors / rows.length * 100 : 0;
  return {
    by_day: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, outcomes]) => ({ day, outcomes })),
    replaced_pct: replacedPct, error_pct: errorPct,
    replaced_amber: replacedPct > 5, error_amber: errorPct > 2,
    p50_latency_ms: percentile(reached.map((r) => r.latency_ms), 0.5),
    p95_latency_ms: percentile(reached.map((r) => r.latency_ms), 0.95),
    cost_per_message_micro: reached.length ? cost / reached.length : 0,
    cold_cache_share_pct: reached.length ? cold / reached.length * 100 : 0,
    messages_per_payer: payers.size ? paidMessages / payers.size : 0,
    answers_by_language: languages,
  };
}
