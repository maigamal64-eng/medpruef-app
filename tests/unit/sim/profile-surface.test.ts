import { describe, it, expect } from "vitest";
import { citedBudgetsFor, profileProblems, profilesForSurface, type SimProfile, type WrittenReportPart } from "@/lib/sim";
import { KP_SIM_PROFILE } from "@/lib/de-kp/sim/profile";

/** The third exam the plan names as proof the core is general (D-19): an Austrian prescription defence, test fixture only. */
const AT_RX: SimProfile = {
  key: "at_rx_defence",
  surface: "at",
  language: "de",
  uiLanguages: ["de", "en"],
  parts: [
    { kind: "written_report", id: "rx", rubric: "report_rubric", document: "bericht", sections: ["rezept", "dosis", "dauer", "interaktionen", "beratung"], marking: "self", totalWeight: 1, maxCharsPerSlot: 2000, languageReview: false },
    { kind: "examiner_round", id: "defence", rubric: "followups", maxItems: 5, maxBoundedPerItem: 1, marking: "self", totalWeight: 1, maxCharsPerSlot: 900, languageReview: false },
  ],
  timing: { mode: "learner_clock", cited: [] },
  access: { freeCase: { aiFullSimulations: 0 }, paid: { aiFullSimulationsPerWindow: 20, windowDays: 30, aiPracticeParts: "unlimited" }, fallbackMarking: "self" },
  honestyCopyKey: "honesty",
};
const REGISTRY = [KP_SIM_PROFILE, AT_RX];
const RX_REPORT: WrittenReportPart = { kind: "written_report", id: "rx", rubric: "report_rubric", document: "bericht", sections: ["rezept"], marking: "self", totalWeight: 1, maxCharsPerSlot: 2000, languageReview: false };

describe("S1 acceptance: profiles stay on their own surface", () => {
  it("the Germany surface never lists an Austrian profile", () => {
    expect(profilesForSurface(REGISTRY, "de").map((p) => p.key)).toEqual([KP_SIM_PROFILE.key]);
  });
  it("the Austrian surface never lists a Germany profile", () => {
    expect(profilesForSurface(REGISTRY, "at").map((p) => p.key)).toEqual(["at_rx_defence"]);
  });
});

describe("profiles are valid", () => {
  it("the KP profile and the general-core fixture pass every rule", () => {
    expect(profileProblems(KP_SIM_PROFILE)).toEqual([]);
    expect(profileProblems(AT_RX)).toEqual([]);
  });

  it("the KP profile runs talk, findings, differentials, Bericht, examiner round in that order, self-mark final", () => {
    expect(KP_SIM_PROFILE.parts.map((p) => p.kind)).toEqual(["patient_talk", "findings", "short_answers", "written_report", "examiner_round"]);
    expect(KP_SIM_PROFILE.parts.map((p) => p.marking)).toEqual(["ai", "none", "ai", "ai", "ai"]);
    expect(KP_SIM_PROFILE.access).toMatchObject({ freeCase: { aiFullSimulations: 1 }, paid: { aiFullSimulationsPerWindow: 20, windowDays: 30 } });
    expect(KP_SIM_PROFILE.uiLanguages).toEqual(["de", "en", "ar"]);
  });

  it("names each broken rule", () => {
    const broken: SimProfile = {
      ...AT_RX,
      key: "Bad Key",
      parts: [
        { ...RX_REPORT, totalWeight: 0 },
        { ...RX_REPORT, sections: ["a", "a"] },
        { kind: "examiner_round", id: "ex", rubric: "followups", maxItems: 5, maxBoundedPerItem: 2, marking: "self", totalWeight: 1, maxCharsPerSlot: 900, languageReview: false },
      ],
      timing: { mode: "learner_clock", cited: [{ partIds: ["nope"], maxSeconds: 60, land: "all", source: { ref: "x", url: "http://x" } }] },
    };
    const rules = profileProblems(broken).map((p) => p.rule);
    for (const r of ["key", "total_weight", "part_id_unique", "sections", "max_bounded", "timing_parts", "timing_source"]) expect(rules).toContain(r);
  });
});

describe("cited times (D-17): only what an opened legal text states, else the learner's own clock", () => {
  it("the talk and findings share one cited 20 minute budget, the Bericht 30 minutes, in every Land", () => {
    for (const land of ["NI", "NW", "BY", null]) {
      expect(citedBudgetsFor(KP_SIM_PROFILE, "talk", land).map((b) => b.maxSeconds)).toEqual([1200]);
      expect(citedBudgetsFor(KP_SIM_PROFILE, "findings", land).map((b) => b.maxSeconds)).toEqual([1200]);
      expect(citedBudgetsFor(KP_SIM_PROFILE, "report", land).map((b) => b.maxSeconds)).toEqual([1800]);
    }
    for (const b of KP_SIM_PROFILE.timing.cited) expect(b.source.url).toBe("https://www.gesetze-im-internet.de/_appro_2002/__37.html");
  });
  it("parts with no cited time run on the learner's clock", () => {
    expect(citedBudgetsFor(KP_SIM_PROFILE, "diff", "NI")).toEqual([]);
    expect(citedBudgetsFor(KP_SIM_PROFILE, "examiner", "NI")).toEqual([]);
  });
  it("a Land budget applies only to its Land", () => {
    const p: SimProfile = { ...AT_RX, timing: { mode: "learner_clock", cited: [{ partIds: ["rx"], maxSeconds: 600, land: "W", source: { ref: "Merkblatt", url: "https://example.org" } }] } };
    expect(citedBudgetsFor(p, "rx", "W")).toHaveLength(1);
    expect(citedBudgetsFor(p, "rx", "T")).toEqual([]);
    expect(citedBudgetsFor(p, "rx", null)).toEqual([]);
  });
});

describe("the core stays exam-agnostic", () => {
  it("src/lib/sim imports nothing from a surface and holds no exam key or copy", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../../../src/lib/sim");
    for (const f of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(/from\s+["']@\/(lib\/de-kp|components|app)/);
      expect(text, f).not.toMatch(/de_kenntnispruefung|process\.env|Date\.now|new Date\(|fetch\(|from\s+["']react/);
      expect(text, f).not.toMatch(/[–—]/);
    }
  });
});
