import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * a-landing-fresh-referrer-1019: every prerendered page that renders the
 * official sittings (deadlines, "noch N Tage", the next sitting) is
 * regenerated at most hourly. Next reads segment config statically, so the
 * export must be the literal number in the segment's page or layout.
 */
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const REVALIDATE = /^export const revalidate = (\d+);$/m;

describe("hourly revalidation of the exam-date pages", () => {
  for (const file of ["src/app/landing/page.tsx", "src/app/pricing/page.tsx", "src/app/stichprobentest/layout.tsx"]) {
    it(`${file} revalidates within an hour`, () => {
      const m = read(file).match(REVALIDATE);
      expect(m, file).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(0);
      expect(Number(m![1])).toBeLessThanOrEqual(3600);
    });
  }
  it("the pages that render the calendar are the ones covered", () => {
    expect(read("src/app/landing/LandingClient.tsx")).toMatch(/<UpcomingExams\b/);
    expect(read("src/app/pricing/PricingClient.tsx")).toMatch(/<UpcomingExams\b|<ExamTimingPicker\b/);
    expect(read("src/app/stichprobentest/page.tsx")).toMatch(/getUpcomingOfficialFor/);
  });
  it("the other sitting pages stay request-time", () => {
    for (const file of ["src/app/pruefungskalender/page.tsx", "src/app/pruefungskalender/[slug]/page.tsx", "src/app/pharmakologie-pruefung-wien/page.tsx", "src/app/lernplan/page.tsx", "src/app/exam-formats/page.tsx"]) {
      expect(read(file), file).toMatch(/^export const dynamic = "force-dynamic";$/m);
    }
  });
});
