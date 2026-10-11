import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  getNextOfficialDeadlineGroup,
} from "@/lib/exam-dates";
import { registrationDeadlineBadge } from "@/lib/i18n-dates";

function freeze(instant: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(instant));
}

function nextSip() {
  return getNextOfficialDeadlineGroup({ exams: OFFICIAL_KEYS_BY_BANK.kenntnispruefung });
}

afterEach(() => vi.useRealTimers());

describe("official SIP registration deadline badge", () => {
  it("shows the absolute date and eight Vienna calendar days in DE and EN for both SIP rows", () => {
    freeze("2026-10-11T12:00:00Z");
    const group = nextSip()!;
    expect(group.rows.map((row) => row.exam_key).sort()).toEqual(["sip4a", "sip5a"]);
    for (const row of group.rows) {
      expect(OFFICIAL_SITTINGS).toContain(row);
      expect(registrationDeadlineBadge(row, "de")).toEqual({
        text: "Anmeldung bis 19. Okt., noch 8 Tage", daysLeft: 8, imminent: true,
      });
      expect(registrationDeadlineBadge(row, "en")?.text).toBe("Register by 19 Oct, 8 days left");
    }
  });

  it("uses Vienna's date even when UTC is still on the previous day", () => {
    freeze("2026-10-10T22:01:00Z"); // 11 Oct 00:01 CEST
    expect(registrationDeadlineBadge(nextSip()!.rows[0], "de")?.daysLeft).toBe(8);
  });

  it.each([
    ["2026-10-05T12:00:00Z", 14, false],
    ["2026-10-06T12:00:00Z", 13, true],
  ])("uses amber strictly below fourteen days at %s", (instant, daysLeft, imminent) => {
    freeze(instant);
    expect(registrationDeadlineBadge(nextSip()!.rows[0], "de")).toMatchObject({ daysLeft, imminent });
  });

  it("uses singular copy with one day left", () => {
    freeze("2026-10-18T12:00:00Z");
    const row = nextSip()!.rows[0];
    expect(registrationDeadlineBadge(row, "de")?.text).toBe("Anmeldung bis 19. Okt., noch 1 Tag");
    expect(registrationDeadlineBadge(row, "en")?.text).toBe("Register by 19 Oct, 1 day left");
  });

  it("keeps the deadline at 19 Oct 2026 23:59 Vienna without a zero-day countdown", () => {
    freeze("2026-10-19T21:59:59Z"); // 23:59:59 CEST
    const group = nextSip()!;
    expect(group.registration_closes).toBe("2026-10-19");
    for (const row of group.rows) {
      expect(registrationDeadlineBadge(row, "de")?.text).toBe("Anmeldung bis 19. Okt., heute letzter Tag");
      expect(registrationDeadlineBadge(row, "en")?.text).toBe("Register by 19 Oct, today is the last day");
    }
  });

  it("removes the expired badge at Vienna midnight and advances to the next official window", () => {
    freeze("2026-10-19T21:59:00Z");
    const expired = nextSip()!.rows;
    vi.setSystemTime(new Date("2026-10-19T22:00:00Z")); // 20 Oct 00:00 CEST, UTC is still 19 Oct
    for (const row of expired) expect(registrationDeadlineBadge(row, "de")).toBeNull();
    const next = nextSip()!;
    expect(next.registration_closes).toBe("2027-01-18");
    expect(next.rows.map((row) => row.exam_key).sort()).toEqual(["sip4a", "sip5a"]);
    for (const row of next.rows) {
      expect(OFFICIAL_SITTINGS).toContain(row);
      const badge = registrationDeadlineBadge(row, "en")!;
      expect(badge.text).toMatch(/^Register by 18 Jan, \d+ days left$/);
      expect(badge.daysLeft).toBe(90);
      expect(badge.imminent).toBe(false);
    }
  });

  it("counts calendar days across Vienna's daylight-saving change", () => {
    freeze("2026-10-24T22:01:00Z"); // 25 Oct 00:01 CEST, clocks go back later that day
    expect(registrationDeadlineBadge(nextSip()!.rows[0], "en")?.daysLeft).toBe(85);
    vi.setSystemTime(new Date("2026-10-25T23:01:00Z")); // 26 Oct 00:01 CET
    expect(registrationDeadlineBadge(nextSip()!.rows[0], "en")?.daysLeft).toBe(84);
  });

  it("does not create SIP badges for other families or unpublished deadlines", () => {
    freeze("2026-10-11T12:00:00Z");
    for (const row of OFFICIAL_SITTINGS.filter((row) => row.exam_key !== "sip4a" && row.exam_key !== "sip5a")) {
      expect(registrationDeadlineBadge(row, "en")).toBeNull();
    }
    expect(registrationDeadlineBadge({ ...nextSip()!.rows[0], registration_closes: null }, "en")).toBeNull();
  });

  it("returns no next window once all published SIP deadlines have passed", () => {
    freeze("2027-08-24T12:00:00Z");
    expect(nextSip()).toBeNull();
  });
});
