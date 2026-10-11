"use client";
import type { MentorAdminSummary } from "@/lib/mentor/contract";
import { formatPct, formatUsd } from "./format";
export function TrendsHeader({summary}:{summary:MentorAdminSummary}) {
 const alerts=Number(summary.overruns>0)+Number(summary.stale_reservations.length>0)+Number(summary.quality?.error_amber??false)+Number(summary.quality?.replaced_amber??false);
 return <section className="space-y-3" aria-label="Mentor at a glance">
 <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="mentor-phone-header">{[["Spend",formatUsd(summary.spend.total_micro)],["Cap used",formatPct(summary.spend.pct_of_cap)],["Margin","Unavailable"],["Alert categories",String(alerts)]].map(([label,value])=><div key={label} className="min-w-0 rounded-lg border border-[var(--mp-border-subtle)] p-3"><p className="text-xs text-[var(--mp-fg-muted)]">{label}</p><p className="text-lg font-semibold tabular-nums break-words">{value}</p></div>)}</div>
 {summary.projection&&<p className="text-sm">Projected month end: <strong>{formatUsd(summary.projection.projected_month_micro)}</strong>. {summary.projection.cap_in_days===null?"No spend pace recorded.":summary.projection.cap_in_days===0?"Cap already reached.":`Cap reached in ${summary.projection.cap_in_days} days at this pace.`} <span className="text-xs text-[var(--mp-fg-muted)]">Estimate uses elapsed UTC breaker month; the cap remains unchanged.</span></p>}
 </section>;
}
