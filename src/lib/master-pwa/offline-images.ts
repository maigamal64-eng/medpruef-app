/**
 * Helpers that warm question images into the active service worker cache.
 *
 * The service worker deletes every cache whose name is not its own build cache
 * on activate (src/app/api/sw/route.ts), so images must go into
 * `medpruef-<buildId>`, never into a separately named cache.
 */

export interface ImageSource {
  image_url?: string | null;
  image_urls?: string[] | null;
}

export interface CacheLike {
  match(request: string): Promise<unknown | undefined>;
  put(request: string, response: ResponseLike): Promise<void>;
}

export interface ResponseLike {
  ok: boolean;
  redirected?: boolean;
  type?: string;
  headers: { get(name: string): string | null };
  clone(): ResponseLike;
}

export type FetchLike = (url: string, init?: { credentials?: "omit"; signal?: AbortSignal }) => Promise<ResponseLike>;

export const DEFAULT_MAX_IMAGES = 300;
export const DEFAULT_CONCURRENCY = 4;

export function cacheNameForBuild(buildId: string): string {
  return `medpruef-${buildId}`;
}

/**
 * Mirrors the service worker rule for storage images: only public, shareable
 * responses. Redirected and opaque responses are never stored. Static same-origin
 * files may omit Cache-Control, anything cross-origin must say `public`.
 */
export function isStorableImageResponse(response: ResponseLike, opts: { requirePublic?: boolean } = {}): boolean {
  if (!response.ok || response.redirected === true) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  const cacheControl = response.headers.get("cache-control") ?? "";
  const vary = response.headers.get("vary") ?? "";
  if (opts.requirePublic && !/(?:^|,)\s*public\b/i.test(cacheControl)) return false;
  if (/private|no-store|no-cache/i.test(cacheControl)) return false;
  if (opts.requirePublic && /max-age=0/i.test(cacheControl)) return false;
  if (vary.trim() === "*" || /cookie|authorization|x-session-token/i.test(vary)) return false;
  return true;
}

const SAME_ORIGIN_IMAGE_PREFIX = "/question-images/";

function isSupabaseStorageHost(hostname: string): boolean {
  return hostname === "supabase.co" || hostname.endsWith(".supabase.co");
}

/**
 * Only question images are ever warmed: same-origin /question-images/ files and
 * https Supabase storage URLs. API, account and report paths never qualify.
 */
export function isWarmableImageUrl(url: string, origin: string): boolean {
  try {
    const base = new URL(origin);
    const parsed = new URL(url, base);
    if (parsed.origin === base.origin) return parsed.pathname.startsWith(SAME_ORIGIN_IMAGE_PREFIX);
    return (
      parsed.protocol === "https:" &&
      isSupabaseStorageHost(parsed.hostname) &&
      parsed.pathname.includes("/storage/")
    );
  } catch {
    return false;
  }
}

export function collectImageUrls(
  questions: readonly ImageSource[],
  origin: string,
  maxImages: number = DEFAULT_MAX_IMAGES,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const question of questions) {
    const candidates = [question.image_url, ...(question.image_urls ?? [])];
    for (const raw of candidates) {
      if (typeof raw !== "string") continue;
      const url = raw.trim();
      if (!url || seen.has(url) || !isWarmableImageUrl(url, origin)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= maxImages) return out;
    }
  }
  return out;
}

export interface WarmResult {
  cached: number;
  skipped: number;
  failed: number;
}

/** Fetches missing images with bounded concurrency; one failure never aborts the rest. */
export async function warmImageCache(opts: {
  cache: CacheLike;
  fetchFn: FetchLike;
  urls: readonly string[];
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<WarmResult> {
  const { cache, fetchFn, urls, signal } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const result: WarmResult = { cached: 0, skipped: 0, failed: 0 };
  let next = 0;

  async function worker(): Promise<void> {
    while (next < urls.length) {
      if (signal?.aborted) return;
      const url = urls[next++];
      try {
        if (await cache.match(url)) {
          result.skipped++;
          continue;
        }
        const response = await fetchFn(url, { credentials: "omit", signal });
        const crossOrigin = !url.startsWith(SAME_ORIGIN_IMAGE_PREFIX);
        if (!isStorableImageResponse(response, { requirePublic: crossOrigin })) {
          result.skipped++;
          continue;
        }
        await cache.put(url, response.clone());
        result.cached++;
      } catch {
        result.failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return result;
}

export interface SwContainerLike {
  controller: { postMessage(message: unknown): void } | null;
  /** Needed in browsers: a container queues messages until startMessages() or onmessage. */
  startMessages?(): void;
  addEventListener(type: "message", listener: (event: { data?: { type?: string; buildId?: string } }) => void): void;
  removeEventListener(type: "message", listener: (event: { data?: { type?: string; buildId?: string } }) => void): void;
}

/** Asks the controlling worker for its build id (GET_BUILD_ID/BUILD_ID protocol); null on timeout. */
export function requestBuildId(container: SwContainerLike, timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    if (!container.controller) {
      resolve(null);
      return;
    }
    const finish = (value: string | null) => {
      clearTimeout(timer);
      container.removeEventListener("message", listener);
      resolve(value);
    };
    const listener = (event: { data?: { type?: string; buildId?: string } }) => {
      if (event.data?.type === "BUILD_ID" && typeof event.data.buildId === "string") finish(event.data.buildId);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    container.addEventListener("message", listener);
    container.startMessages?.();
    container.controller.postMessage({ type: "GET_BUILD_ID" });
  });
}
