import { describe, expect, it } from "vitest";
import { MISTAKE_SESSION_CAP, planMistakeSession } from "@/lib/mistake-session";

describe("planMistakeSession (Fehler-Wiederholung length)", () => {
  it("fewer than 20 mistakes: the session is exactly those mistakes, not 20", () => {
    expect(planMistakeSession(7)).toEqual({ target: 7, remaining: 0 });
    expect(planMistakeSession(1)).toEqual({ target: 1, remaining: 0 });
  });
  it("more than 20 mistakes: all of them, not the daily goal of 20", () => {
    expect(planMistakeSession(45)).toEqual({ target: 45, remaining: 0 });
  });
  it("beyond the cap the rest is reported as remaining", () => {
    expect(planMistakeSession(MISTAKE_SESSION_CAP + 30)).toEqual({ target: MISTAKE_SESSION_CAP, remaining: 30 });
  });
  it("zero mistakes gives a zero target (empty view, no padding)", () => {
    expect(planMistakeSession(0)).toEqual({ target: 0, remaining: 0 });
  });
  it("unknown count is open-ended, never a fixed 20", () => {
    expect(planMistakeSession(null)).toEqual({ target: null, remaining: 0 });
    expect(planMistakeSession(undefined).target).toBeNull();
    expect(planMistakeSession(Number.NaN).target).toBeNull();
  });
});
