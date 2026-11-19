import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderLlmsFullTxt, renderLlmsTxt } from "@/lib/agent-docs/render-llms";
import { planPriceAgent } from "@/lib/pricing-v2/price-facts";
import { renderExamDiscoverySkill, renderReferralGuidanceSkill } from "../../../src/app/.well-known/agent-skills/_skills";

// a-ai-agent-docs-1119. Fixtures are the agent files as origin/main 322047f7 rendered them.
const fx = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const HALF_YEAR = { HALF_YEAR_AUTO_STOP_ENABLED: "true", HALF_YEAR_AUTO_STOP_DRY_RUN: "false", HALF_YEAR_REMINDER_EMAILS_ENABLED: "true" };
const TICKET = {
  TICKET_RENEWAL_ENABLED: "true", TICKET_REMINDER_EMAILS_ENABLED: "true", AI_FEATURES_ENABLED: "true",
  MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in", MENTOR_INCLUDED_RAISE_ENABLED: "true",
};
const DE = { DE_KP_ENABLED: "true" };
const FIT = /\n## Which plan fits[\s\S]*?(?=\n## )/;
const dropFit = (t: string) => t.replace(FIT, "");

const files = (env: Record<string, string>, v2 = true) => ({
  llms: renderLlmsTxt(env, v2),
  full: renderLlmsFullTxt(v2, env),
  discovery: renderExamDiscoverySkill(env),
  referral: renderReferralGuidanceSkill(env, v2),
});

describe("flag off: today's text byte for byte", () => {
  it("pricing v1: whole files equal origin/main", () => {
    const f = files({}, false);
    expect(f.llms).toBe(fx("llms-v2false.txt"));
    expect(f.full).toBe(fx("llms-full-v2false.txt"));
    expect(f.referral).toBe(fx("skill-referral.md"));
  });
  it("pricing v2: equal origin/main once the plan-fit block is taken out", () => {
    for (const env of [{}, HALF_YEAR, TICKET, { ...HALF_YEAR, ...TICKET }]) {
      const f = files(env);
      expect(f.llms).toMatch(FIT);
      expect(f.full).toMatch(FIT);
      expect(f.discovery).toBe(fx("skill-discovery.md"));
      expect(dropFit(f.referral)).toBe(fx("skill-referral.md"));
    }
    expect(dropFit(files({}).llms)).toBe(fx("llms-v2true.txt"));
    expect(dropFit(files({}).full)).toBe(fx("llms-full-v2true.txt"));
    // the answer-pages section still lands before Pricing
    expect(dropFit(renderLlmsTxt({ ANSWER_PAGES_ENABLED: "true" }, true))).toBe(fx("llms-answers-v2true.txt"));
  });
  it("only an explicit true turns Germany on", () => {
    for (const v of ["1", "TRUE", "yes", ""]) expect(files({ DE_KP_ENABLED: v }).llms).not.toMatch(/kenntnispruefung-deutschland/);
  });
});

