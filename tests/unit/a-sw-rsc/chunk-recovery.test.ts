import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_BLOCKED_TAG,
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  RELOAD_SETTLE_MS,
  __resetChunkRecovery,
  decideChunkReload,
  handleChunkLoadError,
  isChunkLoadError,
  shouldDropChunkEvent,
  type StorageLike,
} from "@/lib/master-pwa/chunk-recovery";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

beforeEach(() => __resetChunkRecovery());

describe("isChunkLoadError", () => {
  it.each([
    Object.assign(new Error("Loading chunk 4821 failed.\n(error: https://medpruf.com/_next/static/chunks/4821.js)"), { name: "ChunkLoadError" }),
    new Error("Loading chunk app/quiz/page failed."),
    new Error("Loading CSS chunk 12 failed."),
    new TypeError("Failed to fetch dynamically imported module: https://medpruf.com/_next/static/chunks/x.js"),
    new TypeError("error loading dynamically imported module: https://medpruf.com/_next/static/chunks/x.js"),
    new TypeError("Importing a module script failed."),
    { name: "ChunkLoadError", message: "" },
    "Loading chunk 9 failed.",
  ])("recognises %s", (err) => expect(isChunkLoadError(err)).toBe(true));

  it.each([new Error("boom"), new TypeError("Failed to fetch"), null, undefined, 42, { message: "Unauthorized" }])(
    "ignores %s",
    (err) => expect(isChunkLoadError(err)).toBe(false),
  );
});

describe("decideChunkReload", () => {
  it("reloads the first time and stamps the time", () => {
    const s = memoryStorage();
    expect(decideChunkReload(s, 1_000_000)).toBe("reload");
    expect(s.data.get(CHUNK_RELOAD_KEY)).toBe("1000000");
  });

  it("blocks a second reload inside 10 minutes and allows one after", () => {
    const s = memoryStorage();
    decideChunkReload(s, 1_000_000);
    expect(decideChunkReload(s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe("blocked");
    expect(decideChunkReload(s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS)).toBe("reload");
  });

  it("blocks when storage is missing, throws or drops writes (a loop could not be ruled out)", () => {
    expect(decideChunkReload(null, 1)).toBe("blocked");
    expect(decideChunkReload({ getItem: () => { throw new Error("denied"); }, setItem: () => undefined }, 1)).toBe("blocked");
    expect(decideChunkReload({ getItem: () => null, setItem: () => undefined }, 1)).toBe("blocked");
  });

  it("a garbage stamp does not block", () => {
    const s = memoryStorage();
    s.data.set(CHUNK_RELOAD_KEY, "nope");
    expect(decideChunkReload(s, 5)).toBe("reload");
  });
});

describe("handleChunkLoadError", () => {
  const chunk = Object.assign(new Error("Loading chunk 1 failed."), { name: "ChunkLoadError" });

  it("reloads once without reporting, then reports a blocked repeat once", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const report = vi.fn();
    let now = 10_000;
    const deps = { storage, now: () => now, reload, report };

    expect(handleChunkLoadError(chunk, deps)).toBe("reload");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();

    // The page reloaded: a fresh module state, the same tab storage.
    __resetChunkRecovery();
    now += 60_000;
    expect(handleChunkLoadError(chunk, deps)).toBe("blocked");
    expect(handleChunkLoadError(chunk, deps)).toBe("blocked");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a second sighting of the same failure during the reload neither reloads again nor reports", () => {
    const deps = { storage: memoryStorage(), now: () => 1, reload: vi.fn(), report: vi.fn() };
    handleChunkLoadError(chunk, deps);
    expect(handleChunkLoadError(chunk, deps)).toBe("reload");
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("offline: the reload is not spent and nothing is reported; it runs once back online", () => {
    const storage = memoryStorage();
    let offline = true;
    let onOnline: (() => void) | undefined;
    const deps = {
      storage, now: () => 50, reload: vi.fn(), report: vi.fn(),
      isOffline: () => offline,
      onceOnline: vi.fn((cb: () => void) => { onOnline = cb; }),
    };
    expect(handleChunkLoadError(chunk, deps)).toBe("offline");
    expect(handleChunkLoadError(chunk, deps)).toBe("offline");
    expect(deps.onceOnline).toHaveBeenCalledTimes(1);
    expect(storage.data.has(CHUNK_RELOAD_KEY)).toBe(false);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
    offline = false;
    onOnline!();
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(storage.data.get(CHUNK_RELOAD_KEY)).toBe("50");
  });

  it("a reload cancelled at a leave-page prompt does not silence later failures", () => {
    let now = 1_000;
    const deps = { storage: memoryStorage(), now: () => now, reload: vi.fn(), report: vi.fn() };
    expect(handleChunkLoadError(chunk, deps)).toBe("reload");
    now += RELOAD_SETTLE_MS;
    // Still on the same page: the guard now blocks and reports once.
    expect(handleChunkLoadError(chunk, deps)).toBe("blocked");
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledTimes(1);
  });

  it("other errors are left to the caller", () => {
    const deps = { storage: memoryStorage(), now: () => 1, reload: vi.fn(), report: vi.fn() };
    expect(handleChunkLoadError(new Error("boom"), deps)).toBe("ignored");
    expect(deps.reload).not.toHaveBeenCalled();
  });
});

describe("shouldDropChunkEvent (Sentry beforeSend)", () => {
  it("drops untagged chunk events, keeps the tagged blocked event and every other error", () => {
    const chunk = new Error("Failed to fetch dynamically imported module: x");
    expect(shouldDropChunkEvent({}, chunk)).toBe(true);
    expect(shouldDropChunkEvent({ exception: { values: [{ type: "ChunkLoadError", value: "" }] } }, undefined)).toBe(true);
    expect(shouldDropChunkEvent({ tags: { [CHUNK_RELOAD_BLOCKED_TAG]: "true" } }, chunk)).toBe(false);
    expect(shouldDropChunkEvent({ exception: { values: [{ type: "Error", value: "boom" }] } }, new Error("boom"))).toBe(false);
  });
});
