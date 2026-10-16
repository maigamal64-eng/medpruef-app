import { describe, expect, it } from "vitest";
import {
  cramDaysBucket,
  cramSimulationOffsets,
  filterPartTopics,
  parseCramView,
  partBlueprintWeights,
  resolveCramPart,
  runSubjects,
  runWeakSubjects,
  drillRunFor,
} from "@/lib/cram-part-plan";
import { cramPartPlanEnabled } from "@/lib/cram-part-plan/flag";
import { CRAM_COPY } from "@/lib/cram-part-plan/copy";
import { pickSimulationDays } from "@/lib/master-learning/plan-simulations";
import { addDays } from "@/lib/master-learning/plan-target";
import { generateStudyPlan, type TopicProgress } from "@/lib/studyPlan";
import { simulationPresetFor } from "@/lib/study-plan-target";
import { partOfPreset, simulationHref } from "@/lib/study-plan-view";
import { VIENNA_EXAM_PARTS } from "@/lib/topics";
import type { OfficialSitting } from "@/lib/exam-dates";

const OCT20 = new Date("2026-10-20T10:00:00Z");

const ALL_TEN: TopicProgress[] = [...VIENNA_EXAM_PARTS.sip4, ...VIENNA_EXAM_PARTS.sip5].map((topic) => ({
  topic, total: 400, answered: 0, correct: 0, accuracy: 0,
}));

function row(exam_key: "sip4a" | "sip5a", date: string, extra: Partial<OfficialSitting> = {}): OfficialSitting {
  return {
    exam_key, date, date_end: null, learner_label: exam_key, registration_opens: "2026-10-05", registration_closes: "2026-10-19",
    publisher: null, deadline_type: null, source_url: "https://example.invalid", ...extra,
  } as unknown as OfficialSitting;
}

describe("flag", () => {
  it("only the literal true", () => {
    expect(cramPartPlanEnabled({})).toBe(false);
    expect(cramPartPlanEnabled({ CRAM_PART_PLAN_ENABLED: "1" })).toBe(false);
    expect(cramPartPlanEnabled({ CRAM_PART_PLAN_ENABLED: "true" })).toBe(true);
  });
});

describe("resolveCramPart (saved sitting row)", () => {
  it("November: SIP5a 17 Nov and SIP4a 18 Nov resolve to their part presets", () => {
    expect(resolveCramPart({ examDate: "2026-11-17", activeExam: "kenntnispruefung" }, OCT20)).toMatchObject({ part: "sip5", presetId: "kp_sip5", examKey: "sip5a", date: "2026-11-17" });
    expect(resolveCramPart({ examDate: "2026-11-18", activeExam: "kenntnispruefung" }, OCT20)).toMatchObject({ part: "sip4", presetId: "kp_sip4", examKey: "sip4a" });
  });
  it("same-date rows and window_unconfirmed rows keep the all-subject plan", () => {
    // 10 Mar 2027: SIP4a and SIP5a on one day, window unconfirmed.
    expect(resolveCramPart({ examDate: "2027-03-10", activeExam: "kenntnispruefung" }, OCT20)).toBeNull();
    const sameDate = [row("sip4a", "2026-12-01"), row("sip5a", "2026-12-01")];
    expect(resolveCramPart({ examDate: "2026-12-01", activeExam: "kenntnispruefung" }, OCT20, sameDate)).toBeNull();
    const unconfirmed = [row("sip4a", "2026-12-01", { window_unconfirmed: true })];
    expect(resolveCramPart({ examDate: "2026-12-01", activeExam: "kenntnispruefung" }, OCT20, unconfirmed)).toBeNull();
    expect(resolveCramPart({ examDate: "2026-12-01", activeExam: "kenntnispruefung" }, OCT20, [row("sip4a", "2026-12-01")])).toMatchObject({ part: "sip4" });
  });
  it("another bank, no date, a date that is no sitting, or a past sitting: null", () => {
    expect(resolveCramPart({ examDate: "2026-11-18", activeExam: "pharma" }, OCT20)).toBeNull();
    expect(resolveCramPart({ examDate: null, activeExam: "kenntnispruefung" }, OCT20)).toBeNull();
    expect(resolveCramPart({ examDate: "2026-11-19", activeExam: "kenntnispruefung" }, OCT20)).toBeNull();
    expect(resolveCramPart({ examDate: "2026-11-18", activeExam: "kenntnispruefung" }, new Date("2026-11-18T10:00:00Z"))).toBeNull();
  });
});

