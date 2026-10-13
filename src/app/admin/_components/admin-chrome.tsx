"use client";

/**
 * Admin chrome context (a18): one Inbox count load shared by the sidebar
 * badges, the phone bottom bar, the Today page and the tab titles, plus the
 * current page title for the top bar. Counts are polled every 60 s while
 * the tab is visible and refetched when it becomes visible again or the
 * browser comes back online.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { INBOX_KEYS, type InboxKey } from "./admin-nav";
import { ADMIN_POLL_MS } from "./freshness";

export type InboxCounts = Partial<Record<InboxKey, number | null>>;

export interface InboxState {
  counts: InboxCounts;
  /** Oldest open item per queue (ISO), when the server knows it. */
  oldest: Partial<Record<InboxKey, string | null>>;
  /** Keys the server could not read. Every key when the request failed. */
  failed: ReadonlySet<InboxKey>;
  status: "idle" | "loading" | "ok" | "error";
  updatedAt: number | null;
  /** a19 (ADM-12 B): emergency kill switches that are on right now. */
  killSwitches: Array<{ key: string; effect: string }>;
}

interface AdminChrome {
  inbox: InboxState;
  refreshInbox: () => Promise<void>;
  pageTitle: string | null;
  setPageTitle: (title: string | null) => void;
}

const EMPTY: InboxState = { counts: {}, oldest: {}, failed: new Set(), status: "idle", updatedAt: null, killSwitches: [] };

const AdminChromeContext = createContext<AdminChrome>({
  inbox: EMPTY,
  refreshInbox: async () => {},
  pageTitle: null,
  setPageTitle: () => {},
});

export function useAdminChrome(): AdminChrome {
  return useContext(AdminChromeContext);
}

/** Parse the /api/admin/inbox body; anything malformed counts as failed. */
export function parseInboxBody(body: unknown): Omit<InboxState, "status" | "updatedAt"> {
  const killSwitches = parseKillSwitches(body);
  const counts: InboxCounts = {};
  const oldest: Partial<Record<InboxKey, string | null>> = {};
  const failed = new Set<InboxKey>();
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const failedList = Array.isArray(record?.failed) ? (record?.failed as unknown[]) : [];
  const oldestRecord = record?.oldest && typeof record.oldest === "object" ? (record.oldest as Record<string, unknown>) : {};
  for (const key of INBOX_KEYS) {
    const n = record?.[key];
    counts[key] = typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
    const at = oldestRecord[key];
    oldest[key] = typeof at === "string" ? at : null;
    if (!record || failedList.includes(key)) failed.add(key);
  }
  return { counts, oldest, failed, killSwitches };
}

/** Only well-formed `{ key, effect }` strings survive. */
export function parseKillSwitches(body: unknown): Array<{ key: string; effect: string }> {
  const list = body && typeof body === "object" ? (body as Record<string, unknown>).kill_switches_on : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((k) => (k && typeof k === "object" && typeof (k as { key?: unknown }).key === "string" && typeof (k as { effect?: unknown }).effect === "string"
    ? [{ key: (k as { key: string }).key, effect: (k as { effect: string }).effect }]
    : []));
}

export function AdminChromeProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [inbox, setInbox] = useState<InboxState>(EMPTY);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const seq = useRef(0);
  const updatedAtRef = useRef<number | null>(null);
  useEffect(() => { updatedAtRef.current = inbox.updatedAt; }, [inbox.updatedAt]);

  const refreshInbox = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    setInbox((prev) => ({ ...prev, status: prev.status === "ok" ? "ok" : "loading" }));
    try {
      const res = await authFetch("/api/admin/inbox", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (mine !== seq.current) return;
      if (!res.ok || !body || typeof body !== "object") throw new Error("inbox");
      setInbox({ ...parseInboxBody(body), status: "ok", updatedAt: Date.now() });
    } catch {
      if (mine !== seq.current) return;
      // Keep the last numbers for the age line, but every badge reads "--".
      setInbox((prev) => ({ ...prev, failed: new Set(INBOX_KEYS), status: "error" }));
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refreshInbox();
    // a-db-relief-1 (T0a): every 5 minutes while visible; a tab that comes
    // back refetches only when its counts are older than a minute.
    const tick = () => { if (document.visibilityState === "visible") void refreshInbox(); };
    const onVisible = () => {
      const at = updatedAtRef.current;
      if (at == null || Date.now() - at >= 60_000) tick();
    };
    const timer = setInterval(tick, ADMIN_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", tick);
    };
  }, [enabled, refreshInbox]);

  const value = useMemo(() => ({ inbox, refreshInbox, pageTitle, setPageTitle }), [inbox, refreshInbox, pageTitle]);
  return <AdminChromeContext.Provider value={value}>{children}</AdminChromeContext.Provider>;
}
