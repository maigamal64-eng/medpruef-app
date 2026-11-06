/**
 * a-mentor-better-1106, client side: the deeper chip and the bank provenance render only with v2
 * fields and the v2 handler; the first next step becomes a button only with v2; the SSE parser keeps
 * the new fields only as literal true; start_simulation has a label and a route; the request
 * builder carries depth.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";
vi.mock("@/components/ui", () => ({ Dialog: () => null, Alert: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children) }));
import { AssistantBubble } from "@/components/mentor/ChatMessage";
import type { AssistantMsg } from "@/components/mentor/chat-state";
import { buildChatRequest } from "@/components/mentor/chat-state";
import { toMentorEvent } from "@/components/mentor/sse";
import { answerCopy } from "@/components/mentor/answer-copy";
import { actionHref } from "@/lib/mentor/actions";
import { isMentorClientEvent, mentorEventData } from "@/lib/mentor/telemetry";
(globalThis as { React?: unknown }).React = React;

const final = { ...FIXTURE_FINAL_OK, offer_deeper: true as const, from_bank: true as const, next_actions: [{ kind: "practice_topic" as const, topic: "Psychiatrie", exam_source: "kenntnispruefung" }, { kind: "open_question" as const, question_id: 101, exam_source: "kenntnispruefung" }] };
const msg = (f = final): AssistantMsg => ({ id: "a", role: "assistant", status: "done", text: "", final: f });
const bubble = (m: AssistantMsg, lang: "de" | "en" | "ar", extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(AssistantBubble, { msg: m, lang, packagesHref: null, waitSeconds: 0, onRetry() {}, onNewChat() {}, ...extra }));

describe("answer bubble, v2", () => {
  it("shows the deeper chip and the bank line with the v2 handler", () => {
    const html = bubble(msg(), "de", { onDeeper() {}, v2: true });
    expect(html).toContain("data-mentor-deeper");
    expect(html).toContain("Ausführlicher erklären");
    expect(html).toContain("Aus Übungsfragen der MedPrüf-Fragenbank");
    // The first next step is a button, the second stays a link.
    expect(html).toMatch(/class="mp-btn mp-btn--secondary inline-flex[^"]*"[^>]*>Thema üben/);
  });

  it("without the v2 handler nothing new renders, even if a recovered final carries the fields", () => {
    const html = bubble(msg(), "en");
    expect(html).not.toContain("data-mentor-deeper");
    expect(html).not.toMatch(/mp-btn mp-btn--secondary inline-flex/);
  });

  it("an Arabic UI reads the English chip like the rest of the chrome", () => {
    expect(bubble(msg(), "ar", { onDeeper() {}, v2: true })).toContain("Explain in more depth");
  });
});

describe("parsing and routes", () => {
  it("keeps offer_deeper and from_bank only as literal true", () => {
    expect((toMentorEvent({ ...FIXTURE_FINAL_OK, offer_deeper: true, from_bank: true }) as typeof final).offer_deeper).toBe(true);
    const bad = toMentorEvent({ ...FIXTURE_FINAL_OK, offer_deeper: "yes", from_bank: 1 }) as typeof final;
    expect(bad.offer_deeper).toBeUndefined();
    expect(bad.from_bank).toBeUndefined();
  });

  it("start_simulation survives parsing, has a label and opens the simulation of the exam", () => {
    const ev = toMentorEvent({ ...FIXTURE_FINAL_OK, next_actions: [{ kind: "start_simulation", exam_source: "pharma" }, { kind: "evil" }] }) as typeof final;
    expect(ev.next_actions?.map((a) => a.kind)).toEqual(["start_simulation"]);
    expect(answerCopy("start_simulation", "de")).toBe("Simulation starten");
    expect(answerCopy("start_simulation", "ar")).toBe("Start a simulation");
    expect(actionHref({ kind: "start_simulation", exam_source: "pharma" })).toBe("/exam?from=mentor&examSource=pharma");
  });

  it("the deeper click is a whitelisted telemetry kind", () => {
    expect(isMentorClientEvent("mentor_next_step_click")).toBe(true);
    expect(mentorEventData({ kind: "go_deeper" })).toEqual({ kind: "go_deeper" });
    expect(mentorEventData({ kind: "start_simulation" })).toEqual({ kind: "start_simulation" });
  });

  it("the request builder sends depth only when asked", () => {
    const base = { text: "Bitte erklären Sie das ausführlicher.", lang: "de" as const, mode: "facts" as const, clientRequestId: "6f1b5c1e-6f0a-4f43-9c39-0d5a1a7f2a11" };
    expect(buildChatRequest({ ...base, depth: "deep" }).depth).toBe("deep");
    expect(buildChatRequest(base).depth).toBeUndefined();
  });
});
