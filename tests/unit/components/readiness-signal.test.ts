import { describe, expect, it } from "vitest";
import { isReadinessResponse } from "@/components/ReadinessSignal";

const validResponse = {
  band: "building",
  factors: { coverage: 0.6, accuracy: 0.7, consistency: 0.5, pace: null },
  trend: "flat",
  lowestFactor: "consistency",
  hasExamDate: false,
};

describe("readiness response validation", () => {
  it("accepts a valid readiness payload", () => {
    expect(isReadinessResponse(validResponse)).toBe(true);
  });

  it.each([
    ["band", "toString"],
    ["band", "constructor"],
    ["trend", "constructor"],
    ["trend", "__proto__"],
    ["lowestFactor", "__proto__"],
    ["lowestFactor", "toString"],
  ])("rejects inherited metadata key %s=%s", (field, value) => {
    expect(isReadinessResponse({ ...validResponse, [field]: value })).toBe(false);
  });

  it("rejects missing or malformed response shapes", () => {
    expect(isReadinessResponse({})).toBe(false);
    expect(isReadinessResponse({ ...validResponse, factors: { ...validResponse.factors, coverage: 2 } })).toBe(false);
  });
});
