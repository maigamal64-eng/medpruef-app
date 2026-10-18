import { describe, expect, it } from "vitest";
import {
  FEEDBACK_ASK_COOLDOWN_DAYS,
  askedRecently,
  cooldownStart,
  decideFeedbackAsk,
  feedbackAskEnabled,
  inOwnSittingWeek,
  roundQualifies,
} from "@/lib/feedback-ask/rules";
import { SURFACES, electSurfaces, type QueueContext } from "@/lib/announcements/queue";

// users.exam_date 2026-11-17 in the Kenntnisprüfung bank names the SIP5a sitting of Tue 17 Nov 2026 (OFFICIAL_SITTINGS).
const SIP = { examDate: "2026-11-17", activeExam: "kenntnispruefung" };
const NONE = { examDate: null, activeExam: "kenntnispruefung" };
const OCT17 = new Date("2026-10-17T10:00:00Z");

describe("flag", () => {
  it("only the literal 'true' switches it on", () => {
    expect(feedbackAskEnabled({})).toBe(false);
    expect(feedbackAskEnabled({ FEEDBACK_ASK_ENABLED: "1" })).toBe(false);
    expect(feedbackAskEnabled({ FEEDBACK_ASK_ENABLED: "TRUE" })).toBe(false);
    expect(feedbackAskEnabled({ FEEDBACK_ASK_ENABLED: "true" })).toBe(true);
  });
});

describe("14-day rule", () => {
  it("is 14 days", () => {
    expect(FEEDBACK_ASK_COOLDOWN_DAYS).toBe(14);
    expect(cooldownStart(OCT17).toISOString()).toBe("2026-10-03T10:00:00.000Z");
  });

  it("blocks within 14 days of any ask and frees at exactly 14 days", () => {
    expect(askedRecently(null, OCT17)).toBe(false);
    expect(askedRecently("2026-10-16T10:00:00Z", OCT17)).toBe(true);
    expect(askedRecently("2026-10-03T10:00:01Z", OCT17)).toBe(true);
    expect(askedRecently("2026-10-03T10:00:00Z", OCT17)).toBe(false);
    expect(askedRecently("2026-09-01T10:00:00Z", OCT17)).toBe(false);
  });

  it("an unreadable stamp blocks (never asks twice by accident)", () => {
    expect(askedRecently("not a date", OCT17)).toBe(true);
  });

  it("decides asked_recently outside the sitting week", () => {
    expect(decideFeedbackAsk({ lastShownAt: "2026-10-10T08:00:00Z", learner: SIP, now: OCT17 })).toBe("asked_recently");
    expect(decideFeedbackAsk({ lastShownAt: "2026-09-30T08:00:00Z", learner: SIP, now: OCT17 })).toBe("ok");
    expect(decideFeedbackAsk({ lastShownAt: null, learner: NONE, now: OCT17 })).toBe("ok");
  });
});

describe("sitting-week rule", () => {
  it("covers Monday to Sunday of the learner's own sitting, Vienna days", () => {
    expect(inOwnSittingWeek(SIP, new Date("2026-11-16T08:00:00Z"))).toBe(true);
    expect(inOwnSittingWeek(SIP, new Date("2026-11-22T20:00:00Z"))).toBe(true);
    expect(inOwnSittingWeek(SIP, new Date("2026-11-15T20:00:00Z"))).toBe(false);
    expect(inOwnSittingWeek(SIP, new Date("2026-11-22T23:30:00Z"))).toBe(false); // Monday 23 Nov, 00:30 Vienna
  });

  it("no named sitting means no pause", () => {
    expect(inOwnSittingWeek(NONE, new Date("2026-11-18T08:00:00Z"))).toBe(false);
    // A date that is no official sitting names nothing.
    expect(inOwnSittingWeek({ examDate: "2026-11-19", activeExam: "kenntnispruefung" }, new Date("2026-11-18T08:00:00Z"))).toBe(false);
  });

  it("the sitting week wins over an old ask", () => {
    const now = new Date("2026-11-18T08:00:00Z");
    expect(decideFeedbackAsk({ lastShownAt: null, learner: SIP, now })).toBe("sitting_week");
    expect(decideFeedbackAsk({ lastShownAt: "2026-08-01T08:00:00Z", learner: SIP, now })).toBe("sitting_week");
    expect(decideFeedbackAsk({ lastShownAt: null, learner: SIP, now: new Date("2026-11-24T08:00:00Z") })).toBe("ok");
  });
});

describe("round qualifies", () => {
  it("only a finished set with at least 3 graded answers, never the starter first win", () => {
    expect(roundQualifies({ graded: 10, targetCount: 10, questionCount: 10, starterFirstWin: false })).toBe(true);
    expect(roundQualifies({ graded: 3, targetCount: 3, questionCount: 3, starterFirstWin: false })).toBe(true);
    expect(roundQualifies({ graded: 2, targetCount: 2, questionCount: 2, starterFirstWin: false })).toBe(false);
    expect(roundQualifies({ graded: 6, targetCount: 10, questionCount: 6, starterFirstWin: false })).toBe(false); // timer cut
    expect(roundQualifies({ graded: 10, targetCount: 10, questionCount: 10, starterFirstWin: true })).toBe(false);
  });
});

describe("announcement queue entry", () => {
  const ctx: QueueContext = { onboardingOpen: false, firstSession: false, answeredTotal: 10, fieldFocused: false, msSincePointerDown: 10_000 };
  const now = Date.parse("2026-10-17T08:00:00Z");

  it("is an inline, priority 3 surface that waits in the sitting week", () => {
    expect(SURFACES.feedback_ask).toMatchObject({ kind: "inline", priority: 3, marketing: true });
    expect(electSurfaces(["feedback_ask"], ctx, {}, {}, now).inline).toBe("feedback_ask");
    expect(electSurfaces(["feedback_ask"], { ...ctx, marketingPaused: true }, {}, {}, now).inline).toBeNull();
  });

  it("never stacks on another inline card of this session, and 'Überspringen' quiets it 14 days", () => {
    expect(electSurfaces(["feedback_ask"], ctx, {}, { inline: "trial_card" }, now).inline).toBeNull();
    expect(electSurfaces(["feedback_ask"], ctx, { feedback_ask: now + 14 * 86_400_000 }, {}, now).inline).toBeNull();
    expect(SURFACES.feedback_ask.laterMs).toBe(14 * 86_400_000);
  });
});
