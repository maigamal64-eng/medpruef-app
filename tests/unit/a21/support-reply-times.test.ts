import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { parseArgs, percentile, summarise, workingHoursBetween } from "../../../scripts/support-reply-times.mjs";

describe("support reply-time report (LX-31)", () => {
  it("defaults to the previous calendar month and validates dates", () => {
    expect(parseArgs([], new Date("2026-10-12T00:00:00Z"))).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(() => parseArgs(["--from", "12.10.2026"])).toThrow();
  });
  it("aggregates without learner data and counts unanswered threads", () => {
    const h = 3600;
    const base = Date.parse("2026-10-05T08:00:00Z") / 1000; // a Monday
    const s = summarise([
      { created_at: base, statistics: { first_admin_reply_at: base + 2 * h }, author: { email: "x@y.z" } },
      { created_at: base, statistics: { first_admin_reply_at: base + 30 * h } },
      { created_at: base, statistics: {} },
    ]);
    expect(s).toMatchObject({ conversations: 3, replied: 2, without_reply: 1, median_hours: 2, p90_hours: 30, within_24h_pct: 50, within_2_working_days_pct: 100 });
    expect(JSON.stringify(s)).not.toContain("x@y.z");
  });
  it("counts only Monday to Friday hours as working time", () => {
    const sat = Date.parse("2026-10-10T00:00:00Z") / 1000;
    expect(workingHoursBetween(sat, sat + 48 * 3600)).toBe(0);
    expect(percentile([], 50)).toBeNull();
  });
});
