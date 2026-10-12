import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/sw/route';
afterEach(() => vi.useRealTimers());
it('serves the account-free offline fallback after five seconds of a hung navigation', async () => {
  vi.useFakeTimers();
  const handlers: Record<string, (event: unknown) => void> = {};
  const fallback = new Response('offline');
  const match = vi.fn().mockResolvedValue(fallback);
  runInNewContext(await (await GET()).text(), {
    self: { location: { origin: 'https://medpruf.com' }, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; } },
    URL, Response, AbortController, setTimeout, clearTimeout,
    caches: { match },
    fetch: (_request: Request, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('timeout')));
    }),
  });
  let result: Promise<Response> | undefined;
  const request = { method: 'GET', url: 'https://medpruf.com/quiz', mode: 'navigate', headers: new Headers() };
  handlers.fetch({ request, respondWith: (promise: Promise<Response>) => { result = promise; } });
  await vi.advanceTimersByTimeAsync(4999); expect(match).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(fallback);
  expect(match).toHaveBeenCalledWith('/offline.html');
});
