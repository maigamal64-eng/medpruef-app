import { describe, expect, it } from "vitest";
import { checkLaneSpend, laneCapMicro, type RpcClient } from "@/lib/ai/limits";
import { checkMentorBreaker, mentorResting } from "@/lib/mentor/guard";
import { MENTOR_CONFIG_DEFAULTS, readMentorConfig } from "@/lib/mentor/config";

const now = new Date("2026-10-12T10:00:00Z");
function client(map: Record<string, { data?: unknown; error?: unknown }>): RpcClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rpc(fn: string) {
      calls.push(fn);
      const v = map[fn];
      if (!v) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } });
      return Promise.resolve({ data: v.data ?? null, error: v.error ?? null });
    },
  };
}
const cfg = { ...MENTOR_CONFIG_DEFAULTS, mentorCapSharePct: 50 };

describe("a38 MUX-106 A: separate mentor and legacy caps", () => {
  it("splits the total cap without raising it", () => {
    for (const [cap, share] of [[50_000_000, 50], [50_000_001, 33], [7, 0], [7, 100]] as const) {
      expect(laneCapMicro(cap, "mentor", share) + laneCapMicro(cap, "legacy", share)).toBe(cap);
    }
    expect(laneCapMicro(50_000_000, "mentor", 60)).toBe(30_000_000);
    expect(laneCapMicro(50_000_000, "legacy", 60)).toBe(20_000_000);
  });

  it("a legacy surge in a fixture does not rest the mentor; mentor spend over its share does", async () => {
    const surge = client({ ai_spend_month_split: { data: { mentor_micro: 1_000, legacy_micro: 70_000_000 } }, ai_spend_cap: { data: 50_000_000 } });
    expect(await checkMentorBreaker(surge, cfg, now)).toBeNull();
    expect(await mentorResting(surge, cfg, now)).toBe(false);
    const legacy = await checkLaneSpend(surge, "legacy", { now, mentorSharePct: 50 });
    expect(legacy).toMatchObject({ ok: false, reason: "global_cap", split: true, capMicro: 25_000_000 });
    const mentorFull = client({ ai_spend_month_split: { data: { mentor_micro: 25_000_000, legacy_micro: 0 } }, ai_spend_cap: { data: 50_000_000 } });
    expect((await checkMentorBreaker(mentorFull, cfg, now))?.body.error).toBe("global_cap");
    expect(await mentorResting(mentorFull, cfg, now)).toBe(true);
  });

  it("before the changeset (split read missing) the shared total is checked exactly as before", async () => {
    const shared = client({ ai_spend_month: { data: 60_000_000 }, ai_spend_cap: { data: 50_000_000 } });
    const r = await checkLaneSpend(shared, "mentor", { now, mentorSharePct: 50 });
    expect(r).toMatchObject({ ok: false, reason: "global_cap", split: false, capMicro: 50_000_000 });
    expect(shared.calls).toEqual(["ai_spend_month_split", "ai_spend_cap", "ai_spend_month"]);
  });

  it("an operator error inside the function (42883 without the name) fails closed instead of falling back", async () => {
    const op = client({ ai_spend_month_split: { error: { code: "42883", message: "operator does not exist: text + interval" } }, ai_spend_cap: { data: 50_000_000 }, ai_spend_month: { data: 0 } });
    expect(await checkLaneSpend(op, "mentor", { now, mentorSharePct: 50 })).toMatchObject({ ok: false, reason: "db_error" });
    const missing = client({ ai_spend_month_split: { error: { code: "42883", message: "function public.ai_spend_month_split(p_month => text) does not exist" } }, ai_spend_cap: { data: 50_000_000 }, ai_spend_month: { data: 0 } });
    expect(await checkLaneSpend(missing, "mentor", { now, mentorSharePct: 50 })).toMatchObject({ ok: true, split: false });
  });

  it("fails closed on a DB error or a malformed reply; never treats unknown as open", async () => {
    expect(await checkLaneSpend(client({ ai_spend_month_split: { error: { message: "boom" } }, ai_spend_cap: { data: 1 } }), "legacy", { now, mentorSharePct: 50 })).toMatchObject({ ok: false, reason: "db_error" });
    expect(await checkLaneSpend(client({ ai_spend_month_split: { data: { mentor_micro: "x" } }, ai_spend_cap: { data: 1 } }), "mentor", { now, mentorSharePct: 50 })).toMatchObject({ ok: false, reason: "bad_response" });
    expect(await mentorResting(client({ ai_spend_month_split: { error: { message: "boom" } }, ai_spend_cap: { data: 1 } }), cfg, now)).toBeNull();
  });

  it("the share is env-tunable and clamped; the default is 50", () => {
    expect(readMentorConfig({}).mentorCapSharePct).toBe(50);
    expect(readMentorConfig({ MENTOR_CAP_SHARE_PCT: "70" }).mentorCapSharePct).toBe(70);
    expect(readMentorConfig({ MENTOR_CAP_SHARE_PCT: "170" }).mentorCapSharePct).toBe(50);
  });
});
