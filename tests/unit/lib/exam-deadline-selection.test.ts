import { describe, expect, it } from "vitest";
import { getNextRegistrationDeadlineSitting } from "@/lib/exam-dates";

describe("getNextRegistrationDeadlineSitting", () => {
  it("selects the earliest published deadline and keeps it on the deadline day", () => {
    const sitting = getNextRegistrationDeadlineSitting(
      new Date("2026-07-28T12:00:00Z")
    );

    expect(sitting?.examType).toBe("kenntnispruefung");
    expect(sitting?.registrationDeadline).toBe("2026-07-28");
  });

  it("moves to the next sitting once the prior registration deadline passes", () => {
    const sitting = getNextRegistrationDeadlineSitting(
      new Date("2026-07-29T00:00:00Z")
    );

    expect(sitting?.examType).toBe("kmp_innsbruck");
    expect(sitting?.registrationDeadline).toBe("2026-08-26");
  });

  it("skips expired deadlines and selects the next published sitting", () => {
    for (const now of ["2026-08-27T00:00:00Z", "2026-09-26T12:00:00Z"]) {
      const sitting = getNextRegistrationDeadlineSitting(new Date(now));
      expect(sitting?.date).toBe("2027-01-18");
      expect(sitting?.registrationDeadline).toBe("2026-11-18");
    }
  });

  it("uses the newly published 2027 Kenntnisprüfung deadline after the 2026 deadlines pass", () => {
    const sitting = getNextRegistrationDeadlineSitting(
      new Date("2026-09-27T12:00:00Z")
    );

    expect(sitting?.examType).toBe("kenntnispruefung");
    expect(sitting?.date).toBe("2027-01-18");
    expect(sitting?.registrationDeadline).toBe("2026-11-18");
  });
});
