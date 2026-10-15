/**
 * a-anthropic-features: the Anthropic workspace spend meter (prod USD 400,
 * dev USD 100 per month), its 70 % alarm and 95 % soft stop for free or
 * house-funded calls, and the places that read it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiWorkspace,
  daysInUtcMonth,
  describeMeter,
  evaluateSpend,
  readDaySpendMicro,
  resetSpendMeterCacheForTests,
  softStopBlocks,
  workspaceCapMicro,
  workspaceSpendMeter,
  type SpendDb,
} from "@/lib/ai/workspace-spend";
import { aggregateFeatureSpend } from "@/lib/ai/feature-spend";
import { buildAlertItems } from "@/lib/admin/action-alerts";
import { hasPaidMentorFunding } from "@/app/api/mentor/chat/handler";

const OCT = new Date("2026-10-14T12:00:00Z"); // 31 days
const CAP = 400_000_000;
const DAY_CAP = Math.floor(CAP / 31);

describe("workspace and caps", () => {
  it("production deployment bills medpruf-prod (USD 400), everything else medpruf-dev (USD 100)", () => {
    expect(aiWorkspace({ VERCEL_ENV: "production" })).toBe("prod");
    expect(aiWorkspace({ VERCEL_ENV: "preview" })).toBe("dev");
    expect(aiWorkspace({})).toBe("dev");
    expect(aiWorkspace({ VERCEL_ENV: "preview", AI_WORKSPACE: "prod" })).toBe("prod");
    expect(workspaceCapMicro("prod", {})).toBe(400_000_000);
    expect(workspaceCapMicro("dev", {})).toBe(100_000_000);
    expect(workspaceCapMicro("prod", { AI_WORKSPACE_CAP_USD: "250" })).toBe(250_000_000);
    for (const bad of ["0", "-5", "abc", "1e9"]) expect(workspaceCapMicro("prod", { AI_WORKSPACE_CAP_USD: bad })).toBe(400_000_000);
  });

  it("the day budget is the month spread evenly", () => {
    expect(daysInUtcMonth(OCT)).toBe(31);
    expect(daysInUtcMonth(new Date("2027-02-10T00:00:00Z"))).toBe(28);
    expect(evaluateSpend({ workspace: "prod", monthCapMicro: CAP, monthMicro: 0, dayMicro: 0, now: OCT }).dayCapMicro).toBe(DAY_CAP);
  });
});

describe("evaluateSpend thresholds", () => {
  const at = (monthMicro: number | null, dayMicro: number | null) => evaluateSpend({ workspace: "prod", monthCapMicro: CAP, monthMicro, dayMicro, now: OCT });

  it("ok below 70 %, alarm from 70 %, soft stop from 95 % (month)", () => {
    expect(at(CAP * 0.69, 0).state).toBe("ok");
    expect(at(CAP * 0.7, 0)).toMatchObject({ state: "alarm", trigger: "month" });
    expect(at(CAP * 0.95 - 1, 0).state).toBe("alarm");
    expect(at(CAP * 0.95, 0)).toMatchObject({ state: "soft_stop", trigger: "month" });
  });

  it("the day meter alarms and stops on its own", () => {
    expect(at(0, Math.ceil(DAY_CAP * 0.7))).toMatchObject({ state: "alarm", trigger: "day" });
    expect(at(0, Math.ceil(DAY_CAP * 0.95))).toMatchObject({ state: "soft_stop", trigger: "day" });
  });

  it("a known stop wins over an unknown figure; unknown alone is 'unknown', never a stop", () => {
    expect(at(CAP, null).state).toBe("soft_stop");
    expect(at(null, 0).state).toBe("unknown");
    expect(at(0, null).state).toBe("unknown");
  });

  it("only house-funded calls stop, only at the soft stop", () => {
    expect(softStopBlocks({ state: "soft_stop" }, "house")).toBe(true);
    expect(softStopBlocks({ state: "soft_stop" }, "paid")).toBe(false);
    expect(softStopBlocks({ state: "alarm" }, "house")).toBe(false);
    expect(softStopBlocks({ state: "unknown" }, "house")).toBe(false);
  });

  it("describeMeter is one line without learner data", () => {
    expect(describeMeter(at(CAP * 0.8, 0))).toBe("AI spend prod: month USD 320.00 of USD 400 (80 %), today USD 0.00 of USD 12.90 (0 %), state alarm");
  });
});

// ─── A fake service client: rpc ai_spend_month + paged selects ────────────

function fakeDb(opts: { month?: number | null; calls?: Array<Record<string, unknown>>; ledger?: Array<Record<string, unknown>>; failTable?: string }) {
  const counts = { rpc: 0, selects: 0 };
  const db = {
    rpc: vi.fn(async (fn: string) => {
      counts.rpc++;
      if (fn !== "ai_spend_month") return { data: null, error: { message: "unexpected" } };
      return opts.month === null ? { data: null, error: { message: "down" } } : { data: opts.month ?? 0, error: null };
    }),
    from(table: string) {
      const rows = table === "ai_call_log" ? opts.calls ?? [] : opts.ledger ?? [];
      return {
        select: () => ({
          gte: () => ({
            order: () => ({
              range: async (from: number, to: number) => {
                counts.selects++;
                if (opts.failTable === table) return { data: null, error: { message: "down" } };
                return { data: rows.slice(from, to + 1), error: null };
              },
            }),
          }),
        }),
      };
    },
  };
  return { db: db as unknown as SpendDb, counts };
}

describe("reading the day spend", () => {
  it("sums Anthropic call-log rows (not mentor-route rows) and mentor consumption", async () => {
    const { db } = fakeDb({
      calls: [
        { provider: "anthropic", route: "translate", cost_usd: "0.001485" },
        { provider: "anthropic", route: "mentor", cost_usd: 1 },
        { provider: "openai", route: "translate", cost_usd: 5 },
        { provider: "anthropic", route: null, cost_usd: 0.000002 },
      ],
      ledger: [
        { kind: "settle", cost_micro: 700 },
        { kind: "house_cost", cost_micro: "300" },
        { kind: "grant", cost_micro: 999_999 },
      ],
    });
    expect(await readDaySpendMicro(db, OCT)).toBe(1485 + 2 + 700 + 300);
  });

  it("a missing mentor ledger (42P01 / PGRST205) counts as no mentor spend, never unknown", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const { db } = fakeDb({ calls: [{ provider: "anthropic", route: "translate", cost_usd: 0.000005 }], failTable: "ai_usage_ledger" });
      const real = db.from.bind(db);
      (db as unknown as { from: SpendDb["from"] }).from = (t: string) =>
        t === "ai_usage_ledger"
          ? ({ select: () => ({ gte: () => ({ order: () => ({ range: async () => ({ data: null, error: { code } }) }) }) }) } as unknown as ReturnType<SpendDb["from"]>)
          : real(t);
      expect(await readDaySpendMicro(db, OCT)).toBe(5);
    }
  });

  it("pages past 1,000 rows and returns null when a table cannot be read", async () => {
    const calls = Array.from({ length: 2500 }, () => ({ provider: "anthropic", route: "translate", cost_usd: 0.000001 }));
    expect(await readDaySpendMicro(fakeDb({ calls }).db, OCT)).toBe(2500);
    expect(await readDaySpendMicro(fakeDb({ failTable: "ai_usage_ledger" }).db, OCT)).toBeNull();
  });
});

describe("workspaceSpendMeter cache and alarm", () => {
  beforeEach(() => resetSpendMeterCacheForTests());
  const env = { VERCEL_ENV: "production" };

  it("reads at most once a minute per instance; fresh skips the cache", async () => {
    const { db, counts } = fakeDb({ month: 1 });
    await workspaceSpendMeter(db, { now: OCT, env });
    await workspaceSpendMeter(db, { now: new Date(OCT.getTime() + 59_000), env });
    expect(counts.rpc).toBe(1);
    await workspaceSpendMeter(db, { now: new Date(OCT.getTime() + 61_000), env });
    expect(counts.rpc).toBe(2);
    await workspaceSpendMeter(db, { now: new Date(OCT.getTime() + 62_000), env, fresh: true });
    expect(counts.rpc).toBe(3);
  });

  it("alarms at most hourly per state, and again when the state rises to the soft stop", async () => {
    const onAlarm = vi.fn();
    await workspaceSpendMeter(fakeDb({ month: CAP * 0.8 }).db, { now: OCT, env, onAlarm });
    await workspaceSpendMeter(fakeDb({ month: CAP * 0.8 }).db, { now: new Date(OCT.getTime() + 120_000), env, onAlarm });
    expect(onAlarm).toHaveBeenCalledTimes(1);
    await workspaceSpendMeter(fakeDb({ month: CAP * 0.96 }).db, { now: new Date(OCT.getTime() + 240_000), env, onAlarm });
    expect(onAlarm).toHaveBeenCalledTimes(2);
    expect(onAlarm.mock.calls[1][0].state).toBe("soft_stop");
  });

  it("never throws: a broken client is an unknown meter", async () => {
    const m = await workspaceSpendMeter({} as SpendDb, { now: OCT, env });
    expect(m.state).toBe("unknown");
  });
});

describe("who keeps working at the soft stop", () => {
  const lot = (source: string, remainingMicro = 1000) => ({ source, remainingMicro, startsAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z" });
  const nowMs = OCT.getTime();

  it("mentor: a live paid lot (Whop payment, Pro included) counts as paid; free taste, beta and gifts do not", () => {
    expect(hasPaidMentorFunding([lot("whop_payment")], nowMs)).toBe(true);
    expect(hasPaidMentorFunding([lot("pro_included")], nowMs)).toBe(true);
    expect(hasPaidMentorFunding([lot("free_taste"), lot("beta_grant"), lot("admin_gift"), lot("trial_taste")], nowMs)).toBe(false);
    expect(hasPaidMentorFunding([lot("whop_payment", 0)], nowMs)).toBe(false);
    expect(hasPaidMentorFunding([{ ...lot("whop_payment"), expiresAt: "2026-10-01T00:00:00Z" }], nowMs)).toBe(false);
  });

  it("spendSoftStopped never reads the meter for a paid call, and AI_SPEND_METER=off disables it", async () => {
    const { spendSoftStopped, spendMeterDisabled } = await import("@/lib/ai/spend-guard");
    const { db, counts } = fakeDb({ month: CAP });
    expect(await spendSoftStopped(db, "paid")).toBe(false);
    expect(counts.rpc + counts.selects).toBe(0);
    expect(spendMeterDisabled({ AI_SPEND_METER: "off" })).toBe(true);
    expect(spendMeterDisabled({})).toBe(false);
  });

  it("legacy routes: a house-funded call rests with the existing resting answer, a paid call passes", async () => {
    vi.resetModules();
    vi.doMock("@/lib/ai/limits", async (orig) => ({
      ...(await orig<typeof import("@/lib/ai/limits")>()),
      checkLaneSpend: vi.fn(async () => ({ ok: true })),
      checkLegacyUserCap: vi.fn(async () => ({ ok: true })),
      takeAiQuota: vi.fn(async () => ({ ok: true, used: 1 })),
    }));
    vi.doMock("@/lib/ai/spend-guard", () => ({ spendSoftStopped: vi.fn(async (_db: unknown, funding: string) => funding === "house") }));
    const { legacyGate } = await import("@/lib/notes-safety");
    const db = { rpc: vi.fn() } as never;
    expect(await legacyGate(db, "u", "translate", 5, { funding: "house" })).toEqual({ ok: false, kind: "resting", status: 503, code: "AI_RESTING" });
    expect(await legacyGate(db, "u", "notes_safety", null)).toMatchObject({ ok: false, kind: "resting" });
    expect(await legacyGate(db, "u", "translate", null, { funding: "paid" })).toEqual({ ok: true });
    vi.doUnmock("@/lib/ai/limits");
    vi.doUnmock("@/lib/ai/spend-guard");
  });
});

describe("per-feature spend and the ops alert", () => {
  it("aggregates cost, tokens and hit rate per feature, mentor from the ledger", () => {
    const rows = aggregateFeatureSpend(
      [
        { route: "ai_chat", provider: "anthropic", cost_usd: "0.002", in_tokens: 100, out_tokens: 50, cache_read_tokens: 900, cache_write_tokens: 0 },
        { route: "translate", provider: "anthropic", cost_usd: 0.001, in_tokens: 400, out_tokens: 80, cache_read_tokens: null, cache_write_tokens: null },
        { route: "mentor", provider: "anthropic", cost_usd: 1, in_tokens: 1, out_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 },
        { route: null, provider: "anthropic", cost_usd: 0.000001, in_tokens: 1, out_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 },
      ],
      [{ kind: "settle", cost_micro: 500, input_tokens: 1586, output_tokens: 1562, cache_read_tokens: 47390, cache_write_tokens: 0 }],
    );
    expect(rows.map((r) => r.feature)).toEqual(["mentor", "ai_chat", "translate", "other"]);
    expect(rows[0]).toMatchObject({ calls: 1, costMicro: 500 });
    expect(rows[0].hitRate).toBeCloseTo(47390 / (1586 + 47390));
    expect(rows[1].hitRate).toBeCloseTo(0.9);
    expect(rows[2]).toMatchObject({ costMicro: 1000, hitRate: 0 });
  });

  it("adds one alert item per workspace, period and state", () => {
    const base = { payments: [], refunds: [], deliveries: [], puyp: [], repeatReports: [] };
    const alarm = buildAlertItems({ ...base, aiSpend: { workspace: "prod", state: "alarm", trigger: "month", monthPct: 72.5, dayPct: 10 } }, OCT);
    expect(alarm).toEqual([{ key: "alert:ai_spend:prod:month:2026-10:alarm", kind: "ai_spend", line: "AI spend prod at 72.5 % of the monthly budget (alarm)", path: "/admin/overview" }]);
    const stop = buildAlertItems({ ...base, aiSpend: { workspace: "prod", state: "soft_stop", trigger: "day", monthPct: 10, dayPct: 96 } }, OCT);
    expect(stop[0].key).toBe("alert:ai_spend:prod:day:2026-10-14:soft_stop");
    expect(buildAlertItems({ ...base, aiSpend: { workspace: "prod", state: "ok", trigger: null, monthPct: 1, dayPct: 1 } }, OCT)).toEqual([]);
    expect(buildAlertItems({ ...base, aiSpend: null }, OCT)).toEqual([]);
  });
});
