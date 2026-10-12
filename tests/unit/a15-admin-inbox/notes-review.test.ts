import { describe, expect, it } from "vitest";
import { noteReviewFromMetadata, noteReviewLabel, NOTE_REVIEW_COPY, reviewLang } from "@/lib/notes-review";

describe("TR-08 note review status", () => {
  it("AI notes without a review record are AI drafts", () => {
    expect(noteReviewFromMetadata({ curated: true }, "ai_explanation")).toEqual({ status: "ai_draft", role: null, on: null });
    expect(noteReviewFromMetadata(null, "ai_explanation").status).toBe("ai_draft");
  });
  it("a valid reviewed_on makes any note reviewed, with a trimmed role", () => {
    expect(noteReviewFromMetadata({ reviewed_on: "2026-10-15", reviewed_by_role: "  Ärztin  " }, "ai_explanation")).toEqual({ status: "reviewed", role: "Ärztin", on: "2026-10-15" });
    expect(noteReviewFromMetadata({ reviewed_on: "2026-10-15" }, "manual")).toEqual({ status: "reviewed", role: null, on: "2026-10-15" });
  });
  it("ignores malformed dates and leaves manual notes unlabelled", () => {
    expect(noteReviewFromMetadata({ reviewed_on: "soon" }, "ai_explanation").status).toBe("ai_draft");
    expect(noteReviewFromMetadata({ reviewed_on: "2026-13-45" }, "manual").status).toBe("none");
    expect(noteReviewLabel({ status: "none", role: null, on: null }, "de")).toBeNull();
  });
  it("labels in Sie-neutral German and English, no dashes", () => {
    expect(noteReviewLabel({ status: "ai_draft", role: null, on: null }, "de")?.text).toBe("KI-Entwurf, ungeprüft");
    expect(noteReviewLabel({ status: "reviewed", role: "Ärztin", on: "2026-10-15" }, "de")?.text).toBe("Geprüft von Ärztin am 15. Oktober 2026");
    expect(noteReviewLabel({ status: "reviewed", role: null, on: "2026-10-15" }, "en")?.text).toBe("Reviewed on 15 October 2026");
    const all = JSON.stringify(NOTE_REVIEW_COPY);
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/\b(du|dein|deine)\b/i);
  });
  it("maps UI languages", () => {
    expect(reviewLang("de")).toBe("de");
    expect(reviewLang("ar")).toBe("en");
  });
});
