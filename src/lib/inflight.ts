/**
 * Share one in-flight server read between concurrent callers with the same
 * key (a-stability, 2026-10-12). Nothing is kept once the read settles, so a
 * caller that starts after it finishes always gets a fresh read: this
 * collapses a burst (Home, the mentor Heute card, curriculum and a tab-return
 * refresh asking at once) into one database round, never serves stale data.
 */
const INFLIGHT = new Map<string, Promise<unknown>>();

export function shareInFlight<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = INFLIGHT.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const started = (async () => read())().finally(() => {
    if (INFLIGHT.get(key) === started) INFLIGHT.delete(key);
  });
  INFLIGHT.set(key, started);
  return started;
}

/** Test seam: number of reads currently shared. */
export function inFlightCount(): number {
  return INFLIGHT.size;
}
