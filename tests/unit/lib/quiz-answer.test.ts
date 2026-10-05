import { describe, expect, it } from "vitest";
import { isUnscoredAnswerReveal } from "@/lib/quizAnswer";

describe("open-answer reveal scoring", () => {
  it("identifies a reveal without recording it as a graded attempt", () => {
    expect(isUnscoredAnswerReveal(false, [])).toBe(true);
  });

  it("does not classify submitted choices or a correct response as a reveal", () => {
    expect(isUnscoredAnswerReveal(false, [0])).toBe(false);
    expect(isUnscoredAnswerReveal(true, [])).toBe(false);
  });
});
