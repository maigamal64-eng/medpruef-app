import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  EXAM_PRESETS,
  KMP_INNSBRUCK_BLUEPRINT,
  KP_BLUEPRINT,
  SPT_250_BLUEPRINT,
  SPT_FIELD_BLUEPRINT,
  aggregateBySubject,
  blueprintTotal,
  canStartPreset,
  dwellSecondsByIndex,
  enabledPresetsFor,
  evaluatePassRule,
  getExamPreset,
  gradeQuestion,
  kafQuestionsFromPool,
  paceSnapshot,
  PACING_DEFAULT_ON,
  remainingFromDeadline,
  resolveDuration,
  scaleDuration,
  type GradableQuestion,
  type ReviewedKafRow,
  type SubjectResult,
} from "@/lib/master-exam";
import { VIENNA_EXAM_PARTS } from "@/lib/topics";

const ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(ROOT, "src/lib/master-exam");

const mcq = (topic: string, correct: number[], n = 5): GradableQuestion => ({
  id: `${topic}-${correct.join("")}`,
  topic,
  options: Array.from({ length: n }, (_, i) => ({ text: `Option ${String.fromCharCode(65 + i)}`, correct: correct.includes(i) })),
});

describe("blueprints", () => {
  it("the /exam page reads its blueprints from the engine (no page copy)", () => {
    const page = readFileSync(path.join(ROOT, "src/app/exam/page.tsx"), "utf8");
    expect(page).toMatch(/from "@\/lib\/master-exam"/);
    expect(page).not.toMatch(/EXAM_BLUEPRINTS/);
    expect(page).not.toMatch(/\{ topic: "Innere Medizin", count: \d+ \}/);
  });

  it("sums: KP 180, SIP4 + SIP5 = KP, legacy Innsbruck 146, SPT 250", () => {
    expect(blueprintTotal(KP_BLUEPRINT)).toBe(180);
    expect(blueprintTotal(EXAM_PRESETS.kp_sip4.blueprint) + blueprintTotal(EXAM_PRESETS.kp_sip5.blueprint)).toBe(180);
    expect(EXAM_PRESETS.kp_sip4.blueprint.map((e) => e.topic).sort()).toEqual([...VIENNA_EXAM_PARTS.sip4].sort());
    expect(EXAM_PRESETS.kp_sip5.blueprint.map((e) => e.topic).sort()).toEqual([...VIENNA_EXAM_PARTS.sip5].sort());
    expect(blueprintTotal(KMP_INNSBRUCK_BLUEPRINT)).toBe(146);
    expect(blueprintTotal(SPT_250_BLUEPRINT)).toBe(250);
  });

  it("SPT fields match the Merkblatt structure (stp.structure) and the b21 field keys", () => {
    expect(SPT_FIELD_BLUEPRINT.map((f) => [f.key, f.count])).toEqual([
      ["innere_medizin", 30], ["chirurgie", 30], ["kinderheilkunde", 30],
      ["neurologie", 25], ["gynaekologie", 25], ["dermatologie", 25], ["notfallmedizin", 25],
      ["hno", 20], ["psychiatrie", 20], ["augenheilkunde", 20],
    ]);
    expect(SPT_250_BLUEPRINT.every((e) => /^field:[a-z_]+$/.test(e.fieldTag ?? ""))).toBe(true);
  });

  it("SPT 250 stays off and never shows up as an enabled preset (pick-spt-duration A)", () => {
    expect(EXAM_PRESETS.spt_250.enabled).toBe(false);
    expect(enabledPresetsFor("kmp_innsbruck").map((p) => p.id)).toEqual(["kmp_innsbruck_legacy"]);
    expect(canStartPreset(EXAM_PRESETS.spt_250, { "field:chirurgie": 999 })).toMatchObject({ ok: false, reason: "preset_disabled" });
  });

  it("EKG quota only on SIP4 and the full exam", () => {
    expect(Object.values(EXAM_PRESETS).filter((p) => p.ekgQuota).map((p) => p.id).sort()).toEqual(["kp_full", "kp_sip4"]);
  });

  it("getExamPreset ignores prototype keys", () => {
    expect(getExamPreset("toString")).toBeUndefined();
    expect(getExamPreset("kp_full")?.id).toBe("kp_full");
  });
});

