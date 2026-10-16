import { describe, expect, it } from "vitest";
import {
  REFERRAL_CARD_INTERVAL_MS, parseReferralCardStamp, referralCardDue, referralCardEligible,
  referralSurfaceEnabled, referralSurfaceFlag,
} from "@/lib/referral-surface";
import { activeDaysInWindow, activeDaysLast7 } from "@/lib/home-study-core";
import { computeActiveSurface, type AnnouncementState } from "@/lib/announcements/useAnnouncementGate";
import { SURFACES, electSurfaces } from "@/lib/announcements/queue";
import { parseReferralInvite } from "@/lib/hooks/useReferralInvite";
import { referralMailto } from "@/components/referrals/ReferralShareActions";
import { referralSurfaceLang, rsT, type ReferralSurfaceKey } from "@/lib/referral-surface-copy";

describe("flag and enablement", () => {
  it("only the literal 'true' turns the flag on (default OFF)", () => {
    expect(referralSurfaceFlag({})).toBe(false);
    for (const v of ["1", "TRUE", "yes", "on", ""]) expect(referralSurfaceFlag({ REFERRAL_SURFACE_ENABLED: v })).toBe(false);
    expect(referralSurfaceFlag({ REFERRAL_SURFACE_ENABLED: "true" })).toBe(true);
    expect(referralSurfaceFlag({ REFERRAL_SURFACE_ENABLED: " true " })).toBe(true);
  });
  it("needs the flag, program enrolment and the live exam reward", () => {
    expect(referralSurfaceEnabled({ flag: true, referralsEnabled: true, examRewardEnabled: true })).toBe(true);
    expect(referralSurfaceEnabled({ flag: false, referralsEnabled: true, examRewardEnabled: true })).toBe(false);
    expect(referralSurfaceEnabled({ flag: true, referralsEnabled: false, examRewardEnabled: true })).toBe(false);
    expect(referralSurfaceEnabled({ flag: true, referralsEnabled: true, examRewardEnabled: false })).toBe(false);
  });
});

describe("Home card cadence", () => {
  it("3 or more active days in 14 qualify", () => {
    expect(referralCardEligible(2)).toBe(false);
    expect(referralCardEligible(3)).toBe(true);
    expect(referralCardEligible(Number.NaN)).toBe(false);
  });
  it("at most once a week, but stays for the session that showed it", () => {
    const now = Date.UTC(2026, 9, 14, 12);
    expect(referralCardDue(null, now)).toBe(true);
    expect(referralCardDue(now - REFERRAL_CARD_INTERVAL_MS + 1, now)).toBe(false);
    expect(referralCardDue(now - REFERRAL_CARD_INTERVAL_MS, now)).toBe(true);
    expect(referralCardDue(now - 1000, now, true)).toBe(true);
    expect(referralCardDue(now + 60_000, now)).toBe(false); // stamp from a clock ahead: wait
  });
  it("stamps parse strictly", () => {
    expect(parseReferralCardStamp(null)).toBeNull();
    expect(parseReferralCardStamp("abc")).toBeNull();
    expect(parseReferralCardStamp("0")).toBeNull();
    expect(parseReferralCardStamp("1760000000000")).toBe(1760000000000);
  });
  it("counts distinct Vienna days in the window, today included", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    const times = [
      "2026-10-14T08:00:00Z", "2026-10-14T09:00:00Z", // today, one day
      "2026-10-13T22:30:00Z", // 00:30 Vienna on 14 Oct: still today
      "2026-10-10T10:00:00Z",
      "2026-10-01T10:00:00Z", // day 14 counting today
      "2026-09-30T10:00:00Z", // outside 14 days
      "2026-10-15T10:00:00Z", // future: ignored
      "not a date",
    ];
    expect(activeDaysInWindow(times, now, 14)).toBe(3);
    expect(activeDaysLast7(times, now)).toBe(2);
  });
});

const state = (over: Partial<AnnouncementState> = {}): AnnouncementState => ({
  userId: "u1", sessionCount: 5, qsAnsweredTotal: 100, orientationModalSeenAt: "2026-09-01T00:00:00Z",
  cohortBannerDismissedAt: "2026-09-01T00:00:00Z", referralFloaterDismissedAt: null, lastSessionAt: "2026-10-14T00:00:00Z", ...over,
});

describe("one-surface gate with the referral card", () => {
  it("elects the card before the floater when eligible", () => {
    expect(computeActiveSurface(state(), false, true, false)).toBe("referral_floater");
    expect(computeActiveSurface(state(), false, true, true)).toBe("referral_card");
  });
  it("never without program enrolment", () => {
    expect(computeActiveSurface(state(), false, false, true)).toBeNull();
    expect(computeActiveSurface(state(), true, false, true)).toBeNull();
  });
  it("the orientation modal still comes first", () => {
    expect(computeActiveSurface(state({ orientationModalSeenAt: null }), false, true, true)).toBe("orientation_modal");
  });
  it("paying learners get only the referral card (deliberate exception)", () => {
    expect(computeActiveSurface(state(), true, true, false)).toBeNull();
    expect(computeActiveSurface(state(), true, true, true)).toBe("referral_card");
    expect(computeActiveSurface(state({ orientationModalSeenAt: null }), true, true, true)).toBe("referral_card");
  });
  it("respects the 30-day referral dismissal", () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    expect(computeActiveSurface(state({ referralFloaterDismissedAt: recent }), false, true, true)).not.toBe("referral_card");
    expect(computeActiveSurface(state({ referralFloaterDismissedAt: recent }), true, true, true)).toBeNull();
    expect(computeActiveSurface(state({ referralFloaterDismissedAt: old }), false, true, true)).toBe("referral_card");
  });
  it("existing three-argument callers behave as before", () => {
    expect(computeActiveSurface(state(), false, true)).toBe("referral_floater");
    expect(computeActiveSurface(null, false, true, true)).toBeNull();
  });
  it("the card is a queue inline surface quieted for a week, losing to access cards", () => {
    expect(SURFACES.referral_card).toMatchObject({ kind: "inline", priority: 3, laterMs: 7 * 86_400_000 });
    const ctx = { onboardingOpen: false, firstSession: false, answeredTotal: 50, fieldFocused: false, msSincePointerDown: 5000 };
    expect(electSurfaces(["referral_card", "renewal"], ctx, {}, {}, 0).inline).toBe("renewal");
    expect(electSurfaces(["referral_card"], ctx, { referral_card: 10 }, {}, 0).inline).toBeNull();
    expect(electSurfaces(["referral_card"], { ...ctx, onboardingOpen: true }, {}, {}, 0).inline).toBeNull();
  });
});

