import { describe, it, expect } from "vitest";
import {
  ALL_SERVER_ERROR_CODES,
  defaultAnswerLang,
  errorView,
  formatDate,
  formatEur,
  isAnswerLang,
  offerView,
  refusalKey,
  safeExternalUrl,
  sanitizeOffers,
  usageView,
  verifyProgress,
  VERIFY_CEILING_MS,
  MENTOR_ANSWER_LANGS,
} from "@/components/mentor/view-model";
import { FIXTURE_USAGE, FIXTURE_PACKAGES } from "@/lib/mentor/fixtures";
import { MENTOR_ERROR_STATUS, MENTOR_REFUSAL_REASONS, MENTOR_USAGE_STATES } from "@/lib/mentor/contract";
import { MENTOR_KEYS, mentorT } from "@/lib/i18n-mentor";

const NOW = new Date("2026-10-10T12:00:00Z");

describe("usageView", () => {
  it("has a view for every usage state", () => {
    for (const s of MENTOR_USAGE_STATES) expect(usageView(FIXTURE_USAGE[s], "de", NOW)).toBeTruthy();
  });

  it("ok: no banner, chat open; low: warning with packages", () => {
    expect(usageView(FIXTURE_USAGE.ok, "de", NOW)).toMatchObject({ canChat: true, banner: null, tone: "ok" });
    const low = usageView(FIXTURE_USAGE.low, "de", NOW);
    expect(low).toMatchObject({ canChat: true, tone: "low", showBuy: true });
    expect(low.banner).toMatchObject({ tone: "warning", offerPackages: true });
  });

  it("exhausted and resting close the composer; none stays open so the server decides", () => {
    expect(usageView(FIXTURE_USAGE.exhausted, "de", NOW).canChat).toBe(false);
    expect(usageView(FIXTURE_USAGE.resting, "de", NOW)).toMatchObject({ canChat: false, showBuy: false });
    expect(usageView(FIXTURE_USAGE.none, "de", NOW).canChat).toBe(true);
  });

  it("can_buy false makes no purchase offer anywhere", () => {
    for (const s of ["low", "exhausted", "none"] as const) {
      const v = usageView({ ...FIXTURE_USAGE[s], can_buy: false }, "de", NOW);
      expect(v.showBuy).toBe(false);
      expect(v.banner?.offerPackages).toBe(false);
    }
  });

  it("shows credits and messages, never money", () => {
    const v = usageView(FIXTURE_USAGE.ok, "en", NOW);
    expect(v.creditsText).toBe("142 credits");
    expect(v.messagesText).toBe("about 142 messages");
    expect(`${v.creditsText}${v.messagesText}`).not.toMatch(/\$|USD|dollar/i);
  });

  it("mentions expiry only when it is near and credits remain", () => {
    const soon = { ...FIXTURE_USAGE.ok, next_expiry: "2026-10-15T00:00:00Z" };
    expect(usageView(soon, "de", NOW).expiryText).toContain("2026");
    expect(usageView({ ...FIXTURE_USAGE.ok, next_expiry: "2026-12-01T00:00:00Z" }, "de", NOW).expiryText).toBeNull();
    expect(usageView({ ...soon, credits_left: 0 }, "de", NOW).expiryText).toBeNull();
    expect(usageView({ ...soon, next_expiry: "2026-10-01T00:00:00Z" }, "de", NOW).expiryText).toBeNull();
  });

  it("plural forms follow the language", () => {
    expect(mentorT("credits_count", "de", { n: 1 })).toBe("1 Credit");
    expect(mentorT("credits_count", "ru", { n: 2 })).toBe("2 кредита");
    expect(mentorT("credits_count", "ru", { n: 5 })).toBe("5 кредитов");
    expect(mentorT("credits_count", "ru", { n: 21 })).toBe("21 кредит");
  });
});

describe("errorView", () => {
  it("covers every server error code with copy that exists", () => {
    for (const code of Object.keys(MENTOR_ERROR_STATUS)) {
      const v = errorView(code as never);
      expect(MENTOR_KEYS).toContain(v.messageKey);
      expect(mentorT(v.messageKey, "de", v.vars)).not.toBe(v.messageKey);
    }
    expect(ALL_SERVER_ERROR_CODES.slice().sort()).toEqual(Object.keys(MENTOR_ERROR_STATUS).sort());
  });

  it("routes each code to the right recovery action", () => {
    expect(errorView("credits_required").action).toBe("packages");
    expect(errorView("credits_exhausted").action).toBe("packages");
    expect(errorView("unauthenticated").action).toBe("signin");
    expect(errorView("input_too_large").action).toBe("new_chat");
    for (const c of ["ai_disabled", "global_cap", "reserve_failed", "upstream_error", "network", "unknown"] as const) {
      expect(errorView(c).action).toBe("retry");
    }
    expect(errorView("locked_today").action).toBe("none");
    expect(errorView("mentor_disabled").action).toBe("none");
  });

  it("rate limit: countdown copy with seconds, plain copy without", () => {
    const v = errorView("rate_limited", { retryAfterSeconds: 30 });
    expect(mentorT(v.messageKey, "en", v.vars)).toContain("30");
    expect(errorView("rate_limited").messageKey).toBe("err_rate_limited_nowait");
  });
});

