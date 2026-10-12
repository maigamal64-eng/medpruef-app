import { describe, expect, it } from "vitest";
import { EXAM_PRESETS, RX_SIM_BLOCK_TAGS, blueprintTotal } from "@/lib/exam-presets";
import { normalizePart, partsForSource, planRun, presetForRun } from "@/lib/exam-run";
import { VIENNA_EXAM_PARTS } from "@/lib/topics";

describe("exam presets (a24)", () => {
  it("SIP4a and SIP5a presets follow the official part assignment (sip4a/sip5a.assignment)", () => {
    expect(EXAM_PRESETS.kp_sip4.blueprint.map((e) => e.topic).sort()).toEqual([...VIENNA_EXAM_PARTS.sip4].sort());
    expect(EXAM_PRESETS.kp_sip5.blueprint).toHaveLength(7);
    expect(EXAM_PRESETS.kp_sip4.passRuleId).toBe("sip-overall-and-blocks-60");
  });

  it("Rezeptierkunde MC: 30 items, 60 minutes, curriculum blocks, no pass mark (SIM-05)", () => {
    const rx = EXAM_PRESETS.rx_mc_30;
    expect(blueprintTotal(rx.blueprint)).toBe(30);
    expect(rx.practiceDurationS).toBe(3600);
    expect(rx.passRuleId).toBeNull();
    expect(rx.tagFilter).toEqual(RX_SIM_BLOCK_TAGS);
    expect(RX_SIM_BLOCK_TAGS).toEqual(["block:9", "block:10", "block:11", "block:14", "block:15", "block:18", "block:19", "block:21"]);
  });

  it("the Stichprobentest 250 preset stays off (pick-spt-bank A, pick-spt-duration A)", () => {
    expect(EXAM_PRESETS.spt_250.enabled).toBe(false);
    expect(blueprintTotal(EXAM_PRESETS.spt_250.blueprint)).toBe(250);
    expect(presetForRun("kmp_innsbruck", "all")?.id).toBe("kmp_innsbruck_legacy");
  });

  it("the Innsbruck legacy blueprint shows no threshold (its topics are not the ten fields)", () => {
    expect(EXAM_PRESETS.kmp_innsbruck_legacy.passRuleId).toBeNull();
  });

  it("every MCQ bank offers a custom run; invalid parts fall back to the full run (UX-EXM-26)", () => {
    expect(partsForSource("kmp_innsbruck")).toContain("custom");
    expect(partsForSource("pharma")).toContain("custom");
    expect(normalizePart("kmp_innsbruck", "sip4")).toBe("all");
    expect(normalizePart("kenntnispruefung", "sip5")).toBe("sip5");
    expect(normalizePart("kenntnispruefung", "nonsense")).toBe("all");
  });

  it("owed subjects narrow the run and keep the preset clock (SIM-03)", () => {
    const plan = planRun({ examSource: "kenntnispruefung", part: "sip5", owed: ["Neurologie", "Psychiatrie"] });
    expect(plan.blueprint.map((e) => e.topic)).toEqual(["Neurologie", "Psychiatrie"]);
    expect(plan.total).toBe(34);
    expect(plan.durationS).toBe(EXAM_PRESETS.kp_sip5.practiceDurationS);
    expect(plan.durationKind).toBe("practice");
  });

  it("SIP4 subset without internal medicine drops the ECG quota", () => {
    expect(planRun({ examSource: "kenntnispruefung", part: "sip4", owed: ["Dermatologie und Venerologie"] }).ekgQuota).toBe(false);
    expect(planRun({ examSource: "kenntnispruefung", part: "sip4" }).ekgQuota).toBe(true);
  });
});
