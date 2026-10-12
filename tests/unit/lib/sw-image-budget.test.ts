/**
 * a28-finish (reviewer P2): Supabase storage images get the 5 s network
 * budget only when a stored copy exists. Without one a slow image still
 * loads; it never turns into a broken image after 5 s. Lookalike hosts are
 * not treated as Supabase storage.
 */
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/sw/route';

afterEach(() => vi.useRealTimers());

const IMG = 'https://abc.supabase.co/storage/v1/object/public/question-images/1.png';

async function boot(opts: { cached: Response | undefined; fetchImpl: (req: unknown, init?: RequestInit) => Promise<Response> }) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const match = vi.fn().mockResolvedValue(opts.cached);
  const fetchSpy = vi.fn(opts.fetchImpl);
  runInNewContext(await (await GET()).text(), {
    self: { location: { origin: 'https://medpruf.com' }, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; } },
    URL, Response, AbortController, setTimeout, clearTimeout,
    caches: { match, open: vi.fn().mockResolvedValue({ put: vi.fn() }) },
    fetch: fetchSpy,
  });
  const respond = (url: string) => {
    let result: Promise<Response> | undefined;
    handlers.fetch({ request: { method: 'GET', url, mode: 'no-cors', headers: new Headers() }, respondWith: (p: Promise<Response>) => { result = p; } });
    return result;
  };
  return { respond, fetchSpy };
}

const hung = (_req: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
});

it('with a stored copy, a hung image falls back to it after five seconds', async () => {
  vi.useFakeTimers();
  const copy = new Response('copy');
  const { respond } = await boot({ cached: copy, fetchImpl: hung });
  const result = respond(IMG)!;
  await vi.advanceTimersByTimeAsync(4999);
  let settled = false;
  void result.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe(copy);
});

it('without a stored copy, a slow image is never aborted', async () => {
  vi.useFakeTimers();
  const late = new Response('late', { headers: { 'cache-control': 'private' } });
  const { respond, fetchSpy } = await boot({
    cached: undefined,
    fetchImpl: (_req, init) => {
      expect(init?.signal).toBeUndefined();
      return new Promise((resolve) => setTimeout(() => resolve(late), 12_000));
    },
  });
  const result = respond(IMG)!;
  await vi.advanceTimersByTimeAsync(12_000);
  expect(await result).toBe(late);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it('a lookalike host is not handled as Supabase storage', async () => {
  const { respond, fetchSpy } = await boot({ cached: undefined, fetchImpl: async () => new Response('x') });
  expect(respond('https://abc.supabase.co.evil.tld/storage/v1/object/public/x.png')).toBeUndefined();
  expect(fetchSpy).not.toHaveBeenCalled();
});