describe("part filter and blueprint weights", () => {
  it("a SIP4a plan keeps only the three SIP4a subjects, SIP5a only its seven", () => {
    expect(filterPartTopics(ALL_TEN, "sip4").map((t) => t.topic).sort()).toEqual([...VIENNA_EXAM_PARTS.sip4].sort());
    expect(filterPartTopics(ALL_TEN, "sip5")).toHaveLength(VIENNA_EXAM_PARTS.sip5.length);
  });
  it("weights follow the part preset blueprint, mean 1", () => {
    const w = partBlueprintWeights("sip4");
    expect(w["Innere Medizin"]).toBeCloseTo(1.2);
    expect(w["Chirurgische Fächer"]).toBeCloseTo(1.2);
    expect(w["Dermatologie und Venerologie"]).toBeCloseTo(0.6);
    const w5 = Object.values(partBlueprintWeights("sip5"));
    expect(w5.reduce((a, b) => a + b, 0) / w5.length).toBeCloseTo(1);
  });
  it("a SIP4a plan of 21 days only schedules SIP4a subjects, and Innere/Chirurgie get more than Dermatologie", () => {
    const plan = generateStudyPlan({
      examDate: new Date("2026-11-18T00:00:00Z"), now: new Date("2026-10-28T12:00:00Z"), dailyQuestionGoal: 40,
      availableTopics: filterPartTopics(ALL_TEN, "sip4"), topicWeights: partBlueprintWeights("sip4"),
    });
    const per: Record<string, number> = {};
    for (const d of plan.dailySchedule) for (const t of d.topics) per[t.topic] = (per[t.topic] ?? 0) + t.targetCount;
    expect(Object.keys(per).every((t) => VIENNA_EXAM_PARTS.sip4.includes(t))).toBe(true);
    expect(per["Innere Medizin"]).toBeGreaterThan(per["Dermatologie und Venerologie"]);
  });
});

describe("simulation days (cram)", () => {
  const exam = "2026-11-18";
  const offsets = (days: number) => pickSimulationDays({ startDay: addDays(exam, -days), examDate: exam, consolidationStart: addDays(exam, -Math.round(days * 0.3)), presetId: "kp_sip4", cram: true }).map((d) => d.offsetDays);
  it("10 days: one run (T-7)", () => expect(offsets(10)).toEqual([7]));
  it("14 days: T-14 and T-7", () => expect(offsets(14)).toEqual([14, 7]));
  it("21 days: T-14 and T-7", () => expect(offsets(21)).toEqual([14, 7]));
  it("28 days: T-14 and T-7", () => expect(offsets(28)).toEqual([14, 7]));
  it("below 10 days: none", () => {
    expect(offsets(9)).toEqual([]);
    expect(cramSimulationOffsets(addDays(exam, -9), exam)).toEqual([]);
  });
  it("35 days (and every plan of 30 days or more): unchanged", () => {
    for (const days of [30, 35, 45, 60, 90]) {
      const base = { startDay: addDays(exam, -days), examDate: exam, consolidationStart: addDays(exam, -Math.round(days * 0.3)), presetId: "kp_sip4" };
      expect(pickSimulationDays({ ...base, cram: true })).toEqual(pickSimulationDays(base));
    }
    expect(offsets(35)).toEqual([7, 4]);
  });
  it("without cram nothing changes below 30 days", () => {
    expect(pickSimulationDays({ startDay: addDays(exam, -21), examDate: exam, consolidationStart: addDays(exam, -6), presetId: "kp_full" })).toEqual([]);
  });
});

