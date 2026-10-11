import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createMentorApi, recoverMentorTurn, type MentorFetch } from "@/components/mentor/api";
import { INITIAL_CHAT_STATE, buildChatRequest, chatReducer, lastUserRequest } from "@/components/mentor/chat-state";
import { packagePurchaseState, pendingPurchaseView, offerView, subscriptionText, verifyProgress } from "@/components/mentor/view-model";
import { FIXTURE_FINAL_OK, FIXTURE_USAGE, FIXTURE_PACKAGES } from "@/lib/mentor/fixtures";
import { MENTOR_NATIVE_REVIEW_PENDING_KEYS, mentorT, hasOwnMentorString } from "@/lib/i18n-mentor";
import type { MentorSseEvent, MentorUsageResponse } from "@/lib/mentor/contract";

vi.mock("@/components/ui", () => ({
  // Only chrome is stubbed. Actual answer controls and report form are rendered.
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? createElement("div", { role: "dialog" }, children) : null,
  Alert: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children),
}));
import { AssistantBubble, PatientAdvice } from "@/components/mentor/ChatMessage";
import ReportAnswerSheet from "@/components/mentor/ReportAnswerSheet";
import { creditArrival } from "@/components/mentor/PurchaseNotice";

(globalThis as { React?: unknown }).React = React;
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pending = (age: number, retryAllowed = false): MentorUsageResponse => ({
  ...FIXTURE_USAGE.ok,
  subscriptions: [],
  pending_purchase: { package_id: "mentor_basis", since: new Date(NOW - age).toISOString(), checkout_session_id: SESSION, retry_allowed: retryAllowed },
});

