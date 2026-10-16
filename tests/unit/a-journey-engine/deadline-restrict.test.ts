import { describe, expect, it } from "vitest";
import { buildRestrictedDeadline } from "@/lib/hooks/useOfficialDeadline";

const OCT15 = new Date("2026-10-15T10:00:00Z");

describe("deadline line restricted to the learner's own sitting (live OFFICIAL_SITTINGS)", () => {
  it("SIP5a names only SIP5a and links the official calendar", () => {
    const c = buildRestrictedDeadline({ key: "sip5a:2026-11-17", exams: ["sip5a"], date: "2026-11-17" }, OCT15, "de");
    expect(c).not.toBeNull();
    expect(c!.text).toContain("SIP5a");
    expect(c!.text).not.toContain("SIP4a");
    expect(c!.sources.length).toBeGreaterThan(0);
    expect(c!.sources.every((s) => s.href.startsWith("https://www.meduniwien.ac.at/"))).toBe(true);
  });

  it("the Stichprobentest line carries both publishers", () => {
    const c = buildRestrictedDeadline({ key: "stichprobentest:2027-02-03", exams: ["stichprobentest"], date: "2027-02-03" }, OCT15, "en");
    expect(c).not.toBeNull();
    expect(c!.sources.map((s) => new URL(s.href).hostname).sort()).toEqual(["www.i-med.ac.at", "www.meduniwien.ac.at"]);
  });

  it("returns null once the sitting's windows closed (the bank line takes over)", () => {
    expect(buildRestrictedDeadline({ key: "gerichtsmedizin+rezeptierkunde:2026-11-23", exams: ["gerichtsmedizin", "rezeptierkunde"], date: "2026-11-23" }, new Date("2026-10-20T10:00:00Z"), "de")).toBeNull();
  });
});
