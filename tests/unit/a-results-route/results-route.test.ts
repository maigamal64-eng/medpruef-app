import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RESULTS_WINDOW_DAYS,
  SIP_OUTCOMES,
  SPT_OUTCOMES,
  candidateSittings,
  isOutcomeFor,
  needOf,
  resultsRouteEnabled,
  resultsWindowSittings,
  routeFor,
  routePromptBlocked,
  routeSittings,
  shouldAsk,
  viennaMidnight,
} from "@/lib/results-route";
import { LINK_TOKEN, resultsRouteCopy, splitLink } from "@/lib/results-route-copy";
import { officialLink } from "@/lib/results-route-server";

const at = (iso: string) => new Date(`${iso}T10:00:00Z`);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("flag", () => {
  it("is off unless the literal true", () => {
    expect(resultsRouteEnabled({})).toBe(false);
    expect(resultsRouteEnabled({ RESULTS_ROUTE_ENABLED: "1" })).toBe(false);
    expect(resultsRouteEnabled({ RESULTS_ROUTE_ENABLED: "TRUE" })).toBe(false);
    expect(resultsRouteEnabled({ RESULTS_ROUTE_ENABLED: " true " })).toBe(true);
  });
});

describe("sittings and windows", () => {
  it("knows the 23 Sep 2026 Stichprobentest (Graz) from the PUYP calendar, once per exam and date", () => {
    const all = routeSittings();
    const sep = all.find((s) => s.key === "stichprobentest:2026-09-23");
    expect(sep).toMatchObject({ exam_key: "stichprobentest", last_day: "2026-09-23", label: { de: "Stichprobentest Graz", en: "Stichprobentest Graz" } });
    const keys = all.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === "stichprobentest:2027-02-03")).toHaveLength(1);
    expect(all.every((s) => ["stichprobentest", "sip4a", "sip5a"].includes(s.exam_key))).toBe(true);
  });
  it("asks the September sitters on 5 Nov (the release day) and through their 90-day window", () => {
    expect(resultsWindowSittings(at("2026-11-05")).map((s) => s.key)).toContain("stichprobentest:2026-09-23");
    expect(resultsWindowSittings(at("2026-12-22")).map((s) => s.key)).toContain("stichprobentest:2026-09-23");
    expect(resultsWindowSittings(at("2026-12-23")).map((s) => s.key)).not.toContain("stichprobentest:2026-09-23");
    expect(resultsWindowSittings(at("2026-09-23")).map((s) => s.key)).not.toContain("stichprobentest:2026-09-23");
    expect(RESULTS_WINDOW_DAYS.stichprobentest).toBe(90);
  });
  it("adds the November SIP sittings after their day, newest first", () => {
    const keys = resultsWindowSittings(at("2026-12-01")).map((s) => s.key);
    expect(keys.slice(0, 2)).toEqual(["sip4a:2026-11-18", "sip5a:2026-11-17"]);
    expect(keys).toContain("stichprobentest:2026-09-23");
  });
  it("asks nothing on an official sitting day or in the November blackout", () => {
    for (const d of ["2026-11-17", "2026-11-19", "2026-11-24", "2027-02-03"]) expect(routePromptBlocked(at(d))).toBe(true);
    for (const d of ["2026-11-05", "2026-11-21", "2026-12-01"]) expect(routePromptBlocked(at(d))).toBe(false);
  });
});

describe("Vienna day bounds", () => {
  it("midnight in CEST and CET", () => {
    expect(viennaMidnight("2026-06-25")).toBe("2026-06-24T22:00:00.000Z");
    expect(viennaMidnight("2026-12-01")).toBe("2026-11-30T23:00:00.000Z");
    expect(viennaMidnight("2026-10-25")).toBe("2026-10-24T22:00:00.000Z");
  });
});

describe("which sitting a learner is asked about", () => {
  const window = resultsWindowSittings(at("2026-12-01"));
  it("a stored exam date naming a window sitting wins", () => {
    expect(candidateSittings({ examDate: "2026-09-23", activeExam: "kenntnispruefung" }, window)).toEqual({ rows: [expect.objectContaining({ key: "stichprobentest:2026-09-23" })], byDate: true });
  });
  it("otherwise the active bank's window sittings (the caller then checks activity)", () => {
    const spt = candidateSittings({ examDate: null, activeExam: "kmp_innsbruck" }, window);
    expect(spt.byDate).toBe(false);
    expect(spt.rows.map((s) => s.key)).toEqual(["stichprobentest:2026-09-23"]);
    expect(candidateSittings({ examDate: "2027-02-03", activeExam: "kenntnispruefung" }, window).rows.map((s) => s.exam_key)).toEqual(["sip4a", "sip5a"]);
    expect(candidateSittings({ examDate: null, activeExam: "pharma" }, window).rows).toEqual([]);
  });
});

