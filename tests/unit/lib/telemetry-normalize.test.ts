import { describe, expect, it } from "vitest";
import { normalizeEventTimestamp, normalizeTrackedPath } from "@/lib/telemetry-normalize";

describe("telemetry normalization", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");

  it("replaces invalid, historical, and implausibly future event clocks with receipt time", () => {
    expect(normalizeEventTimestamp("1978-08-01T00:00:00.000Z", now)).toBe(now.toISOString());
    expect(normalizeEventTimestamp("not-a-date", now)).toBe(now.toISOString());
    expect(normalizeEventTimestamp("2026-09-27T00:00:00.000Z", now)).toBe(now.toISOString());
  });

  it("preserves a plausible client timestamp", () => {
    expect(normalizeEventTimestamp("2026-09-26T11:59:00.000Z", now)).toBe("2026-09-26T11:59:00.000Z");
  });

  it("drops query and fragment data and templates identifier segments", () => {
    expect(normalizeTrackedPath("/admin/users/123456?email=private@example.com#row"))
      .toBe("/admin/users/:id");
    expect(normalizeTrackedPath("https://medpruf.com/quiz?userId=secret"))
      .toBe("/quiz");
  });

  it("rejects empty or invalid route values", () => {
    expect(normalizeTrackedPath("   ")).toBeNull();
    expect(normalizeTrackedPath(null)).toBeNull();
  });
});
