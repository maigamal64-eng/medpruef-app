import { describe, expect, it } from "vitest";
import { formatCount, summarize, type CohortUser } from "../../../scripts/cram-part-plan-count";

const NOW = new Date("2026-10-26T10:00:00Z");
const u = (id: string, exam_date: string | null, extra: Partial<CohortUser> = {}): CohortUser => ({ id, exam_date, active_exam: "kenntnispruefung", email: `${id}@learner.example.org`, role: "user", tier: "free", ...extra });

describe("cram part plan Monday count", () => {
  it("k of n over learners with a future SIP4a or SIP5a sitting; staff, other banks and other dates left out", () => {
    const users = [
      u("a", "2026-11-18"), u("b", "2026-11-17"), u("c", "2027-03-10"), u("d", "2026-11-18"),
      u("x", "2026-11-18", { active_exam: "pharma" }), u("y", "2026-11-19"), u("z", "2026-11-18", { role: "admin" }),
    ];
    const out = summarize(users, {
      viewedPart: new Set(["a", "b"]), partRun: new Set(["a", "z"]), checkout: new Set(["a", "d", "x"]), paid: new Set(["a"]),
    }, 14, NOW);
    expect(out).toEqual({ days: 14, cohort: 4, partPlan: 3, viewedPartPlan: 2, withPartRun: 1, checkoutOpened: 2, paid: 1, checkoutOpenedWithRun: 1, paidWithRun: 1 });
    expect(formatCount(out)).toContain("part plan 3 of 4");
    expect(formatCount(out)).not.toMatch(/@/);
  });
});
