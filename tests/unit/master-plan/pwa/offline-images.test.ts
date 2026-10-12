import { describe, expect, it, vi } from "vitest";
import {
  cacheNameForBuild,
  collectImageUrls,
  isStorableImageResponse,
  isWarmableImageUrl,
  requestBuildId,
  warmImageCache,
  type ResponseLike,
  type SwContainerLike,
} from "@/lib/master-pwa/offline-images";

const ORIGIN = "https://www.medpruef.com";
const SUPA = "https://abc.supabase.co/storage/v1/object/public/q/1.png";

function resp(ok: boolean, headers: Record<string, string> = {}): ResponseLike {
  const r: ResponseLike = { ok, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, clone: () => r };
  return r;
}

describe("collectImageUrls", () => {
  it("dedupes, trims, filters foreign hosts and caps", () => {
    const urls = collectImageUrls(
      [
        { image_url: "/question-images/a.png", image_urls: [SUPA, "/question-images/a.png"] },
        { image_url: " /question-images/b.png " },
        { image_url: "https://evil.example/x.png" },
        { image_url: "javascript:alert(1)" },
        { image_url: null, image_urls: null },
      ],
      ORIGIN,
    );
    expect(urls).toEqual(["/question-images/a.png", SUPA, "/question-images/b.png"]);
    expect(collectImageUrls([{ image_urls: [SUPA, "/a.png", "/b.png"] }], ORIGIN, 2)).toHaveLength(2);
  });
  it("warmable rule", () => {
    expect(isWarmableImageUrl(SUPA, ORIGIN)).toBe(true);
    expect(isWarmableImageUrl("https://abc.supabase.co/rest/v1/x", ORIGIN)).toBe(false);
  });
});

describe("isStorableImageResponse", () => {
  it("rejects private, no-store, vary cookie and not ok", () => {
    expect(isStorableImageResponse(resp(true, { "cache-control": "public, max-age=60" }))).toBe(true);
    expect(isStorableImageResponse(resp(true, { "cache-control": "private" }))).toBe(false);
    expect(isStorableImageResponse(resp(true, { vary: "Cookie" }))).toBe(false);
    expect(isStorableImageResponse(resp(false))).toBe(false);
  });
});

describe("warmImageCache", () => {
  it("caches missing, skips present and unstorable, counts failures, bounds concurrency", async () => {
    const stored: string[] = [];
    const cache = {
      match: async (u: string) => (u === "/have.png" ? {} : undefined),
      put: async (u: string) => void stored.push(u),
    };
    let live = 0;
    let peak = 0;
    const fetchFn = vi.fn(async (u: string) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      if (u === "/boom.png") throw new Error("net");
      if (u === "/private.png") return resp(true, { "cache-control": "private" });
      return resp(true);
    });
    const result = await warmImageCache({
      cache,
      fetchFn,
      urls: ["/a.png", "/have.png", "/boom.png", "/private.png", "/b.png", "/c.png"],
      concurrency: 2,
    });
    expect(result).toEqual({ cached: 3, skipped: 2, failed: 1 });
    expect(stored.sort()).toEqual(["/a.png", "/b.png", "/c.png"]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(fetchFn).not.toHaveBeenCalledWith("/have.png", expect.anything());
  });
  it("stops when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await warmImageCache({
      cache: { match: async () => undefined, put: async () => {} },
      fetchFn: async () => resp(true),
      urls: ["/a.png"],
      signal: ac.signal,
    });
    expect(r).toEqual({ cached: 0, skipped: 0, failed: 0 });
  });
});

describe("build cache naming", () => {
  it("matches the service worker cache name", () => {
    expect(cacheNameForBuild("abc123")).toBe("medpruef-abc123");
  });
  it("requestBuildId resolves from the worker reply and times out without one", async () => {
    let listener: ((e: { data?: { type?: string; buildId?: string } }) => void) | null = null;
    const container: SwContainerLike = {
      controller: {
        postMessage: (m) => {
          if ((m as { type: string }).type === "GET_BUILD_ID") setTimeout(() => listener?.({ data: { type: "BUILD_ID", buildId: "dev-local" } }), 1);
        },
      },
      addEventListener: (_t, l) => void (listener = l),
      removeEventListener: () => void (listener = null),
    };
    expect(await requestBuildId(container, 200)).toBe("dev-local");
    expect(await requestBuildId({ ...container, controller: null })).toBeNull();
    const silent: SwContainerLike = { controller: { postMessage: () => {} }, addEventListener: () => {}, removeEventListener: () => {} };
    expect(await requestBuildId(silent, 20)).toBeNull();
  });
});
