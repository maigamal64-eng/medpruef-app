import { checkedJson, isRecord, DataResponseError } from './async-data';

export interface HomeTopic { topic: string; count: number }
export const HOME_TOPICS_TIMEOUT_MS = 8_000;
export const HOME_TOPICS_RETRY_DELAY_MS = 1_200;

/** Bound topics independently of authentication and of the transport's timeout. */
export async function loadHomeTopics(exam: string, fetcher: typeof fetch, signal: AbortSignal): Promise<HomeTopic[]> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  let rejectAbort: (error: unknown) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason ?? new DOMException('Cancelled', 'AbortError'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('Topics timed out', 'TimeoutError')), HOME_TOPICS_TIMEOUT_MS);
  try {
    return await Promise.race([
      fetcher('/api/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'topics', examSource: exam }), signal: controller.signal,
      }).then(response => checkedJson(response, (value): value is HomeTopic[] => Array.isArray(value) && value.every(item =>
        isRecord(item) && typeof item.topic === 'string' && Number.isInteger(item.count) && Number(item.count) >= 0))),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

/** A failed Mini App refresh cannot discard an existing signed browser session. */
export function miniAppAuthFailure(status: number | null, hasCachedSession: boolean): 'auth' | 'degraded' {
  return status === 401 || status === 403 || !hasCachedSession ? 'auth' : 'degraded';
}

/** Only a dropped connection or a deadline is worth a second try; an HTTP answer (4xx, 5xx, malformed) is final. */
export function isRetryableTopicsFailure(failure: unknown): boolean {
  if (failure instanceof DataResponseError) return false;
  if (failure instanceof DOMException) return failure.name === 'TimeoutError';
  return failure instanceof TypeError; // fetch network failure; a SyntaxError (200 with a non-JSON body) is final
}

export class HomeTopicsFailure extends Error {
  constructor(public cause: unknown, public attempts: number) { super('Home topics failed'); }
}

/**
 * One retry after a short backoff for network and timeout failures (cold PWA
 * launches often fire the read before the radio is up). Cancelling the request
 * sequence during the wait stops everything. A final failure carries the attempt count.
 */
export async function loadHomeTopicsWithRetry(
  exam: string, fetcher: typeof fetch, signal: AbortSignal, delayMs = HOME_TOPICS_RETRY_DELAY_MS,
): Promise<{ topics: HomeTopic[]; attempts: number }> {
  try {
    return { topics: await loadHomeTopics(exam, fetcher, signal), attempts: 1 };
  } catch (first) {
    if (signal.aborted || !isRetryableTopicsFailure(first)) throw new HomeTopicsFailure(first, 1);
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, delayMs);
      signal.addEventListener('abort', done, { once: true });
    });
    if (signal.aborted) throw new HomeTopicsFailure(first, 1);
    try {
      return { topics: await loadHomeTopics(exam, fetcher, signal), attempts: 2 };
    } catch (second) {
      throw new HomeTopicsFailure(second, 2);
    }
  }
}
