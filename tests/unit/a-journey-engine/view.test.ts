import { describe, expect, it } from "vitest";
import { getLearnerMoments } from "@/lib/journey/moments";
import { journeyView } from "@/lib/journey/view";
import { mockHrefFor } from "@/lib/journey/home";
import { SITTINGS_EXCERPT as S } from "./sittings-excerpt";

const on = { KAF_TIMED_ENABLED: "true", RESULTS_ROUTE_ENABLED: "true" };

describe("journeyView", () => {
  it("carries no label text and no learner id", () => {
    const v = journeyView(getLearnerMoments({ examDate: "2026-11-17", activeExam: "kenntnispruefung" }, new Date("2026-10-15T10:00:00Z"), S), {});
    expect(Object.keys(v).sort()).toEqual(["canConfirm", "closingSoon", "code", "inCram", "kaf", "named", "phase", "registered", "resultsRoute", "sittingWeek"]);
    expect(v.named).toEqual({ key: "sip5a:2026-11-17", exam_keys: ["sip5a"], segment: "vienna_sip", date: "2026-11-17" });
  });

  it("KAF only for SIP4a learners and only with KAF_TIMED_ENABLED", () => {
    const at = new Date("2026-10-25T10:00:00Z");
    const sip4 = getLearnerMoments({ examDate: "2026-11-18", activeExam: "kenntnispruefung" }, at, S);
    const sip5 = getLearnerMoments({ examDate: "2026-11-17", activeExam: "kenntnispruefung" }, at, S);
    expect(journeyView(sip4, on).kaf).toBe(true);
    expect(journeyView(sip4, {}).kaf).toBe(false);
    expect(journeyView(sip5, on).kaf).toBe(false);
  });

  it("M6 hands off only in the results window, for a route exam, with the route on", () => {
    const after = new Date("2026-11-25T10:00:00Z");
    const sip = getLearnerMoments({ examDate: "2026-11-17", activeExam: "kenntnispruefung" }, after, S);
    expect(journeyView(sip, on).resultsRoute).toBe(true);
    expect(journeyView(sip, {}).resultsRoute).toBe(false);
    const rez = getLearnerMoments({ examDate: "2026-11-23", activeExam: "pharma" }, new Date("2026-12-01T10:00:00Z"), S);
    expect(rez.phase).toBe("results");
    expect(journeyView(rez, on).resultsRoute).toBe(false);
    const before = getLearnerMoments({ examDate: "2026-11-17", activeExam: "kenntnispruefung" }, new Date("2026-11-10T10:00:00Z"), S);
    expect(journeyView(before, on).resultsRoute).toBe(false);
  });
});

describe("mockHrefFor", () => {
  it("opens the learner's own simulation, or the plan gate without the entitlement", () => {
    expect(mockHrefFor(["sip4a"], true)).toBe("/exam?examSource=kenntnispruefung&part=sip4");
    expect(mockHrefFor(["sip5a"], true)).toBe("/exam?examSource=kenntnispruefung&part=sip5");
    expect(mockHrefFor(["sip4a", "sip5a"], true)).toBe("/exam?examSource=kenntnispruefung");
    expect(mockHrefFor(["stichprobentest"], true)).toBe("/exam?examSource=kmp_innsbruck");
    expect(mockHrefFor(["gerichtsmedizin", "rezeptierkunde"], true)).toBe("/exam?examSource=pharma");
    expect(mockHrefFor(["sip4a"], false)).toBe("/pricing?gate=mock_exam");
  });
});
