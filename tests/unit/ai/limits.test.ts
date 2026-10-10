import { describe, it, expect, vi } from "vitest";
import {
  LEGACY_LIMIT_DEFAULTS,
  checkGlobalSpend,
  checkLegacyUserCap,
  dailyAttemptLimit,
  getLegacyAiLimits,
  interpretQuotaTake,
  parseMicro,
  readNonNegativeInt,
  takeAiQuota,
  utcMonthKey,
  type RpcClient,
} from "@/lib/ai/limits";

const UID = "11111111-1111-1111-1111-111111111111";

function client(impl: (fn: string, args?: Record<string, unknown>) => { data: unknown; error: unknown }): RpcClient & {
  rpc: ReturnType<typeof vi.fn>;
} {
  return { rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => impl(fn, args)) };
}

describe("legacy limits config", () => {
  it("defaults to the contract values", () => {
    expect(getLegacyAiLimits({})).toEqual({
      chatDailyAttempts: 15,
      translateDailyAttempts: 40,
      transformDailyAttempts: 30,
      userMonthlyCapMicro: 3_000_000,
    });
    expect(LEGACY_LIMIT_DEFAULTS.userMonthlyCapMicro).toBe(3_000_000);
  });

  it("reads env at call time and honours 0", () => {
    const env = {
      AI_CHAT_DAILY_ATTEMPTS: "20",
      AI_TRANSLATE_DAILY_ATTEMPTS: "0",
      AI_TRANSFORM_DAILY_ATTEMPTS: " 7 ",
      AI_LEGACY_USER_MONTHLY_CAP_MICRO: "5000000",
    };
    expect(getLegacyAiLimits(env)).toEqual({
      chatDailyAttempts: 20,
      translateDailyAttempts: 0,
      transformDailyAttempts: 7,
      userMonthlyCapMicro: 5_000_000,
    });
  });

  it("falls back on junk values", () => {
    for (const bad of ["", "abc", "-3", "1.5", "1e3", "99999999999999999999"]) {
      expect(readNonNegativeInt(bad, 15)).toBe(15);
    }
    expect(readNonNegativeInt(undefined, 15)).toBe(15);
  });

  it("maps routes to their daily limits", () => {
    const l = getLegacyAiLimits({});
    expect(dailyAttemptLimit("ai_chat", l)).toBe(15);
    expect(dailyAttemptLimit("translate", l)).toBe(40);
    expect(dailyAttemptLimit("notes_transform", l)).toBe(30);
  });
});

describe("ai_quota_take caller (fails closed)", () => {
  it("passes the contract arguments and returns ok with used", async () => {
    const c = client(() => ({ data: { ok: true, used: 3 }, error: null }));
    await expect(takeAiQuota(c, UID, "ai_chat", 15)).resolves.toEqual({ ok: true, used: 3 });
    expect(c.rpc).toHaveBeenCalledWith("ai_quota_take", { p_user: UID, p_route: "ai_chat", p_limit: 15 });
  });

  it("limit reached is a denial with the used count", async () => {
    const c = client(() => ({ data: { ok: false, used: 15, reason: "limit_reached" }, error: null }));
    await expect(takeAiQuota(c, UID, "ai_chat", 15)).resolves.toEqual({ ok: false, used: 15, reason: "limit_reached" });
  });

  it("DB error, thrown client, or odd shapes all deny", async () => {
    const cases: Array<() => { data: unknown; error: unknown }> = [
      () => ({ data: null, error: { message: "boom" } }),
      () => {
        throw new Error("network");
      },
      () => ({ data: null, error: null }),
      () => ({ data: "yes", error: null }),
      () => ({ data: { ok: "true", used: 1 }, error: null }),
      () => ({ data: { ok: true }, error: null }),
      () => ({ data: { ok: true, used: -1 }, error: null }),
      () => ({ data: { ok: false, used: null, reason: "db_error", sqlstate: "42501" }, error: null }),
    ];
    for (const impl of cases) {
      const r = await takeAiQuota(client(impl), UID, "ai_chat", 15);
      expect(r.ok).toBe(false);
    }
  });

  it("accepts a one-element array reply (PostgREST variant)", () => {
    expect(interpretQuotaTake([{ ok: true, used: 1 }], null)).toEqual({ ok: true, used: 1 });
  });

  it("limit below 1 and bad arguments never reach the DB", async () => {
    const c = client(() => ({ data: { ok: true, used: 1 }, error: null }));
    expect(await takeAiQuota(c, UID, "ai_chat", 0)).toEqual({ ok: false, used: null, reason: "limit_reached" });
    expect(await takeAiQuota(c, "", "ai_chat", 5)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(await takeAiQuota(c, UID, "Bad-Route", 5)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(await takeAiQuota(c, UID, "ai_chat", 1.5)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(c.rpc).not.toHaveBeenCalled();
  });
});

describe("spend checks (fail closed)", () => {
  it("parses bigint replies as numbers or numeric strings", () => {
    expect(parseMicro(511801)).toBe(511801);
    expect(parseMicro("50000000")).toBe(50_000_000); // node-postgres style int8 string (seen in the prod shape check)
    expect(parseMicro([42])).toBe(42);
    expect(parseMicro("-1")).toBeNull();
    expect(parseMicro(null)).toBeNull();
    expect(parseMicro(1.5)).toBeNull();
  });

  it("legacy user cap: allowed strictly below the cap", async () => {
    const limits = getLegacyAiLimits({});
    expect(await checkLegacyUserCap(client(() => ({ data: 2_999_999, error: null })), UID, limits)).toMatchObject({ ok: true });
    expect(await checkLegacyUserCap(client(() => ({ data: "3000000", error: null })), UID, limits)).toMatchObject({
      ok: false,
      reason: "cap_reached",
    });
    expect(await checkLegacyUserCap(client(() => ({ data: null, error: { m: 1 } })), UID, limits)).toMatchObject({
      ok: false,
      reason: "db_error",
    });
    expect(await checkLegacyUserCap(client(() => ({ data: {}, error: null })), UID, limits)).toMatchObject({
      ok: false,
      reason: "bad_response",
    });
  });

  it("global spend: month key in UTC, optional floor/pct passed through, denies at the cap", async () => {
    const calls: Array<[string, unknown]> = [];
    const c = client((fn, args) => {
      calls.push([fn, args]);
      return fn === "ai_spend_month" ? { data: "928119", error: null } : { data: 50_000_000, error: null };
    });
    const r = await checkGlobalSpend(c, { now: new Date("2026-10-31T23:30:00Z"), floorMicro: 50_000_000, netPct: 6 });
    expect(r).toEqual({ ok: true, spentMicro: 928_119, capMicro: 50_000_000 });
    expect(calls).toContainEqual(["ai_spend_month", { p_month: "2026-10" }]);
    expect(calls).toContainEqual(["ai_spend_cap", { p_floor_micro: 50_000_000, p_net_pct: 6 }]);

    const atCap = client((fn) => ({ data: fn === "ai_spend_month" ? 50_000_000 : 50_000_000, error: null }));
    expect(await checkGlobalSpend(atCap)).toMatchObject({ ok: false, reason: "global_cap" });
    const broken = client(() => ({ data: null, error: { message: "x" } }));
    expect(await checkGlobalSpend(broken)).toMatchObject({ ok: false, reason: "db_error" });
  });

  it("utcMonthKey uses the UTC month, not local time", () => {
    expect(utcMonthKey(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(utcMonthKey(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(utcMonthKey(new Date("2027-01-01T00:30:00+02:00"))).toBe("2026-12");
  });
});
