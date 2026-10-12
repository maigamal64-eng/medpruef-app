import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";
import type { MentorUsageResponse } from "@/lib/mentor/contract";
import { toMentorEvent } from "@/components/mentor/sse";
import { admissionGapText, a38T } from "@/components/mentor/a38-copy";
import { exhaustedState } from "@/components/mentor/r1-shell-state";
vi.mock("@/components/ui", () => ({ Dialog: () => null, Alert: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children) }));
import { AssistantBubble, errorBillingLine, errorViewFor } from "@/components/mentor/ChatMessage";
(globalThis as { React?: unknown }).React = React;

const bubble = (msg: Record<string, unknown>, lang: "de" | "en" = "de") =>
  renderToStaticMarkup(createElement(AssistantBubble, { msg: { id: "a", role: "assistant", text: "", ...msg } as never, lang, packagesHref: "/mentor/packages", waitSeconds: 0, onRetry() {}, onNewChat() {}, onRephrase() {} }));

describe("a38 MUX-38 not-charged lines", () => {
  it("say 'not charged' only on a server-confirmed free turn; a network failure never claims it", () => {
    expect(errorBillingLine({ error: "network", notCharged: true }, "de")).toBe("Prüfen Sie Ihr Guthaben: Eine fehlgeschlagene Antwort kostet nichts, eine fertige sehen Sie nach dem Neuladen.");
    expect(errorBillingLine({ error: "upstream_error", reason: "answer_timeout" }, "de")).toBe(a38T("network_check", "de"));
    expect(errorBillingLine({ error: "upstream_error", notCharged: true }, "de")).toBe("Dafür wurden keine Credits abgezogen.");
    expect(errorBillingLine({ error: "upstream_error" }, "de")).toBeNull();
    expect(errorBillingLine({ error: "credits_exhausted", notCharged: true }, "de")).toBeNull();
  });
  it("the SSE parser keeps credits_deducted:false only when the server sent it", () => {
    expect(toMentorEvent({ type: "error", error: "upstream_error", credits_deducted: false })).toEqual({ type: "error", error: "upstream_error", credits_deducted: false });
    expect(toMentorEvent({ type: "error", error: "upstream_error" })).toEqual({ type: "error", error: "upstream_error" });
    expect(toMentorEvent({ type: "error", error: "upstream_error", credits_deducted: true })).toEqual({ type: "error", error: "upstream_error" });
  });
  it("a free final shows 'Nicht berechnet'; a charged one does not", () => {
    expect(bubble({ status: "done", final: { ...FIXTURE_FINAL_OK, charged: false, credits_used: 0 } })).toContain("Nicht berechnet");
    expect(bubble({ status: "done", final: { ...FIXTURE_FINAL_OK, charged: true, credits_used: 0.2 } })).not.toContain("Nicht berechnet");
    expect(bubble({ status: "done", final: { ...FIXTURE_FINAL_OK, result: "notice", reason: "no_source", charged: false, credits_used: 0 } })).toContain("Dafür wurden keine Credits abgezogen.");
    expect(bubble({ status: "error", error: "upstream_error", notCharged: true })).toContain("Dafür wurden keine Credits abgezogen.");
    expect(bubble({ status: "error", error: "network" })).not.toContain("keine Credits abgezogen");
  });
});

describe("a38 MUX-37 A Hide", () => {
  it("a hidden in-flight answer says it is still being finished; the finished one states its charge and offers View", () => {
    const waiting = bubble({ status: "streaming", hidden: true, text: "teil" });
    expect(waiting).toContain(a38T("hidden_waiting", "de"));
    expect(waiting).not.toContain("teil");
    expect(bubble({ status: "done", hidden: true, final: { ...FIXTURE_FINAL_OK, charged: true } })).toContain("Ausgeblendet. Die Antwort ist fertig und wurde berechnet.");
    const noCharged = { ...FIXTURE_FINAL_OK } as Partial<typeof FIXTURE_FINAL_OK>;
    delete noCharged.charged;
    const neutral = bubble({ status: "done", hidden: true, final: noCharged });
    expect(neutral).toContain("Ausgeblendet. Die Antwort ist fertig.");
    expect(neutral).not.toContain("nicht berechnet");
    const free = bubble({ status: "done", hidden: true, final: { ...FIXTURE_FINAL_OK, charged: false } });
    expect(free).toContain("wurde nicht berechnet");
    expect(free).toContain(">Ansehen<");
  });
  it("no 'gestoppt' line remains in the learner copy while a turn can still be charged", () => {
    expect(readFileSync("src/lib/i18n-mentor.ts", "utf8")).not.toMatch(/stopped_notice|Antwort gestoppt/);
    const composer = readFileSync("src/components/mentor/Composer.tsx", "utf8");
    expect(composer).toMatch(/a38T\("hide", p\.lang\)/);
    expect(composer).toMatch(/h-11 w-11/);
  });
});

describe("a38 MUX-23 one admission number", () => {
  it("names the bar above zero, says 'aufgebraucht' only at zero, and never shows a balance at or above the bar", () => {
    expect(admissionGapText(4.2, 4.21, "de")).toBe("Für die nächste Nachricht brauchen Sie mindestens 4,3 Credits. Sie haben noch 4,2. Mit einem Paket geht es weiter.");
    expect(admissionGapText(4.29, 4.21, "de")).toBeNull();
    expect(admissionGapText(0, 4.21, "de")).toBeNull();
    expect(admissionGapText(1.05, 4.21, "en")).toBe("You need at least 4.3 credits for the next message. You have 1.0 left. A package lets you continue.");
    expect(admissionGapText(3, null, "de")).toBeNull();
  });
  it("the 402 card, the pill/composer reason and the packages line read the same numbers", () => {
    const view = errorViewFor({ error: "credits_exhausted", admitMinCredits: 4.21, creditsLeft: 2 }, "de");
    expect(view.text).toContain("mindestens 4,3 Credits");
    expect(errorViewFor({ error: "credits_exhausted" }, "de").text).toBeUndefined();
    const u = { state: "exhausted", credits_left: 2, admit_min_credits: 4.21, sources: ["package"], subscriptions: [], can_buy: false, messages_left_estimate: 0, next_expiry: null } as unknown as MentorUsageResponse;
    expect(exhaustedState(u, [], "de").reason).toContain("mindestens 4,3 Credits. Sie haben noch 2,0.");
    expect(exhaustedState(u, [], "de").composerReason).toBe("Mindestens 4,3 Credits nötig, Sie haben 2,0.");
    expect(exhaustedState({ ...u, credits_left: 0 }, [], "de").reason).toContain("aufgebraucht");
    expect(readFileSync("src/components/mentor/PackagesScreen.tsx", "utf8")).toMatch(/admissionGapText\(usage\.value\.credits_left, usage\.value\.admit_min_credits/);
  });
});
