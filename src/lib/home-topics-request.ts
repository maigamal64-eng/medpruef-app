import { checkedJson, isRecord } from './async-data';

export interface HomeTopic { topic: string; count: number }
export const HOME_TOPICS_TIMEOUT_MS = 8_000;

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
