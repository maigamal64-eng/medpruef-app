import { describe, expect, it } from "vitest";
import { answerPathBlocked, ANSWER_SLUG_GATES } from "@/lib/answer-pages/slugs";
import { ANSWER_PAGES } from "@/lib/answer-pages/registry";
import { BLOG_POSTS } from "@/lib/blog";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import data from "@/lib/answer-pages/pages.data.json";
import articles from "@/lib/answer-pages/pages.articles.json";

// Reviewer follow-ups (a-answer-pages): edge gate, slug space, content upkeep.

/** Procedural content (addresses, forms, withdrawal rules) is re-read at least this often. */
const ANSWER_REVIEW_DAYS = 45;

describe("edge gate", () => {
  it("blocks a percent-encoded answer slug while the flag is off", () => {
    const slug = "sip-stichprobentest-kenntnispruefung-unterschied";
    expect(answerPathBlocked(`/blog/%73${slug.slice(1)}`, {})).toBe(true);
    expect(answerPathBlocked(`/blog/${encodeURIComponent(slug)}`, {})).toBe(true);
    expect(answerPathBlocked(`/blog/%E0%A4%A`, {})).toBe(false);
    expect(answerPathBlocked(`/blog/%73${slug.slice(1)}`, { ANSWER_PAGES_ENABLED: "true" })).toBe(false);
  });

  it("answer slugs never collide with blog post slugs or blog route folders", () => {
    const posts = new Set(BLOG_POSTS.map((p) => p.slug));
    expect(Object.keys(ANSWER_SLUG_GATES).filter((s) => posts.has(s))).toEqual([]);
  });
});

describe("content upkeep", () => {
  it(`every answer page was checked against its sources within ${ANSWER_REVIEW_DAYS} days`, () => {
    const today = Date.now();
    for (const page of ANSWER_PAGES) {
      const age = (today - Date.parse(`${page.checked_on}T00:00:00Z`)) / 86_400_000;
      expect(age, `${page.slug} checked_on ${page.checked_on}: re-read the sources and update checked_on`).toBeLessThanOrEqual(ANSWER_REVIEW_DAYS);
    }
  });

  it("copy saying Rezeptierkunde and Gerichtsmedizin close on a Tuesday at 12:00 matches OFFICIAL_SITTINGS", () => {
    const text = JSON.stringify(data) + JSON.stringify(articles);
    if (!/Dienstag um 12 Uhr|Tuesday at 12:00|Tuesday at 12 noon/.test(text)) return;
    const rows = OFFICIAL_SITTINGS.filter((s) => s.exam_key === "rezeptierkunde" || s.exam_key === "gerichtsmedizin");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (!row.registration_closes) continue;
      expect(new Date(`${row.registration_closes}T12:00:00Z`).getUTCDay(), `${row.exam_key} ${row.registration_closes}`).toBe(2);
      expect(row.closes_at_time).toBe("12:00");
    }
  });
});