describe("grading", () => {
  it("single best answer: index and text agree", () => {
    const q = mcq("Innere Medizin", [2]);
    expect(gradeQuestion(q, { indices: [2] })).toEqual({ correct: true, answered: true });
    expect(gradeQuestion(q, { texts: ["option c"] })).toEqual({ correct: true, answered: true });
    expect(gradeQuestion(q, { indices: [1] }).correct).toBe(false);
    expect(gradeQuestion(q, { texts: ["Option B"] }).correct).toBe(false);
  });

  it("Pick-N is all or nothing, no partial credit (pick-partial-credit A)", () => {
    const q = mcq("Neurologie", [0, 3]);
    const cases: [number[], boolean][] = [[[0, 3], true], [[3, 0], true], [[0], false], [[0, 3, 4], false], [[1, 2], false]];
    for (const [sel, want] of cases) {
      expect(gradeQuestion(q, { indices: sel }).correct).toBe(want);
      expect(gradeQuestion(q, { texts: sel.map((i) => q.options![i].text) }).correct).toBe(want);
    }
  });

  it("index and text grading agree on every subset of a 5-option item", () => {
    const q = mcq("Psychiatrie", [1, 4]);
    for (let mask = 1; mask < 32; mask++) {
      const sel = [0, 1, 2, 3, 4].filter((i) => mask & (1 << i));
      expect(gradeQuestion(q, { indices: sel }).correct).toBe(gradeQuestion(q, { texts: sel.map((i) => q.options![i].text) }).correct);
    }
  });

  it("unanswered, empty and unknown text are never correct", () => {
    const q = mcq("HNO", [0]);
    expect(gradeQuestion(q, undefined)).toEqual({ correct: false, answered: false });
    expect(gradeQuestion(q, { indices: [] })).toEqual({ correct: false, answered: false });
    expect(gradeQuestion(q, { texts: ["  "] })).toEqual({ correct: false, answered: false });
    expect(gradeQuestion(q, { texts: ["not an option"] })).toEqual({ correct: false, answered: true });
    expect(gradeQuestion({ id: 1, topic: "x", options: [] }, { indices: [0] }).correct).toBe(false);
  });

  it("duplicate option texts make text grading refuse rather than guess", () => {
    const q: GradableQuestion = { id: 9, topic: "x", options: [{ text: "Same", correct: true }, { text: "same", correct: false }] };
    expect(gradeQuestion(q, { texts: ["Same"] }).correct).toBe(false);
    expect(gradeQuestion(q, { indices: [0] }).correct).toBe(true);
  });

  it("KAF text sets: every required answer once, spelling folded", () => {
    const q: GradableQuestion = { id: 7, topic: "Innere Medizin", acceptedAnswers: [["Lungenembolie", "Pulmonalembolie"], ["Heparin"]] };
    expect(gradeQuestion(q, { texts: ["heparin", "Lungen-Embolie"] }).correct).toBe(false);
    expect(gradeQuestion(q, { texts: ["heparin", "LUNGENEMBOLIE"] }).correct).toBe(true);
    expect(gradeQuestion(q, { texts: ["Pulmonalembolie"] }).correct).toBe(false);
    expect(gradeQuestion({ id: 8, topic: "x", acceptedAnswers: [["Fußpuls"]] }, { texts: ["fusspuls"] }).correct).toBe(true);
  });
});

