import { afterEach, describe, expect, it, vi } from "vitest";
import { renderLlmsFullTxt, renderLlmsTxt, v2PaidSentence } from "@/lib/agent-docs/render-llms";
import { v2LandingPreview } from "@/lib/pricing-v2/landing-preview";
import { v2Readiness } from "@/lib/pricing-v2/readiness";
import { v2JsonLdOffers } from "@/lib/pricing-v2/structured";

// a-v2-readiness-surfaces-1020: llms.txt, the landing preview and the /pricing
// snippet sell a plan only while checkout can (v2PlanReady), like the JSON-LD.
const HALF_YEAR: Record<string, string> = {
  HALF_YEAR_AUTO_STOP_ENABLED: "true",
  HALF_YEAR_AUTO_STOP_DRY_RUN: "false",
  HALF_YEAR_REMINDER_EMAILS_ENABLED: "true",
};
const TICKET: Record<string, string> = {
  TICKET_RENEWAL_ENABLED: "true",
  TICKET_REMINDER_EMAILS_ENABLED: "true",
  AI_FEATURES_ENABLED: "true",
  MENTOR_ENABLED: "true",
  MENTOR_ACCESS_SCOPE: "signed_in",
  MENTOR_INCLUDED_RAISE_ENABLED: "true",
};
const OFF: Record<string, string> = {};
const ON = { ...HALF_YEAR, ...TICKET };

describe("agent files", () => {
  it("half_year off: no 6-month sentence, no Ticket without its flags", () => {
    for (const env of [OFF, TICKET]) {
      const s = v2PaidSentence(env);
      expect(s).not.toMatch(/6-month/);
      expect(s).toMatch(/monthly plan at/);
      expect(s).toMatch(/Sitting Pass at/);
    }
    expect(v2PaidSentence(OFF)).not.toMatch(/Guarantee Ticket/);
    expect(v2PaidSentence(OFF)).toMatch(/\) and a Sitting Pass at .*\.$/);
  });
  it("half_year on: the 6-month plan is named; ticket stays out until ready", () => {
    const s = v2PaidSentence(HALF_YEAR);
    expect(s).toMatch(/6-month plan at/);
    expect(s).not.toMatch(/Guarantee Ticket/);
    expect(s).toMatch(/, and a 6-month plan at/);
  });
  it("all ready: all four plans, one closing full stop, no mentor word", () => {
    const s = v2PaidSentence(ON);
    for (const w of ["monthly plan", "Sitting Pass", "6-month plan", "Guarantee Ticket"]) expect(s).toContain(w);
    expect(s.endsWith(".")).toBe(true);
    expect(s).not.toMatch(/mentor/i);
  });
  it("both files follow the same rule", () => {
    for (const env of [OFF, HALF_YEAR, TICKET, ON]) {
      for (const file of [renderLlmsTxt(env, true), renderLlmsFullTxt(true, env)]) {
        expect(file.includes("6-month plan at")).toBe(env === HALF_YEAR || env === ON);
        expect(file.includes("Guarantee Ticket at")).toBe(env === TICKET || env === ON);
        expect(file).toContain(v2PaidSentence(env));
      }
    }
  });
  it("ticket ready, half_year off: Ticket named after the Sitting Pass with one comma list", () => {
    const s = v2PaidSentence(TICKET);
    expect(s).toMatch(/\), and the Guarantee Ticket at /);
    expect(s).not.toMatch(/6-month/);
  });
  it("flag off: unchanged v1 text whatever the readiness env", () => {
    expect(renderLlmsFullTxt(false, ON)).toBe(renderLlmsFullTxt(false, OFF));
  });
});

describe("landing preview", () => {
  const names = (r: ReturnType<typeof v2Readiness>) => v2LandingPreview(r).tiers.map((t) => t.name.en);
  it("half_year off: Sitting Pass only; no Ticket clause in the subtitle", () => {
    const p = v2LandingPreview(v2Readiness(OFF));
    expect(names(v2Readiness(OFF))).toEqual(["Sitting Pass"]);
    expect(p.subtitle.de).not.toMatch(/Garantie-Ticket|Verlängerungsjahre/);
    expect(p.subtitle.en).not.toMatch(/Guarantee Ticket|renewal years/);
    expect(p.subtitle.en.endsWith(".")).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/6 months|180/);
  });
  it("half_year on: the 6-month card appears, the Ticket does not", () => {
    expect(names(v2Readiness(HALF_YEAR))).toEqual(["Sitting Pass", "6 months"]);
  });
  it("all on: three cards and the Ticket clause (today's text)", () => {
    const p = v2LandingPreview(v2Readiness(ON));
    expect(p.tiers.map((t) => t.name.en)).toEqual(["Sitting Pass", "6 months", "Guarantee Ticket"]);
    expect(p.subtitle.de).toMatch(/; kostenlose Verlängerungsjahre auf Nachweis gibt es mit dem Garantie-Ticket\.$/);
  });
  it("no prop: closed (Sitting Pass only), the same on server and client", () => {
    expect(v2LandingPreview().tiers.map((t) => t.name.en)).toEqual(["Sitting Pass"]);
  });
  it("matches the JSON-LD offers plan for plan", () => {
    for (const env of [OFF, HALF_YEAR, TICKET, ON]) {
      const ld = v2JsonLdOffers(env).map((o) => o.name);
      const prev = ["Monthly plan", ...v2LandingPreview(v2Readiness(env)).tiers.map((t) => t.name.en)];
      expect(prev.filter((n) => n !== "Monthly plan")).toEqual(ld.filter((n) => n !== "Monthly plan"));
    }
  });
});

describe("/pricing meta", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const load = async (env: Record<string, string>) => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return (await import("@/app/pricing/layout")).metadata;
  };
  it("half_year off: names Monatsabo and Prüfungspass only", async () => {
    const m = await load(OFF);
    expect(m.description).toContain("den passenden Tarif: Monatsabo oder Prüfungspass. 150 Fragen");
    expect(m.description).not.toMatch(/6 Monate|Garantie-Ticket/);
    expect(m.openGraph?.description).toBe(m.description);
  });
  it("ticket only: Monatsabo, Prüfungspass oder Garantie-Ticket", async () => {
    expect((await load(TICKET)).description).toContain("Monatsabo, Prüfungspass oder Garantie-Ticket. 150");
  });
  it("half_year on: adds 6 Monate; all on: the byte-exact four-plan line", async () => {
    expect((await load(HALF_YEAR)).description).toContain("Monatsabo, Prüfungspass oder 6 Monate. 150");
    expect((await load(ON)).description).toContain("Monatsabo, Prüfungspass, 6 Monate oder Garantie-Ticket. 150");
  });
});
