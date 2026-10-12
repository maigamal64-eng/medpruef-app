import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nextOpenAccessAnchor,
  suggestNextExpiresAt,
  suggestPuypExtension,
  type PuypExamType,
} from "@/lib/exam-dates";
import { computeGrantExpiry, examRewardGrantDecision } from "@/lib/referral-exam-reward";

/**
 * a27 (GU-09, G35, TR-06-R-b): access dates follow the next official sitting
 * of the learner's exam with open registration, plus 14 days
 * ([name] 2026-10-11: pick-access-dates A, pick-access-buffer A).
 * Expected values are computed by hand from OFFICIAL_SITTINGS.
 */

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

const TABLE: Array<{ name: string; now: string; bank: PuypExamType; anchor: string | null; expires: string }> = [
  // 12 Oct 2026: the Nov SIP window (5 to 19 Oct) is open; SIP4a 18 Nov is the later block.
  { name: "Vienna, Nov window open", now: "2026-10-12T10:00:00Z", bank: "kenntnispruefung", anchor: "2026-11-18", expires: "2026-12-02T23:59:59.000Z" },
  // Last day of the Nov window (Vienna): still open until the end of 19 Oct.
  { name: "Vienna, last day of Nov window", now: "2026-10-19T21:30:00Z", bank: "kenntnispruefung", anchor: "2026-11-18", expires: "2026-12-02T23:59:59.000Z" },
  // 19 Oct 22:30 UTC is 20 Oct 00:30 Vienna: closed, the Feb sittings follow (window 4 to 18 Jan, not open yet counts).
  { name: "Vienna, Nov window closed", now: "2026-10-19T22:30:00Z", bank: "kenntnispruefung", anchor: "2027-02-19", expires: "2027-03-05T23:59:59.000Z" },
  // 18 Jan 2027 is the last day of the Feb window.
  { name: "Vienna, last day of Feb window", now: "2027-01-18T12:00:00Z", bank: "kenntnispruefung", anchor: "2027-02-19", expires: "2027-03-05T23:59:59.000Z" },
  // 19 Jan: the 10 Mar 2027 window is unconfirmed (typo on the official page), so it is skipped.
  { name: "Vienna, unconfirmed Mar window skipped", now: "2027-01-19T12:00:00Z", bank: "kenntnispruefung", anchor: "2027-04-28", expires: "2027-05-12T23:59:59.000Z" },
  // 25 Jul 2027: SIP4a 1 Sep and SIP5a 23 Sep both still registrable; the later one wins.
  { name: "Vienna, Sep blocks three weeks apart", now: "2027-07-25T10:00:00Z", bank: "kenntnispruefung", anchor: "2027-09-23", expires: "2027-10-07T23:59:59.000Z" },
  // 10 Aug 2027: no further SIP4a is published, so no anchor; fallback now + 3 months.
  { name: "Vienna, SIP4a unpublished", now: "2027-08-10T10:00:00Z", bank: "kenntnispruefung", anchor: null, expires: "2027-11-10T10:00:00.000Z" },
  // Pharma: the exam week counts to its last day (23 to 27 Nov).
  { name: "Pharma, Nov week open", now: "2026-10-12T10:00:00Z", bank: "pharma", anchor: "2026-11-27", expires: "2026-12-11T23:59:59.000Z" },
  // 20 Oct 11:00 Vienna: the window closes at 12:00, still open.
  { name: "Pharma, before 12:00 close", now: "2026-10-20T09:00:00Z", bank: "pharma", anchor: "2026-11-27", expires: "2026-12-11T23:59:59.000Z" },
  // 20 Oct 12:30 Vienna: closed, the Jan week (window 2 to 15 Dec) follows.
  { name: "Pharma, after 12:00 close", now: "2026-10-20T10:30:00Z", bank: "pharma", anchor: "2027-01-22", expires: "2027-02-05T23:59:59.000Z" },
  // 16 Dec 2026: summer 2027 weeks are not published: fallback.
  { name: "Pharma, no week published", now: "2026-12-16T10:00:00Z", bank: "pharma", anchor: null, expires: "2027-03-16T10:00:00.000Z" },
  // Stichprobentest 3 Feb 2027: Merkblatt cutoff 14 Dec, i-med deadline 7 Jan.
  { name: "Stichprobentest, both deadlines open", now: "2026-10-12T10:00:00Z", bank: "kmp_innsbruck", anchor: "2027-02-03", expires: "2027-02-17T23:59:59.000Z" },
  { name: "Stichprobentest, i-med deadline still open", now: "2027-01-01T10:00:00Z", bank: "kmp_innsbruck", anchor: "2027-02-03", expires: "2027-02-17T23:59:59.000Z" },
  { name: "Stichprobentest, both closed", now: "2027-01-08T10:00:00Z", bank: "kmp_innsbruck", anchor: "2027-05-04", expires: "2027-05-18T23:59:59.000Z" },
];

