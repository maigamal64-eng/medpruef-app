/**
 * a-fo-08 client modules: the sticky quiz pack mode and Home's account-keyed
 * last-good copy. Browser storage is a Map stand-in (vitest runs in node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mapStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: mapStorage(), sessionStorage: mapStorage() });
});
afterEach(() => vi.unstubAllGlobals());

describe("quiz pack mode", () => {
  it("flag: only the literal 'true'", async () => {
    const { isQuizPackFallbackEnabled } = await import("@/lib/quiz-pack-fallback");
    expect(isQuizPackFallbackEnabled({})).toBe(false);
    expect(isQuizPackFallbackEnabled({ NEXT_PUBLIC_QUIZ_PACK_FALLBACK: "1" })).toBe(false);
    expect(isQuizPackFallbackEnabled({ NEXT_PUBLIC_QUIZ_PACK_FALLBACK: "true" })).toBe(true);
  });

  it("is sticky for 10 minutes, per account, and ends early on leave", async () => {
    const { enterPackMode, isPackModeActive, leavePackMode, PACK_MODE_MS } = await import("@/lib/quiz-pack-fallback");
    const t0 = 1_800_000_000_000;
    expect(isPackModeActive("u1", t0)).toBe(false);
    enterPackMode("u1", t0);
    expect(isPackModeActive("u1", t0 + 1)).toBe(true);
    expect(isPackModeActive("u1", t0 + PACK_MODE_MS - 1)).toBe(true);
    expect(isPackModeActive("u1", t0 + PACK_MODE_MS)).toBe(false);
    expect(isPackModeActive("u2", t0 + 1)).toBe(false);
    expect(isPackModeActive(null, t0 + 1)).toBe(false);
    leavePackMode();
    expect(isPackModeActive("u1", t0 + 1)).toBe(false);
  });

  it("survives a blocked session storage in page memory", async () => {
    vi.stubGlobal("window", { get sessionStorage(): Storage { throw new Error("blocked"); } });
    const { enterPackMode, isPackModeActive } = await import("@/lib/quiz-pack-fallback");
    enterPackMode("u1", 1000);
    expect(isPackModeActive("u1", 2000)).toBe(true);
  });

  it("only a deadline or a 5xx moves to the pack, never a 4xx", async () => {
    const { isDeadlineError, isServerFailureStatus } = await import("@/lib/quiz-pack-fallback");
    expect(isDeadlineError(new DOMException("Request timed out", "TimeoutError"))).toBe(true);
    expect(isDeadlineError(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isDeadlineError(new TypeError("Failed to fetch"))).toBe(false);
    for (const s of [500, 502, 503, 504, 520]) expect(isServerFailureStatus(s)).toBe(true);
    for (const s of [200, 401, 402, 404, 409, 429]) expect(isServerFailureStatus(s)).toBe(false);
  });
});

describe("Home last-good copy", () => {
  const ROWS = [{ topic: "Neurologie", total: 100, answered: 40, correct: 30, wrong: 10, accuracy: 75 }];
  const READY = { band: "building" as const, trend: "up" as const, lowestFactor: "coverage" as const };
  const NOW = Date.parse("2026-10-24T12:05:00Z");

  it("flag: only the literal 'true'", async () => {
    const { isHomeLastGoodEnabled } = await import("@/lib/home-last-good");
    expect(isHomeLastGoodEnabled({})).toBe(false);
    expect(isHomeLastGoodEnabled({ NEXT_PUBLIC_HOME_LAST_GOOD: "true" })).toBe(true);
  });

  it("returns the account's own copy for that bank, with its time", async () => {
    const m = await import("@/lib/home-last-good");
    m.writeLastGoodProgress("u1", "kenntnispruefung", ROWS, NOW - 60_000);
    m.writeLastGoodReadiness("u1", "kenntnispruefung", READY, NOW - 30_000);
    expect(m.readLastGoodProgress("u1", "kenntnispruefung", NOW)).toEqual({ at: NOW - 60_000, rows: ROWS });
    expect(m.readLastGoodReadiness("u1", "kenntnispruefung", NOW)).toEqual({ at: NOW - 30_000, value: READY });
    expect(m.readLastGoodProgress("u1", "pharma", NOW)).toBeNull();
  });

  it("a different account never sees it, and its first write replaces the old owner's copy", async () => {
    const m = await import("@/lib/home-last-good");
    m.writeLastGoodProgress("u1", "kenntnispruefung", ROWS, NOW);
    expect(m.readLastGoodProgress("u2", "kenntnispruefung", NOW)).toBeNull();
    expect(m.readLastGoodReadiness("u2", "kenntnispruefung", NOW)).toBeNull();
    m.writeLastGoodReadiness("u2", "kenntnispruefung", READY, NOW);
    expect(m.readLastGoodProgress("u1", "kenntnispruefung", NOW)).toBeNull();
    expect(m.readLastGoodProgress("u2", "kenntnispruefung", NOW)).toBeNull();
  });

  it("guests are never written; copies older than 7 days or malformed are not shown", async () => {
    const m = await import("@/lib/home-last-good");
    m.writeLastGoodProgress("guest_abc", "kenntnispruefung", ROWS, NOW);
    expect(m.readLastGoodProgress("guest_abc", "kenntnispruefung", NOW)).toBeNull();
    m.writeLastGoodProgress("u1", "kenntnispruefung", ROWS, NOW - m.HOME_LAST_GOOD_MAX_AGE_MS - 1);
    expect(m.readLastGoodProgress("u1", "kenntnispruefung", NOW)).toBeNull();
    m.writeLastGoodReadiness("u1", "kenntnispruefung", { ...READY, band: "passed" as never }, NOW);
    expect(m.readLastGoodReadiness("u1", "kenntnispruefung", NOW)).toBeNull();
    window.localStorage.setItem(m.HOME_LAST_GOOD_KEY, "{not json");
    expect(m.readLastGoodProgress("u1", "kenntnispruefung", NOW)).toBeNull();
  });

  it("the label is the Vienna time today and adds the day otherwise", async () => {
    const { lastGoodTime } = await import("@/lib/home-last-good");
    expect(lastGoodTime(NOW - 60_000, "de", NOW)).toBe("14:04");
    expect(lastGoodTime(NOW - 2 * 86_400_000, "de", NOW)).toMatch(/^22\. Okt\.?, 14:05$/);
    expect(lastGoodTime(NOW - 60_000, "en", NOW)).toBe("14:04");
  });

  it("the key is cleared on logout and account switch", async () => {
    const { ACCOUNT_STATE_KEYS } = await import("@/lib/master-locale/storage-keys");
    const { HOME_LAST_GOOD_KEY } = await import("@/lib/home-last-good");
    expect(ACCOUNT_STATE_KEYS as readonly string[]).toContain(HOME_LAST_GOOD_KEY);
  });
});
