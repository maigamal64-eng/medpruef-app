import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CREDIT_MICRO_USD,
  MENTOR_CONFIG_DEFAULTS,
  creditsFromMicro,
  envFlag,
  mentorPackageForWhopPlan,
  mentorWhopPlanId,
  messagesLeftEstimate,
  readMentorConfig,
} from "@/lib/mentor/config";
import { MENTOR_ERROR_STATUS, MENTOR_PACKAGE_IDS, MENTOR_RPCS, MENTOR_USAGE_STATES } from "@/lib/mentor/contract";
import * as fixtures from "@/lib/mentor/fixtures";
import { MODEL_IDS } from "@/lib/ai/pricing";

const ROOT = path.resolve(__dirname, "../../../..");
const SQL = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261022100000_mentor_ledger.sql"), "utf8");

describe("C5 config", () => {
  it("everything defaults OFF and to the contract numbers", () => {
    const c = readMentorConfig({});
    expect(c).toMatchObject({
      aiFeaturesEnabled: false,
      enabled: false,
      freeEnabled: false,
      escalationEnabled: false,
      packagesEnabled: false,
      topupsEnabled: false,
      modelDefault: MODEL_IDS.HAIKU_5_5,
      effort: "low",
      maxTokens: 700,
      maxToolRounds: 3,
      ratePerMin: 6,
      ratePerDay: 60,
      houseFreeFailsPerDay: 3,
      globalMonthlyCapFloorMicro: 50_000_000,
      globalCapNetPct: 6,
    });
    expect(c.betaUserIds).toEqual([]);
    expect(MENTOR_CONFIG_DEFAULTS.enabled).toBe(false);
  });

  it("booleans are strict: only the literal 'true' is on", () => {
    for (const v of ["TRUE", "1", "yes", "on", " false", ""]) expect(envFlag(v)).toBe(false);
    expect(envFlag("true")).toBe(true);
    expect(envFlag(" true ")).toBe(true);
    expect(readMentorConfig({ MENTOR_ENABLED: "1" }).enabled).toBe(false);
  });

  it("env can tighten but never exceed max_tokens 700 or 3 tool rounds", () => {
    const c = readMentorConfig({ MENTOR_MAX_TOKENS: "4000", MENTOR_MAX_TOOL_ROUNDS: "9", MENTOR_EFFORT: "max" });
    expect(c.maxTokens).toBe(700);
    expect(c.maxToolRounds).toBe(3);
    expect(c.effort).toBe("low");
    expect(readMentorConfig({ MENTOR_MAX_TOKENS: "500" }).maxTokens).toBe(500);
  });

  it("beta allowlist keeps only uuids", () => {
    const c = readMentorConfig({ MENTOR_BETA_USER_IDS: " 11111111-1111-4111-8111-111111111111 ,bad, ;drop" });
    expect(c.betaUserIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("Whop plan mapping is env-driven and unset means not buyable", () => {
    const env = { WHOP_PLAN_MENTOR_BASIS: " plan_basis ", WHOP_PLAN_MENTOR_PLUS: "" };
    expect(mentorWhopPlanId("mentor_basis", env)).toBe("plan_basis");
    expect(mentorWhopPlanId("mentor_plus", env)).toBeNull();
    expect(mentorPackageForWhopPlan("plan_basis", env)).toBe("mentor_basis");
    expect(mentorPackageForWhopPlan("plan_redacted8f2b848b", env)).toBeNull();
    expect(mentorPackageForWhopPlan(null, env)).toBeNull();
  });

  it("credits and message estimates never go negative and never show dollars", () => {
    expect(CREDIT_MICRO_USD).toBe(5_000);
    expect(creditsFromMicro(750_000)).toBe(150);
    expect(creditsFromMicro(4_999)).toBe(0);
    expect(creditsFromMicro(-10)).toBe(0);
    expect(messagesLeftEstimate(100_000, null)).toBe(20);
    expect(messagesLeftEstimate(100_000, 2_500)).toBe(40);
    expect(messagesLeftEstimate(-1, 2_500)).toBe(0);
  });
});

describe("C4 fixtures", () => {
  it("cover every usage state and every error code", () => {
    for (const s of MENTOR_USAGE_STATES) expect(fixtures.FIXTURE_USAGE[s].state).toBe(s);
    for (const code of Object.keys(MENTOR_ERROR_STATUS)) {
      const f = fixtures.FIXTURE_ERRORS[code as keyof typeof MENTOR_ERROR_STATUS];
      expect(f.status).toBe(MENTOR_ERROR_STATUS[code as keyof typeof MENTOR_ERROR_STATUS]);
      expect(f.body.error).toBe(code);
    }
    expect(fixtures.FIXTURE_STREAM_OK.at(-1)?.type).toBe("final");
    expect(fixtures.FIXTURE_FINAL_REFUSED.refused).toBeDefined();
    expect(fixtures.FIXTURE_FINAL_REFUSED.refusal_link).toMatch(/^https:\/\//);
  });

  it("are synthetic (example.org), carry no em dash and no dollar sign", () => {
    const text = JSON.stringify(fixtures);
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/\$|USD/);
    const urls = text.match(/https:\/\/[^"]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith("https://example.org/")).toBe(true);
  });
});

describe("C3 ledger migration (static checks; the live run is on a local Postgres)", () => {
  it("is marked unapplied and touches only ai_/mentor_ objects", () => {
    expect(SQL.startsWith("-- UNAPPLIED")).toBe(true);
    const created = [...SQL.matchAll(/CREATE (?:TABLE IF NOT EXISTS|OR REPLACE FUNCTION) public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(10);
    for (const name of created) expect(name).toMatch(/^(ai_|mentor_|_mentor_)/);
  });

  it("every frozen RPC exists in the SQL and gets EXECUTE for service_role only", () => {
    for (const { fn, args } of Object.values(MENTOR_RPCS)) {
      if (fn === "ai_spend_cap") continue; // owned by the R2 migration
      expect(SQL).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
      const sig = SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`));
      expect(sig, fn).not.toBeNull();
      for (const a of args) expect(sig![1], `${fn}.${a}`).toContain(a);
      expect(SQL).toMatch(new RegExp(`'public\\.${fn}\\(`));
    }
    expect(SQL).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION %s TO service_role");
    expect(SQL).not.toMatch(/GRANT [A-Z, ]+ ON [^;]+ TO (anon|authenticated)/);
  });

  it("every table has RLS and the ledger is append-only for service_role", () => {
    const tables = [...SQL.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z_]+)/g)].map((m) => m[1]);
    for (const t of tables) expect(SQL).toContain(`'${t}'`);
    expect(SQL).toContain("GRANT SELECT, INSERT         ON public.ai_usage_ledger            TO service_role;");
    expect(SQL).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*ai_usage_ledger/);
  });

  it("ai_spend_month counts consumption only, never grants or purchases", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.ai_spend_month"));
    expect(fn).toContain("g.kind IN ('settle', 'house_cost')");
    expect(fn).toContain("l.route <> 'mentor'");
  });

  it("seeds exactly the package ids the contract names, sold packages inactive", () => {
    for (const id of MENTOR_PACKAGE_IDS) expect(SQL).toMatch(new RegExp(`\\('${id}',`));
    expect(SQL).toMatch(/\('mentor_basis',\s+'subscription',\s+\d+,\s+30,\s+33,\s+\d+, false, true/);
    expect(SQL).toMatch(/\('trial_taste',\s+'trial',\s+100000,/);
    expect(SQL).toContain("ON CONFLICT (package_id) DO NOTHING");
  });
});

describe("frozen guard and Whop id rules", () => {
  it("admits a message only when 3 rounds of the first ceiling fit", async () => {
    const { admitMessageMinMicro, canAdmitMessage } = await import("@/lib/mentor/config");
    expect(admitMessageMinMicro(4_000, 3)).toBe(12_000);
    expect(canAdmitMessage(11_999, 4_000, 3)).toBe(false);
    expect(canAdmitMessage(12_000, 4_000, 3)).toBe(true);
    expect(() => admitMessageMinMicro(0, 3)).toThrow();
  });

  it("refund and dispute need a matched payment id and never read the membership alone", async () => {
    const { MENTOR_WHOP_ID_RULES } = await import("@/lib/mentor/contract");
    expect(MENTOR_WHOP_ID_RULES.clawback.extractor).toBe("extractWhopRevoke");
    expect(MENTOR_WHOP_ID_RULES.clawback.requiresPaymentMatch).toBe(true);
    expect(MENTOR_WHOP_ID_RULES.clawback.ids).not.toContain("membershipId");
    expect(MENTOR_WHOP_ID_RULES.deactivate.ids[0]).toBe("membershipId");
  });
});
