"use client";

/**
 * Trend of comparable runs (UX-EXM-42): shown only with three or more
 * comparable attempts. Inline SVG (no chart library): viridian dots and line,
 * a dashed 60 percent reference line, and a text alternative plus the delta
 * against the previous run beside it, so nothing is encoded by colour alone.
 */
import { th } from "@/lib/i18n-history";
import { formatDate, formatPct, trendDeltaText, type RunGroup, type Trend } from "./history-rules";

const W = 320;
const H = 96;
const PAD_X = 12;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

const GROUP_KEY: Record<RunGroup, "group_full" | "group_part" | "group_custom" | "group_kaf" | "group_simulations"> = {
  full: "group_full",
  part: "group_part",
  custom: "group_custom",
  kaf: "group_kaf",
  simulations: "group_simulations",
};

export default function TrendChart({ trend, lang }: { trend: Trend; lang: string }) {
  const n = trend.points.length;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const x = (i: number) => PAD_X + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (pct: number) => PAD_TOP + (1 - pct / 100) * plotH;
  const path = trend.points.map((p, i) => `${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const label = trend.title ?? th(GROUP_KEY[trend.group], lang);
  const heading = th("trend_title", lang, { group: label });
  const alt = th("trend_alt", lang, {
    n,
    list: trend.points.map((p) => `${formatDate(p.at, lang)} ${formatPct(p.pct, lang)}`).join(", "),
  });
  const latest = trend.points[n - 1];

  return (
    <figure className="card mb-5 p-4">
      <figcaption className="mb-2 text-[14px] font-semibold text-[var(--mp-fg)]">{heading}</figcaption>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full sm:max-w-[320px]"
          role="img"
          aria-label={alt}
        >
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={y(60)}
            y2={y(60)}
            stroke="var(--mp-fg-muted)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <polyline points={path} fill="none" stroke="var(--mp-viridian)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {trend.points.map((p, i) => (
            <circle
              key={p.id}
              cx={x(i)}
              cy={y(p.pct)}
              r={i === n - 1 ? 5 : 3.5}
              fill="var(--mp-viridian)"
              stroke="var(--mp-surface)"
              strokeWidth={i === n - 1 ? 2 : 1}
            />
          ))}
        </svg>
        <div className="min-w-0 text-[14px] text-[var(--mp-fg)]">
          <p className="font-mono text-2xl font-black">{formatPct(latest.pct, lang)}</p>
          <p>{trendDeltaText(trend.delta, lang)}</p>
          <p className="mt-1 text-[13px] text-[var(--mp-fg-muted)]">{th("trend_reference", lang)}</p>
        </div>
      </div>
    </figure>
  );
}