describe("generateStudyPlan with the cram inputs", () => {
  const exam = new Date("2026-11-18T00:00:00Z");
  const topics = filterPartTopics(ALL_TEN, "sip4");
  const build = (now: string, extra: Partial<Parameters<typeof generateStudyPlan>[0]> = {}) => generateStudyPlan({
    examDate: exam, now: new Date(now), dailyQuestionGoal: 30, availableTopics: topics,
    simulationPresetId: "kp_sip4", lightDays: true, topicWeights: partBlueprintWeights("sip4"), cramSimulations: true, ...extra,
  });

  it("without the new inputs the generator output is today's", () => {
    const input = { examDate: exam, now: new Date("2026-10-20T12:00:00Z"), dailyQuestionGoal: 30, availableTopics: ALL_TEN, simulationPresetId: "kp_full", lightDays: true };
    const a = generateStudyPlan(input);
    const b = generateStudyPlan({ ...input, topicWeights: undefined, cramSimulations: undefined, drill: undefined });
    expect(b).toEqual(a);
    expect(a.dailySchedule.some((d) => d.simulation)).toBe(false); // 29 days, kp_full: no run today
    expect(a.dailySchedule.some((d) => d.drill)).toBe(false);
  });

  it("a learner starting on 20 Oct (29 days) gets two SIP4a runs, T-14 and T-7, and pending drill days after them", () => {
    const plan = build("2026-10-20T12:00:00Z", { drill: { presetId: "kp_sip4", runs: [] } });
    const sims = plan.dailySchedule.filter((d) => d.simulation);
    expect(sims.map((d) => [d.day, d.simulation!.presetId])).toEqual([["2026-11-04", "kp_sip4"], ["2026-11-11", "kp_sip4"]]);
    const drills = plan.dailySchedule.filter((d) => d.drill);
    expect(drills.map((d) => [d.day, d.drill!.state])).toEqual([["2026-11-05", "pending"], ["2026-11-12", "pending"]]);
    expect(drills.every((d) => !d.light)).toBe(true);
  });

  it("the day after a run practises that run's subjects below 60 percent", () => {
    const runs = [{ presetId: "kp_sip4", day: "2026-11-04", weak: [{ topic: "Innere Medizin", pct: 0.4 }, { topic: "Dermatologie und Venerologie", pct: 0.55 }] }];
    const plan = build("2026-10-25T12:00:00Z", { drill: { presetId: "kp_sip4", runs } });
    const d = plan.dailySchedule.find((x) => x.day === "2026-11-05")!;
    expect(d.drill).toMatchObject({ state: "blocks", runDay: "2026-11-04", blocks: ["Innere Medizin", "Dermatologie und Venerologie"] });
    expect(d.topics.map((t) => t.topic)).toEqual(["Innere Medizin", "Dermatologie und Venerologie"]);
    expect(d.topics.every((t) => t.focus === "weak")).toBe(true);
    expect(d.totalQuestions).toBe(30);
    expect(d.topics[0].targetCount).toBeGreaterThan(d.topics[1].targetCount);
  });

  it("a run yesterday makes today a drill day even when its scheduled day has left the plan", () => {
    const runs = [{ presetId: "kp_sip4", day: "2026-11-04", weak: [{ topic: "Chirurgische Fächer", pct: 0.5 }] }];
    const plan = build("2026-11-05T12:00:00Z", { drill: { presetId: "kp_sip4", runs } });
    expect(plan.dailySchedule[0].day).toBe("2026-11-05");
    expect(plan.dailySchedule[0].drill).toMatchObject({ state: "blocks", blocks: ["Chirurgische Fächer"] });
    // 13 days left: T-7 still scheduled.
    expect(plan.dailySchedule.filter((d) => d.simulation).map((d) => d.day)).toEqual(["2026-11-11"]);
  });

  it("an older run never fills the drill day after a scheduled run still ahead", () => {
    // Run at T-16, T-14 still ahead: the T-13 drill day stays pending.
    const runs = [{ presetId: "kp_sip4", day: "2026-11-02", weak: [{ topic: "Innere Medizin", pct: 0.3 }] }];
    const plan = build("2026-10-25T12:00:00Z", { drill: { presetId: "kp_sip4", runs } });
    expect(plan.dailySchedule.find((x) => x.day === "2026-11-05")!.drill).toMatchObject({ state: "pending" });
  });

  it("a run with no subject below 60 percent keeps the day's plan", () => {
    const runs = [{ presetId: "kp_sip4", day: "2026-11-11", weak: [] }];
    const plan = build("2026-11-12T12:00:00Z", { drill: { presetId: "kp_sip4", runs } });
    expect(plan.dailySchedule[0].drill).toMatchObject({ state: "none_below", runDay: "2026-11-11" });
    expect(plan.dailySchedule[0].topics.length).toBeGreaterThan(0);
  });

  it("runs of the other part never fill a drill day", () => {
    const runs = [{ presetId: "kp_sip5", day: "2026-11-04", weak: [{ topic: "Neurologie", pct: 0.2 }] }];
    const plan = build("2026-11-05T12:00:00Z", { drill: { presetId: "kp_sip4", runs } });
    expect(plan.dailySchedule[0].drill).toBeUndefined();
  });

  it("no drill input (free accounts): run days stay, no drill days", () => {
    const plan = build("2026-10-20T12:00:00Z");
    expect(plan.dailySchedule.filter((d) => d.simulation)).toHaveLength(2);
    expect(plan.dailySchedule.some((d) => d.drill)).toBe(false);
  });
});

