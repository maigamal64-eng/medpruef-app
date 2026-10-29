import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ id: "acct-a" as string | null }));
vi.mock("@/lib/auth", () => ({ getStoredSession: () => (session.id ? { user: { id: session.id } } : null) }));
import {
  FIXED_MIN_QUESTIONS,
  referralMoment,
  referralPromptCadence,
  referralPromptEnabled,
  referralPromptFlag,
  type AnswerRow,
} from "@/lib/referral-prompt";
import { computeActiveSurface, type AnnouncementState } from "@/lib/announcements/useAnnouncementGate";
import { SURFACES, electSurfaces } from "@/lib/announcements/queue";
import { REFERRAL_PROMPT_COPY, referralPromptTitle, rpT } from "@/lib/referral-prompt-copy";
import { holdReferralPrompt, referralPromptElected, resetReferralPromptSignal, setReferralPromptEligible } from "@/lib/announcements/referral-prompt-signal";

const NOW = new Date("2026-10-29T12:00:00Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
/** n answers one minute apart, the newest `endMinutesAgo` ago. */
function sessionRows(n: number, correct: number, endMinutesAgo: number, firstQ = 1000): AnswerRow[] {
  return Array.from({ length: n }, (_, i) => ({ question_id: firstQ + i, is_correct: i < correct, created_at: at(endMinutesAgo + i) }));
}

describe("referral prompt flag", () => {
  it("is on only for the literal 'true'", () => {
    expect(referralPromptFlag({})).toBe(false);
    expect(referralPromptFlag({ REFERRAL_PROMPT_ENABLED: "1" })).toBe(false);
    expect(referralPromptFlag({ REFERRAL_PROMPT_ENABLED: "TRUE" })).toBe(false);
    expect(referralPromptFlag({ REFERRAL_PROMPT_ENABLED: "true" })).toBe(true);
  });
  it("needs the program and the exam reward too", () => {
    expect(referralPromptEnabled({ flag: true, referralsEnabled: true, examRewardEnabled: true })).toBe(true);
    expect(referralPromptEnabled({ flag: true, referralsEnabled: false, examRewardEnabled: true })).toBe(false);
    expect(referralPromptEnabled({ flag: true, referralsEnabled: true, examRewardEnabled: false })).toBe(false);
    expect(referralPromptEnabled({ flag: false, referralsEnabled: true, examRewardEnabled: true })).toBe(false);
  });
});

describe("referralMoment", () => {
  it("strong session: 15+ answers at 80 percent, ended 10+ minutes ago", () => {
    expect(referralMoment(sessionRows(15, 12, 20), NOW)).toBe("strong_session");
    expect(referralMoment(sessionRows(15, 11, 20), NOW)).toBeNull();
    expect(referralMoment(sessionRows(14, 14, 20), NOW)).toBeNull();
  });
  it("never while the learner may still be in the quiz (last answer under 10 minutes ago)", () => {
    expect(referralMoment(sessionRows(20, 20, 5), NOW)).toBeNull();
  });
  it("only a session that ended in the last 24 hours", () => {
    expect(referralMoment(sessionRows(20, 20, 25 * 60), NOW)).toBeNull();
    expect(referralMoment(sessionRows(20, 20, 23 * 60), NOW)).toBe("strong_session");
  });
  it("only the latest session counts (a 30-minute gap ends a session)", () => {
    const rows = [...sessionRows(5, 5, 20), ...sessionRows(20, 20, 20 + 5 + 40, 2000)];
    expect(referralMoment(rows, NOW)).toBeNull();
  });
  it("fixed mistakes: 3+ questions right now that were wrong before the session", () => {
    const before: AnswerRow[] = [1, 2, 3].map((q) => ({ question_id: q, is_correct: false, created_at: at(3 * 24 * 60) }));
    const now: AnswerRow[] = [1, 2, 3].map((q, i) => ({ question_id: q, is_correct: true, created_at: at(15 + i) }));
    expect(FIXED_MIN_QUESTIONS).toBe(3);
    expect(referralMoment([...now, ...before], NOW)).toBe("fixed_mistakes");
    expect(referralMoment([...now.slice(0, 2), ...before], NOW)).toBeNull();
  });
  it("a question whose latest earlier answer was right is not a fixed mistake", () => {
    const rows: AnswerRow[] = [
      ...[1, 2, 3].map((q, i) => ({ question_id: q, is_correct: true, created_at: at(15 + i) })),
      ...[1, 2, 3].map((q) => ({ question_id: q, is_correct: true, created_at: at(2 * 24 * 60) })),
      ...[1, 2, 3].map((q) => ({ question_id: q, is_correct: false, created_at: at(5 * 24 * 60) })),
    ];
    expect(referralMoment(rows, NOW)).toBeNull();
  });
  it("ignores order, bad dates and empty input", () => {
    expect(referralMoment([], NOW)).toBeNull();
    const rows = sessionRows(15, 15, 20).reverse();
    rows.push({ question_id: 1, is_correct: true, created_at: "not a date" });
    expect(referralMoment(rows, NOW)).toBe("strong_session");
  });
});

describe("referralPromptCadence", () => {
  it("dismissed for good wins; then once per 14 days", () => {
    expect(referralPromptCadence({ dismissed: true, lastShownAt: null, now: NOW })).toBe("dismissed");
    expect(referralPromptCadence({ dismissed: false, lastShownAt: at(13 * 24 * 60), now: NOW })).toBe("shown_recently");
    expect(referralPromptCadence({ dismissed: false, lastShownAt: at(14 * 24 * 60 + 1), now: NOW })).toBeNull();
    expect(referralPromptCadence({ dismissed: false, lastShownAt: null, now: NOW })).toBeNull();
  });
});

const STATE: AnnouncementState = {
  userId: "u1", sessionCount: 9, qsAnsweredTotal: 400, orientationModalSeenAt: "2026-09-01T00:00:00Z",
  cohortBannerDismissedAt: "2026-09-01T00:00:00Z", referralFloaterDismissedAt: null, lastSessionAt: "2026-10-29T00:00:00Z",
};

describe("one-surface gate", () => {
  it("elects the prompt only for paying learners in the program", () => {
    expect(computeActiveSurface(STATE, true, true, false, true)).toBe("referral_prompt");
    expect(computeActiveSurface(STATE, true, false, false, true)).toBeNull();
    expect(computeActiveSurface(STATE, false, true, false, true)).not.toBe("referral_prompt");
  });
  it("wins over the weekly referral card and never stacks with it", () => {
    expect(computeActiveSurface(STATE, true, true, true, true)).toBe("referral_prompt");
    expect(computeActiveSurface(STATE, true, true, true, false)).toBe("referral_card");
  });
  it("respects the 30-day referral dismissal cooldown", () => {
    const recent = { ...STATE, referralFloaterDismissedAt: new Date(Date.now() - 86_400_000).toISOString() };
    expect(computeActiveSurface(recent, true, true, false, true)).toBeNull();
  });
  it("is promotion in the queue: paused in the sitting week, one inline slot with the rest", () => {
    expect(SURFACES.referral_prompt).toMatchObject({ kind: "inline", marketing: true });
    expect(SURFACES.referral_prompt.laterMs).toBe(14 * 86_400_000);
    const ctx = { onboardingOpen: false, firstSession: false, answeredTotal: 50, fieldFocused: false, msSincePointerDown: Infinity };
    expect(electSurfaces(["referral_prompt"], { ...ctx, marketingPaused: true }, {}, {}, Date.now()).inline).toBeNull();
    expect(electSurfaces(["referral_prompt", "referral_card"], ctx, {}, {}, Date.now()).inline).not.toBeNull();
    expect(electSurfaces(["referral_prompt"], ctx, {}, { inline: "referral_card" }, Date.now()).inline).toBeNull();
  });
});

describe("prompt copy", () => {
  it("DE and EN, no dashes, no exclamation marks, no reward, price or AI words", () => {
    const all = Object.values(REFERRAL_PROMPT_COPY).flat();
    for (const s of all) {
      expect(s).not.toMatch(/[—–!]/);
      expect(s).not.toMatch(/€|EUR|\bKI\b|\bAI\b|\bbot\b|Credits|kostenlos|free|Geld|cash|Rabatt|discount/i);
    }
    expect(rpT("body", "de")).toContain("dieselbe Prüfung");
    expect(rpT("body", "ar")).toBe(rpT("body", "en"));
    expect(referralPromptTitle("fixed_mistakes", "de")).toBe("Frühere Fehler, jetzt richtig beantwortet.");
  });
});

describe("referral prompt signal", () => {
  it("a held election belongs to the account that held it", () => {
    resetReferralPromptSignal();
    session.id = "acct-a";
    expect(referralPromptElected()).toBe(false);
    setReferralPromptEligible(true);
    expect(referralPromptElected()).toBe(true);
    setReferralPromptEligible(false);
    holdReferralPrompt();
    expect(referralPromptElected()).toBe(true);
    session.id = "acct-b";
    expect(referralPromptElected()).toBe(false);
    resetReferralPromptSignal();
  });
});
