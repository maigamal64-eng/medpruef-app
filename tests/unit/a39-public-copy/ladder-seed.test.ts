import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MENTOR_CREDIT_MICRO_USD, MENTOR_GRACE_DAYS, MENTOR_LADDER } from "@/lib/mentor-public/ladder";
import { CREDIT_MICRO_USD } from "@/lib/mentor/config";
import { FREE_CREDIT_DEFAULTS, readFreeCreditConfig, includedAmountOverrides } from "@/lib/mentor/credits/free-credits";

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

  // a-free-credit-hooks L1: the public numbers are the raised amounts, which
  // the grant uses only while MENTOR_INCLUDED_RAISE_ENABLED is on; the seed
  // rows (50 / 150) stay the flag-off amounts.
  it("Pro includes 200 credits per 30 days (monthly and quarterly) once the raise is on", () => {
    const raised = includedAmountOverrides(readFreeCreditConfig({ MENTOR_INCLUDED_RAISE_ENABLED: "true" }));
    for (const id of ["included_pro_monthly", "included_pro_quarterly"]) {
      const row = seedRow(id);
      expect(row.kind).toBe("included");
      expect(credits(row.grantMicro)).toBe(50);
      expect(credits(raised[id] as number)).toBe(MENTOR_LADDER.pro.credits);
      expect(row.periodDays).toBe(MENTOR_LADDER.pro.periodDays);
    }
    expect(MENTOR_LADDER.pro.credits).toBe(200);
    expect(MENTOR_LADDER.pro.credits).toBe(FREE_CREDIT_DEFAULTS.proIncludedCredits);
  });

  it("the cohort includes 400 credits per 30 days once the raise is on", () => {
    const raised = includedAmountOverrides(readFreeCreditConfig({ MENTOR_INCLUDED_RAISE_ENABLED: "true" }));
    const row = seedRow("included_cohort");
    expect(credits(row.grantMicro)).toBe(150);
    expect(credits(raised.included_cohort as number)).toBe(MENTOR_LADDER.cohort.credits);
    expect(row.periodDays).toBe(MENTOR_LADDER.cohort.periodDays);
    expect(MENTOR_LADDER.cohort.credits).toBe(400);
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