describe("refusals and links", () => {
  it("has copy for every refusal reason", () => {
    for (const r of MENTOR_REFUSAL_REASONS) {
      expect(MENTOR_KEYS).toContain(refusalKey(r));
    }
  });
  it("renders only https links", () => {
    expect(safeExternalUrl("https://example.org/x")).toBe("https://example.org/x");
    expect(safeExternalUrl("http://example.org")).toBeNull();
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats Stand dates in Vienna time and prices in EUR", () => {
    expect(formatDate("2026-10-10", "de")).toBe("10. Oktober 2026");
    expect(formatDate("garbage", "de")).toBe("");
    expect(formatEur(490, "de")).toMatch(/4,90/);
    expect(formatEur(490, "de")).toContain("€");
    expect(formatEur(990, "en")).toContain("9.90");
  });
});

describe("answer language", () => {
  it("never offers Arabic until it is signed off, and maps an Arabic UI to English", () => {
    expect(MENTOR_ANSWER_LANGS).not.toContain("ar");
    expect(isAnswerLang("ar")).toBe(false);
    expect(defaultAnswerLang("ar")).toBe("en");
    expect(defaultAnswerLang("de")).toBe("de");
    expect(defaultAnswerLang("tr")).toBe("tr");
  });
});

describe("package offers", () => {
  it("builds a card from the server numbers only", () => {
    const basis = offerView(FIXTURE_PACKAGES.packages[0], "de");
    expect(basis).toMatchObject({ isSubscription: true });
    expect(basis.periodText).toContain("30");
    expect(basis.validText).toContain("33");
    expect(basis.priceText).toMatch(/4,90/);
    const top = offerView(FIXTURE_PACKAGES.packages[2], "de");
    expect(top).toMatchObject({ isSubscription: false, periodText: null, renewsNote: null });
  });

  it("drops offers the UI cannot render safely", () => {
    expect(sanitizeOffers(FIXTURE_PACKAGES.packages)).toHaveLength(3);
    expect(sanitizeOffers([{ package_id: "free", kind: "subscription", credits: 1, price_eur_cents: 1, messages_estimate: 1, valid_days: 1 }])).toEqual([]);
    expect(sanitizeOffers([{ ...FIXTURE_PACKAGES.packages[0], price_eur_cents: 0 }])).toEqual([]);
    expect(sanitizeOffers("nope")).toEqual([]);
  });
});

describe("checkout return honesty", () => {
  const pending = { kind: "verify", status: "pending", credits: 0 } as const;

  it("says granted only when the server says granted", () => {
    expect(verifyProgress({ kind: "verify", status: "granted", credits: 150 }, 0, 0)).toMatchObject({ state: "granted", credits: 150, nextDelayMs: null });
    for (const r of [pending, { kind: "error", error: "network" } as const, { kind: "error", error: "upstream_error" } as const]) {
      expect(verifyProgress(r, 0, 0).state).not.toBe("granted");
    }
  });

  it("keeps polling on pending and on transient errors, backing off", () => {
    expect(verifyProgress(pending, 0, 0)).toMatchObject({ state: "pending", nextDelayMs: 2_500 });
    expect(verifyProgress({ kind: "error", error: "network" }, 3, 20_000)).toMatchObject({ state: "pending", nextDelayMs: 20_000 });
    expect(verifyProgress(pending, 20, 100_000).nextDelayMs).toBe(60_000);
  });

  it("after the ceiling it says slow, never done", () => {
    const p = verifyProgress(pending, 30, VERIFY_CEILING_MS - 1_000);
    expect(p).toMatchObject({ state: "slow", nextDelayMs: null });
  });

  it("failed stops polling; a lost session asks to sign in", () => {
    expect(verifyProgress({ kind: "verify", status: "failed", credits: 0 }, 0, 0)).toMatchObject({ state: "failed", nextDelayMs: null });
    expect(verifyProgress({ kind: "error", error: "unauthenticated" }, 0, 0)).toMatchObject({ state: "signin", nextDelayMs: null });
  });
});
