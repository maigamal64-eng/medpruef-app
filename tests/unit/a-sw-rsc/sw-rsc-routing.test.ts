/**
 * a-sw-rsc: the generated service worker never answers an App Router RSC
 * request from Cache Storage, serves cache-first only allowlisted static
 * files, and its activate step removes RSC entries an older worker stored.
 * Evaluated from the real route body (same pattern as sw-image-budget).
 */
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/sw/route";

const ORIGIN = "https://medpruf.com";

type Handler = (event: unknown) => void;

class FakeCache {
  entries = new Map<string, { request: Request; response: Response }>();
  async keys() { return [...this.entries.values()].map((e) => e.request); }
  async match(req: Request | string) { return this.entries.get(typeof req === "string" ? req : req.url)?.response; }
  async put(req: Request | string, res: Response) {
    const request = typeof req === "string" ? new Request(req) : req;
    this.entries.set(request.url, { request, response: res });
  }
  async delete(req: Request | string) { return this.entries.delete(typeof req === "string" ? req : req.url); }
  async add() { /* precache: ignored */ }
}

async function boot() {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, FakeCache>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new FakeCache());
    return stores.get(name)!;
  };
  const caches = {
    open: vi.fn(open),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: Request | string) => {
      for (const c of stores.values()) {
        const hit = await c.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const fetchSpy = vi.fn(async () => new Response("net", { headers: { "content-type": "image/png" } }));
  const body = await (await GET()).text();
  const ctx = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (name: string, fn: Handler) => { handlers[name] = fn; },
      clients: { claim: async () => undefined, matchAll: async () => [] },
    },
    URL, Request, Response, Headers, AbortController, setTimeout, clearTimeout,
    caches,
    fetch: fetchSpy,
  };
  runInNewContext(body, ctx);
  const cacheName = /const CACHE_NAME = "([^"]+)"/.exec(body)![1];
  const imageCache = /const OFFLINE_IMAGE_CACHE = "([^"]+)"/.exec(body)![1];

  const dispatch = (path: string, opts: { headers?: Record<string, string>; mode?: string } = {}) => {
    let responded: Promise<Response> | undefined;
    handlers.fetch({
      request: new Proxy(new Request(path.startsWith("http") ? path : ORIGIN + path, { headers: opts.headers }), {
        get(target, prop) {
          if (prop === "mode") return opts.mode ?? "cors";
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      }),
      respondWith: (p: Promise<Response>) => { responded = p; },
    });
    return responded;
  };
  const activate = async () => {
    let done: Promise<unknown> | undefined;
    handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  };
  return { dispatch, activate, stores, open, cacheName, imageCache, fetchSpy };
}

describe("RSC requests bypass the service worker", () => {
  it.each([
    ["?_rsc query", "/quiz?_rsc=abc12", {}],
    ["RSC header", "/admin/users", { RSC: "1" }],
    ["router state header", "/quiz", { "Next-Router-State-Tree": "%5B%22%22%5D" }],
    ["prefetch header", "/library", { "Next-Router-Prefetch": "1", RSC: "1" }],
    ["flight accept", "/progress", { Accept: "text/x-component" }],
  ])("%s: no respondWith, so the network (and skew protection) answers", async (_name, path, headers) => {
    const { dispatch, fetchSpy } = await boot();
    expect(dispatch(path, { headers })).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an RSC request whose path looks static still bypasses (the query wins)", async () => {
    const { dispatch } = await boot();
    expect(dispatch("/brand/logo.png?_rsc=x")).toBeUndefined();
  });

  it("a stored RSC copy from an older worker is never served", async () => {
    const { dispatch, open, cacheName } = await boot();
    (await open(cacheName)).put(ORIGIN + "/quiz?_rsc=abc12", new Response("0:old-flight", { headers: { "content-type": "text/x-component" } }));
    expect(dispatch("/quiz?_rsc=abc12", { headers: { RSC: "1" } })).toBeUndefined();
  });
});

