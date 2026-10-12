import { describe, expect, it } from "vitest";
import { EXAM_SITTINGS, getFutureSittings } from "@/lib/exam-dates";
import {
  FALLBACK_HORIZON_DAYS,
  addDays,
  daysBetween,
  nextSittings,
  planTargetShares,
  provisionalLabel,
  resolvePlanTarget,
} from "@/lib/master-learning/plan-target";

const NOW = new Date("2026-10-12T09:00:00Z");

describe("plan target", () => {
  it("no date and bank kenntnispruefung returns the next future sitting, provisional", () => {
    const sittings = getFutureSittings("kenntnispruefung", NOW);
    const t = resolvePlanTarget({ examDate: null, sittings, now: NOW });
    const expected = EXAM_SITTINGS.kenntnispruefung.map((s) => s.date).filter((d) => d >= "2026-10-12").sort()[0];
    expect(t.targetDate).toBe(expected);
    expect(t.provisional).toBe(true);
    expect(t.source).toBe("next_official_sitting");
    expect(t.expired).toBe(false);
  });

  it("no sitting listed returns now plus 84 days", () => {
    const t = resolvePlanTarget({ examDate: null, sittings: [], now: NOW });
    expect(t.source).toBe("fallback_horizon");
    expect(t.daysLeft).toBe(FALLBACK_HORIZON_DAYS);
    expect(t.targetDate).toBe(addDays("2026-10-12", 84));
    expect(t.provisional).toBe(true);
  });

  it("a chosen future date is used as is and is not provisional", () => {
    const t = resolvePlanTarget({ examDate: "2027-01-18", sittings: [{ date: "2026-11-01" }], now: NOW });
    expect(t).toMatchObject({ targetDate: "2027-01-18", provisional: false, source: "user_exam_date", expired: false });
    expect(t.daysLeft).toBe(daysBetween("2026-10-12", "2027-01-18"));
  });

  it("a date today still counts as chosen", () => {
    expect(resolvePlanTarget({ examDate: "2026-10-12", sittings: [], now: NOW }).provisional).toBe(false);
  });

  it("a past date moves to the next sitting, marked expired", () => {
    const t = resolvePlanTarget({ examDate: "2026-09-28", sittings: [{ date: "2027-01-18" }], now: NOW });
    expect(t).toMatchObject({ targetDate: "2027-01-18", provisional: true, expired: true });
  });

  it("after the last listed sitting nextSittings is empty and the 12 week fallback applies", () => {
    const late = new Date("2030-01-01T00:00:00Z");
    expect(nextSittings(getFutureSittings("kenntnispruefung", late), late)).toEqual([]);
    const t = resolvePlanTarget({ examDate: null, sittings: getFutureSittings("kenntnispruefung", late), now: late });
    expect(t.source).toBe("fallback_horizon");
  });

  it("nextSittings returns at most n future dates, sorted and unique", () => {
    const got = nextSittings(
      [{ date: "2027-05-10" }, { date: "2026-09-01" }, { date: "2027-01-18" }, { date: "2027-01-18" }, { date: "2027-09-27" }, { date: "bad" }],
      NOW,
      2,
    );
    expect(got.map((s) => s.date)).toEqual(["2027-01-18", "2027-05-10"]);
  });

  it("reports the two shares side by side", () => {
    const shares = planTargetShares(
      [{ examDate: "2027-01-18" }, { examDate: null }, { examDate: "2026-01-01" }, { examDate: undefined }],
      [{ date: "2027-05-10" }],
      NOW,
    );
    expect(shares.learners).toBe(4);
    expect(shares.withExamDate).toBe(1);
    expect(shares.withPlanTarget).toBe(4);
    expect(shares.withExamDateShare).toBe(0.25);
    expect(shares.withPlanTargetShare).toBe(1);
    expect(planTargetShares([], [], NOW).withPlanTargetShare).toBe(0);
  });

  it("labels a provisional target in DE and EN", () => {
    expect(provisionalLabel("de")).toBe("Vorläufig, bis Sie Ihren Termin wählen");
    expect(provisionalLabel("en")).toContain("Provisional");
  });
});
