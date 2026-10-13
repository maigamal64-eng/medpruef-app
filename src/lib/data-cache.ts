/**
 * Vercel Data Cache helpers (a-db-relief-1, 13 Oct 2026).
 *
 * The free-plan database froze on memory and disk IO: every buffer it touches
 * costs about 240 us. Reads that are the same for every learner (topic counts,
 * bank coverage) therefore go through the Data Cache, which is shared by every
 * function instance, instead of a per-instance Map that a cold instance never
 * has.
 *
 * - `readThrough` wraps `unstable_cache`. `compute` must THROW for anything
 *   that may not be kept (an error, an empty bank): a throw on a cold key
 *   propagates and stores nothing; a throw while revalidating a stale entry
 *   keeps serving the stale value (Next's own rule).
 * - Where no Data Cache exists (unit tests, scripts, `next dev` without an
 *   incremental cache) it simply runs `compute`; `next/cache` is imported
 *   lazily so a client bundle that reaches this module never pulls it in.
 * - `claimOnce` turns a key into a first-writer-wins record: the first caller
 *   stores its value, every later caller reads that value. Used for the
 *   purge debounce and the database watch, which must keep a little state
 *   while the database itself is down. Records are never revalidated; their
 *   keys carry a time slot, so they are write-once by construction.
 *
 * Never pass a client or other object to these helpers as a key part: key
 * parts are serialized into the cache key.
 */

export interface ReadThroughOptions {
  /** Seconds until the entry is stale (served while it revalidates), or false for never. */
  revalidate: number | false;
  tags?: string[];
}

export type DataCacheRunner = <T>(
  keyParts: string[],
  compute: () => Promise<T>,
  options: ReadThroughOptions,
) => Promise<{ value: T; cached: boolean }>;

let testRunner: DataCacheRunner | null = null;

/** Test seam: replace the Data Cache with an in-memory runner (null restores Next's). */
export function __setDataCacheRunnerForTests(runner: DataCacheRunner | null): void {
  testRunner = runner;
}

/** An in-memory runner that behaves like the shared Data Cache, for tests. */
export function memoryDataCacheRunner(store = new Map<string, unknown>()): DataCacheRunner & { store: Map<string, unknown> } {
  const run: DataCacheRunner = async <T>(keyParts: string[], compute: () => Promise<T>) => {
    const key = keyParts.join("|");
    if (store.has(key)) return { value: store.get(key) as T, cached: true };
    const value = await compute();
    store.set(key, value);
    return { value, cached: true };
  };
  return Object.assign(run, { store });
}

function isMissingIncrementalCache(err: unknown): boolean {
  return err instanceof Error && /incrementalCache missing/i.test(err.message);
}

async function nextRunner<T>(keyParts: string[], compute: () => Promise<T>, options: ReadThroughOptions): Promise<{ value: T; cached: boolean }> {
  let cachedFn: () => Promise<T>;
  try {
    const { unstable_cache } = await import("next/cache");
    cachedFn = unstable_cache(compute, keyParts, { revalidate: options.revalidate, tags: options.tags });
  } catch {
    return { value: await compute(), cached: false };
  }
  try {
    return { value: await cachedFn(), cached: true };
  } catch (err) {
    // No Data Cache in this runtime: the invariant fires before compute runs.
    if (isMissingIncrementalCache(err)) return { value: await compute(), cached: false };
    throw err;
  }
}

/** Read `compute` through the shared Data Cache (see the module comment). */
export async function readThrough<T>(keyParts: string[], compute: () => Promise<T>, options: ReadThroughOptions): Promise<T> {
  return (await (testRunner ?? nextRunner)(keyParts, compute, options)).value;
}

/** Same as readThrough, and says whether a shared cache was actually there. */
export async function readThroughDetailed<T>(keyParts: string[], compute: () => Promise<T>, options: ReadThroughOptions): Promise<{ value: T; cached: boolean }> {
  return (testRunner ?? nextRunner)(keyParts, compute, options);
}

export interface Claim<T> {
  /** True when this call stored the record (or no shared cache exists). */
  claimed: boolean;
  /** The stored record: ours when claimed, otherwise the first writer's. */
  value: T;
  /** False when no shared cache exists; callers decide how to degrade. */
  shared: boolean;
}

/** First writer wins: store `value` under `keyParts` unless a record exists. */
export async function claimOnce<T extends Record<string, unknown>>(keyParts: string[], value: T, tags: string[] = []): Promise<Claim<T>> {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const { value: stored, cached } = await readThroughDetailed(
      keyParts,
      async () => ({ ...value, __claim: token }),
      { revalidate: false, tags },
    );
    const record = stored as T & { __claim?: string };
    const { __claim, ...rest } = record;
    return { claimed: !cached || __claim === token, value: rest as unknown as T, shared: cached };
  } catch {
    return { claimed: true, value, shared: false };
  }
}
