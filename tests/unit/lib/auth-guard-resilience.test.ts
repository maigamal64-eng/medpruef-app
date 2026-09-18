import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServiceClient: vi.fn(),
  lookup: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.getServiceClient }));
vi.mock("@/lib/session", () => ({
  SESSION_HEADER: "x-session-token",
  verifySession: mocks.verifySession,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-09-18T09:00:00Z");
const row = {
  id: USER_ID,
  role: "user",
  tier: "pro",
  tier_expires_at: "2026-10-18T09:00:00Z",
  is_banned: false,
  session_invalidated_at: null,
};

let guards: typeof import("@/lib/auth-guard");
const request = () => new NextRequest("http://localhost/api/test", {
  headers: { "x-session-token": "unit-test-token" },
});

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("SUPABASE_DEGRADED_MODE", "false");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.verifySession.mockReturnValue({ userId: USER_ID, issuedAtMs: NOW - 60_000 });
  mocks.lookup.mockResolvedValue({ data: { ...row }, error: null });
  mocks.getServiceClient.mockImplementation(() => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) }),
  }));
  guards = await import("@/lib/auth-guard");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authorization during and after a database incident", () => {
  it("rechecks bans immediately outside explicit degraded mode", async () => {
    await guards.requireUser(request());
    mocks.lookup.mockResolvedValue({ data: { ...row, is_banned: true }, error: null });
    const result = await guards.requireUser(request());
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect("error" in result && result.error.status).toBe(403);
  });

  it("rechecks session invalidation in normal mode", async () => {
    await guards.requireUser(request());
    mocks.lookup.mockResolvedValue({
      data: { ...row, session_invalidated_at: new Date(NOW).toISOString() }, error: null,
    });
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(401);
    if ("error" in result) expect((await result.error.json()).code).toBe("REFRESH_REQUIRED");
  });

  it("only reuses a recently verified ordinary user in explicit degraded mode", async () => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
    expect(await guards.requireUser(request())).toMatchObject({ userId: USER_ID, role: "user" });
    expect(await guards.requireUser(request())).toMatchObject({ userId: USER_ID, role: "user" });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it("discards emergency cache when degraded mode is turned off", async () => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
    await guards.requireUser(request());
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "false");
    mocks.lookup.mockResolvedValue({ data: { ...row, is_banned: true }, error: null });
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(403);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it.each(["false", "true"])("returns retryable 503 for a DB timeout with degraded mode %s", async (mode) => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", mode);
    mocks.lookup.mockResolvedValue({ data: null, error: { code: "57014", message: "statement timeout" } });
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(503);
    if ("error" in result) expect(result.error.headers.get("Retry-After")).toBe("30");
  });

  it("does not report server-side database configuration errors as an invalid user session", async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: { code: "PGRST002", message: "Schema cache unavailable" } });
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(503);
  });

  it("never admits a user using an expired emergency cache", async () => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
    await guards.requireUser(request());
    vi.setSystemTime(NOW + 30_001);
    mocks.lookup.mockResolvedValue({ data: null, error: { status: 504 } });
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(503);
  });

  it("repopulates the emergency cache after a successful expired lookup", async () => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
    await guards.requireUser(request());
    vi.setSystemTime(NOW + 30_001);
    await guards.requireUser(request());
    await guards.requireUser(request());
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("does not extend the cache lifetime on cache hits", async () => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
    await guards.requireUser(request());
    vi.setSystemTime(NOW + 20_000);
    await guards.requireUser(request());
    vi.setSystemTime(NOW + 30_001);
    mocks.lookup.mockResolvedValue({ data: { ...row, is_banned: true }, error: null });
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(403);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("a failed fresh admin check invalidates a cached ordinary-user row", async () => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
    await guards.requireUser(request());
    mocks.lookup.mockResolvedValue({ data: null, error: { status: 504 } });
    await guards.requireAdmin(request());
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(503);
    expect(mocks.lookup).toHaveBeenCalledTimes(3);
  });

  it("rechecks a paid-tier downgrade immediately in normal mode", async () => {
    await guards.requireUser(request());
    mocks.lookup.mockResolvedValue({ data: { ...row, tier: "free" }, error: null });
    const result = await guards.requireUser(request());
    expect(result).toMatchObject({ tier: "free" });
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it.each([{ role: "admin", tier: "free" }, { role: "user", tier: "admin" }])(
    "never caches a privileged identity: %j", async (privileges) => {
      vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
      mocks.lookup.mockResolvedValue({ data: { ...row, ...privileges }, error: null });
      await guards.requireUser(request());
      mocks.lookup.mockResolvedValue({ data: null, error: { status: 504 } });
      const result = await guards.requireUser(request());
      expect("error" in result && result.error.status).toBe(503);
      expect(mocks.lookup).toHaveBeenCalledTimes(2);
    },
  );

  it("admin checks bypass a cached ordinary-user row and stay fail-closed", async () => {
    vi.stubEnv("SUPABASE_DEGRADED_MODE", "true");
    await guards.requireUser(request());
    mocks.lookup.mockResolvedValue({ data: null, error: { status: 504 } });
    const result = await guards.requireAdmin(request());
    expect("error" in result && result.error.status).toBe(503);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("a synchronous client initialization failure does not poison later lookups", async () => {
    mocks.getServiceClient.mockImplementationOnce(() => { throw new Error("Missing configuration"); });
    const first = await guards.requireUser(request());
    expect("error" in first && first.error.status).toBe(503);
    expect(await guards.requireUser(request())).toMatchObject({ userId: USER_ID });
    expect(mocks.getServiceClient).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent lookups, but not subsequent normal-mode requests", async () => {
    let resolveLookup!: (value: { data: typeof row; error: null }) => void;
    mocks.lookup.mockReturnValueOnce(new Promise((resolve) => { resolveLookup = resolve; }));
    const first = guards.requireUser(request());
    const second = guards.requireUser(request());
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    resolveLookup({ data: { ...row }, error: null });
    await Promise.all([first, second]);
    await guards.requireUser(request());
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("still rejects a missing signed session before any database access", async () => {
    mocks.verifySession.mockReturnValue(null);
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("still returns 401 when the verified account no longer exists", async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: null });
    const result = await guards.requireUser(request());
    expect("error" in result && result.error.status).toBe(401);
  });
});
