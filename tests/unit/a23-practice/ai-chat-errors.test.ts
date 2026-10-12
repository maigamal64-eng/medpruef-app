import { describe, expect, it } from "vitest";
import { classifyAiFailure, resetClock } from "@/lib/ai-chat-errors";

describe("in-card AI failures (UX-PRA-28)", () => {
  const now = new Date("2026-10-12T21:30:00Z");
  it("retryable: offline, timeout, network, 5xx, burst", () => {
    expect(classifyAiFailure({ offline: true })).toMatchObject({ kind: "offline", retryable: true });
    expect(classifyAiFailure({ timedOut: true })).toMatchObject({ kind: "timeout", retryable: true });
    expect(classifyAiFailure({})).toMatchObject({ kind: "network", retryable: true });
    expect(classifyAiFailure({ status: 503 })).toMatchObject({ kind: "server", retryable: true });
    expect(classifyAiFailure({ status: 429, body: { retryAfter: 20 } })).toMatchObject({ kind: "burst", retryable: true });
  });
  it("limits never offer a retry and carry the server's reset time", () => {
    const daily = classifyAiFailure({ status: 429, body: { error: "Daily quota", retry_after: 3600 }, now });
    expect(daily).toMatchObject({ kind: "daily_limit", retryable: false });
    expect(daily.resetAt?.toISOString()).toBe("2026-10-12T22:30:00.000Z");
    expect(classifyAiFailure({ status: 429, retryAfterHeader: "60", now }).resetAt?.toISOString()).toBe("2026-10-12T21:31:00.000Z");
    expect(classifyAiFailure({ status: 429, body: { error: "monthly_cap_reached" } })).toMatchObject({ kind: "monthly_limit", retryable: false, resetAt: null });
    expect(classifyAiFailure({ status: 402 })).toMatchObject({ kind: "plan", retryable: false });
  });
  it("formats the reset clock or says nothing", () => {
    expect(resetClock(null, "de-AT")).toBeNull();
    expect(resetClock(new Date("2026-10-12T22:30:00Z"), "de-AT")).toMatch(/^\d{2}:\d{2}$/);
  });
});
