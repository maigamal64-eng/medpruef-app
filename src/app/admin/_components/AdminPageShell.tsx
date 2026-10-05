"use client";

/**
 * AdminPageShell — shared chrome for every admin sub-route.
 *
 * Owns the page title, freshness badge, and optional action rail.
 * Each route renders its own body inside `children`.
 *
 * §2.12 of the April 23 admin revamp sprint — every data view labels
 * its freshness (LIVE / NEAR-LIVE / CACHED / DISCONNECTED).
 */

import { HelpCircle, RefreshCw } from "lucide-react";
import { ReactNode } from "react";

export type Freshness = "live" | "near-live" | "cached" | "disconnected";

export function FreshnessBadge({ state }: { state: Freshness }) {
  const styles = {
    live: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
    "near-live":
      "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/40",
    cached:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40",
    disconnected:
      "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40",
  } as const;
  const label = {
    live: "LIVE",
    "near-live": "NEAR-LIVE",
    cached: "CACHED",
    disconnected: "DISCONNECTED",
  }[state];
  return (
    <span
      className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${styles[state]}`}
    >
      {label}
    </span>
  );
}

export function AdminPageShell({
  title,
  description,
  freshness,
  actions,
  onRefresh,
  children,
}: {
  title: string;
  description?: ReactNode;
  freshness?: Freshness;
  actions?: ReactNode;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--mp-fg)]">{title}</h1>
          {description && (
            <p className="text-xs text-[var(--mp-fg-muted)] mt-0.5">
              {description}
            </p>
          )}
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {actions}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5"
              title="Refresh"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          )}
          {freshness && <FreshnessBadge state={freshness} />}
        </div>
      </div>
      {children}
    </div>
  );
}

export function ComingSoonCard({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-6 flex flex-col items-center justify-center text-center gap-2">
      <HelpCircle size={20} className="text-[var(--mp-fg-muted)]" />
      <div className="text-sm font-semibold text-[var(--mp-fg)]">{title}</div>
      {children && (
        <div className="text-xs text-[var(--mp-fg-muted)] max-w-md">
          {children}
        </div>
      )}
    </div>
  );
}
