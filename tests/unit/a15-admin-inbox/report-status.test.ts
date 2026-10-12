import { describe, expect, it } from "vitest";
import {
  learnerReportState,
  parseReporterOutcome,
  reportContextFacts,
  safeParsePath,
  sanitizeReportContext,
  turnaroundFromRows,
} from "@/lib/reports/report-status";
import { REPORTS_COPY, reportsCopy, turnaroundLine } from "@/lib/i18n-reports";

describe("learner report state", () => {
  it.each([
    [{ status: "pending" }, "open"],
    [{ status: "approved" }, "accepted"],
    [{ status: "approved", applied: true }, "fixed"],
    [{ status: "approved", outcome: "fixed" }, "fixed"],
    [{ status: "rejected" }, "not_an_error"],
    [{ status: "rejected", outcome: "needs_info" }, "needs_info"],
    [{ status: "reverted" }, "closed"],
    [{ status: "weird" }, "closed"],
  ])("%o -> %s", (input, expected) => {
    expect(learnerReportState(input)).toBe(expected);
  });

  it("only accepts outcomes that fit the action", () => {
    expect(parseReporterOutcome("fixed", "approve")).toBe("fixed");
    expect(parseReporterOutcome("fixed", "reject")).toBeNull();
    expect(parseReporterOutcome("needs_info", "reject")).toBe("needs_info");
    expect(parseReporterOutcome(42, "approve")).toBeNull();
  });

  it("reads context facts defensively", () => {
    expect(reportContextFacts(null)).toEqual({ outcome: null, applied: false, notifiedAt: null });
    expect(reportContextFacts({ reporter_outcome: "bogus", applied_edit: "x", notified_at: 5 })).toEqual({ outcome: null, applied: false, notifiedAt: null });
    expect(reportContextFacts({ reporter_outcome: "fixed", applied_edit: { before: {} }, notified_at: "2026-10-12T00:00:00Z" })).toEqual({ outcome: "fixed", applied: true, notifiedAt: "2026-10-12T00:00:00Z" });
  });
});

describe("turnaround", () => {
  const row = (hours: number) => ({ created_at: "2026-10-01T00:00:00Z", resolved_at: new Date(Date.parse("2026-10-01T00:00:00Z") + hours * 3_600_000).toISOString() });
  it("computes a median and hides it below five resolved reports", () => {
    expect(turnaroundFromRows([row(1), row(2), row(30), row(40)])).toEqual({ median_hours: null, sample: 4 });
    expect(turnaroundFromRows([row(7), row(20), row(21), row(30), row(90)])).toEqual({ median_hours: 21, sample: 5 });
  });
  it("ignores broken rows", () => {
    expect(turnaroundFromRows([{ created_at: null, resolved_at: null }, { created_at: "x", resolved_at: "y" }, { created_at: "2026-10-02T00:00:00Z", resolved_at: "2026-10-01T00:00:00Z" }]).sample).toBe(0);
  });
  it("words hours and days", () => {
    expect(turnaroundLine(REPORTS_COPY.de, 20)).toBe("Meldungen werden derzeit im Median nach etwa 20 Stunden bearbeitet.");
    expect(turnaroundLine(REPORTS_COPY.en, 80)).toBe("Reports are currently resolved in a median of about 3 days.");
  });
});

describe("UX-ADM-01 context url", () => {
  it("keeps http(s) urls and paths, drops anything else", () => {
    expect(sanitizeReportContext({ url: "https://medpruf.com/quiz?x=1", a: 1 })).toEqual({ url: "https://medpruf.com/quiz?x=1", a: 1 });
    expect(sanitizeReportContext({ url: "/quiz" })).toEqual({ url: "/quiz" });
    expect(sanitizeReportContext({ url: "javascript:alert(1)" })).toEqual({});
    expect(sanitizeReportContext({ url: { evil: true } })).toEqual({});
    expect(sanitizeReportContext({ url: "x".repeat(501) })).toEqual({});
    expect(sanitizeReportContext({ other: 1 })).toEqual({ other: 1 });
  });
  it("safeParsePath never throws and trims to 60 characters", () => {
    expect(safeParsePath("https://medpruf.com/quiz?topic=Innere")).toBe("/quiz?topic=Innere");
    expect(safeParsePath(null)).toBeNull();
    expect(safeParsePath({ toString: () => "not a url" })).toBe("/not%20a%20url");
    expect(safeParsePath("http://[")).toBe("http://[");
    expect((safeParsePath("/" + "a".repeat(200)) ?? "").length).toBe(60);
  });
});

describe("report copy", () => {
  it("German uses Sie, nothing uses a dash", () => {
    const walk = (value: unknown): string[] => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(walk) : [];
    for (const text of walk(REPORTS_COPY.de)) expect(text, text).not.toMatch(/\b(du|dich|dir|dein|deine|deinen|deiner)\b/i);
    for (const text of [...walk(REPORTS_COPY.de), ...walk(REPORTS_COPY.en)]) expect(text, text).not.toMatch(/[–—]/);
  });
  it("non-German account languages read English", () => {
    expect(reportsCopy("ar")).toBe(REPORTS_COPY.en);
    expect(reportsCopy("de")).toBe(REPORTS_COPY.de);
  });
});
