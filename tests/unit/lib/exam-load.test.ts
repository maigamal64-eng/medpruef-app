import { describe, expect, it } from "vitest";
import { isExamBatchComplete } from "@/lib/examLoad";

describe("exam simulation batch validation", () => {
  it("accepts a fully loaded blueprint batch", () => {
    expect(isExamBatchComplete(28, 28)).toBe(true);
    expect(isExamBatchComplete(30, 28)).toBe(true);
  });

  it("rejects a partial or invalid batch instead of starting an incomplete exam", () => {
    expect(isExamBatchComplete(27, 28)).toBe(false);
    expect(isExamBatchComplete(0, 28)).toBe(false);
    expect(isExamBatchComplete(28, 0)).toBe(false);
  });
});
