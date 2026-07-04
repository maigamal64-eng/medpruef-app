"use client";

/**
 * Presentational visuals for the admin user-detail page.
 *
 * All SVG / CSS — no chart dependency — so they render fast, stay
 * SSR-safe, and theme with the `--mp-*` tokens in light + dark.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  HeatmapCell,
  TrendPoint,
  TopicStat,
  ExamStat,
} from "./types";

// ── formatting ──────────────────────────────────────────────────────
export function fmtInt(n: number | null | undefined): string {
  return new Intl.NumberFormat("de-AT").format(Math.round(n || 0));
}

export function fmtDurationMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtDurationSec(sec: number | null | undefined): string {
  if (sec == null) return "—";
  return fmtDurationMs(sec * 1000);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function fmtEuroCents(
  cents: number | null | undefined,
  currency = "EUR"
): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: currency || "EUR",
  }).format(cents / 100);
}

// ── Stat card ───────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = "var(--mp-fg)",
  tint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  accent?: string;
  tint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3.5 flex flex-col gap-1 min-h-[92px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
          {label}
        </span>
        {Icon && (
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md"
            style={{ background: tint || "var(--mp-surface-sunken)", color: accent }}
          >
            <Icon size={13} />
          </span>
        )}
      </div>
      <span
        className="text-2xl font-semibold tabular-nums leading-tight"
        style={{ color: accent }}
      >
        {value}
      </span>
      {sub != null && (
        <span className="text-[11px] text-[var(--mp-fg-subtle)] mt-auto">{sub}</span>
      )}
    </div>
  );
}

// ── Study heatmap (GitHub-style calendar) ───────────────────────────
export function StudyHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  // group into weeks (columns of 7). cells are oldest→newest.
  const weeks: HeatmapCell[][] = [];
  // pad the front so the first column starts on the correct weekday row
  const firstDay = cells.length ? new Date(cells[0].date).getUTCDay() : 0;
  const padded: (HeatmapCell | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...cells,
  ];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7) as HeatmapCell[]);
  }
  const CELL = 12;
  const GAP = 3;
  const W = weeks.length * (CELL + GAP);
  const H = 7 * (CELL + GAP);

  function color(count: number): string {
    if (!count) return "var(--mp-surface-sunken)";
    const r = count / max;
    if (r <= 0.25) return "rgba(0,123,95,0.28)";
    if (r <= 0.5) return "rgba(0,123,95,0.5)";
    if (r <= 0.75) return "rgba(0,123,95,0.72)";
    return "var(--mp-viridian)";
  }

  // month labels
  const monthLabels: { x: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((w, wi) => {
    const firstReal = w.find(Boolean);
    if (!firstReal) return;
    const m = new Date(firstReal.date).getUTCMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      monthLabels.push({
        x: wi * (CELL + GAP),
        label: new Date(firstReal.date).toLocaleDateString("en-GB", {
          month: "short",
        }),
      });
    }
  });

  return (
    <div className="overflow-x-auto">
      <svg
        width={W}
        height={H + 16}
        role="img"
        aria-label="Study activity heatmap"
        className="block"
      >
        {monthLabels.map((m, i) => (
          <text
            key={i}
            x={m.x}
            y={9}
            fontSize={9}
            fill="var(--mp-fg-subtle)"
            fontFamily="ui-monospace, monospace"
          >
            {m.label}
          </text>
        ))}
        {weeks.map((w, wi) =>
          w.map((c, di) => {
            if (!c) return null;
            return (
              <rect
                key={`${wi}-${di}`}
                x={wi * (CELL + GAP)}
                y={16 + di * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2.5}
                fill={color(c.count)}
              >
                <title>
                  {c.date}: {c.count} answered
                </title>
              </rect>
            );
          })
        )}
      </svg>
    </div>
  );
}

// ── Activity trend (last 30 days, correct/wrong stacked bars) ───────
export function AccuracyTrend({ trend }: { trend: TrendPoint[] }) {
  const max = Math.max(1, ...trend.map((t) => t.answered));
  const total = trend.reduce((s, t) => s + t.answered, 0);
  if (!total) {
    return (
      <div className="text-xs text-[var(--mp-fg-subtle)] italic py-6 text-center">
        No questions answered in the last 30 days.
      </div>
    );
  }
  const H = 84;
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: H }}>
        {trend.map((t, i) => {
          const barH = (t.answered / max) * H;
          const correctH = t.answered ? (t.correct / t.answered) * barH : 0;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end min-w-[3px]"
              style={{ height: H }}
              title={`${t.date}: ${t.answered} answered, ${t.correct} correct`}
            >
              {t.answered > 0 ? (
                <div
                  className="w-full rounded-t-[2px] overflow-hidden flex flex-col justify-end"
                  style={{ height: Math.max(barH, 2) }}
                >
                  <div
                    style={{
                      height: barH - correctH,
                      background: "var(--mp-error)",
                      opacity: 0.55,
                    }}
                  />
                  <div
                    style={{ height: correctH, background: "var(--mp-viridian)" }}
                  />
                </div>
              ) : (
                <div
                  className="w-full rounded-full"
                  style={{ height: 2, background: "var(--mp-border-subtle)" }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--mp-fg-subtle)]">
        <span>30 days ago</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-[var(--mp-viridian)]" /> correct
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ background: "var(--mp-error)", opacity: 0.55 }}
            />{" "}
            wrong
          </span>
        </span>
        <span>today</span>
      </div>
    </div>
  );
}

// ── Per-topic mastery bars ──────────────────────────────────────────
function accuracyColor(acc: number): string {
  if (acc >= 70) return "var(--mp-viridian)";
  if (acc >= 40) return "var(--mp-status-warning)";
  return "var(--mp-error)";
}

export function TopicBars({ topics }: { topics: TopicStat[] }) {
  if (!topics.length) {
    return (
      <div className="text-xs text-[var(--mp-fg-subtle)] italic py-4 text-center">
        No answered questions yet.
      </div>
    );
  }
  const shown = topics.slice(0, 12);
  return (
    <div className="space-y-2">
      {shown.map((t) => (
        <div key={t.topic} className="flex items-center gap-3">
          <div className="w-28 sm:w-40 truncate text-xs text-[var(--mp-fg)]" title={t.topic}>
            {t.topic}
          </div>
          <div className="flex-1 h-4 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(t.accuracy, 3)}%`,
                background: accuracyColor(t.accuracy),
              }}
            />
          </div>
          <div className="w-24 text-right text-[11px] tabular-nums text-[var(--mp-fg-muted)]">
            <span style={{ color: accuracyColor(t.accuracy) }} className="font-semibold">
              {t.accuracy}%
            </span>{" "}
            · {t.answered}
          </div>
        </div>
      ))}
      {topics.length > shown.length && (
        <div className="text-[10px] text-[var(--mp-fg-subtle)] pt-1">
          +{topics.length - shown.length} more topics
        </div>
      )}
    </div>
  );
}

// ── Exam split (segmented proportion bar) ───────────────────────────
const EXAM_COLORS = ["#007B5F", "#003A8C", "#00A896", "#8B5CF6"];

export function ExamSplit({ exams }: { exams: ExamStat[] }) {
  const total = exams.reduce((s, e) => s + e.answered, 0);
  if (!total) {
    return (
      <div className="text-xs text-[var(--mp-fg-subtle)] italic py-4 text-center">
        No exam activity yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex h-3 rounded-full overflow-hidden bg-[var(--mp-surface-sunken)]">
        {exams.map((e, i) => (
          <div
            key={e.examType}
            style={{
              width: `${(e.answered / total) * 100}%`,
              background: EXAM_COLORS[i % EXAM_COLORS.length],
            }}
            title={`${e.label}: ${e.answered}`}
          />
        ))}
      </div>
      <div className="space-y-1.5">
        {exams.map((e, i) => {
          const acc = e.answered ? Math.round((e.correct / e.answered) * 100) : 0;
          return (
            <div key={e.examType} className="flex items-center gap-2 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ background: EXAM_COLORS[i % EXAM_COLORS.length] }}
              />
              <span className="flex-1 truncate text-[var(--mp-fg)]">{e.label}</span>
              <span className="tabular-nums text-[var(--mp-fg-muted)]">
                {e.answered} · {acc}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Card wrapper with a heading ─────────────────────────────────────
export function VizCard({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-muted)]">
          {title}
        </h3>
        {hint && <span className="text-[10px] text-[var(--mp-fg-subtle)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
