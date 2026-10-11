import { describe, expect, it } from "vitest";
import { FIXTURE_PACKAGES, FIXTURE_USAGE } from "@/lib/mentor/fixtures";
import { buildChatRequest, chatReducer, INITIAL_CHAT_STATE, lastUserRequest } from "@/components/mentor/chat-state";
import { conservativeMessageFloor, isLowCredits, offerView, usageView } from "@/components/mentor/view-model";
import { exhaustedState, keyboardIsOpen, lowCreditText, TURN_SILENCE_MS } from "@/components/mentor/r1-shell-state";
import { shellT, SHELL_AR_DRAFT } from "@/components/mentor/r1-shell-copy";

const request = () => buildChatRequest({ text: "Why?", mode: "explain", questionId: 5, lang: "en", clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", selectedOptionText: "Potassium", wasCorrect: false, filingUniversity: "graz" });

describe("MUX-22 source-aware exhausted state", () => {
  it("uses the lot's renewal date and top-up package row for subscribers", () => {
    const u = { ...FIXTURE_USAGE.exhausted, source_package: "mentor_basis" as const, renewal_at: "2026-11-01T12:00:00Z", current_grant: 150 };
    const view = exhaustedState(u, FIXTURE_PACKAGES.packages, "en");
    expect(view.reason).toContain("1 November 2026");
    expect(view.reason).toContain("400 credits once for €10.00");
    expect(view.href).toBe("/mentor/packages?from=exhausted&select=mentor_topup#topup");
  });
  it("Pro at zero uses its grant and Plus when top-ups are absent, never Pro again", () => {
    const u = { ...FIXTURE_USAGE.exhausted, sources: ["pro_included" as const], current_grant: 50, renewal_at: null };
    const view = exhaustedState(u, FIXTURE_PACKAGES.packages.filter((p) => p.kind !== "topup"), "en");
    expect(view.reason).toContain("Your 50 Pro credits are used up.");
    expect(view.reason).toContain("Mentor Plus");
    expect(view.reason).not.toContain("New credits on");
    expect(view.href).toContain("select=mentor_plus");
  });
  it("no buyable top-up row means no top-up line or fabricated price", () => {
    const u = { ...FIXTURE_USAGE.exhausted, source_package: "mentor_basis" as const };
    expect(exhaustedState(u, [], "en").reason).not.toMatch(/once|EUR|€/);
    expect(exhaustedState({ ...u, can_buy: false }, FIXTURE_PACKAGES.packages, "en").reason).not.toContain("once");
  });
});

describe("MUX-24/32 credit-only, stable estimates", () => {
  it("uses the server threshold, not a second fixed threshold", () => {
    expect(isLowCredits(20, 22.5)).toBe(true);
    expect(isLowCredits(20, 10)).toBe(false);
    expect(isLowCredits(10, 10)).toBe(false);
  });
  it("low banner uses a credit number and lot renewal date, never a message estimate", () => {
    const text = lowCreditText({ ...FIXTURE_USAGE.low, renewal_at: "2026-11-01T12:00:00Z", messages_left_estimate: 9999 }, "en");
    expect(text).toMatch(/^\d+ credits left/);
    expect(text).toContain("1 November 2026");
    expect(text).not.toMatch(/messages|9999/);
  });
  it("every package uses the same conservative floor derived from its grant", () => {
    for (const row of FIXTURE_PACKAGES.packages) {
      expect(conservativeMessageFloor(row)).toBe(Math.floor(row.credits));
      expect(offerView({ ...row, messages_estimate: 9999 }, "en").messagesText).toBe(`at least about ${Math.floor(row.credits)} messages`);
    }
  });
  it("changing the learner average never rebases the balance message copy", () => {
    const before = usageView({ ...FIXTURE_USAGE.ok, messages_left_estimate: 10 }, "en");
    const after = usageView({ ...FIXTURE_USAGE.ok, messages_left_estimate: 50000 }, "en");
    expect(after.messagesText).toBe(before.messagesText);
    expect(after.messagesText).not.toMatch(/\d+ messages/);
  });
});

describe("MUX-26/36 keyboard and recovery timing", () => {
  it("focus and small browser chrome changes are not treated as a keyboard", () => {
    expect(keyboardIsOpen(667, 667)).toBe(false);
    expect(keyboardIsOpen(667, 620)).toBe(false);
    expect(keyboardIsOpen(667, 420)).toBe(true);
    expect(keyboardIsOpen(640, 360)).toBe(true);
    expect(TURN_SILENCE_MS).toBe(45000);
  });
  it("retry preserves UUID, selected option text, correctness and filing university", () => {
    const req = request();
    let state = chatReducer(INITIAL_CHAT_STATE, { type: "send", userId: "u", assistantId: "a", text: "Why?", request: req });
    state = chatReducer(state, { type: "fail", error: "network" });
    state = chatReducer(state, { type: "retry", assistantId: "b" });
    expect(lastUserRequest(state)).toEqual(req);
    expect(req).toMatchObject({ selected_option_text: "Potassium", was_correct: false, filing_university: "graz" });
    const facts = buildChatRequest({ text: "Dates?", mode: "facts", lang: "en", clientRequestId: "id", questionId: 5, selectedOptionText: "Potassium", wasCorrect: false });
    expect(facts).not.toHaveProperty("selected_option_text");
    expect(facts).not.toHaveProperty("was_correct");
  });
});

describe("MUX-41/49 copy and Arabic draft gate", () => {
  it("scope copy has a separate provenance and limit for each mode", () => {
    expect(shellT("scope_facts", "en")).toContain("official source");
    expect(shellT("scope_explain", "en")).toContain("practice question");
    expect(shellT("scope_study", "en")).toContain("only you see it");
    expect(shellT("diploma_limit", "de")).toContain("Universität");
    expect(shellT("complete", "en", { n: 2 })).toBe("Answer ready, 2 sources.");
  });
  it("Arabic falls back to English and the Egyptian draft is marked for sign-off", () => {
    expect(shellT("cost", "ar")).toBe(shellT("cost", "en"));
    expect(SHELL_AR_DRAFT.status).toBe("needs [name] sign-off");
    for (const lang of ["de", "en", "ru", "uk", "tr", "ar"] as const) {
      for (const key of ["scope_facts", "scope_explain", "scope_study", "wait", "rest", "complete"] as const) expect(shellT(key, lang, { n: 2 })).not.toMatch(/[—–]/);
    }
  });
});