describe("aggregation and pass rules", () => {
  const subj = (topic: string, correct: number, total: number): SubjectResult =>
    ({ topic, correct, total, answered: total, pct: correct / total, avgSecondsPerQuestion: null });

  it("aggregates per subject with average seconds per question", () => {
    const qs = [mcq("A", [0]), mcq("A", [1]), mcq("B", [2])];
    const res = aggregateBySubject(qs, { 0: { indices: [0] }, 1: { indices: [0] } }, { 0: 60, 1: 120, 2: 30 });
    expect(res).toEqual([
      { topic: "A", total: 2, answered: 2, correct: 1, pct: 0.5, avgSecondsPerQuestion: 90 },
      { topic: "B", total: 1, answered: 0, correct: 0, pct: 0, avgSecondsPerQuestion: 30 },
    ]);
    expect(aggregateBySubject(qs, {})[0].avgSecondsPerQuestion).toBeNull();
  });

  it("overall-60 matches the page rule at the boundary (108/180 passes, 107 fails)", () => {
    expect(evaluatePassRule("overall-60", [subj("x", 108, 180)]).passed).toBe(true);
    expect(evaluatePassRule("overall-60", [subj("x", 107, 180)]).passed).toBe(false);
    expect(evaluatePassRule("overall-60", [subj("x", 3, 5)]).passed).toBe(true);
    expect(evaluatePassRule("overall-60", []).passed).toBe(false);
  });

  it("SIP blocks: 60 percent overall AND in every block (sip.pass)", () => {
    const ok = [subj("Chirurgische Fächer", 17, 28), subj("Innere Medizin", 17, 28), subj("Dermatologie und Venerologie", 9, 14)];
    expect(evaluatePassRule("sip-overall-and-blocks-60", ok).passed).toBe(true);
    const oneBlockLow = [subj("Chirurgische Fächer", 28, 28), subj("Innere Medizin", 28, 28), subj("Dermatologie und Venerologie", 8, 14)];
    const r = evaluatePassRule("sip-overall-and-blocks-60", oneBlockLow);
    expect(r.overallPct).toBeGreaterThan(0.9);
    expect(r.passed).toBe(false);
    expect(r.negativeUnits).toEqual(["Dermatologie und Venerologie"]);
  });

  it("SPT: six positive fields pass, five fail, regardless of overall percent (stp.pass)", () => {
    const fields = SPT_FIELD_BLUEPRINT.map((f) => f.key);
    const six = fields.map((k, i) => subj(k, i < 6 ? 15 : 0, 25));
    expect(evaluatePassRule("stp-six-fields-60", six).passed).toBe(true);
    const five = fields.map((k, i) => subj(k, i < 5 ? 25 : 14, 25));
    const r = evaluatePassRule("stp-six-fields-60", five);
    expect(r.overallPct).toBeGreaterThan(0.6);
    expect(r.passed).toBe(false);
    expect(r.positiveUnits).toHaveLength(5);
  });
});

describe("duration and pacing", () => {
  const sittings = [
    { examKey: "stichprobentest", date: "2027-02-03", status: "not_confirmed" as const, sourceId: "source-09", durationMin: 300 },
    { examKey: "sip4a", date: "2027-02-19", status: "official" as const, sourceId: "source-05", durationMin: 150 },
  ];

  it("uses an official duration only when the data file records one", () => {
    expect(resolveDuration(EXAM_PRESETS.kp_sip4, sittings, "2027-02-19")).toEqual({ seconds: 9000, kind: "official", sourceId: "source-05", sittingDate: "2027-02-19" });
    expect(resolveDuration(EXAM_PRESETS.spt_250, sittings, "2027-02-03")).toMatchObject({ seconds: 14400, kind: "practice", sourceId: null });
    expect(resolveDuration(EXAM_PRESETS.kp_full, sittings)).toMatchObject({ seconds: 14400, kind: "practice" });
  });

  it("reload at hour 3 keeps one hour left; never negative or above the duration", () => {
    const start = Date.UTC(2027, 1, 19, 8);
    expect(remainingFromDeadline(start, 14400, start + 3 * 3600_000)).toBe(3600);
    expect(remainingFromDeadline(start, 14400, start + 5 * 3600_000)).toBe(0);
    expect(remainingFromDeadline(start, 14400, start - 60_000)).toBe(14400);
  });

  it("scales a shorter custom exam proportionally with a one-minute floor", () => {
    expect(scaleDuration(14400, 180, 90)).toBe(7200);
    expect(scaleDuration(14400, 180, 1)).toBe(80);
    expect(scaleDuration(600, 180, 1)).toBe(60);
    expect(scaleDuration(14400, 180, 400)).toBe(14400);
    expect(scaleDuration(14400, 180, 0)).toBe(0);
  });

  it("pacing is off by default and reads 1.5 minutes per question", () => {
    expect(PACING_DEFAULT_ON).toBe(false);
    // Rezeptierkunde: 30 items in 60 minutes is two minutes each (SIM-05).
    expect(Object.values(EXAM_PRESETS).every((p) => p.pacingTargetS === (p.id === "rx_mc_30" ? 120 : 90))).toBe(true);
    expect(paceSnapshot(90 * 40, 40, 180, 90)).toMatchObject({ state: "on_track", expected: 40, deltaQuestions: 0, avgSecondsPerAnswered: 90 });
    expect(paceSnapshot(90 * 40, 30, 180, 90).state).toBe("behind");
    expect(paceSnapshot(90 * 40, 50, 180, 90).state).toBe("ahead");
    expect(paceSnapshot(90 * 500, 180, 180, 90).expected).toBe(180);
    expect(paceSnapshot(0, 0, 180, 90).avgSecondsPerAnswered).toBeNull();
  });

  it("dwell time sums revisits", () => {
    expect(dwellSecondsByIndex([[0, 0], [1, 30_000], [0, 90_000]], 100_000)).toEqual({ 0: 40, 1: 60 });
  });
});

