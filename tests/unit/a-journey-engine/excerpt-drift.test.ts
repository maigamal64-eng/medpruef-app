import { describe, expect, it } from "vitest";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { SITTINGS_EXCERPT } from "./sittings-excerpt";

describe("stored excerpt agrees with the live OFFICIAL_SITTINGS", () => {
  it("every excerpt row still exists unchanged in src/lib/exam-dates.ts", () => {
    for (const row of SITTINGS_EXCERPT) {
      const live = OFFICIAL_SITTINGS.find(
        (s) => s.exam_key === row.exam_key && s.date === row.date && s.publisher === row.publisher && s.deadline_type === row.deadline_type,
      );
      expect(live, `${row.exam_key} ${row.date} ${row.publisher}`).toBeDefined();
      expect(live).toEqual(row);
    }
  });
});
