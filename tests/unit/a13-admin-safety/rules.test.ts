import { describe, expect, it } from "vitest";
import { escapeLike, planProfileEdit } from "@/lib/admin/profile-edit";
import { asksForKeyChange, matches, parseSubmission, planEdit, proposedEdit } from "@/lib/admin/suggestion-edit";
import { groupDuplicateQuestions } from "@/lib/admin/duplicates";
import { hoursUntilDue, puypDecisionEmail } from "@/lib/admin/puyp-decision";
import { canAuthorizeAdminRequest, permissionForAdminRequest } from "@/lib/admin/permissions";

describe("ADM-06 profile edits", () => {
  const current = { email: "learner@example.invalid", first_name: "Ada", last_name: null };
  it("normalizes email like login and skips unchanged fields", () => {
    expect(planProfileEdit(current, { email: "  Learner@Example.INVALID ", first_name: "Ada" })).toEqual({ changes: {} });
    expect(planProfileEdit(current, { email: "New@Example.org" })).toEqual({ changes: { email: "new@example.org" } });
  });
  it("rejects malformed email and removal of an existing email", () => {
    expect(planProfileEdit(current, { email: "not-an-email" })).toEqual({ error: "Enter a valid email address" });
    expect(planProfileEdit(current, { email: "" })).toEqual({ error: "An email cannot be removed here" });
  });
  it("a name fix on a Telegram-only learner never writes an empty email", () => {
    expect(planProfileEdit({ email: null, first_name: null, last_name: null }, { email: "", first_name: " [name] " })).toEqual({ changes: { first_name: "[name]" } });
  });
  it("escapes LIKE wildcards for the duplicate check", () => {
    expect(escapeLike("user-3f5fe8f2@example.com")).toBe("a\\_b\\user-474cd81f@example.com");
  });
});

describe("ADM-05 report submissions and edits", () => {
  it("drops answer and choices at submission and caps sizes", () => {
    const parsed = parseSubmission({ questionId: 7, type: "edit", suggestedChanges: { question: "Neu", answer: "B", choices: [] } });
    expect(parsed).toMatchObject({ questionId: 7, suggestedChanges: { question: "Neu" } });
    expect(parseSubmission({ questionId: 7, type: "edit", details: "x".repeat(2001) })).toEqual({ error: "details is longer than 2000 characters" });
    expect(parseSubmission({ questionId: "abc", type: "flag" })).toEqual({ error: "questionId and type required" });
  });
  it("applies only changed question/explanation/topic fields and keeps nulls for revert", () => {
    const stored = { question: "Same stem", explanation: "New text", answer: "C" };
    const plan = planEdit({ question: "Same stem", explanation: null, topic: "Innere" }, proposedEdit(stored));
    expect(plan).toEqual({ before: { explanation: null }, after: { explanation: "New text" } });
    expect(asksForKeyChange(stored)).toBe(true);
    expect(matches({ explanation: null }, plan.before)).toBe(true);
    expect(matches({ explanation: "Edited since" }, plan.before)).toBe(false);
  });
});

describe("ADM-21 duplicate grouping", () => {
  it("uses the trimmed lowercase 200-character key and skips short stems", () => {
    const stem = "Welche Aussage zur Herzinsuffizienz trifft zu";
    const rows = [
      { id: 3, question: ` ${stem} `, topic: "A", exam_type: "kenntnispruefung", exam_dates: null, anki_note_id: null },
      { id: 1, question: stem.toUpperCase(), topic: "A", exam_type: "kmp_innsbruck", exam_dates: null, anki_note_id: null },
      { id: 2, question: "short", topic: "A", exam_type: "pharma", exam_dates: null, anki_note_id: null },
      { id: 4, question: "short", topic: "A", exam_type: "pharma", exam_dates: null, anki_note_id: null },
    ];
    const result = groupDuplicateQuestions(rows);
    expect(result.totalGroups).toBe(1);
    expect(result.totalExtraCopies).toBe(1);
    expect(result.groups[0].questions.map((q) => q.id)).toEqual([1, 3]);
  });
});

describe("ADM-19 / UX-ADM-22 PUYP helpers", () => {
  it("German decision emails use formal Sie and no em dash", () => {
    const rejected = puypDecisionEmail("rejected", "de", "Ada", { reason: "<b>Datum fehlt</b>" });
    expect(rejected.htmlBody).toContain("Ihre Verlängerungsanfrage");
    expect(rejected.htmlBody).toContain("&lt;b&gt;");
    expect(rejected.htmlBody).not.toMatch(/\bdu\b|\bdein/i);
    const approved = puypDecisionEmail("approved", "de", null, { newExpiresAtIso: "2027-03-20T12:00:00Z" });
    expect(approved.subject).toBe("Ihr MedPrüf-Zugang wurde verlängert");
    for (const mail of [rejected, approved]) expect(mail.htmlBody).not.toContain("—");
  });
  it("counts down the 72-hour review promise", () => {
    const created = "2026-10-12T00:00:00Z";
    expect(hoursUntilDue(created, Date.parse("2026-10-12T00:00:00Z"))).toBe(72);
    expect(hoursUntilDue(created, Date.parse("2026-10-15T05:00:00Z"))).toBe(-5);
  });
});

describe("ADM-17 own-session revocation", () => {
  it("is open to any admin with a role snapshot, only as POST", () => {
    const snapshot = { roles: [{ key: "support", name: "Support" }], permissions: [] };
    expect(permissionForAdminRequest("/api/admin/session/revoke-all", "POST")).toBeNull();
    expect(canAuthorizeAdminRequest("admin", snapshot, "/api/admin/session/revoke-all", "POST")).toBe(true);
    expect(canAuthorizeAdminRequest("admin", snapshot, "/api/admin/session/revoke-all", "GET")).toBe(false);
    expect(canAuthorizeAdminRequest("admin", null, "/api/admin/session/revoke-all", "POST")).toBe(false);
    expect(canAuthorizeAdminRequest("user", snapshot, "/api/admin/session/revoke-all", "POST")).toBe(false);
  });
});