describe("MUX-35 original send identity and recovery", () => {
  it("keeps the original UUID and full context through dropped stream and every retry", () => {
    const request = buildChatRequest({ clientRequestId: REQUEST, text: " Explain ", lang: "uk", mode: "explain", questionId: 5, conversationId: "conversation" });
    let state = chatReducer(INITIAL_CHAT_STATE, { type: "send", userId: "u", assistantId: "a", text: "Explain", request });
    state = chatReducer(state, { type: "fail", error: "network" });
    for (let i = 0; i < 3; i++) {
      state = chatReducer(state, { type: "retry", assistantId: `a${i}` });
      expect(lastUserRequest(state)).toBe(request);
      expect(lastUserRequest(state)).toMatchObject({ client_request_id: REQUEST, question_id: 5, lang: "uk", conversation_id: "conversation" });
      expect(state.messages.filter((m) => m.role === "user")).toHaveLength(1);
      state = chatReducer(state, { type: "fail", error: "network" });
    }
  });

  it("polls the original result with GET only, renders in_progress, then replays final", async () => {
    const final = { ...FIXTURE_FINAL_OK, request_id: REQUEST };
    const fetch = vi.fn<MentorFetch>().mockResolvedValueOnce(json({ status: "in_progress" })).mockResolvedValueOnce(json({ status: "complete", final }));
    const events: MentorSseEvent[] = [];
    expect(await recoverMentorTurn(createMentorApi(fetch), REQUEST, (e) => events.push(e), undefined, async () => {})).toBe("complete");
    expect(events).toEqual([{ type: "in_progress", client_request_id: REQUEST }, final]);
    expect(fetch.mock.calls.every(([url, init]) => url.includes(`client_request_id=${REQUEST}`) && !init?.method)).toBe(true);
  });

  it("a missing or expired result ends recovery and Stop never reads another result", async () => {
    const fetch = vi.fn<MentorFetch>().mockResolvedValue(json({ status: "expired" }));
    const api = createMentorApi(fetch);
    expect(await recoverMentorTurn(api, REQUEST, () => {})).toBe("failed");
    expect(fetch).toHaveBeenCalledTimes(1);
    const ctrl = new AbortController(); ctrl.abort();
    expect(await recoverMentorTurn(api, REQUEST, () => {}, ctrl.signal)).toBe("aborted");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("MUX-78,79,85 buying guards", () => {
  it("an active same-package subscription replaces buying while other plans stay buyable", () => {
    const usage: MentorUsageResponse = { ...FIXTURE_USAGE.ok, subscriptions: [{ package_id: "mentor_basis", renews: true, status: "active", renews_at: null }] };
    expect(packagePurchaseState(usage, "mentor_basis", NOW)).toMatchObject({ disabled: true, reasonKey: "pkg_active" });
    expect(packagePurchaseState(usage, "mentor_plus", NOW).disabled).toBe(false);
    expect(packagePurchaseState(usage, "mentor_topup", NOW).disabled).toBe(false);
    expect(subscriptionText(usage.subscriptions[0], "en")).toBe("Active");
    const failed = { ...usage, subscriptions: [{ package_id: "mentor_basis" as const, renews: false, status: "payment_failed" as const }] };
    expect(packagePurchaseState(failed, "mentor_basis", NOW).disabled).toBe(true);
    expect(subscriptionText(failed.subscriptions[0], "en")).toBe("Payment failed");
    expect(packagePurchaseState({ ...usage, subscriptions: [{ package_id: "mentor_topup", status: "active", renews: false }] }, "mentor_topup", NOW).disabled).toBe(false);
  });

  it("blocks every package in resting even if a stale server can_buy says true", () => {
    for (const id of ["mentor_basis", "mentor_plus", "mentor_topup"] as const) {
      expect(packagePurchaseState({ ...FIXTURE_USAGE.resting, can_buy: true }, id, NOW)).toMatchObject({ disabled: true, reasonKey: "pkg_resting", mayRetry: false });
    }
  });

  it("blocks a pending same-package payment, supports it after 30min, expires at 24h", () => {
    expect(packagePurchaseState(pending(5_000), "mentor_basis", NOW)).toMatchObject({ disabled: true, reasonKey: "purchase_pending", mayRetry: false });
    expect(packagePurchaseState(pending(5_000), "mentor_topup", NOW).disabled).toBe(false);
    expect(pendingPurchaseView(pending(30 * 60_000 - 1, true), NOW)).toMatchObject({ showSupport: false, mayRetry: false });
    expect(pendingPurchaseView(pending(30 * 60_000, false), NOW)).toMatchObject({ showSupport: true, mayRetry: false });
    expect(packagePurchaseState(pending(30 * 60_000, true), "mentor_basis", NOW).mayRetry).toBe(true);
    expect(pendingPurchaseView(pending(24 * 60 * 60_000, true), NOW)).toBeNull();
  });

  it("does not announce credits from a balance increase or cleared/failed purchase", () => {
    expect(creditArrival({ ...FIXTURE_USAGE.ok, credits_left: 999, pending_purchase: null }, new Set())).toBeNull();
    const receipt = { checkout_session_id: SESSION, credits_added: 150, granted_at: new Date(NOW).toISOString() };
    const u = { ...FIXTURE_USAGE.ok, recent_purchase: receipt };
    expect(creditArrival(u, new Set())).toEqual(receipt);
    expect(creditArrival(u, new Set([SESSION]))).toBeNull();
  });

  it("preserves already_subscribed, pending_purchase and mentor_resting server errors", async () => {
    const fetch = vi.fn<MentorFetch>();
    const api = createMentorApi(fetch);
    for (const [error, status] of [["already_subscribed", 409], ["pending_purchase", 409], ["mentor_resting", 403]] as const) {
      fetch.mockResolvedValueOnce(json({ error }, status));
      expect(await api.checkout({ package_id: "mentor_basis" })).toMatchObject({ ok: false, error });
    }
  });
});

describe("MUX-74,83 purchase terms and receipt-specific credit count", () => {
  it("buy terms use the actual offer's price and recurring period", () => {
    const offer = { ...FIXTURE_PACKAGES.packages[0], price_eur_cents: 1234, period_days: 45 };
    const recurring = offerView(offer, "de");
    expect(recurring.buyText).toContain("Abo starten");
    expect(recurring.buyText).toContain("12,34");
    expect(recurring.buyText).toContain("45");
    expect(offerView({ ...offer, kind: "topup", period_days: null }, "en").buyText).toContain("Buy once");
    for (const lang of ["ru", "uk"] as const) expect(offerView(offer, lang).buyText).not.toContain("{price}");
  });

  it("requires checkout correlation and carries it through verify with credits_added", async () => {
    const fetch = vi.fn<MentorFetch>().mockResolvedValueOnce(json({ purchase_url: "https://whop.com/c/x" })).mockResolvedValueOnce(json({ purchase_url: "https://whop.com/c/x", checkout_session_id: SESSION })).mockResolvedValueOnce(json({ status: "granted", credits_added: 150, credits_left: 162 }));
    const api = createMentorApi(fetch);
    expect(await api.checkout({ package_id: "mentor_basis" })).toMatchObject({ ok: false });
    expect(await api.checkout({ package_id: "mentor_basis", retry_pending: true })).toMatchObject({ ok: true, checkoutSessionId: SESSION });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ package_id: "mentor_basis", retry_pending: true });
    const result = await api.verify(`?checkout_session_id=${SESSION}`);
    expect(result).toMatchObject({ ok: true, verify: { status: "granted", credits_added: 150, credits_left: 162 } });
    expect(fetch.mock.calls[2][0]).toBe(`/api/mentor/checkout/verify?checkout_session_id=${SESSION}`);
    expect(mentorT("ok_body_granted", "en", { added: 150, n: 162 })).toBe("New: +150 credits, now 162");
    expect(verifyProgress({ kind: "verify", status: "granted", credits: 162, creditsAdded: 150 }, 0, 0)).toMatchObject({ creditsAdded: 150 });
  });

  it("rejects a supposed grant without the newly-added credits", async () => {
    const fetch = vi.fn<MentorFetch>().mockResolvedValue(json({ status: "granted", credits_left: 162 }));
    expect(await createMentorApi(fetch).verify(`?checkout_session_id=${SESSION}`)).toMatchObject({ ok: false });
  });
});

describe("MUX-13,54 code-owned safety and answer reporting", () => {
  it("renders fixed DE/EN hotline links as 44px LTR targets", () => {
    for (const lang of ["de", "en", "ar"] as const) {
      const html = renderToStaticMarkup(createElement(PatientAdvice, { lang }));
      expect(html).toContain('href="tel:1450"');
      expect(html).toContain('href="tel:144"');
      expect(html.match(/<bdi dir="ltr">/g)).toHaveLength(2);
      expect(html.match(/min-h-11 min-w-11/g)).toHaveLength(2);
      expect(html).not.toContain("mp-error");
    }
    for (const lang of ["ru", "uk", "tr"] as const) {
      expect(hasOwnMentorString("refusal_patient_advice", lang)).toBe(false);
      expect(mentorT("refusal_patient_advice", lang)).toBe(mentorT("refusal_patient_advice", "en"));
      expect(MENTOR_NATIVE_REVIEW_PENDING_KEYS).toContain("refusal_patient_advice");
    }
  });

  it("every finished answer renders a named 44px report control; refusal suppresses unrelated notice/link", () => {
    const final = { ...FIXTURE_FINAL_OK, request_id: REQUEST, refused: "patient_advice" as const, refusal_link: "https://www.aerztekammer.at/", validator_replaced: true };
    const html = renderToStaticMarkup(createElement(AssistantBubble, { msg: { id: "a", role: "assistant", status: "done", text: "", final }, lang: "en", packagesHref: null, waitSeconds: 0, onRetry() {}, onNewChat() {} }));
    expect(html).toContain("Wrong or outdated? Report");
    expect(html).toContain('aria-label="Report answer: If you have symptoms');
    expect(html).not.toContain("aerztekammer.at");
    expect(html).not.toContain(mentorT("validator_notice", "en"));
  });

  it("report form renders five 44px reason radios and an optional details field", () => {
    const html = renderToStaticMarkup(createElement(ReportAnswerSheet, { open: true, lang: "en", onClose() {}, onSubmit: async () => true }));
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html.match(/min-h-11 cursor-pointer/g)).toHaveLength(5);
    expect(html).toContain("Question or answer looks wrong");
    expect(html).toContain("Additional details (optional)");
  });

  it("posts the canonical request reference and no client-authored answer/fact contents", async () => {
    const fetch = vi.fn<MentorFetch>().mockResolvedValue(json({ ok: true }));
    expect(await createMentorApi(fetch).report({ request_id: REQUEST, reason: "date_wrong", details: "Please check" })).toEqual({ ok: true });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ request_id: REQUEST, reason: "date_wrong", details: "Please check" });
  });
});
