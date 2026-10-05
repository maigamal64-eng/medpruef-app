import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLegacyExamSession,
  clearExamSession,
  discardLegacyExamSession,
  isExamActive,
  loadExamSession,
  loadLegacyExamSession,
  saveExamSession,
} from "@/lib/examSession";
import type { SavedExamSession } from "@/lib/examSession";

const LEGACY_KEY = "medpruef_exam_autosave";
const accountKey = (id: string) => `medpruef_exam_autosave:v1:${encodeURIComponent(id)}`;

const session: Omit<SavedExamSession, "v" | "savedAt"> = {
  startedAt: 1_000,
  questions: [{
    id: 42,
    topic: "Neurologie",
    question: "Question",
    answer: "Answer",
    explanation: "Explanation",
    difficulty: 1,
    exam_dates: [],
  }],
  answers: { 0: [1] },
  flaggedIdxs: [0],
  currentIdx: 0,
  selectedPart: "all",
  examSource: "kenntnispruefung",
  attemptId: "attempt-a",
};

const saved = (attemptId: string): SavedExamSession => ({ ...session, attemptId, v: 1, savedAt: 2_000 });

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe("account-scoped full-exam autosave", () => {
  it("isolates two accounts and resumes the same account's session", () => {
    saveExamSession("account-a", session);

    expect(loadExamSession("account-a")).toMatchObject({ attemptId: "attempt-a", answers: { 0: [1] } });
    expect(loadExamSession("account-b")).toBeNull();
    expect(isExamActive("account-a")).toBe(true);
    expect(isExamActive("account-b")).toBe(false);
  });

  it("lets the PWA detect an active exam without exposing its contents", () => {
    saveExamSession("account-a", session);

    expect(isExamActive()).toBe(true);
    expect(loadExamSession("account-b")).toBeNull();
  });

  it("does not expose a legacy ownerless session through normal account reads", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(saved("legacy-attempt")));

    expect(loadExamSession("account-a")).toBeNull();
    expect(loadLegacyExamSession()).toMatchObject({ attemptId: "legacy-attempt" });
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("claims legacy data only on explicit call and moves it to the confirmed account", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(saved("legacy-attempt")));

    expect(claimLegacyExamSession("account-a")).toMatchObject({ attemptId: "legacy-attempt" });
    expect(loadExamSession("account-a")).toMatchObject({ attemptId: "legacy-attempt" });
    expect(loadExamSession("account-b")).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("keeps legacy data if the confirmed account already has its own exam", () => {
    saveExamSession("account-a", { ...session, attemptId: "owned-attempt" });
    localStorage.setItem(LEGACY_KEY, JSON.stringify(saved("legacy-attempt")));

    expect(claimLegacyExamSession("account-a")).toBeNull();
    expect(loadExamSession("account-a")).toMatchObject({ attemptId: "owned-attempt" });
    expect(loadLegacyExamSession()).toMatchObject({ attemptId: "legacy-attempt" });
  });

  it("discards only the legacy session on explicit decline and clears only the selected account", () => {
    saveExamSession("account-a", { ...session, attemptId: "a-attempt" });
    saveExamSession("account-b", { ...session, attemptId: "b-attempt" });
    localStorage.setItem(LEGACY_KEY, JSON.stringify(saved("legacy-attempt")));

    discardLegacyExamSession();
    clearExamSession("account-a");

    expect(loadLegacyExamSession()).toBeNull();
    expect(loadExamSession("account-a")).toBeNull();
    expect(loadExamSession("account-b")).toMatchObject({ attemptId: "b-attempt" });
  });

  it("refuses empty account identifiers", () => {
    saveExamSession("  ", session);
    clearExamSession("");

    expect(loadExamSession(" ")).toBeNull();
    expect(localStorage.getItem(accountKey(""))).toBeNull();
  });
});
