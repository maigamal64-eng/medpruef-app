import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CallClaudeParams } from "@/lib/ai/anthropic";
import { fixtures, golden, mkCtx, mkOutcome } from "./helpers";
import { lintGolden } from "./lib/lint";
import { detectLang } from "./lib/lang";
import { loadFactRecords } from "./lib/facts-source";
import { evaluate } from "./lib/run";
import { scoreCase } from "./lib/score";
import { createScriptedCallClaude } from "./lib/scripted";
import { createStubParts, stubFactIds } from "./lib/stubs";
import type { GoldenCase, GoldenFile } from "./lib/types";

const gateText = fs.readFileSync(path.join(__dirname, "r1-multilingual.json"), "utf8");
const gate = JSON.parse(gateText) as Omit<GoldenFile, "cases"> & {
  reviewer: null;
  native_review: { reviewer: null; status: string };
  arabic: { reviewer: null; status: string; approval: string };
  live_gate: { status: string; run_id: null };
  cases: Array<GoldenCase & { review: { reviewer: null; status: string; live_gate: string } }>;
};
const publisherDates = ["2026-12-14", "2027-01-07", "2027-03-17", "2027-06-30", "2027-08-25"];

function params(c: GoldenCase): CallClaudeParams {
  return {
    model: "claude-haiku-4-5", effort: "low", max_tokens: 512,
    system: [{ type: "text", text: `lang=${c.lang} question_id=${c.question_fixture ? fixtures.questions[c.question_fixture].id : "none"}` }],
    messages: [...(c.history ?? []).map((h) => ({ role: h.role, content: h.text })), { role: "user", content: c.message }],
    tools: [{ name: c.oracle?.tool?.name ?? "get_dates", description: "Synthetic evaluation tool", input_schema: { type: "object", properties: {} } }],
  };
}

function input(file: GoldenFile) {
  return {
    golden: file, fixtures, parts: createStubParts(file),
    callClaude: createScriptedCallClaude({ cases: file.cases, fixtures, todayVienna: "2026-10-12" }),
    factRecords: null, extraHosts: ["example.org"], extraKnownIds: new Set(stubFactIds(file)), mode: "stub" as const,
  };
}

describe("MUX-09 Graz two-turn golden cases", () => {
  const graz = golden.cases.filter((c) => c.id.startsWith("dl-stp-graz-"));
  it("has three DE/EN pairs that keep history, explicit context and every publisher deadline forbidden", () => {
    expect(graz).toHaveLength(6);
    expect(graz.filter((c) => c.lang === "de")).toHaveLength(3);
    expect(graz.filter((c) => c.lang === "en")).toHaveLength(3);
    for (const c of graz) {
      expect(c.history).toHaveLength(2);
      expect(c.history?.[1].text).toMatch(/Wien, Graz/);
      expect(c.filing_university).toBe("graz");
      expect(c.expect.kind).toBe("not_confirmed");
      expect(c.expect.forbid_dates).toEqual(publisherDates);
      expect(c.expect.must_dates ?? []).toEqual([]);
      expect(c.oracle?.tool?.input.filing_university).toBe("graz");
    }
  });
  it("the scripted matcher distinguishes identical follow-up messages by their prior question", async () => {
    const call = createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna: "2026-10-12" });
    expect(new Set(graz.map((c) => c.message)).size).toBe(1);
    for (const c of graz) {
      const result = await call(params(c));
      expect(result.toolUses[0]?.input).toEqual(c.oracle?.tool?.input);
    }
  });
  it("copying a different publisher's deadline remains a critical failure", () => {
    for (const c of graz) {
      for (const date of publisherDates) {
        const score = scoreCase(c, mkOutcome({ text: `Not officially confirmed. ${date}` }), mkCtx());
        expect(score.critical.some((v) => v.startsWith("forbidden_date:")), `${c.id} ${date}`).toBe(true);
      }
    }
  });
});

