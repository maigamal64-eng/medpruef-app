"use client";
/**
 * useHomeStudy (UX-HOME-09, UX-HOME-59, LX-10): the server study snapshot for
 * Home, read through /api/auth/me?include=study.
 *
 *  - Paints the last snapshot cached for THIS account at once (no dimming),
 *    then refreshes on mount, on return to the tab and on bfcache restore,
 *    at most once per 60 seconds.
 *  - A cached snapshot from an earlier Vienna day keeps the streak but never
 *    shows yesterday's "today" count: that tile shows a dash until refresh.
 *  - Nothing cached and nothing loaded yet: every field reads as unknown, so
 *    the strip shows a dash, never a false 0.
 *  - The cache is bound to the account owner (storage-keys.ts) and cleared on
 *    logout or an account switch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { safeStorage } from "@/lib/safe-storage";
import { isStudySnapshot, viennaDay, type StudySnapshot } from "@/lib/home-study-core";

export const HOME_STUDY_CACHE_KEY = "medpruef_home_study_v1";
export const HOME_STUDY_THROTTLE_MS = 60_000;

interface CacheEntry { userId: string; snapshot: StudySnapshot }

export function readStudyCache(userId: string): StudySnapshot | null {
  try {
    const raw = safeStorage.getItem(HOME_STUDY_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CacheEntry) : null;
    return parsed && parsed.userId === userId && isStudySnapshot(parsed.snapshot) ? parsed.snapshot : null;
  } catch {
    return null;
  }
}

function writeStudyCache(userId: string, snapshot: StudySnapshot): void {
  try { safeStorage.setItem(HOME_STUDY_CACHE_KEY, JSON.stringify({ userId, snapshot } satisfies CacheEntry)); } catch { /* storage may be blocked */ }
}

export interface HomeStudyState {
  snapshot: StudySnapshot | null;
  /** True when the snapshot belongs to an earlier Vienna day (today's count unknown). */
  staleDay: boolean;
  loading: boolean;
  error: boolean;
  refresh: (force?: boolean) => void;
}

export function useHomeStudy(userId: string | null | undefined, onSnapshot?: (s: StudySnapshot) => void): HomeStudyState {
  const signedIn = !!userId && !userId.startsWith("guest_");
  const [snapshot, setSnapshot] = useState<StudySnapshot | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [error, setError] = useState(false);
  const lastFetch = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  const refresh = useCallback((force = false) => {
    if (!signedIn || !userId) return;
    if (!force && Date.now() - lastFetch.current < HOME_STUDY_THROTTLE_MS) return;
    lastFetch.current = Date.now();
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setLoading(true);
    authFetch(`/api/auth/me?include=study&t=${Date.now()}`, { signal: ctrl.signal, skipAuthRedirect: true, timeoutMs: 8_000 })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { study?: unknown; user?: { id?: string } };
        if (ctrl.signal.aborted) return;
        if (body.user?.id !== userId || !isStudySnapshot(body.study)) throw new Error("study snapshot unavailable");
        writeStudyCache(userId, body.study);
        setSnapshot(body.study);
        setError(false);
        onSnapshotRef.current?.(body.study);
      })
      .catch((err) => { if (!ctrl.signal.aborted && (err as Error)?.name !== "AbortError") setError(true); })
      .finally(() => { if (inFlight.current === ctrl) { inFlight.current = null; setLoading(false); } });
  }, [signedIn, userId]);

  useEffect(() => {
    if (!signedIn || !userId) { setSnapshot(null); setLoading(false); return; }
    setSnapshot(readStudyCache(userId));
    lastFetch.current = 0;
    refresh(true);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      inFlight.current?.abort();
    };
  }, [signedIn, userId, refresh]);

  const staleDay = !!snapshot && snapshot.day !== viennaDay(new Date());
  return { snapshot, staleDay, loading, error, refresh };
}