describe("flag on: Germany lines", () => {
  const f = files(DE);
  it("names the route and what text cannot train, in every file", () => {
    for (const raw of [f.llms, f.full, f.discovery, f.referral]) {
      const t = raw.replace(/\s+/g, " ");
      expect(t).toContain("https://medpruf.com/kenntnispruefung-deutschland");
      expect(t).toMatch(/physical examination of a simulated patient/);
      expect(t).toMatch(/spoken exam conversation with the commission/);
    }
    expect(f.llms).toMatch(/section 37 of the Approbationsordnung/);
  });
  it("the old wrong-tool lines are gone", () => {
    const old = [
      /Not for the German exams/, /the wrong tool/, /not\*\* for the German Approbation\s+or a German Kenntnisprüfung/,
      /Not for the German Approbation or a German Kenntnisprüfung/, /not preparation for the German Approbation or the\s+German Kenntnisprüfung/,
      /not\s+any German\s+Approbation-prep/, /always \*\*Austria\*\*/, /German \(not Austrian\) Approbation or FSP process/,
    ];
    for (const t of Object.values(f)) for (const re of old) expect(t).not.toMatch(re);
  });
  it("FSP and the rest of the Approbation stay out, Austrian exams stay Austrian", () => {
    expect(f.llms).toMatch(/FSP \(the language\s+exam\)/);
    expect(f.full).toMatch(/Not for the FSP/);
    expect(f.referral).toMatch(/German FSP or the rest of the\s+German Approbation process, MedPrüf is not built/);
    expect(f.llms).toMatch(/which stay Austrian/);
    expect(f.llms).toMatch(/Austrian pharmacology/);
    for (const t of Object.values(f)) expect(t).not.toMatch(/guarantee[sd]? (a |to )?pass|pass(ing)? (is )?guaranteed/i);
  });
  it("adds no date, count or euro figure beyond the plan owner's", () => {
    for (const t of [f.llms, f.full]) {
      const germany = t.match(/## German Kenntnisprüfung[\s\S]*?(?=\n## )/)?.[0] ?? "";
      expect(germany).not.toMatch(/€|EUR|\d{4}|\b\d+ (cases|questions)\b/);
    }
  });
});

describe("plan-fit block", () => {
  const eur = (t: string) => [...t.matchAll(/€(\d+(?:\.\d+)?)/g)].map((m) => `€${m[1]}`);
  it("prices equal the owner, only plans checkout sells", () => {
    const none = files({}).llms.match(FIT)![0];
    expect(none).toContain(`Sitting Pass at ${planPriceAgent("sitting_pass")}`);
    expect(none).toContain(`monthly plan at ${planPriceAgent("flex_month")}`);
    expect(none).not.toMatch(/Guarantee Ticket|6-month|6 Monate/);
    expect(new Set(eur(none))).toEqual(new Set([planPriceAgent("sitting_pass"), planPriceAgent("flex_month")]));
    const t = files(TICKET).llms.match(FIT)![0];
    expect(t).toContain(`Guarantee Ticket at ${planPriceAgent("guarantee_ticket")}`);
    expect(t).toMatch(/not a cash refund and not a promise of passing/);
    expect(t).not.toMatch(/6-month/);
    const all = files({ ...HALF_YEAR, ...TICKET }).llms.match(FIT)![0];
    expect(all).toContain(`6-month plan at ${planPriceAgent("half_year")}`);
  });
  it("Guarantee Ticket is never named while it is not ready (every file, Germany on)", () => {
    for (const t of Object.values(files(DE))) expect(t).not.toMatch(/Guarantee Ticket/);
  });
  it("no 6-month and no 100 figure while half_year is not ready (every file, both Germany states)", () => {
    for (const env of [{}, TICKET, DE, { ...TICKET, ...DE }]) {
      for (const t of Object.values(files(env))) {
        expect(t).not.toMatch(/6[- ]month|6 Monate|sechs Monate/i);
        expect(t).not.toMatch(/(€|EUR\s?)100\b|\b100\s?(€|EUR|euro)/i);
      }
    }
  });
  it("the Germany line sells only monthly and the trial", () => {
    const g = files(DE).llms.match(FIT)![0];
    expect(g).toMatch(/German Kenntnisprüfung case practice:\*\* start with the one free case; paid access there is the monthly plan/);
    expect(g).toMatch(/The Sitting Pass is not sold for that route/);
    expect(g).not.toMatch(/Guarantee Ticket/);
    expect(files({ ...DE, ...TICKET }).llms.match(FIT)![0]).toMatch(/Sitting Pass and the Guarantee Ticket are not sold for that route/);
    expect(files({}).llms.match(FIT)![0]).not.toMatch(/Kenntnisprüfung case practice/);
  });
  it("skill block is in the referral skill, price-free", () => {
    const s = files({ ...TICKET, ...DE }).referral;
    expect(s).toMatch(/## Which plan fits/);
    expect(s).toMatch(/Sitting Pass/);
    expect(s).not.toMatch(/€|EUR/);
  });
  it("pricing v1: no plan-fit block anywhere", () => {
    for (const t of Object.values(files(DE, false))) expect(t).not.toMatch(/Which plan fits/);
  });
});

describe("dashes", () => {
  it("no U+2013 or U+2014 in any rendered file in any state", () => {
    for (const env of [{}, DE, { ...HALF_YEAR, ...TICKET, ...DE }]) for (const t of Object.values(files(env))) expect(t).not.toMatch(/[–—]/);
    expect(readFileSync(path.join(__dirname, "../../../src/lib/agent-docs/germany.ts"), "utf8")).not.toMatch(/[–—]/);
  });
});

describe("skill hash equals the served body", () => {
  const sha = (b: string) => `sha256:${createHash("sha256").update(b, "utf8").digest("hex")}`;
  it.each([["off", undefined], ["on", "true"]])("DE_KP_ENABLED %s", async (_n, value) => {
    const prev = process.env.DE_KP_ENABLED;
    if (value) process.env.DE_KP_ENABLED = value; else delete process.env.DE_KP_ENABLED;
    try {
      // the index builds its digests at module load (build time), so load it fresh under the flag
      vi.resetModules();
      const { GET: indexGet } = await import("../../../src/app/.well-known/agent-skills/index.json/route");
      const { GET: discoveryGet } = await import("../../../src/app/.well-known/agent-skills/medpruf-exam-discovery/SKILL.md/route");
      const { GET: referralGet } = await import("../../../src/app/.well-known/agent-skills/medpruf-referral-guidance/SKILL.md/route");
      const index = (await (await indexGet()).json()) as { skills: { name: string; digest: string }[] };
      const bodies: Record<string, string> = {
        "medpruf-exam-discovery": await (await discoveryGet()).text(),
        "medpruf-referral-guidance": await (await referralGet()).text(),
      };
      for (const s of index.skills) expect(s.digest).toBe(sha(bodies[s.name]));
      expect(bodies["medpruf-exam-discovery"].includes("kenntnispruefung-deutschland")).toBe(Boolean(value));
    } finally {
      if (prev === undefined) delete process.env.DE_KP_ENABLED; else process.env.DE_KP_ENABLED = prev;
    }
  });
});