describe("runs", () => {
  it("subjects below 60 percent, weakest first, removed questions left out", () => {
    const topicById = new Map<number, string>([[1, "Innere Medizin"], [2, "Innere Medizin"], [3, "Dermatologie und Venerologie"], [4, "Chirurgische Fächer"], [5, "Chirurgische Fächer"]]);
    const grading = { "1": { is_correct: true }, "2": { is_correct: false }, "3": { is_correct: false }, "4": { is_correct: true }, "5": { is_correct: true }, "6": { is_correct: false } };
    const subjects = runSubjects([1, 2, 3, 4, 5, 6], grading, topicById);
    expect(runWeakSubjects(subjects, "sip4")).toEqual([{ topic: "Dermatologie und Venerologie", pct: 0 }, { topic: "Innere Medizin", pct: 0.5 }]);
  });
  it("a drill day uses the newest run of its preset within 7 days before it", () => {
    const runs = [
      { presetId: "kp_sip4", day: "2026-11-01", weak: [] },
      { presetId: "kp_sip4", day: "2026-11-04", weak: [] },
      { presetId: "kp_sip4", day: "2026-11-12", weak: [] },
    ];
    expect(drillRunFor("2026-11-05", "kp_sip4", runs)?.day).toBe("2026-11-04");
    expect(drillRunFor("2026-11-19", "kp_sip4", runs)?.day).toBe("2026-11-12");
    expect(drillRunFor("2026-11-20", "kp_sip4", runs)).toBeNull();
    expect(drillRunFor("2026-11-04", "kp_sip4", runs)?.day).toBe("2026-11-01");
    expect(drillRunFor("2026-11-05", "kp_sip4", runs, "2026-11-04")?.day).toBe("2026-11-04");
    expect(drillRunFor("2026-11-05", "kp_sip4", runs.slice(0, 1), "2026-11-04")).toBeNull();
  });
});

describe("links and presets", () => {
  it("the plan runs the part preset, the full run without a part", () => {
    expect(simulationPresetFor("kenntnispruefung", "sip4")).toBe("kp_sip4");
    expect(simulationPresetFor("kenntnispruefung", "sip5")).toBe("kp_sip5");
    expect(simulationPresetFor("kenntnispruefung")).toBe("kp_full");
  });
  it("part links open the part and carry from=plan; full-run links are today's", () => {
    expect(simulationHref("kenntnispruefung", "sip4")).toBe("/exam?examSource=kenntnispruefung&part=sip4&returnTo=%2Fstudy-plan&from=plan");
    expect(simulationHref("kenntnispruefung")).toBe("/exam?examSource=kenntnispruefung&part=all&returnTo=%2Fstudy-plan");
    expect(partOfPreset("kp_sip5")).toBe("sip5");
    expect(partOfPreset("kp_full")).toBe("all");
  });
});

describe("view, buckets, copy", () => {
  it("days buckets", () => {
    expect([5, 10, 13, 14, 20, 21, 29, 30].map(cramDaysBucket)).toEqual(["lt10", "d10_13", "d10_13", "d14_20", "d14_20", "d21_29", "d21_29", "d30plus"]);
  });
  it("parseCramView accepts only known shapes and drops foreign subjects", () => {
    expect(parseCramView(undefined)).toBeNull();
    expect(parseCramView({ part: "all", days: "d21_29" })).toEqual({ part: "all", days: "d21_29" });
    expect(parseCramView({ part: "sip4", presetId: "kp_sip5", examKey: "sip4a", date: "2026-11-18", days: "d21_29" })).toBeNull();
    expect(parseCramView({ part: "sip4", presetId: "kp_sip4", examKey: "sip4a", date: "2026-11-18", days: "d21_29", kaf: true, latestRun: { day: "2026-11-04", weak: ["Innere Medizin", "<script>"] } }))
      .toMatchObject({ part: "sip4", kaf: true, latestRun: { day: "2026-11-04", weak: ["Innere Medizin"] } });
  });
  it("copy: German and English, Sie, no em dash, no exclamation, no pass promise, American English", () => {
    for (const [k, v] of Object.entries(CRAM_COPY)) {
      expect(v.de, k).toBeTruthy();
      expect(v.en, k).toBeTruthy();
      expect(v.de + v.en, k).not.toMatch(/[—!]/);
      expect(v.de, k).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
      expect((v.de + " " + v.en).replace(/keine Vorhersage|not a forecast|nicht als offizielle Bestehensregel|not as an official pass rule/g, ""), k).not.toMatch(/bestanden|bestehen|pass|garant|Vorhersage|forecast|Deutschland/i);
      expect(v.en, k).not.toMatch(/practis/);
    }
  });
});
