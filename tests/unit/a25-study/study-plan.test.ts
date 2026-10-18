import { describe, expect, it } from "vitest";
import { generateStudyPlan, unseenTotal, type TopicProgress } from "@/lib/studyPlan";
import { isStudyPlanResponse } from "@/lib/study-p0";
import { simulationPresetFor, studyPlanTarget, officialPlanSittings } from "@/lib/study-plan-target";
import { planPhases, reachableNew, registrationRows, registrationLineVisible, todayProgress, upcomingDays, focusKey, simulationMeta, simulationHref } from "@/lib/study-plan-view";

const NOW = new Date("2026-10-12T08:00:00Z");
const topics = (unseenEach: number, n = 4): TopicProgress[] =>
  Array.from({ length: n }, (_, i) => ({ topic: `T${i}`, total: unseenEach + 10, answered: 10, correct: 8, accuracy: 80 }));

describe("LX-01 / LX-03 plan target (pick-plan-target A)", () => {
  it("no own date: provisional plan toward the next official sitting of the bank, never written", () => {
    const t = studyPlanTarget("kenntnispruefung", null, NOW);
    expect(t).toMatchObject({ provisional: true, source: "next_official_sitting", expired: false });
    expect(t.targetDate).toBe(officialPlanSittings("kenntnispruefung", NOW)[0].date);
    expect(t.targetDate >= "2026-10-12").toBe(true);
    expect(t.nextSittings.length).toBeGreaterThan(0);
    expect(t.nextSittings.length).toBeLessThanOrEqual(3);
  });
  it("own future date wins and is not provisional", () => {
    expect(studyPlanTarget("kenntnispruefung", "2027-02-15", NOW)).toMatchObject({ targetDate: "2027-02-15", provisional: false, source: "user_exam_date" });
  });
  it("past own date: expired plus the next sitting for the one-tap switch", () => {
    const t = studyPlanTarget("kmp_innsbruck", "2026-05-04", NOW);
    expect(t).toMatchObject({ expired: true, provisional: true, source: "next_official_sitting" });
    expect(t.nextSittings[0]).toBe(t.targetDate);
  });
  it("after the last listed sitting: 12-week horizon, not a crash", () => {
    const t = studyPlanTarget("kenntnispruefung", null, new Date("2031-01-01T00:00:00Z"));
    expect(t).toMatchObject({ source: "fallback_horizon", daysLeft: 84, provisional: true });
    expect(t.nextSittings).toEqual([]);
  });
  it("the plan target is one of the dates the sitting picker offers", () => {
    const dates = officialPlanSittings("pharma", NOW).map((s) => s.date);
    expect(dates).toContain(studyPlanTarget("pharma", null, NOW).targetDate);
  });
});

describe("LX-02 days-and-load status", () => {
  it("6 weeks and 7,500 unseen at goal 20: tight status with the too_much verdict", () => {
    const plan = generateStudyPlan({ examDate: new Date("2026-11-23T00:00:00Z"), dailyQuestionGoal: 20, now: NOW, availableTopics: topics(1875) });
    expect(plan.effort).toMatchObject({ unseen: 7500, questionsPerDay: 179, verdict: "too_much" });
    expect(plan.status).toBe("tight");
    // The schedule shape stays new-then-review: not the short-window review-only plan.
    expect(plan.dailySchedule[0].phase).toBe("new");
  });
  it("5 months and 150 unseen: fits, status normal", () => {
    const plan = generateStudyPlan({ examDate: new Date("2027-03-12T00:00:00Z"), dailyQuestionGoal: 20, now: NOW, availableTopics: topics(50, 3) });
    expect(plan.effort?.verdict).toBe("fits");
    expect(plan.status).toBe("normal");
  });
  it("unseenTotal sums the open questions", () => {
    expect(unseenTotal(topics(5, 3))).toBe(15);
  });
});

describe("LX-04 simulation days", () => {
  const base = { dailyQuestionGoal: 20, now: NOW, availableTopics: topics(500) };
  it("a 60-day plan gets at least two mock exams inside the review window, at least 2 days apart", () => {
    const plan = generateStudyPlan({ ...base, examDate: new Date("2026-12-11T00:00:00Z"), simulationPresetId: "kp_full" });
    const sims = plan.dailySchedule.filter((d) => d.simulation);
    expect(sims.length).toBeGreaterThanOrEqual(2);
    for (const d of sims) {
      expect(d.phase).toBe("consolidation");
      expect(d.day >= plan.phaseBreak).toBe(true);
      expect(d.simulation?.presetId).toBe("kp_full");
    }
    const days = sims.map((d) => Date.parse(d.day) / 86_400_000);
    for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThan(2);
  });
  it("a 20-day plan gets none, and no preset means none", () => {
    expect(generateStudyPlan({ ...base, examDate: new Date("2026-11-01T00:00:00Z"), simulationPresetId: "kp_full" }).dailySchedule.some((d) => d.simulation)).toBe(false);
    expect(generateStudyPlan({ ...base, examDate: new Date("2026-12-11T00:00:00Z") }).dailySchedule.some((d) => d.simulation)).toBe(false);
  });
  it("only startable presets are scheduled; the length is read from the preset", () => {
    expect(simulationPresetFor("kenntnispruefung")).toBe("kp_full");
    expect(simulationPresetFor("pharma")).toBeNull();
    expect(simulationMeta("kp_full")).toMatchObject({ questions: expect.any(Number), durationS: expect.any(Number) });
    expect(simulationMeta("spt_250")).toBeNull();
    expect(simulationHref("kenntnispruefung")).toBe("/exam?examSource=kenntnispruefung&part=all&returnTo=%2Fstudy-plan");
  });
});

