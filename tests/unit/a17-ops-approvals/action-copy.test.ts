import { describe, expect, it } from "vitest";
import {
  countdown, opsApproveConfirmation, opsChanges, opsGroup, opsHeadline, opsOutcome, opsStatusLabel,
  rejectReasonRequired, validRejectReason, type OpsQueueItem,
} from "@/lib/ops/action-copy";
import { OPS_OAUTH_SCOPES, OPS_PREPARE_SCOPES, opsScopeLabel } from "@/lib/ops/scopes";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const base = (over: Partial<OpsQueueItem>): OpsQueueItem => ({
  id: "a1", operation: "entitlement.grant", status: "prepared", payload: { user_id: LEARNER, days: 30, reason: "Unmapped payment" },
  payload_hash: "h", target_hash: "t", predicted_effect: { previous_tier: "free", previous_expiry: null, predicted_expiry: "2026-11-11T10:00:00Z" },
  expires_at: "2026-10-13T09:00:00Z", created_at: "2026-10-12T09:00:00Z", principal_id: "p", ...over,
});

describe("Ops approvals copy (UX-ADM-13/14)", () => {
  it("groups by what the owner must do and never stacks an expired suffix", () => {
    expect(opsGroup(base({}), NOW)).toBe("needs_decision");
    expect(opsGroup(base({ status: "approved" }), NOW)).toBe("approved_waiting");
    expect(opsGroup(base({ expires_at: "2026-10-12T09:59:00Z" }), NOW)).toBe("expired");
    expect(opsGroup(base({ status: "expired" }), NOW)).toBe("expired");
    expect(opsGroup(base({ status: "succeeded", expires_at: "2026-10-12T09:00:00Z" }), NOW)).toBe("done");
    expect(opsStatusLabel(base({ status: "succeeded", expires_at: "2026-10-12T09:00:00Z" }), NOW)).toBe("Done");
    expect(opsStatusLabel(base({ status: "rejected", expires_at: "2026-10-12T09:00:00Z" }), NOW)).toBe("Rejected");
    expect(opsStatusLabel(base({ status: "expired" }), NOW)).toBe("Expired, nothing changed");
    expect(opsStatusLabel(base({}), NOW)).toBe("Waiting for you");
  });

  it("states an access grant as a sentence with live before and after", () => {
    const item = base({ target: { kind: "learner", current_tier: "pro", current_expiry: "2026-10-20T00:00:00Z", expiry_if_run_now: "2026-11-19T00:00:00Z" } });
    expect(opsHeadline(item)).toEqual({ lead: "Give 30 days of Pro to", learnerId: LEARNER, tail: "" });
    expect(opsChanges(item)).toEqual([{ label: "Access", before: "Pro until 20 Oct 2026", after: "Pro until 19 Nov 2026" }]);
    expect(opsApproveConfirmation(item, "Lea Muster")).toMatch(/^Give 30 days of Pro to Lea Muster\. Access: Pro until 20 Oct 2026 becomes Pro until 19 Nov 2026\./);
    // Legacy rows (no live target) fall back to the prediction.
    expect(opsChanges(base({}))).toEqual([{ label: "Access", before: "Free", after: "Pro until 11 Nov 2026" }]);
  });

  it("describes feedback, report and note actions without raw JSON", () => {
    const feedback = base({ operation: "feedback.triage", payload: { feedback_id: 501, status: "resolved", note: "Fixed", from_status: "new" }, target: { kind: "feedback", user_id: LEARNER, current_status: "new" } });
    expect(opsHeadline(feedback).lead).toBe("Mark feedback #501 as resolved");
    expect(opsChanges(feedback)).toEqual([{ label: "Status", before: "New", after: "Resolved" }, { label: "Internal note", before: "Kept as is", after: 'Adds: "Fixed"' }]);
    const report = base({ operation: "content.review", payload: { question_suggestion_id: 12, status: "rejected" }, target: { kind: "question_report", question_id: 345, current_status: "pending" } });
    expect(opsHeadline(report).lead).toBe("Dismiss question report #12 on question 345");
    expect(opsChanges(report)[0]).toEqual({ label: "Report status", before: "Pending", after: "Dismissed" });
    const note = base({ operation: "notes.moderation", payload: { report_id: "r", decision: "takedown" }, target: { kind: "note_report", note_title: "Sepsis", note_visibility: "public", note_is_active: true, report_status: "open" } });
    expect(opsHeadline(note).lead).toBe('Take down the note "Sepsis"');
    expect(opsChanges(note)[1]).toMatchObject({ before: "Public", after: "Hidden from Explore and from its author's library" });
  });

  it("shows the execution outcome after a decision", () => {
    expect(opsOutcome(base({ status: "succeeded", executed_at: "2026-10-12T09:30:00Z", result: { tier_expires_at: "2026-11-11T09:30:00Z" } }), NOW)).toMatch(/Learner has Pro until 11 Nov 2026/);
    expect(opsOutcome(base({ status: "rejected", decided_at: "2026-10-12T09:30:00Z", decision_reason: "Wrong amount" }), NOW)).toMatch(/: Wrong amount\.$/);
    expect(opsOutcome(base({ status: "approved", approved_at: "2026-10-12T09:30:00Z" }), NOW)).toMatch(/Nothing changes until the agent runs it/);
  });

  it("requires a reject reason only for access changes", () => {
    expect(rejectReasonRequired("entitlement.grant")).toBe(true);
    expect(validRejectReason("entitlement.grant", "  ")).toBe(false);
    expect(validRejectReason("entitlement.grant", "Not now")).toBe(true);
    expect(validRejectReason("feedback.triage", "")).toBe(true);
    expect(validRejectReason("feedback.triage", "x".repeat(301))).toBe(false);
  });

  it("counts down in minutes and hours", () => {
    expect(countdown("2026-10-12T10:10:00Z", NOW)).toBe("Expires in 10 min");
    expect(countdown("2026-10-12T13:30:00Z", NOW)).toBe("Expires in 3 h 30 min");
    expect(countdown("2026-10-12T09:00:00Z", NOW)).toBe("Expired");
  });

  it("labels every scope and marks the prepare scopes", () => {
    for (const scope of OPS_OAUTH_SCOPES) expect(opsScopeLabel(scope)).not.toMatch(/Unrecognised/);
    expect(opsScopeLabel("future.scope")).toBe("Unrecognised permission (future.scope)");
    expect([...OPS_PREPARE_SCOPES].every((scope) => opsScopeLabel(scope).includes("you approve each one"))).toBe(true);
  });
});
