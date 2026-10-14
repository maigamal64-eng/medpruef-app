/** a-fo-07: queued answers replay their key fingerprint; a changed key is dropped, never retried. */
import { describe, expect, it } from "vitest";
import { replayBody, replayDecision } from "@/lib/offlineSync";

const row = { id: "00000000-0000-4000-8000-000000000001", userId: "u", questionId: 7, userAnswer: "A", isCorrect: true, timeSpentMs: 5, createdAt: "2026-10-21T10:00:00Z" };

describe("outbox and the stale-key guard", () => {
  it("replays the fingerprint the quiz stored when it queued the row", () => {
    expect(replayBody({ ...row, keyFingerprint: "k1:" + "a".repeat(64) })).toMatchObject({ keyFingerprint: "k1:" + "a".repeat(64), isCorrect: true, requestId: row.id });
  });
  it("a row queued before the deploy replays without one", () => {
    expect(replayBody(row)).not.toHaveProperty("keyFingerprint");
  });
  it("409 'question changed' is drop_conflict", () => {
    expect(replayDecision(409, { error: "question changed" })).toBe("drop_conflict");
    expect(replayDecision(409, { error: "Request already used for another answer" })).toBe("drop_conflict");
    expect(replayDecision(409, { error: "Question is no longer available" })).toBe("drop_unavailable");
  });
});
