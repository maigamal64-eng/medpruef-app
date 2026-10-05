import { describe, expect, it } from "vitest";
import {
  pendingAnswersForUser,
  claimUnownedPendingAnswers,
  unownedPendingAnswers,
  type PendingAnswer,
} from "@/lib/offlineDb";

const answer = (id: string, userId: string): PendingAnswer => ({
  id,
  userId,
  questionId: 42,
  userAnswer: "Option A",
  isCorrect: true,
  timeSpentMs: 1200,
  createdAt: "2026-09-26T00:00:00.000Z",
});

describe("offline answer ownership", () => {
  it("only syncs queued answers created by the current account", () => {
    const queue = [answer("a", "user-a"), answer("b", "user-b")];

    expect(pendingAnswersForUser(queue, "user-a").map((row) => row.id)).toEqual(["a"]);
  });

  it("does not sync legacy unowned answers or any answer while logged out", () => {
    const legacy: PendingAnswer = {
      id: "old",
      questionId: 17,
      userAnswer: "Option B",
      isCorrect: false,
      timeSpentMs: 3300,
      createdAt: "2026-09-20T00:00:00.000Z",
    };

    expect(pendingAnswersForUser([legacy], "user-a")).toEqual([]);
    expect(pendingAnswersForUser([answer("a", "user-a")], null)).toEqual([]);
    expect(unownedPendingAnswers([legacy])).toEqual([legacy]);
  });

  it("keeps legacy rows separate while account-owned rows remain syncable", () => {
    const legacy: PendingAnswer = {
      id: "old",
      questionId: 17,
      userAnswer: "Option B",
      isCorrect: false,
      timeSpentMs: 3300,
      createdAt: "2026-09-20T00:00:00.000Z",
    };
    const queue = [legacy, answer("a", "user-a"), answer("b", "user-b")];

    expect(pendingAnswersForUser(queue, "user-a").map(({ id }) => id)).toEqual(["a"]);
    expect(unownedPendingAnswers(queue)).toEqual([legacy]);
  });

  it("claims only ownerless rows after explicit account confirmation", () => {
    const legacy: PendingAnswer = {
      id: "old",
      questionId: 17,
      userAnswer: "Option B",
      isCorrect: false,
      timeSpentMs: 3300,
      createdAt: "2026-09-20T00:00:00.000Z",
    };
    const owned = answer("owned", "user-b");
    const claimed = claimUnownedPendingAnswers([legacy, owned], "user-a");

    expect(claimed[0]).toMatchObject({
      userId: "user-a",
      questionId: legacy.questionId,
      userAnswer: legacy.userAnswer,
      isCorrect: legacy.isCorrect,
      timeSpentMs: legacy.timeSpentMs,
      createdAt: legacy.createdAt,
    });
    expect(claimed[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(claimed[1]).toEqual(owned);
    expect(claimUnownedPendingAnswers(claimed, "user-a")[0].id).toBe(claimed[0].id);
    expect(claimUnownedPendingAnswers([legacy], null)).toEqual([legacy]);
  });
});
