import { describe, expect, it } from "vitest";
import { addExcludedQuestionIds, rememberReviewedQuestion } from "@/lib/flashcardQueue";

describe("flashcard review queue", () => {
  it("adds each reviewed card once to the session exclusion set", () => {
    const once = rememberReviewedQuestion([], 42);
    expect(rememberReviewedQuestion(once, 42)).toBe(once);
    expect(rememberReviewedQuestion(once, 0)).toBe(once);
    expect(rememberReviewedQuestion(once, 43)).toEqual([42, 43]);
  });

  it("sends seen ids to the next question request without duplicates", () => {
    const params = addExcludedQuestionIds(new URLSearchParams({ limit: "1" }), [42, 42, -1, 43]);
    expect(params.get("limit")).toBe("1");
    expect(params.get("excludeIds")).toBe("42,43");
  });

  it("removes stale exclusions when the current session has no seen cards", () => {
    const params = addExcludedQuestionIds(new URLSearchParams({ excludeIds: "42" }), []);
    expect(params.has("excludeIds")).toBe(false);
  });
});
