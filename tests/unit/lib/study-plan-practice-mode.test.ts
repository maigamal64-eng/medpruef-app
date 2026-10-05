import { describe, expect, it } from "vitest";
import { getStudyPlanPracticeMode } from "@/lib/studyPlan";

describe("study-plan quiz routing", () => {
  it("routes review blocks through due-first mode with an all-topic fallback", () => {
    expect(getStudyPlanPracticeMode("review")).toBe("all");
  });

  it("keeps new and weak blocks on the unseen-question pool", () => {
    expect(getStudyPlanPracticeMode("new")).toBe("unseen");
    expect(getStudyPlanPracticeMode("weak")).toBe("unseen");
  });
});