describe("outcomes and routes", () => {
  it("never asks a Stichprobentest learner whether they passed", () => {
    expect(SPT_OUTCOMES).not.toContain("passed");
    expect(SPT_OUTCOMES.some((o) => /pass|fail/.test(o))).toBe(false);
    for (const lang of ["de", "en"]) {
      const c = resultsRouteCopy(lang);
      const sptText = [c.sptQuestion, c.sptHelper, c.afterSpt, ...SPT_OUTCOMES.map((o) => c.outcome[o])].join(" ");
      expect(sptText).not.toMatch(/bestanden|bestehen|durchgefallen|nicht geschafft|\bpass(ed)?\b|\bfail/i);
    }
    expect(isOutcomeFor("spt", "passed")).toBe(false);
    expect(isOutcomeFor("spt", "not_all_passed")).toBe(false);
    expect(isOutcomeFor("sip", "rez_gm")).toBe(false);
    expect(isOutcomeFor("sip", "passed")).toBe(true);
  });
  it("maps every answer to a need", () => {
    expect([...SPT_OUTCOMES, ...SIP_OUTCOMES].map(needOf)).toEqual(["part_done", "more_to_do", "waiting", "not_sat", "part_done", "more_to_do", "waiting", "not_sat"]);
  });
  const all = { testimonial: true, referral: true, gm: true };
  it("relief branches open the next track and invite a testimonial and a referral", () => {
    expect(routeFor("rez_gm", all)).toEqual({ next: ["pharma"], rescue: false, officialNext: false, gm: true, testimonial: true, referral: true });
    expect(routeFor("passed", all)).toEqual({ next: ["kenntnispruefung", "pharma"], rescue: false, officialNext: false, gm: true, testimonial: true, referral: true });
  });
  it("more-to-do branches never ask for a testimonial or a referral", () => {
    expect(routeFor("rez_gm_sip", all)).toMatchObject({ next: ["pharma", "kenntnispruefung"], officialNext: true, testimonial: false, referral: false });
    expect(routeFor("not_all_passed", all)).toMatchObject({ next: [], rescue: true, testimonial: false, referral: false, gm: false });
  });
  it("asks, offers and links nothing it is not allowed to", () => {
    const none = { testimonial: false, referral: false, gm: false };
    expect(routeFor("rez_gm", none)).toMatchObject({ testimonial: false, referral: false, gm: false });
    expect(routeFor("waiting", all)).toEqual({ next: [], rescue: false, officialNext: false, gm: false, testimonial: false, referral: false });
    expect(routeFor("not_sat", all).next).toEqual([]);
  });
  it("asks again a week after 'not here yet', never after a final answer", () => {
    const now = at("2026-11-20");
    expect(shouldAsk(null, now)).toBe(true);
    expect(shouldAsk({ sitting_key: "k", outcome: "waiting", at: "2026-11-15T10:00:00Z" }, now)).toBe(false);
    expect(shouldAsk({ sitting_key: "k", outcome: "waiting", at: "2026-11-13T10:00:00Z" }, now)).toBe(true);
    expect(shouldAsk({ sitting_key: "k", outcome: "rez_gm", at: "2026-10-01T10:00:00Z" }, now)).toBe(false);
  });
});

describe("copy", () => {
  // Per-line sha256 of the F16 M6 lines (course-correction copy audit, F16;
  // each line is byte-identical to its place in the audited de/en block).
  const F16 = {
    de: {
      title: "a49022ce07dae131dfc4be5e24791f63ff455160eb17809676957dc5d207021d",
      rescue: "5b206a6af8b30a97303021f9fab90383d3c346f5920999255e6c64e432a0ce51",
      partPassed: "7d97d0f6ccc1584129831dc0daf97e708e30f3d50c2a1a18e4c8c77550d94890",
      afterSpt: "797e3ebd759dc63db0a8153b354ccdce5b724c395326a6ad5fa2de5b471dfca0",
      experience: "20a859e837a5de91d60b615e8619b84094ed4844f811494291c56f7c4a4b21c3",
    },
    en: {
      title: "1fb1984bd015e7f80d0fe6006ce137d9c92b37686322573bb4bc4d9305ab45ac",
      rescue: "8b14f6e63a45e8a3ebdf258510bcf2f359b5cd1521df4051ef4e351dd298a0ad",
      partPassed: "d90a98726a25a3b39fc98d321ff55582c81b01f2aed3763654e26c5ea320749d",
      afterSpt: "193bd5876997e957fd48f6099b0089da4b78e71cfad9a3e56dd8e8295139bd47",
      experience: "1756d8771b7527c6b5edda41e96c93f4c7236e8f7cbee480a9c90ec967327b60",
    },
  } as const;
  it("keeps the F16 M6 lines byte-exact", () => {
    for (const lang of ["de", "en"] as const) {
      const c = resultsRouteCopy(lang);
      for (const [k, h] of Object.entries(F16[lang])) expect(sha(c[k as keyof typeof F16.de]), `${lang}.${k}`).toBe(h);
    }
  });
  it("other languages render English until reviewed", () => {
    for (const lang of ["ar", "ru", "uk", "tr", "fr", undefined]) expect(resultsRouteCopy(lang)).toBe(resultsRouteCopy("en"));
  });
  it("no dashes, no exclamation marks, no prices, no bare free, no amounts", () => {
    for (const lang of ["de", "en"]) {
      const c = resultsRouteCopy(lang);
      const strings = Object.values(c).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v as Record<string, string>)));
      for (const s of strings) {
        expect(s).not.toMatch(/[–—!€$]/);
        expect(s).not.toMatch(/\b(gratis|kostenlos|free|unbegrenzt|unlimited)\b/i);
        expect(s.replace(/SIP[45]a/g, "")).not.toMatch(/\d/);
      }
    }
    expect(resultsRouteCopy("de").continueWith).toContain("{exam}");
  });
  it("links one official page in place of {LINK}, never a summary", () => {
    const c = resultsRouteCopy("de");
    expect(splitLink(c.rescue)[0]).toBe("Nicht alle Blöcke bestanden? Die offiziellen Wiederholungsregeln finden Sie hier: ");
    expect(splitLink(c.rescue)[1].startsWith(". ")).toBe(true);
    expect(c.officialNext).toContain(LINK_TOKEN);
    expect(officialLink()).toEqual({ url: "https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/pruefungen/", label: "MedUni Wien, Nostrifizierung, Prüfungen" });
  });
});
