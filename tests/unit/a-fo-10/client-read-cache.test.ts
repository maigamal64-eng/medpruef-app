/**
 * a-fo-10: five-minute, account-keyed client cache for the Sidebar referral
 * status and the announcement state row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANNOUNCEMENT_STATE_CACHE_KEY,
  CLIENT_READ_CACHE_KEYS,
  CLIENT_READ_CACHE_TTL_MS,
  REFERRAL_STATUS_CACHE_KEY,
  readAccountCache,
  writeAccountCache,
} from "@/lib/client-read-cache";
import { clearAccountState } from "@/lib/master-locale/storage-keys";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); return true; },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe("readAccountCache / writeAccountCache", () => {
  it("returns the value only to its owner and only for five minutes", () => {
    const s = memoryStore();
    writeAccountCache(REFERRAL_STATUS_CACHE_KEY, "user-a", { copied: true }, 1_000, s);
    expect(readAccountCache(REFERRAL_STATUS_CACHE_KEY, "user-a", 1_000 + CLIENT_READ_CACHE_TTL_MS - 1, s)).toEqual({ copied: true });
    expect(readAccountCache(REFERRAL_STATUS_CACHE_KEY, "user-a", 1_000 + CLIENT_READ_CACHE_TTL_MS, s)).toBeUndefined();
    expect(readAccountCache(REFERRAL_STATUS_CACHE_KEY, "user-b", 1_001, s)).toBeUndefined();
    expect(readAccountCache(REFERRAL_STATUS_CACHE_KEY, null, 1_001, s)).toBeUndefined();
    // A clock set back never serves an entry "from the future".
    expect(readAccountCache(REFERRAL_STATUS_CACHE_KEY, "user-a", 999, s)).toBeUndefined();
  });

  it("never stores for a guest or an empty owner, and ignores a broken entry", () => {
    const s = memoryStore();
    writeAccountCache(REFERRAL_STATUS_CACHE_KEY, "guest_123", { copied: true }, 1, s);
    writeAccountCache(REFERRAL_STATUS_CACHE_KEY, "", { copied: true }, 1, s);
    expect(s.m.size).toBe(0);
    s.setItem(ANNOUNCEMENT_STATE_CACHE_KEY, "{not json");
    expect(readAccountCache(ANNOUNCEMENT_STATE_CACHE_KEY, "user-a", 2, s)).toBeUndefined();
  });

  it("logout (clearAccountState) removes both caches from the tab store", () => {
    const local = memoryStore();
    const session = memoryStore();
    for (const key of CLIENT_READ_CACHE_KEYS) writeAccountCache(key, "user-a", { x: 1 }, 1, session);
    clearAccountState(local, session);
    expect(session.m.size).toBe(0);
  });
});

const g = vi.hoisted(() => ({ fetch: vi.fn(), owner: "user-a" as string | null, store: new Map<string, string>() }));
vi.mock("@/lib/authFetch", () => ({ authFetch: g.fetch }));
vi.mock("@/lib/auth", () => ({ getStoredSession: () => (g.owner ? { user: { id: g.owner } } : null) }));
vi.mock("@/lib/hooks/useUserTier", () => ({ useUserTier: () => ({}) }));
vi.mock("@/lib/safe-storage", () => {
  const make = () => ({
    getItem: (k: string) => g.store.get(k) ?? null,
    setItem: (k: string, v: string) => { g.store.set(k, v); return true; },
    removeItem: (k: string) => { g.store.delete(k); },
  });
  return { safeStorage: make(), safeSessionStorage: make(), createSafeStorage: make };
});

const gate = await import("@/lib/announcements/useAnnouncementGate");

const row = (userId: string, sessionCount = 3) => ({
  state: {
    userId, sessionCount, qsAnsweredTotal: 30, orientationModalSeenAt: null, cohortBannerDismissedAt: null,
    referralFloaterDismissedAt: null, lastSessionAt: "2026-10-14T00:00:00Z",
  },
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("fetchAnnouncementState with the account cache", () => {
  beforeEach(() => {
    g.store.clear();
    g.owner = "user-a";
    g.fetch.mockReset();
  });

  it("a second page load within five minutes is served from the cache", async () => {
    g.fetch.mockResolvedValue(ok(row("user-a")));
    expect((await gate.fetchAnnouncementState())?.state?.userId).toBe("user-a");
    expect((await gate.fetchAnnouncementState())?.state?.sessionCount).toBe(3);
    expect(g.fetch).toHaveBeenCalledTimes(1);
  });

  it("another account on the same tab fetches its own row", async () => {
    g.fetch.mockResolvedValueOnce(ok(row("user-a"))).mockResolvedValueOnce(ok(row("user-b", 7)));
    await gate.fetchAnnouncementState();
    g.owner = "user-b";
    expect((await gate.fetchAnnouncementState())?.state?.sessionCount).toBe(7);
    expect(g.fetch).toHaveBeenCalledTimes(2);
  });

  it("a forgotten row (after a /seen write) is fetched again; a row for another account is never stored", async () => {
    g.fetch.mockResolvedValue(ok(row("user-a")));
    await gate.fetchAnnouncementState();
    gate.forgetAnnouncementState();
    await gate.fetchAnnouncementState();
    expect(g.fetch).toHaveBeenCalledTimes(2);

    gate.rememberAnnouncementState(row("user-b"));
    await gate.fetchAnnouncementState();
    expect(g.fetch).toHaveBeenCalledTimes(3);
  });

  it("guests and failed reads are never cached", async () => {
    g.owner = null;
    g.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    expect(await gate.fetchAnnouncementState()).toBeNull();
    expect(await gate.fetchAnnouncementState()).toBeNull();
    expect(g.fetch).toHaveBeenCalledTimes(2);
    expect(g.store.size).toBe(0);
  });
});
