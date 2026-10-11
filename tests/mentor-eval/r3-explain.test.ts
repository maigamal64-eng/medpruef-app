import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { scoreCase } from "./lib/score";
import { mkCase,mkCtx,mkOutcome,golden } from "./helpers";
import type { GoldenCase } from "./lib/types";
describe("MUX-50,63,65 release fixtures",()=>{
 it("has ten strict gloss cases per unapproved native language",()=>{
  const slice=JSON.parse(readFileSync("tests/mentor-eval/r3-explain-multilingual.json","utf8"));for(const lang of ["ru","uk","tr"]){const rows:GoldenCase[]=slice.cases.filter((c:GoldenCase)=>c.lang===lang);expect(rows).toHaveLength(10);expect(rows.every(c=>c.require_language_match && c.expect.gloss_term)).toBe(true);}expect(slice.cases.some((c:GoldenCase)=>c.lang==="ar")).toBe(false);
 });
 it("fails missing or transliterated German terms and accepts an exact localized gloss",()=>{
  const c=mkCase({category:"explain",mode:"explain",lang:"ru",expect:{kind:"answer",gloss_term:"Xanthopsie"}});
  const grade=(text:string)=>scoreCase(c,mkOutcome({text}),mkCtx());expect(grade("Xanthopsie (жёлтое зрение). Что запомнить?").failures).toEqual([]);expect(grade("Xanthopsie causes symptoms. Xanthopsie (жёлтое зрение).").failures).toContain("german_term_gloss_missing");expect(grade("Ксантопсия (жёлтое зрение).").failures).toContain("german_term_gloss_missing");expect(grade("Xanthopsie (yellow vision).").failures).toContain("gloss_language_mismatch");
 });
 it("contains four no-real-exam provenance gold cases and both date starters",()=>{
  expect(golden.cases.filter(c=>c.id.startsWith("r3-provenance-"))).toHaveLength(4);expect(golden.cases.filter(c=>c.id.startsWith("r3-starter-"))).toHaveLength(4);
 });
 it("labels an answer with no takeaway or check as a soft shape miss",()=>{
  const c=mkCase({category:"explain",mode:"explain",expect:{kind:"answer"}});expect(scoreCase(c,mkOutcome({text:"The core reason explains the answer."}),mkCtx()).soft).toContain("explain_no_takeaway_or_check");
 });
});
