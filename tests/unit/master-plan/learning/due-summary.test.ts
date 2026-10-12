import { describe, expect, it } from "vitest";
import {
  DUE_ROUND_CAP,
  buildDueSummary,
  dueRound,
  localDayKey,
  orderDueRows,
  type DueRow,
} from "@/lib/master-learning/due-summary";
import { dueCopy } from "@/lib/master-learning/due-summary-copy";

// 2026-10-12 12:00 Vienna (UTC+2). Local day ends at 2026-10-12T22:00:00Z.
const NOW = new Date("2026-10-12T10:00:00Z");
const row = (id: number, iso: string | null, ease: number | null = 2.5): DueRow => ({ questionId: id, nextReviewAt: iso, ease });

describe("due summary", () => {
  const rows = [
    row(1, "2026-10-12T08:00:00Z"), // due today
    row(2, "2026-10-11T08:00:00Z"), // overdue
    row(3, "2026-10-12T21:59:00Z"), // still today in Vienna
    row(4, "2026-10-12T22:30:00Z"), // tomorrow in Vienna (00:30 local)
    row(5, "2026-10-14T09:00:00Z"), // in 2 days
    row(6, "2026-10-30T09:00:00Z"), // beyond the 7 day window
    row(7, null),
  ];

  it("Pro fixture: counts due today, overdue and the next 7 days by local day", () => {
    const s = buildDueSummary(rows, { now: NOW, entitled: true });
    expect(s).toEqual({
      entitled: true,
      dueToday: 3,
      overdue: 1,
      next7: [1, 1, 0, 0, 0, 0, 0],
      cap: 20,
      capped: 3,
      remaining: 0,
    });
  });

  it("free or non-entitled caller gets entitled false and no counts", () => {
    const s = buildDueSummary(rows, { now: NOW, entitled: false });
    expect(s).toEqual({ entitled: false });
    expect(JSON.stringify(s)).not.toMatch(/dueToday|next7/);
  });

  it("caps the round at 20 and reports the rest", () => {
    const many = Array.from({ length: 35 }, (_, i) => row(i + 1, "2026-10-11T08:00:00Z"));
    const s = buildDueSummary(many, { now: NOW, entitled: true });
    expect(s).toMatchObject({ dueToday: 35, capped: DUE_ROUND_CAP, remaining: 15 });
    expect(dueRound(many, NOW)).toHaveLength(DUE_ROUND_CAP);
  });

  it("orders by overdue-ness, then lowest ease, then id", () => {
    const ordered = orderDueRows([
      row(3, "2026-10-12T08:00:00Z", 2.0),
      row(1, "2026-10-12T08:00:00Z", 1.5),
      row(2, "2026-10-10T08:00:00Z", 3.0),
    ]);
    expect(ordered.map((r) => r.questionId)).toEqual([2, 1, 3]);
  });

  it("local day key follows the time zone", () => {
    expect(localDayKey(new Date("2026-10-12T22:30:00Z"), "Europe/Vienna")).toBe("2026-10-13");
    expect(localDayKey(new Date("2026-10-12T22:30:00Z"), "UTC")).toBe("2026-10-12");
  });

  it("exact copy for the due and zero states", () => {
    expect(dueCopy({ entitled: true, dueToday: 12, overdue: 0, next7: [0, 0, 0, 0, 0, 0, 0], cap: 20, capped: 12, remaining: 0 }, "de")).toBe("Heute fällig: 12");
    expect(dueCopy({ entitled: true, dueToday: 0, overdue: 0, next7: [7, 0, 0, 0, 0, 0, 0], cap: 20, capped: 0, remaining: 0 }, "de")).toBe(
      "Heute ist nichts fällig. Nächste Wiederholung: morgen (7).",
    );
    expect(dueCopy({ entitled: false }, "de")).toBeNull();
  });

  it("isolates users: the module only sees the rows it is given", () => {
    const a = buildDueSummary([row(1, "2026-10-12T08:00:00Z")], { now: NOW, entitled: true });
    const b = buildDueSummary([], { now: NOW, entitled: true });
    expect(a).toMatchObject({ dueToday: 1 });
    expect(b).toMatchObject({ dueToday: 0 });
  });
});
