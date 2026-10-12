import { describe, expect, it } from "vitest";
import {
  EXAM_SITTINGS,
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  nextOpenAccessAnchor,
  suggestNextExpiresAt,
} from "@/lib/exam-dates";

/**
 * CNT-46 / G35 / TR-06: the Vienna bank's access dates never come from the
 * postgraduate ÖÄK list (EXAM_SITTINGS.kenntnispruefung). Every anchor is an
 * official SIP4a or SIP5a sitting, for every day from Oct 2026 to the end of
 * 2027.
 */

const DAY = 86_400_000;
const oeaekDates = new Set(EXAM_SITTINGS.kenntnispruefung.map((s) => s.date));
const sipDates = new Set(
  OFFICIAL_SITTINGS.filter((s) => OFFICIAL_KEYS_BY_BANK.kenntnispruefung.includes(s.exam_key)).map((s) => s.date)
);

describe("Vienna bank access anchor", () => {
  it("is always an official SIP4a/SIP5a sitting and never an ÖÄK sitting", () => {
    let anchored = 0;
    for (let t = Date.parse("2026-10-01T10:00:00Z"); t < Date.parse("2028-01-01T00:00:00Z"); t += DAY) {
      const now = new Date(t);
      const anchor = nextOpenAccessAnchor("kenntnispruefung", now);
      if (anchor) {
        anchored++;
        expect(sipDates.has(anchor)).toBe(true);
        // A SIP sitting can share a calendar day with an ÖÄK one only by chance;
        // none does today, and the anchor must never be taken from that list.
        expect(oeaekDates.has(anchor)).toBe(false);
      }
      const expires = suggestNextExpiresAt("kenntnispruefung", 14, now).toISOString().slice(0, 10);
      for (const d of oeaekDates) {
        const oeaekPlus14 = new Date(`${d}T23:59:59Z`);
        oeaekPlus14.setUTCDate(oeaekPlus14.getUTCDate() + 14);
        expect(expires).not.toBe(oeaekPlus14.toISOString().slice(0, 10));
      }
    }
    expect(anchored).toBeGreaterThan(200);
  });

  it("no longer returns the old ÖÄK-based expiry (18 Jan 2027 plus 14 days)", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(suggestNextExpiresAt("kenntnispruefung", 14, now).toISOString().slice(0, 10)).not.toBe("2027-02-01");
  });

  it("every official row carries a source link and a parseable read date", () => {
    for (const s of OFFICIAL_SITTINGS) {
      expect(s.source_url).toMatch(/^https:\/\//);
      expect(s.publisher.length).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(`${s.read_on}T00:00:00Z`))).toBe(true);
    }
  });
});