describe("suggestNextExpiresAt (a27 access rule)", () => {
  for (const row of TABLE) {
    it(row.name, () => {
      const now = at(row.now);
      expect(nextOpenAccessAnchor(row.bank, now)).toBe(row.anchor);
      expect(iso(suggestNextExpiresAt(row.bank, 14, now))).toBe(row.expires);
    });
  }

  it("applies the buffer argument", () => {
    const now = at("2026-10-12T10:00:00Z");
    expect(iso(suggestNextExpiresAt("kenntnispruefung", 0, now))).toBe("2026-11-18T23:59:59.000Z");
  });

  it("never returns an invalid date", () => {
    for (const bank of ["kenntnispruefung", "kmp_innsbruck", "pharma"] as const) {
      for (let d = Date.parse("2026-10-01"); d < Date.parse("2028-01-01"); d += 86_400_000 * 3) {
        expect(Number.isFinite(suggestNextExpiresAt(bank, 14, new Date(d)).getTime())).toBe(true);
      }
    }
  });
});

describe("computeGrantExpiry follows the same rule (referral exam reward)", () => {
  afterEach(() => vi.useRealTimers());

  it("Vienna referrer on 12 Oct 2026 gets the SIP anchor plus 14 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-10-12T10:00:00Z"));
    expect(iso(computeGrantExpiry("kenntnispruefung"))).toBe("2026-12-02T23:59:59.000Z");
  });
});

describe("suggestPuypExtension (claim default, a27 review)", () => {
  const now = at("2026-10-12T10:00:00Z");
  it("uses the official rule for the Vienna and pharma banks", () => {
    expect(iso(suggestPuypExtension("kenntnispruefung", now)!)).toBe("2026-12-02T23:59:59.000Z");
    expect(iso(suggestPuypExtension("pharma", now)!)).toBe("2026-12-11T23:59:59.000Z");
  });
  it("leaves the date to the admin for a Stichprobentest claim, an unknown exam or no published sitting", () => {
    expect(suggestPuypExtension("kmp_innsbruck", now)).toBeNull();
    expect(suggestPuypExtension("oeaek", now)).toBeNull();
    expect(suggestPuypExtension("pharma", at("2026-12-16T10:00:00Z"))).toBeNull();
    expect(suggestPuypExtension("kenntnispruefung", at("2027-08-10T10:00:00Z"))).toBeNull();
  });
});

describe("examRewardGrantDecision never shortens or downgrades", () => {
  const next = at("2026-12-02T23:59:59Z");
  it("keeps admins, permanent Pro and a later Pro expiry", () => {
    expect(examRewardGrantDecision({ tier: "admin", role: "admin", tier_expires_at: null }, next)).toEqual({ kind: "covered" });
    expect(examRewardGrantDecision({ tier: "free", role: "admin", tier_expires_at: null }, next)).toEqual({ kind: "covered" });
    expect(examRewardGrantDecision({ tier: "pro", role: "user", tier_expires_at: null }, next)).toEqual({ kind: "covered" });
    expect(examRewardGrantDecision({ tier: "pro", role: "user", tier_expires_at: "2027-03-01T00:00:00Z" }, next)).toEqual({ kind: "covered" });
  });
  it("grants the new date, or carries over a later expiry on another tier", () => {
    expect(examRewardGrantDecision({ tier: "free", role: "user", tier_expires_at: null }, next)).toEqual({ kind: "grant", expiry: next });
    expect(examRewardGrantDecision({ tier: "pro", role: "user", tier_expires_at: "2026-11-01T00:00:00Z" }, next)).toEqual({ kind: "grant", expiry: next });
    const later = examRewardGrantDecision({ tier: "notes_pro_trial", role: "user", tier_expires_at: "2027-01-31T00:00:00Z" }, next);
    expect(later.kind === "grant" && later.expiry.toISOString()).toBe("2027-01-31T00:00:00.000Z");
  });
});
