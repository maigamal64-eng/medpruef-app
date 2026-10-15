import { describe, expect, it } from "vitest";
import { answerLead } from "@/lib/answer-pages/lead";
import { nextSittingAnswer, nextSittingQuestion, rowText } from "@/lib/answer-pages/copy";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";

// Vienna noon on fixed days, so the expectations follow OFFICIAL_SITTINGS, not the wall clock.
const at = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("answer page lead (next official sitting from OFFICIAL_SITTINGS)", () => {
  it("shows the next SIP sitting with an open window and days left", () => {
    const [entry] = answerLead(["sip4a"], at("2026-10-14"));
    expect(entry.next?.date).toBe("2026-11-18");
    expect(entry.next?.rows[0].state).toBe("open");
    expect(entry.nextOpen).toBeNull();
    expect(rowText(entry.next!.rows[0], "de", at("2026-10-14"))).toMatch(/^MedUni Wien: Anmeldefrist bis 19\. Oktober 2026 \(/);
  });

  it("after the window closes, keeps the sitting and adds the next window", () => {
    const [entry] = answerLead(["sip4a"], at("2026-10-25"));
    expect(entry.next?.date).toBe("2026-11-18");
    expect(entry.next?.rows[0].state).toBe("closed");
    expect(entry.nextOpen?.date).toBe("2027-02-19");
    expect(entry.nextOpen?.rows[0].state).toBe("upcoming");
  });

  it("shows both Stichprobentest publishers for the same sitting, never picking one", () => {
    const [entry] = answerLead(["stichprobentest"], at("2026-10-14"));
    expect(entry.next?.date).toBe("2027-02-03");
    const publishers = entry.next!.rows.map((r) => [r.sitting.publisher, r.sitting.deadline_type]);
    expect(publishers).toEqual(expect.arrayContaining([["MedUni Wien", "filing_cutoff"], ["Medizinische Universität Innsbruck", "registration"]]));
    const en = nextSittingAnswer(entry, "en", at("2026-10-14"));
    expect(en).toContain("MedUni Vienna: submission deadline");
    expect(en).toContain("Medical University of Innsbruck: registration deadline");
    expect(nextSittingAnswer(entry, "de", at("2026-10-14"))).toContain("MedUni Wien: Einreichungsfrist bis");
  });

  it("keeps both publishers in one sitting even when their labels differ", () => {
    const rows = OFFICIAL_SITTINGS.filter((s) => s.exam_key === "stichprobentest" && s.date === "2027-02-03");
    expect(rows.length).toBe(2);
    const relabelled = OFFICIAL_SITTINGS.map((s) => (s === rows[1] ? { ...s, learner_label: { ...s.learner_label, de: "Stichprobentest (anders benannt)" } } : s));
    const [entry] = answerLead(["stichprobentest"], at("2026-10-14"), relabelled);
    expect(entry.next?.rows).toHaveLength(2);
  });

  it("marks an unconfirmed window instead of counting it down", () => {
    const [entry] = answerLead(["sip4a"], at("2027-02-20"));
    expect(entry.next?.date).toBe("2027-03-10");
    expect(entry.next?.rows[0].state).toBe("unconfirmed");
    expect(rowText(entry.next!.rows[0], "de", at("2027-02-20"))).toContain("noch nicht bestätigt");
  });

  it("Rezeptierkunde names the exam week and the 12:00 close", () => {
    const [entry] = answerLead(["rezeptierkunde"], at("2026-10-14"));
    expect(entry.next?.date_end).toBe("2026-11-27");
    expect(rowText(entry.next!.rows[0], "de", at("2026-10-14"))).toContain("20. Oktober 2026, 12:00 Uhr");
  });

  it("says plainly when nothing is published", () => {
    const [entry] = answerLead(["sip4a"], at("2030-01-01"));
    expect(entry.next).toBeNull();
    expect(nextSittingAnswer(entry, "de", at("2030-01-01"))).toContain("kein weiterer offizieller Termin");
  });

  it("every date in an answer comes from an official row with its source", () => {
    const now = at("2026-10-14");
    for (const exam of ["sip4a", "sip5a", "stichprobentest", "rezeptierkunde", "gerichtsmedizin"] as const) {
      const [entry] = answerLead([exam], now);
      const text = nextSittingAnswer(entry, "de", now);
      expect(text).toMatch(/Quelle: .+, gelesen am /);
      expect(nextSittingQuestion(exam, "de")).toMatch(/: Wann ist der nächste offizielle Termin\?$/);
      for (const row of entry.next?.rows ?? []) expect(OFFICIAL_SITTINGS).toContain(row.sitting);
    }
  });
});