describe("UX-STU-23 light days", () => {
  it("every 7th day is half load and review only, never a simulation day", () => {
    const plan = generateStudyPlan({ examDate: new Date("2026-12-11T00:00:00Z"), dailyQuestionGoal: 20, now: NOW, availableTopics: topics(500), simulationPresetId: "kp_full", lightDays: true });
    const light = plan.dailySchedule.filter((d) => d.light);
    expect(light.length).toBeGreaterThan(5);
    for (const d of light) {
      expect(d.simulation).toBeUndefined();
      expect(d.totalQuestions).toBeLessThanOrEqual(10);
      expect(d.topics.every((t) => t.focus === "review")).toBe(true);
    }
  });
});

describe("UX-STU-18/24/26/27 view rules", () => {
  const plan = generateStudyPlan({ examDate: new Date("2026-12-11T00:00:00Z"), dailyQuestionGoal: 20, now: NOW, availableTopics: topics(500) });
  it("one phase model: review starts on the generator's switch day", () => {
    const phases = planPhases(plan, "2026-10-12");
    expect(phases.map((p) => p.key)).toEqual(["new", "review", "exam"]);
    expect(phases[1].from).toBe(plan.phaseBreak);
    expect(phases[0].status).toBe("current");
    expect(phases[2].from).toBe("2026-12-11");
  });
  it("Stichprobentest: both published deadlines with their publisher, never one picked", () => {
    const rows = registrationRows("kmp_innsbruck", "2027-02-03", "2026-12-01", new Date("2026-12-01T08:00:00Z"));
    expect(rows.map((r) => r.publisher).sort()).toEqual(["imed", "muw"]);
    expect(rows.every((r) => r.sourceUrl.startsWith("https://"))).toBe(true);
    expect(registrationLineVisible(rows)).toBe(true);
  });
  it("SIP sitting: one official row; quiet far from the deadline; custom date none", () => {
    const rows = registrationRows("kenntnispruefung", "2027-04-27", "2026-10-12", NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].publisher).toBeNull();
    // Quiet by deadline, but this window has not opened yet, so the line shows its opening day (a-lektor-followups-1015).
    expect(rows[0].level).toBe("quiet");
    expect(rows[0].opensLater).not.toBeNull();
    expect(registrationLineVisible(rows)).toBe(true);
    expect(registrationRows("kenntnispruefung", "2027-04-26", "2026-10-12", NOW)).toEqual([]);
  });
  it("weak blocks read 'Mehr üben', never 'Neu'", () => {
    expect(focusKey("weak")).toBe("focus_weak");
    expect(focusKey("review")).toBe("focus_review");
  });
  it("upcoming days start tomorrow and keep free days", () => {
    const days = upcomingDays(plan, "2026-10-12");
    expect(days[0].day).toBe("2026-10-13");
    expect(days).toHaveLength(6);
  });
  it("today's total is honest: unknown stays unknown, no per-block ticks", () => {
    expect(todayProgress(null, 20)).toEqual({ done: null, toGoal: null, reached: false });
    expect(todayProgress(7, 20)).toEqual({ done: 7, toGoal: 13, reached: false });
    expect(todayProgress(25, 20).reached).toBe(true);
  });
  it("reachable new questions never exceed the unseen pool", () => {
    expect(reachableNew(plan, 100)).toBe(100);
    expect(reachableNew(plan, 1e6)).toBeLessThan(1e6);
  });
});

describe("study-plan response guard", () => {
  it("accepts a provisional plan without an own date and keeps older no-plan fixtures", () => {
    const plan = generateStudyPlan({ examDate: new Date("2026-11-17T00:00:00Z"), dailyQuestionGoal: 20, now: NOW, availableTopics: topics(50) });
    expect(isStudyPlanResponse({ plan, hasExamDate: false, provisional: true, targetDate: "2026-11-17", nextSittings: ["2026-11-17"], answeredToday: 3 })).toBe(true);
    expect(isStudyPlanResponse({ plan, hasExamDate: false })).toBe(false);
    expect(isStudyPlanResponse({ plan: null, hasExamDate: false })).toBe(true);
    expect(isStudyPlanResponse({ plan, hasExamDate: false, targetDate: "17.11.2026" })).toBe(false);
    expect(isStudyPlanResponse({ plan, hasExamDate: true, examDate: "2026-11-17", answeredToday: -1 })).toBe(false);
  });
});