describe("KAF pool guard (pick-kaf-pool build)", () => {
  const row = (id: number, v1: string, v2: string): ReviewedKafRow => ({
    id, topic: "Innere Medizin", stored_answer: "Pulmonalembolie",
    read1: { verdict: v1, model_answer: "Pulmonalembolie", key_points: ["Lungenembolie"] },
    read2: { verdict: v2, model_answer: "Lungenembolie", key_points: [] },
  });

  it("empty pool blocks the start; only two-read passes enter", () => {
    expect(canStartPreset(EXAM_PRESETS.kaf_timed, 0)).toMatchObject({ ok: false, reason: "empty_pool" });
    const qs = kafQuestionsFromPool([row(1, "include", "fix-then-include"), row(2, "include", "exclude"), row(3, "exclude", "include")]);
    expect(qs.map((q) => q.id)).toEqual([1]);
    expect(canStartPreset(EXAM_PRESETS.kaf_timed, qs.length)).toEqual({ ok: true, questionCount: 1 });
    expect(gradeQuestion(qs[0], { texts: ["Lungenembolie"] }).correct).toBe(true);
    expect(gradeQuestion(qs[0], { texts: ["Pneumonie"] }).correct).toBe(false);
  });

  it("reads must agree on the key; a key both reads correct is never accepted in its stored wording", () => {
    // Shape of pool row 63854: both reads say key_correct "no" and give the corrected answer.
    const corrected: ReviewedKafRow = {
      id: 63854, topic: "Innere Medizin", stored_answer: "Rascher chirurgischer Mitralklappenersatz",
      read1: { verdict: "fix-then-include", model_answer: "Mitralklappenrekonstruktion", key_points: [], key_correct: "no" },
      read2: { verdict: "fix-then-include", model_answer: "Mitralklappenrekonstruktion", key_points: [], key_correct: "no" },
    };
    const disagree: ReviewedKafRow = { ...corrected, id: 2, read2: { ...corrected.read2, key_correct: "yes" } };
    const qs = kafQuestionsFromPool([corrected, disagree]);
    expect(qs.map((q) => q.id)).toEqual([63854]);
    expect(gradeQuestion(qs[0], { texts: ["Rascher chirurgischer Mitralklappenersatz"] }).correct).toBe(false);
    expect(gradeQuestion(qs[0], { texts: ["Mitralklappenrekonstruktion"] }).correct).toBe(true);
  });

  it("rows needing a stem cleanup stay out until the fix is applied", () => {
    const r = { ...row(7, "include", "include"), stem_fix_needed: true };
    expect(kafQuestionsFromPool([r])).toEqual([]);
    expect(kafQuestionsFromPool([r], { stemFixApplied: (id) => id === 7 }).map((q) => q.id)).toEqual([7]);
  });

  it("blueprint presets refuse to start short", () => {
    const counts = Object.fromEntries(KP_BLUEPRINT.map((e) => [e.topic, e.count]));
    expect(canStartPreset(EXAM_PRESETS.kp_full, counts)).toEqual({ ok: true, questionCount: 180 });
    expect(canStartPreset(EXAM_PRESETS.kp_full, { ...counts, Augenheilkunde: 11 })).toMatchObject({ ok: false, reason: "short_blueprint", detail: "Augenheilkunde" });
  });
});

describe("purity", () => {
  it("no UI, React, Next or Supabase import; no dash or Arabic in source", () => {
    for (const f of readdirSync(SRC)) {
      const text = readFileSync(path.join(SRC, f), "utf8");
      expect(text, f).not.toMatch(/from "(react|next\/[^"]*|@supabase\/[^"]*|@\/components\/[^"]*|@\/app\/[^"]*)"/);
      expect(text, f).not.toMatch(/"use client"/);
      expect(text, f).not.toMatch(/[–—؀-ۿ]/);
    }
  });
});
