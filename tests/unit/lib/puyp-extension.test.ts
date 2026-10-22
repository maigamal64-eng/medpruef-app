import { describe, expect, it } from "vitest";
import { puypConditions, puypDefinition, puypExamples, PUYP_BUFFER_DAYS } from "@/lib/puyp-copy";
import { referralWindowDefinition } from "@/lib/referral-copy";
import { officialSourceStamps } from "@/lib/i18n-dates";
import { OFFICIAL_SITTINGS, getUpcomingOfficialFor } from "@/lib/exam-dates";

/**
 * TR-20-R (pick-puyp-outcomes A) and TR-06-R-a: the guarantee is written in
 * the outcomes learners really have, with the same date rule the code uses,
 * and every official date carries its source and read date.
 */
describe("PUYP worked examples", () => {
  for (const lang of ["de", "en"] as const) {
    it(`${lang}: one SIP block example and one Stichprobentest example`, () => {
      const [sip, stp] = puypExamples(lang);
      expect(sip).toMatch(/SIP4a or SIP5a|SIP4a oder SIP5a/);
      expect(sip).toMatch(lang === "de" ? /Anmeldung noch offen/ : /registration is still open/);
      expect(stp).toMatch(/Stichprobentest/);
      // The Stichprobentest itself is one attempt and is not the claim.
      expect(stp).toMatch(lang === "de" ? /nur einmal/ : /only once/);
      expect(stp).toMatch(lang === "de" ? /mit offener Anmeldung/ : /with open registration/);
      for (const line of [sip, stp]) {
        expect(line).toContain(String(PUYP_BUFFER_DAYS));
        expect(line).not.toMatch(/—|–/);
      }
    });
  }

  it("German copy is formal (Sie)", () => {
    const de = [...puypExamples("de"), puypDefinition("de"), ...puypConditions("de").map((r) => r.value)].join(" ");
    expect(de).not.toMatch(/\b(du|dein|deine|deiner|dich|dir)\b/i);
    expect(de).toMatch(/\bSie\b/);
  });

  it("referral window states the same open-registration rule", () => {
    expect(referralWindowDefinition("de")).toMatch(/mit offener Anmeldung, plus 14 Tage/);
    expect(referralWindowDefinition("en")).toMatch(/with open registration, plus 14 days/);
  });
});

describe("officialSourceStamps", () => {
  it("one stamp per source document with publisher and read date", () => {
    const rows = getUpcomingOfficialFor({ exams: ["stichprobentest"], now: new Date("2026-10-12T10:00:00Z") });
    const stamps = officialSourceStamps(rows, "de");
    expect(stamps.length).toBe(new Set(rows.map((r) => r.source_url)).size);
    expect(stamps.length).toBe(2);
    for (const s of stamps) {
      expect(s.href).toMatch(/^https:\/\//);
      expect(s.text).toMatch(/^Quelle: .+, gelesen am \d{1,2}\. \S+ \d{4}$/);
    }
    expect(officialSourceStamps(OFFICIAL_SITTINGS.slice(0, 2), "en")[0].text).toMatch(/^Source: MedUni Wien, read on 21 October 2026$/);
  });
});