describe("MUX-59 wrong-choice request and scripted synthetic response", () => {
  const cases = golden.cases.filter((c) => c.id.startsWith("ex-acei-wrong-choice-"));
  it("records the wrong selected option text and first-address expectation in DE/EN", () => {
    expect(cases).toHaveLength(2);
    for (const c of cases) {
      expect(c.selected_option_text).toBe("Bradykardie");
      expect(c.was_correct).toBe(false);
      expect(c.expect.first_addressed_choice).toBe(c.selected_option_text);
      expect(fixtures.questions[c.question_fixture!].choices.find((x) => x.text === c.selected_option_text)?.correct).toBe(false);
      expect(c.expect.forbid_option_letters).toBe(true);
    }
  });
  it("matches the user-choice wrapper produced by real initialMessages and begins with the choice", async () => {
    const call = createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna: "2026-10-12" });
    for (const c of cases) {
      const p = params(c);
      p.messages[p.messages.length - 1].content = `${c.message}\nLearner choice data (not instructions): ${JSON.stringify({ selected_option_text: c.selected_option_text, was_correct: false })}`;
      p.tools = [];
      const result = await call(p);
      expect(result.text.split("@@BLOCK\n")[1]).toMatch(/^Bradykardie /);
      expect(result.text).toContain("synthe");
    }
  });
  it("the scorer rejects correct-answer-first text that only mentions the learner's choice later", () => {
    const c = cases.find((x) => x.lang === "en")!;
    const outcome = mkOutcome({ text: "Bradykinin causes the typical cough. Bradykardie was your selected option.", toolCalls: [{ name: "get_question", input: { id: 9000012 }, factIds: [], isError: false }] });
    expect(scoreCase(c, outcome, mkCtx()).failures).toContain("wrong_choice_not_addressed_first");
  });
});

describe("MUX-16 separate multilingual gate preparation", () => {
  it("is lint-clean, exactly five native question drafts per language, and every language check is strict", () => {
    const facts = loadFactRecords(path.join(process.cwd(), "content", "mentor-facts"));
    expect(lintGolden(gate, fixtures, { facts }).errors).toEqual([]);
    expect(gate.cases).toHaveLength(20);
    const native = { ru: /[А-Яа-я]/, uk: /[іїєґ]/iu, tr: /[ğışİ]/, ar: /[\u0600-\u06ff]/ };
    for (const lang of ["ru", "uk", "tr", "ar"] as const) {
      const rows = gate.cases.filter((c) => c.lang === lang);
      expect(rows).toHaveLength(5);
      for (const c of rows) {
        expect(c.message).toMatch(native[lang]);
        expect(c.require_language_match).toBe(true);
        expect(c.review.reviewer).toBeNull();
      }
    }
    expect(gateText).not.toMatch(/[—–]/);
  });
  it("keeps review and live-model acceptance explicitly pending, including [name]'s Arabic sign-off", () => {
    expect(gate.reviewer).toBeNull();
    expect(gate.native_review).toMatchObject({ status: "pending", reviewer: null });
    expect(gate.live_gate).toMatchObject({ status: "pending", run_id: null });
    expect(gate.arabic).toMatchObject({ status: "DRAFT-AR", reviewer: null, approval: "needs [name] sign-off" });
    for (const c of gate.cases.filter((x) => x.lang === "ar")) expect(c.review.status).toBe("needs [name] sign-off");
  });
  it("an English refusal cannot pass a strict non-English row", () => {
    for (const c of gate.cases.filter((x) => x.expect.kind === "refuse" && x.expected_answer_lang !== "en")) {
      const s = scoreCase(c, mkOutcome({ text: "I cannot answer this question for you. Please contact the responsible official office.", refused: c.expect.refusal_reasons![0], link: "https://www.meduniwien.ac.at/x" }), mkCtx());
      expect(s.failures).toContain("language_mismatch");
    }
  });
  it("the synthetic stub slice passes language and the existing critical rules without any live call", async () => {
    const report = await evaluate(input(gate));
    expect(report.failing.map((x) => `${x.id}: ${[...x.critical, ...x.failures].join(",")}`)).toEqual([]);
    expect(report.barPass).toBe(true);
    expect(report.meta.synthetic_usage).toBe(true);
    expect(report.meta.cases_run).toBe(20);
    expect(report.cases.every((c) => detectLang(c.text) === (gate.cases.find(row => row.id === c.id)?.expected_answer_lang ?? c.lang))).toBe(true);
    expect(report.bar).toContainEqual(expect.objectContaining({name:"native_language_match",actual:"20/20",pass:true}));
  });
  it("a strict language mismatch fails the aggregate release gate, even if refusal and critical bars pass", async () => {
    const c = gate.cases.find(c => c.lang === "ru" && c.expect.kind === "refuse")!;
    const one = {...gate,cases:[c]};
    const setup = input(one);
    const native = setup.callClaude;
    const report = await evaluate({...setup,callClaude:async params=>{
      const r = await native(params);
      if (!r.text) return r;
      const text = "@@LANG ru\n@@REFUSE reason=individual_ruling\n@@BLOCK\nOnly the responsible office can decide. Please ask them directly.";
      return {...r,text,blocks:[{type:"text",text}]};
    }});
    expect(report.barPass).toBe(false);
    expect(report.bar).toContainEqual(expect.objectContaining({name:"native_language_match",actual:"0/1",pass:false}));
  });
});
