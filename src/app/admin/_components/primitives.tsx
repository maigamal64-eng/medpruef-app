"use client";

/**
 * Shared mission-control primitives for the admin shell.
 *
 * Polish sprint (Apr 23): after Agent A shipped the IA + 18 routes + 11
 * tiles, [name] flagged that the dashboard "feels cheap". These small
 * primitives give every tile/row/section a consistent visual language
 * so the whole shell starts to feel like real mission-control —
 * tabular numbers everywhere, status dots with semantic colors,
 * currency formatted through Intl.NumberFormat, and a visibility-gated
 * pulse so tabs in the background don't silently thrash.
 */

import { ReactNode, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// Status dots — semantic colors, used consistently on every page
// ═══════════════════════════════════════════════════════════════════

export type StatusTone = "success" | "warn" | "danger" | "neutral" | "info";

const DOT_COLORS: Record<StatusTone, string> = {
  success: "#10B981", // emerald-500
  warn: "#F59E0B", // amber-500
  danger: "#EF4444", // red-500
  neutral: "#64748B", // slate-500
  info: "#3B82F6", // blue-500
};

export function StatusDot({
  tone = "neutral",
  pulse = false,
  size = 8,
  title,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  size?: number;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center justify-center"
      role="status"
      title={title}
      aria-label={title}
    >
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: DOT_COLORS[tone],
          boxShadow: pulse
            ? `0 0 0 2px ${DOT_COLORS[tone]}44`
            : undefined,
          transition: "box-shadow 0.2s ease-out",
        }}
        className={pulse ? "motion-safe:animate-pulse" : ""}
      />
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Number + currency formatting helpers
//
// Every number in the admin shell should go through one of these, so
// we never leak a raw `1234.5678` to the UI.
// ═══════════════════════════════════════════════════════════════════

const EUR_FORMATTER = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM_FORMATTER_DE = new Intl.NumberFormat("de-AT");
const PCT_FORMATTER = new Intl.NumberFormat("de-AT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatEuroFromCents(cents: number): string {
  return EUR_FORMATTER.format((cents || 0) / 100);
}

export function formatInt(n: number): string {
  return NUM_FORMATTER_DE.format(Math.round(n || 0));
}

export function formatPct(ratio: number): string {
  return PCT_FORMATTER.format(ratio || 0);
}

export function FormatEuro({ cents }: { cents: number | null | undefined }) {
  return (
    <span className="tabular-nums">
      {cents == null ? "—" : formatEuroFromCents(cents)}
    </span>
  );
}

export function FormatInt({ value }: { value: number | null | undefined }) {
  return (
    <span className="tabular-nums">
      {value == null ? "—" : formatInt(value)}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Keyboard shortcut hint — tiny kbd pill shown next to nav items
// ═══════════════════════════════════════════════════════════════════

export function ShortcutHint({ keys }: { keys: string }) {
  return (
    <kbd
      className="inline-flex items-center gap-0.5 font-mono text-[9px] px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]"
      aria-hidden
    >
      {keys}
    </kbd>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Section heading — the "three rooms" divider for the overview grid
// ═══════════════════════════════════════════════════════════════════

export function SectionHeading({
  title,
  hint,
  icon: Icon,
  right,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 pb-2 border-b border-[var(--mp-border-subtle)]">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && (
          <Icon size={14} className="text-[var(--mp-fg-muted)]" aria-hidden />
        )}
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-muted)]">
          {title}
        </h2>
        {hint && (
          <span className="text-[10px] text-[var(--mp-fg-subtle)] italic">
            {hint}
          </span>
        )}
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Visibility hook — gates pulse animations so backgrounded tabs
// don't flash every time Realtime fires an event.
// ═══════════════════════════════════════════════════════════════════

export function useIsVisible() {
  const [visible, setVisible] = useState(
    typeof document !== "undefined"
      ? document.visibilityState === "visible"
      : true
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVis() {
      setVisible(document.visibilityState === "visible");
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}

// ═══════════════════════════════════════════════════════════════════
// Sparkline — minimal inline SVG line chart, no dependency on recharts
//
// The series is optional; when empty we render a flat baseline so the
// tile still has the right height.
// ═══════════════════════════════════════════════════════════════════

export function Sparkline({
  series,
  width = 120,
  height = 32,
  stroke = "var(--mp-viridian)",
  fill = "rgba(0,123,95,0.12)",
  ariaLabel,
}: {
  series: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
}) {
  if (!series.length) {
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel || "No data yet"}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--mp-border-subtle)"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      </svg>
    );
  }
  const min = Math.min(...series, 0);
  const max = Math.max(...series, 1);
  const range = max - min || 1;
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const points = series.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return { x, y };
  });
  const linePath = points
    .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
    .join(" ");
  const fillPath = `${linePath} L${width},${height} L0,${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel || "Trend"}
    >
      <path d={fillPath} fill={fill} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Kebab menu — standard row actions dropdown
// ═══════════════════════════════════════════════════════════════════

export function KebabMenu({
  label = "More actions",
  items,
}: {
  label?: string;
  items: Array<{
    key: string;
    label: string;
    onSelect: () => void;
    tone?: "default" | "danger";
    icon?: LucideIcon;
    disabled?: boolean;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1.5 rounded-md hover:bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="5" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="19" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[180px] rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] shadow-lg z-20 py-1"
        >
          {items.map((it) => {
            const Icon = it.icon;
            const tone =
              it.tone === "danger"
                ? "text-[var(--mp-error)] hover:bg-[var(--mp-error)]/10"
                : "text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]";
            return (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onSelect();
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs ${tone} ${it.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                {Icon && <Icon size={12} />}
                <span>{it.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Filter chips — sticky row of toggleable filter pills
// ═══════════════════════════════════════════════════════════════════

export function FilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full border text-[11px] font-medium transition-colors ${
        active
          ? "bg-[var(--mp-viridian)]/15 border-[var(--mp-viridian)]/40 text-[var(--mp-viridian)]"
          : "bg-[var(--mp-surface-raised)] border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] hover:border-[var(--mp-border-subtle)]"
      }`}
    >
      <span>{children}</span>
      {typeof count === "number" && (
        <span
          className={`tabular-nums text-[10px] px-1 rounded ${
            active
              ? "bg-[var(--mp-viridian)]/20"
              : "bg-[var(--mp-surface-sunken)]"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Generic skeleton card + skeleton row (reused across list views)
// ═══════════════════════════════════════════════════════════════════

export function TileSkeleton() {
  return (
    <div
      className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 min-h-[108px] flex flex-col motion-safe:animate-pulse"
      aria-hidden
    >
      <div className="h-2.5 w-20 rounded bg-[var(--mp-surface-sunken)] mb-3" />
      <div className="h-7 w-24 rounded bg-[var(--mp-surface-sunken)] mb-auto" />
      <div className="h-2 w-32 rounded bg-[var(--mp-surface-sunken)] mt-3" />
    </div>
  );
}

export function RowSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-t border-[var(--mp-border-subtle)] motion-safe:animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-2.5 w-full rounded bg-[var(--mp-surface-sunken)]" />
        </td>
      ))}
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Empty-state with a timestamp (for "no data yet" tile empty states)
// ═══════════════════════════════════════════════════════════════════

export function TileEmptyLabel({
  updatedAt,
  tone = "neutral",
}: {
  updatedAt: Date | null;
  tone?: StatusTone;
}) {
  if (!updatedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--mp-fg-subtle)]">
        <StatusDot tone={tone} size={6} />
        Awaiting first event
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--mp-fg-subtle)]">
      <StatusDot tone={tone} size={6} />
      <span className="font-mono">
        Updated {updatedAt.toLocaleTimeString()}
      </span>
    </span>
  );
}
