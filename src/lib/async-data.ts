export type RegionState = 'idle' | 'loading' | 'slow' | 'ok' | 'empty' | 'error';
export class DataResponseError extends Error {
  constructor(public status: number, public malformed = false) { super('Data could not be loaded'); }
}
export async function checkedJson<T>(response: Response, valid: (value: unknown) => value is T): Promise<T> {
  if (!response.ok) throw new DataResponseError(response.status);
  const value: unknown = await response.json();
  if (!valid(value)) throw new DataResponseError(502, true);
  return value;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Each new filter/request invalidates its predecessor, even if fetch ignores abort. */
export function createRequestSequence() {
  let token = 0;
  let controller: AbortController | undefined;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      const ownToken = ++token;
      return { signal: controller.signal, current: () => ownToken === token && !controller?.signal.aborted };
    },
    cancel() { ++token; controller?.abort(); },
  };
}

/**
 * UX-GLOBAL-16 request classes: timeouts belong to a class, not one number.
 * Auth and form submits keep every input for 15 s; page data waits 8 s and
 * then shows a retryable error; staged bulk fetches get 25 s per request;
 * service-worker navigations race the network for 5 s before the fallback.
 */
export const REQUEST_CLASS_TIMEOUT_MS = { form: 15_000, page: 8_000, bulk: 25_000, navigation: 5_000 } as const;
export const SKELETON_AFTER_MS = 200;
export const SLOW_AFTER_MS = 8_000;
/** Refetch on visibilitychange at most once a minute (and on `online`). */
export const REFETCH_THROTTLE_MS = 60_000;

export type FailureReason = 'offline' | 'timeout' | 'server' | 'malformed' | 'expired' | 'forbidden' | 'network';

/**
 * Session classes are never conflated: 401 is an expired session (keep the
 * work, then sign in with reason=expired), 403 is an entitlement gate, network
 * or 5xx is degraded data with the last good content kept, never a logout.
 */
export function classifyFailure(error: unknown, online = true): FailureReason {
  if (!online) return 'offline';
  if (error instanceof DataResponseError) {
    if (error.status === 401) return 'expired';
    if (error.status === 403 || error.status === 402) return 'forbidden';
    if (error.malformed) return 'malformed';
    return 'server';
  }
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout';
  if (error instanceof Error && /timed out|timeout/i.test(error.message)) return 'timeout';
  return 'network';
}

export interface RegionView { state: RegionState; reason: FailureReason | null }

/**
 * One region state from a request outcome. Empty is reported only for a
 * confirmed successful empty body; a failure never renders as zero or empty.
 */
export function resolveRegion<T>(input: {
  settled: boolean;
  elapsedMs: number;
  data?: T;
  error?: unknown;
  online?: boolean;
  isEmpty?: (data: T) => boolean;
}): RegionView {
  if (!input.settled) return { state: input.elapsedMs >= SLOW_AFTER_MS ? 'slow' : 'loading', reason: null };
  if (input.error !== undefined && input.error !== null) return { state: 'error', reason: classifyFailure(input.error, input.online ?? true) };
  if (input.data === undefined) return { state: 'idle', reason: null };
  const empty = input.isEmpty ? input.isEmpty(input.data) : Array.isArray(input.data) && input.data.length === 0;
  return { state: empty ? 'empty' : 'ok', reason: null };
}

/** Throttled visibility refetch: true when the last load is older than the throttle. */
export function shouldRefetchOnVisible(lastLoadedAt: number | null, now: number): boolean {
  return lastLoadedAt === null || now - lastLoadedAt >= REFETCH_THROTTLE_MS;
}
