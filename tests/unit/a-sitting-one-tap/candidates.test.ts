import { describe, expect, it } from "vitest";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { allOfficialSources, candidateSittings, resolveChoice, timeLeft } from "@/lib/sitting-link/candidates";

const now = new Date("2026-11-01T10:00:00Z");

describe("candidate sittings", () => {
  it("puts the account's bank first and lists every bank", () => {
    const banks = candidateSittings("kmp_innsbruck", now);
    expect(banks.map((b) => b.bank)).toEqual(["kmp_innsbruck", "kenntnispruefung", "pharma"]);
    expect(candidateSittings(null, now)[0].bank).toBe("kenntnispruefung");
  });

  it("leaves window_unconfirmed sittings out whole", () => {
    const unconfirmed = OFFICIAL_SITTINGS.filter((s) => s.window_unconfirmed).map((s) => s.date);
    expect(unconfirmed.length).toBeGreaterThan(0);
    const all = candidateSittings("kenntnispruefung", new Date("2027-02-20T10:00:00Z")).flatMap((b) => b.options.map((o) => o.date));
    for (const d of unconfirmed) expect(all).not.toContain(d);
  });

  it("keeps both Stichprobentest publishers on one option", () => {
    const stp = candidateSittings("kmp_innsbruck", now)[0].options[0];
    expect(stp.rows.map((r) => r.publisher).sort()).toEqual(["MedUni Wien", "Medizinische Universität Innsbruck"]);
    expect(new Set(stp.rows.map((r) => r.registration_closes)).size).toBe(2);
  });

  it("uses the exam week's first day as the date and its last day for fit", () => {
    const pharma = candidateSittings("pharma", now)[0].options[0];
    expect(pharma.date).toBe("2026-11-23");
    expect(pharma.lastDay).toBe("2026-11-27");
  });

  it("never lists a past sitting and caps each bank", () => {
    for (const b of candidateSittings("kenntnispruefung", now)) {
      expect(b.options.length).toBeLessThanOrEqual(4);
      for (const o of b.options) expect(o.lastDay >= "2026-11-01").toBe(true);
    }
  });

  it("accepts only offered choices", () => {
    const banks = candidateSittings("kenntnispruefung", now);
    const first = banks[0].options[0];
    expect(resolveChoice(first.id, banks)).toEqual({ kind: "sitting", option: first });
    expect(resolveChoice("open", banks)).toEqual({ kind: "open" });
    expect(resolveChoice("kenntnispruefung:2030-01-01", banks)).toEqual({ kind: "invalid" });
    expect(resolveChoice("kenntnispruefung:2027-03-10", banks)).toEqual({ kind: "invalid" });
    expect(resolveChoice(undefined, banks)).toEqual({ kind: "invalid" });
  });

  it("counts weeks, then days, to the sitting (Vienna days)", () => {
    expect(timeLeft("2026-11-01", now)).toEqual({ unit: "today" });
    expect(timeLeft("2026-11-02", now)).toEqual({ unit: "days", n: 1 });
    expect(timeLeft("2026-11-14", now)).toEqual({ unit: "days", n: 13 });
    expect(timeLeft("2026-11-15", now)).toEqual({ unit: "weeks", n: 2 });
    expect(timeLeft("2027-02-03", now)).toEqual({ unit: "weeks", n: 13 });
  });

  it("names every bank's official pages for the freeze", () => {
    const s = allOfficialSources();
    expect(s.map((b) => b.bank)).toEqual(["kenntnispruefung", "kmp_innsbruck", "pharma"]);
    expect(s.find((b) => b.bank === "kmp_innsbruck")!.sources.length).toBe(2);
    for (const b of s) for (const src of b.sources) expect(src.url).toMatch(/^https:\/\//);
  });
});
