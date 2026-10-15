import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readMentorConfig, MENTOR_CONFIG_DEFAULTS } from "../../../src/lib/mentor/config";
import { laneCapMicro, MENTOR_CAP_SHARE_PCT_DEFAULT } from "../../../src/lib/ai/limits";

// a-ai-cap-split (plan.json J3): the production values are env only.
// MENTOR_GLOBAL_MONTHLY_CAP_FLOOR_MICRO=80000000 and MENTOR_CAP_SHARE_PCT=60
// give a USD 80 cap split USD 48 mentor / USD 32 other learner AI. The code
// defaults stay USD 50 and 50 percent (Vercel owns the live values).
describe("J3 cap values", () => {
  it("parses the J3 env values and splits USD 80 into 48 and 32", () => {
    const cfg = readMentorConfig({ MENTOR_GLOBAL_MONTHLY_CAP_FLOOR_MICRO: "80000000", MENTOR_CAP_SHARE_PCT: "60" });
    expect(cfg.globalMonthlyCapFloorMicro).toBe(80_000_000);
    expect(cfg.mentorCapSharePct).toBe(60);
    expect(cfg.globalCapNetPct).toBe(6);
    expect(laneCapMicro(80_000_000, "mentor", cfg.mentorCapSharePct)).toBe(48_000_000);
    expect(laneCapMicro(80_000_000, "legacy", cfg.mentorCapSharePct)).toBe(32_000_000);
  });

  it("keeps the code defaults unchanged when the env is absent or invalid", () => {
    expect(MENTOR_CONFIG_DEFAULTS.globalMonthlyCapFloorMicro).toBe(50_000_000);
    expect(MENTOR_CAP_SHARE_PCT_DEFAULT).toBe(50);
    const absent = readMentorConfig({});
    expect(absent.globalMonthlyCapFloorMicro).toBe(50_000_000);
    expect(absent.mentorCapSharePct).toBe(50);
    // A typo never opens the cap: out of range or non-integer falls back to the default.
    const bad = readMentorConfig({ MENTOR_GLOBAL_MONTHLY_CAP_FLOOR_MICRO: "80e6x", MENTOR_CAP_SHARE_PCT: "160" });
    expect(bad.globalMonthlyCapFloorMicro).toBe(50_000_000);
    expect(bad.mentorCapSharePct).toBe(50);
  });

  it("the read-back SQL uses the same floor and share as the runbook", () => {
    const verify = readFileSync(resolve("scripts/sql/track-a/a-ai-cap-split/verify.sql"), "utf8");
    const before = readFileSync(resolve("scripts/sql/track-a/a-ai-cap-split/before-image.sql"), "utf8");
    expect(verify).toContain("ai_spend_cap(80000000, 6)");
    expect(verify).toContain("c.cap * 60 / 100");
    expect(before).toContain("ai_spend_cap(80000000, 6)");
    // Both files are read only.
    for (const text of [verify, before]) expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE)\b/);
  });
});
