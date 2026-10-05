import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "user-a" as string | null,
  authFetch: vi.fn(),
  drainPendingAnswers: vi.fn(),
  pendingAnswersForUser: vi.fn(),
  removePendingAnswer: vi.fn(),
}));

vi.mock("@/lib/authFetch", () => ({ authFetch: mocks.authFetch }));
vi.mock("@/lib/auth", () => ({
  getStoredSession: () => mocks.userId ? { user: { id: mocks.userId } } : null,
}));
vi.mock("@/lib/offlineDb", () => ({
  drainPendingAnswers: mocks.drainPendingAnswers,
  pendingAnswersForUser: mocks.pendingAnswersForUser,
  removePendingAnswer: mocks.removePendingAnswer,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("offline answer sync account changes", () => {
  it("stops before posting another row if the active account switches during sync", async () => {
    vi.resetModules();
    mocks.userId = "user-a";
    const queue = [
      { id: "row-a", userId: "user-a", questionId: 1, userAnswer: "A", isCorrect: true, timeSpentMs: 100, createdAt: "now" },
      { id: "row-b", userId: "user-a", questionId: 2, userAnswer: "B", isCorrect: false, timeSpentMs: 200, createdAt: "now" },
    ];
    mocks.drainPendingAnswers.mockResolvedValue(queue);
    mocks.pendingAnswersForUser.mockImplementation((rows, userId) => rows.filter((row: { userId: string }) => row.userId === userId));
    let firstRemoval!: () => void;
    const removedFirstRow = new Promise<void>((resolve) => { firstRemoval = resolve; });
    mocks.removePendingAnswer.mockImplementation(async (id: string) => {
      if (id === "row-a") firstRemoval();
    });
    mocks.authFetch.mockImplementation(async () => {
      mocks.userId = "user-b";
      return { ok: true, status: 200 };
    });

    let onlineHandler: (() => void) | undefined;
    const fakeWindow = {
      addEventListener: (type: string, handler: () => void) => {
        if (type === "online") onlineHandler = handler;
      },
    };
    vi.stubGlobal("window", fakeWindow as unknown as Window);
    vi.stubGlobal("navigator", { onLine: false });

    const { initOfflineSync } = await import("@/lib/offlineSync");
    initOfflineSync();
    vi.stubGlobal("navigator", { onLine: true });
    onlineHandler?.();

    await removedFirstRow;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.authFetch).toHaveBeenCalledTimes(1);
    expect(mocks.removePendingAnswer).toHaveBeenCalledTimes(1);
    expect(mocks.removePendingAnswer).toHaveBeenCalledWith("row-a");
  });
});
