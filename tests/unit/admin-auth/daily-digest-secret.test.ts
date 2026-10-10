import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ safeEqualCalls: 0, dbReached: 0 }));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/security/timing-safe", async (orig) => {
  const actual = await orig<typeof import("@/lib/security/timing-safe")>();
  return {
    safeEqual: (a: unknown, b: unknown) => {
      h.safeEqualCalls += 1;
      return actual.safeEqual(a, b);
    },
  };
});
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.dbReached += 1;
    throw new Error("db down (test)");
  },
}));

import { GET } from "@/app/api/cron/daily-digest/route";

const call = (authorization?: string) =>
  GET(new NextRequest("https://medpruf.test/api/cron/daily-digest", authorization === undefined ? undefined : { headers: { authorization } }));

beforeEach(() => {
  h.safeEqualCalls = 0;
  h.dbReached = 0;
  process.env.CRON_SECRET = "cron-secret-value";
});

describe("daily-digest cron secret check", () => {
  it("rejects a missing header, a wrong secret and a near miss with 401, never reaching the DB", async () => {
    for (const header of [undefined, "", "Bearer wrong", "Bearer [secret]", "cron-secret-value", "Bearer [secret] x"]) {
      const res = await call(header);
      expect(res.status, String(header)).toBe(401);
    }
    expect(h.dbReached).toBe(0);
  });

  it("fails closed when CRON_SECRET is unset, even with an empty bearer", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("")).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect(h.dbReached).toBe(0);
  });

  it("accepts the right secret (reaches the handler body) and compares via safeEqual", async () => {
    const res = await call("Bearer [secret]");
    expect(res.status).toBe(500); // body reached; the stubbed DB throws
    expect(h.dbReached).toBe(1);
    expect(h.safeEqualCalls).toBeGreaterThan(0);
  });
});
