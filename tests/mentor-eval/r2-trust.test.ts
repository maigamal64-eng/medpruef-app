import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadRealParts } from "./lib/real-parts";
import { loadFactRecords } from "./lib/facts-source";
import { lintGolden } from "./lib/lint";
import { evaluate } from "./lib/run";
import { createScriptedCallClaude } from "./lib/scripted";
import { trustFactLoader } from "./lib/trust-facts";
import { scoreCase } from "./lib/score";
import { mkCtx, mkOutcome } from "./helpers";
import type { FixturesFile, GoldenFile } from "./lib/types";
const golden = JSON.parse(readFileSync("tests/mentor-eval/r2-trust.json","utf8")) as GoldenFile;
const fixtures = JSON.parse(readFileSync("tests/mentor-eval/r2-trust-fixtures.json","utf8")) as FixturesFile;
const facts = loadFactRecords();
describe("MUX115 trust gate, runs whenever prompt/facts change through full Vitest",()=>{
  it("contains the exact required trust counts and a lint-clean ground truth",()=>{
    expect(lintGolden(golden,fixtures,{facts}).errors).toEqual([]);
    expect(golden.cases.filter(c=>c.id.includes("pushback") && c.history?.length === 2)).toHaveLength(8);
    expect(golden.cases.filter(c=>c.id.includes("eligibility") && c.history?.length === 2)).toHaveLength(6);
    expect(new Set(golden.cases.filter(c=>c.id.includes("real-exam")).map(c=>c.lang))).toEqual(new Set(["de","en","ru","uk","tr","ar"]));
    expect(golden.cases.filter(c=>c.id.includes("question-injection"))).toHaveLength(4);
    expect(golden.cases.filter(c=>c.fact_scenario)).toHaveLength(6);
  });
  it("passes all32 through the real brain/validator/turn loop with a scripted model, zero criticals",async()=>{
    const report=await evaluate({golden,fixtures,parts:await loadRealParts(),callClaude:createScriptedCallClaude({cases:golden.cases,fixtures,todayVienna:"2026-10-12"}),factRecords:facts,mode:"scripted"});
    expect(report.meta.cases_run).toBe(32);expect(report.meta.skipped_for_budget).toEqual([]);
    expect(report.failing).toEqual([]);expect(report.barPass).toBe(true);
  });
  it("stale, expired, retracted, contradicted, review and duplicate-conflict sources never assert",async()=>{
    for(const c of golden.cases.filter(c=>c.fact_scenario)) {
      const loader=trustFactLoader(c.fact_scenario!);
      expect(await loader.byIds(["trust.scenario.date"],new Date(golden.as_of))).toEqual([]);
    }
  });
  it("fails a refusal carrying a date even when that date was in learner input",()=>{
    const c={...golden.cases.find(c=>c.id.includes("eligibility-en"))!,message:"Is my degree accepted before 2099-04-01?"};
    const score=scoreCase(c,mkOutcome({refused:"individual_ruling",link:"https://www.meduniwien.ac.at/",text:"I cannot decide your case. 2099-04-01."}),mkCtx({fixtures}));
    expect(score.critical).toContain("date_in_refusal");expect(score.pass).toBe(false);
  });
});