describe("invite payload and share intents", () => {
  it("accepts only an enabled answer with an http(s) link", () => {
    expect(parseReferralInvite(null)).toEqual({ enabled: false });
    expect(parseReferralInvite({ enabled: true })).toEqual({ enabled: false });
    expect(parseReferralInvite({ enabled: true, link: "javascript:alert(1)" })).toEqual({ enabled: false });
    expect(parseReferralInvite({ enabled: true, link: "https://medpruf.com/login?ref=ABCD2345", mentorCredits: 50, card: { activeDays14: 4, eligible: true } }))
      .toEqual({ enabled: true, link: "https://medpruf.com/login?ref=ABCD2345", mentorCredits: 50, card: { activeDays14: 4, eligible: true } });
    expect(parseReferralInvite({ enabled: true, link: "https://x.test", mentorCredits: 0 }).mentorCredits).toBeNull();
  });
  it("email intent has no recipient and encodes subject and body", () => {
    const href = referralMailto("Einladung zu MedPrüf", "Hallo & https://medpruf.com/login?ref=AB");
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    expect(href).toContain(encodeURIComponent("Hallo & https://medpruf.com/login?ref=AB"));
    expect(href).not.toContain("&body=Hallo &");
  });
});

describe("copy", () => {
  const keys: ReferralSurfaceKey[] = ["share_group_label", "copy_invite", "copied", "copy_failed", "telegram", "whatsapp", "email", "share_native", "email_subject", "link_label", "terms_link", "card_title", "card_body", "card_dismiss_aria", "after_result_line", "after_result_cta"];
  it("German and English for every key, no dashes, no pass words, Sie", () => {
    for (const k of keys) {
      for (const lang of ["de", "en"]) {
        const s = rsT(k, lang, { credits: 50 });
        expect(s.length).toBeGreaterThan(0);
        expect(s).not.toMatch(/[–—]| - /);
        expect(s).not.toMatch(/bestanden|passed|\bdu\b|\bdein/i);
      }
    }
    expect(rsT("card_body", "de", { credits: 50 })).toContain("50 Credits für den KI-Mentor");
    expect(rsT("card_body", "de", { credits: 50 })).toContain("30 Tage");
    expect(rsT("card_body", "en", { credits: 50 })).toContain("first time");
  });
  it("unreviewed languages read English", () => {
    expect(referralSurfaceLang("ar")).toBe("en");
    expect(referralSurfaceLang("ru")).toBe("en");
    expect(rsT("copy_invite", "tr")).toBe("Copy invite");
  });
});

import { holdReferralCard, referralCardElected, resetReferralCardSignal, setReferralCardEligible, REFERRAL_CARD_HELD_KEY } from "@/lib/announcements/referral-card-signal";
import { clearAccountState } from "@/lib/master-locale/storage-keys";

describe("referral card election signal", () => {
  it("follows the granted slot, then stays held for the session after showing or dismissing", () => {
    const mem = new Map<string, string>();
    (globalThis as { window?: unknown }).window = globalThis;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    try {
      resetReferralCardSignal();
      expect(referralCardElected()).toBe(false);
      setReferralCardEligible(true);
      expect(referralCardElected()).toBe(true);
      setReferralCardEligible(false);
      expect(referralCardElected()).toBe(false);
      holdReferralCard();
      expect(mem.get(REFERRAL_CARD_HELD_KEY)).toBe("1");
      resetReferralCardSignal(); // a new page in the same session reads the hold back
      expect(referralCardElected()).toBe(true);
      const removed: string[] = [];
      clearAccountState({ getItem: () => null, setItem: () => true, removeItem: () => {} }, { removeItem: (k: string) => void removed.push(k) });
      expect(removed).toContain(REFERRAL_CARD_HELD_KEY);
    } finally {
      delete (globalThis as { window?: unknown }).window;
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
      resetReferralCardSignal();
    }
  });
});

describe("auth/me exposes the surface switch", () => {
  it("useUserTier maps referral_surface strictly", async () => {
    const { readFileSync } = await import("node:fs");
    const me = readFileSync("src/app/api/auth/me/route.ts", "utf8");
    expect(me).toMatch(/referral_surface: referralSurfaceEnabled\(\{/);
    const hook = readFileSync("src/lib/hooks/useUserTier.ts", "utf8");
    expect(hook).toContain("referralSurface: u.referral_surface === true");
    for (const f of ["src/components/referrals/ReferralHomeCard.tsx", "src/components/referrals/ReferralInviteLine.tsx", "src/components/mentor/FirstRunCard.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/useReferralInvite\([^)]*referralSurface|const active = [^\n]*referralSurface/);
    }
  });
});
