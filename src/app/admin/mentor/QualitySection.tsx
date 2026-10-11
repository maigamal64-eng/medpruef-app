import type { MentorQualitySummary, MentorTurnOutcome } from "@/lib/mentor/contract";
import { FunnelSection } from "./FunnelSection";

const COLORS: Record<MentorTurnOutcome, string> = {
  answered: "bg-emerald-600", refused: "bg-sky-500", replaced_partial: "bg-amber-500",
  notice_only: "bg-amber-300", error: "bg-red-500", blocked_402: "bg-slate-500",
  blocked_429: "bg-purple-400", blocked_cap: "bg-slate-300",
};
export function QualitySection({ quality: q }: { quality: MentorQualitySummary }) {
  return <section className="space-y-4 rounded-2xl border border-[var(--mp-border)] p-4">
    <h2 className="font-semibold">Quality</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
      <p className={q.replaced_amber ? "text-amber-600" : ""}>Replaced: {q.replaced_pct.toFixed(1)}% (amber above 5%)</p>
      <p className={q.error_amber ? "text-amber-600" : ""}>Errors: {q.error_pct.toFixed(1)}% (amber above 2%)</p>
      <p>Latency p50: {(q.p50_latency_ms / 1000).toFixed(1)}s</p>
      <p>Latency p95: {(q.p95_latency_ms / 1000).toFixed(1)}s</p>
      <p>Cost per message: ${(q.cost_per_message_micro / 1_000_000).toFixed(4)}</p>
      <p>Cold cache: {q.cold_cache_share_pct.toFixed(1)}%</p>
      <p>Messages per payer: {q.messages_per_payer.toFixed(1)}</p>
      <p>Answers by language: {Object.entries(q.answers_by_language).map(([l, n]) => `${l}: ${n}`).join(", ") || "None"}</p>
    </div>
    <FunnelSection />
    {q.by_day.map((d) => {
      const total = Object.values(d.outcomes).reduce((a, b) => a + b, 0);
      return <div key={d.day} className="space-y-1">
        <p className="text-sm">{d.day}: {total} turns</p>
        <div className="flex h-4 overflow-hidden rounded" role="img" aria-label={Object.entries(d.outcomes).map(([o, n]) => `${o}: ${n}`).join(", ")}>
          {Object.entries(d.outcomes).filter(([, n]) => n > 0).map(([o, n]) => <span key={o} title={`${o}: ${n}`} className={COLORS[o as MentorTurnOutcome]} style={{ width: `${total ? n / total * 100 : 0}%` }} />)}
        </div>
        <p className="text-xs text-[var(--mp-fg-muted)]">{Object.entries(d.outcomes).filter(([, n]) => n > 0).map(([o, n]) => `${o}: ${n}`).join(", ")}</p>
      </div>;
    })}
  </section>;
}
