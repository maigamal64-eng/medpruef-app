import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MENTOR_CREDIT_MICRO_USD, MENTOR_GRACE_DAYS, MENTOR_LADDER } from "@/lib/mentor-public/ladder";
import { CREDIT_MICRO_USD } from "@/lib/mentor/config";

const SEED = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261022100000_mentor_ledger.sql"), "utf8");

/** Parse one ai_credit_package seed tuple: (id, kind, grant_micro, period_days, expiry_days, price_eur_cents, ...). */
function seedRow(id: string) {
  const re = new RegExp(`\\('${id}',\\s*'(\\w+)',\\s*(\\d+),\\s*(NULL|\\d+),\\s*(\\d+),\\s*(NULL|\\d+)`);
  const m = SEED.match(re);
  if (!m) throw new Error(`seed row ${id} not found`);
  const num = (v: string) => (v === "NULL" ? null : Number(v));
  return { kind: m[1], grantMicro: Number(m[2]), periodDays: num(m[3]), expiryDays: Number(m[4]), priceCents: num(m[5]) };
}
const credits = (micro: number) => micro / MENTOR_CREDIT_MICRO_USD;

describe("mentor ladder matches the ai_credit_package seed", () => {
  it("uses the same credit unit as the mentor config", () => {
    expect(MENTOR_CREDIT_MICRO_USD).toBe(CREDIT_MICRO_USD);
  });

  it("Pro includes 50 credits per 30 days (monthly and quarterly)", () => {
    for (const id of ["included_pro_monthly", "included_pro_quarterly"]) {
      const row = seedRow(id);
      expect(row.kind).toBe("included");
      expect(credits(row.grantMicro)).toBe(MENTOR_LADDER.pro.credits);
      expect(row.periodDays).toBe(MENTOR_LADDER.pro.periodDays);
    }
    expect(MENTOR_LADDER.pro.credits).toBe(50);
  });

  it("the cohort includes 150 credits per 30 days", () => {
    const row = seedRow("included_cohort");
    expect(credits(row.grantMicro)).toBe(MENTOR_LADDER.cohort.credits);
    expect(row.periodDays).toBe(MENTOR_LADDER.cohort.periodDays);
    expect(MENTOR_LADDER.cohort.credits).toBe(150);
  });

  it("Mentor Basis price, credits, period and expiry", () => {
    const row = seedRow("mentor_basis");
    expect(row.kind).toBe("subscription");
    expect(row.priceCents).toBe(MENTOR_LADDER.basis.priceCents);
    expect(credits(row.grantMicro)).toBe(MENTOR_LADDER.basis.credits);
    expect(row.periodDays).toBe(MENTOR_LADDER.basis.periodDays);
    expect(row.expiryDays).toBe(MENTOR_LADDER.basis.expiryDays);
    expect(MENTOR_GRACE_DAYS).toBe(3);
  });
});