describe("cache-first is an allowlist", () => {
  it.each(["/brand/icon-192.png", "/favicon.ico", "/manifest.json", "/apple-touch-icon.png", "/question-images/placeholder-medical.svg", "/fonts/inter.woff2", "/x/Photo.JPG"])(
    "%s is answered by the worker and stored",
    async (path) => {
      const { dispatch, stores, cacheName } = await boot();
      const p = dispatch(path);
      expect(p).toBeDefined();
      expect(await (await p!).text()).toBe("net");
      await new Promise((r) => setTimeout(r, 0));
      expect(stores.get(cacheName)?.entries.has(ORIGIN + path)).toBe(true);
    },
  );

  it("a second request for a static file comes from the cache", async () => {
    const { dispatch, fetchSpy } = await boot();
    await dispatch("/brand/icon-192.png");
    await new Promise((r) => setTimeout(r, 0));
    const again = await dispatch("/brand/icon-192.png")!;
    expect(await again.text()).toBe("net");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["/quiz", "/admin/users", "/llms.txt", "/robots.txt", "/sitemap.xml", "/openapi.json", "/.well-known/api-catalog", "/some/page"])(
    "%s (fetch, not a navigation) is left to the network",
    async (path) => {
      const { dispatch, fetchSpy } = await boot();
      expect(dispatch(path, { headers: { Accept: "*/*" } })).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("navigations still go network-first with the offline fallback", async () => {
    const { dispatch } = await boot();
    expect(dispatch("/quiz", { mode: "navigate", headers: { Accept: "text/html" } })).toBeDefined();
  });

  it("a static path answered with HTML or a flight is not stored", async () => {
    const { dispatch, stores, cacheName, fetchSpy } = await boot();
    fetchSpy.mockImplementationOnce(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
    await dispatch("/brand/missing.png");
    fetchSpy.mockImplementationOnce(async () => new Response("0:x", { headers: { "content-type": "text/x-component" } }));
    await dispatch("/brand/other.png");
    await new Promise((r) => setTimeout(r, 0));
    expect(stores.get(cacheName)?.entries.size ?? 0).toBe(0);
  });
});

describe("activate removes RSC entries and keeps the rest", () => {
  it("deletes _rsc and text/x-component entries in the build cache, keeps the offline page, icons and the image cache", async () => {
    const { activate, open, stores, cacheName, imageCache } = await boot();
    const build = await open(cacheName);
    await build.put(ORIGIN + "/offline.html", new Response("<html>offline</html>", { headers: { "content-type": "text/html" } }));
    await build.put(ORIGIN + "/brand/icon-192.png", new Response("png", { headers: { "content-type": "image/png" } }));
    await build.put(ORIGIN + "/quiz?_rsc=abc12", new Response("0:x", { headers: { "content-type": "text/x-component" } }));
    await build.put(ORIGIN + "/admin/users", new Response("0:y", { headers: { "content-type": "text/x-component; charset=utf-8" } }));
    await build.put(ORIGIN + "/progress?_rsc=zz", new Response("weird", { headers: { "content-type": "text/plain" } }));
    const images = await open(imageCache);
    await images.put("https://abc.supabase.co/storage/v1/object/public/question-images/1.png", new Response("img", { headers: { "content-type": "image/png" } }));
    const old = await open("medpruef-oldbuild");
    await old.put(ORIGIN + "/quiz?_rsc=old", new Response("0:z", { headers: { "content-type": "text/x-component" } }));

    await activate();

    expect([...stores.keys()].sort()).toEqual([cacheName, imageCache].sort());
    expect([...stores.get(cacheName)!.entries.keys()].sort()).toEqual([ORIGIN + "/brand/icon-192.png", ORIGIN + "/offline.html"]);
    expect(stores.get(imageCache)!.entries.size).toBe(1);
  });

  it("a failing sweep never blocks activation", async () => {
    const { activate, open, cacheName } = await boot();
    const build = await open(cacheName);
    build.keys = async () => { throw new Error("quota"); };
    await expect(activate()).resolves.toBeUndefined();
  });
});

it("CACHE_NAME is derived from the build id, never the clock", async () => {
  const a = await (await GET()).text();
  await new Promise((r) => setTimeout(r, 5));
  const b = await (await GET()).text();
  expect(a).toBe(b);
  expect(a).toMatch(/const CACHE_NAME = "medpruef-[^"]+";/);
});
