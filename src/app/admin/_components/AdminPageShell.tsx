"use client";

/**
 * AdminPageShell — shared chrome for every admin sub-route.
 *
 * Owns the page title, freshness badge, and optional action rail.
 * Each route renders its own body inside `children`.
 *
 * Freshness (a18, UX-ADM-31): the badge is derived from the page's load
 * state (see ./freshness.ts), never passed by hand, with "Updated hh:mm"
 * beside it. Also sets the tab title and the top-bar title per route.
 */

import { HelpCircle, RefreshCw } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { adminDocumentTitle, navEntryFor, sumCounts } from "./admin-nav";
import { useAdminChrome } from "./admin-chrome";
import { deriveFreshness, type Freshness, type LoadState } from "./freshness";

export type { Freshness, LoadState } from "./freshness";

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
      data-testid="admin-freshness"
      className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${styles[state]}`}
    >
      {label}
    </span>
  );
}

/**
 * Last successful load time. A page may pass it; otherwise the shell stamps
 * the moment `loading` ends without an error (the page's own load finished).
 */
function useLoadStamp(state: LoadState | undefined): number | null {
  const [stamp, setStamp] = useState<number | null>(null);
  const wasLoading = useRef<boolean | null>(null);
  const explicit = state?.updatedAt;
  const loading = state?.loading ?? false;
  const failed = Boolean(state?.error);
  const hasState = Boolean(state);
  useEffect(() => {
    if (!hasState || explicit !== undefined) return;
    if (!loading && !failed && (wasLoading.current !== false || stamp == null)) setStamp(Date.now());
    wasLoading.current = loading;
  }, [hasState, explicit, loading, failed, stamp]);
  return explicit !== undefined ? explicit ?? null : stamp;
}

export function AdminPageShell({
  title,
  description,
  loadState,
  pollMs,
  actions,
  onRefresh,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** The page's own load; drives the freshness badge (UX-ADM-31). Omit on static pages. */
  loadState?: LoadState;
  /** Refetch through onRefresh every pollMs while the tab is visible (ADM-20 A). */
  pollMs?: number;
  actions?: ReactNode;
  /** Re-runs the page load. Also fired when the tab becomes visible with old data and when the browser comes back online. */
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { inbox, setPageTitle } = useAdminChrome();
  const updatedAt = useLoadStamp(loadState);
  const [now, setNow] = useState(() => Date.now());
  const view = loadState ? deriveFreshness({ loading: loadState.loading, error: loadState.error, updatedAt }, now, { pollMs }) : null;

  // Tab title and top-bar title follow the page (UX-ADM-27); queue pages lead with their open count.
  const entry = navEntryFor(pathname);
  const badgeKeys = entry?.item?.badgeKeys;
  const badge = badgeKeys ? sumCounts(inbox.counts, badgeKeys, inbox.failed) : null;
  const titleCount = badge && !badge.unknown ? badge.total : null;
  useEffect(() => {
    document.title = adminDocumentTitle(title, titleCount);
  }, [title, titleCount]);
  useEffect(() => {
    setPageTitle(title);
    return () => setPageTitle(null);
  }, [setPageTitle, title]);

  // Re-render the age once in a while so NEAR-LIVE ages into CACHED.
  useEffect(() => {
    if (!loadState) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [loadState]);

  // Refetch triggers (UX-ADM-31): visible again with data older than 60 s, back online, and the optional poll.
  const refreshRef = useRef(onRefresh);
  const stampRef = useRef(updatedAt);
  useEffect(() => { refreshRef.current = onRefresh; stampRef.current = updatedAt; });
  const hasRefresh = Boolean(onRefresh);
  useEffect(() => {
    if (!hasRefresh) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const at = stampRef.current;
      if (at == null || Date.now() - at >= 60_000) refreshRef.current?.();
    };
    const onOnline = () => refreshRef.current?.();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const timer = pollMs ? setInterval(() => { if (document.visibilityState === "visible") refreshRef.current?.(); }, pollMs) : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (timer) clearInterval(timer);
    };
  }, [hasRefresh, pollMs]);

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
          {view?.stamp && (
            <span
              data-testid="admin-updated-at"
              className={`font-mono text-[11px] tabular-nums ${view.stale ? "text-[var(--mp-warning)]" : "text-[var(--mp-fg-muted)]"}`}
              title={view.stale ? "Older than three refresh intervals" : undefined}
            >
              {view.stamp}
            </span>
          )}
          {view?.badge && <FreshnessBadge state={view.badge} />}
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
