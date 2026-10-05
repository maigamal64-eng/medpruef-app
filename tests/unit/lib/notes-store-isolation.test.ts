import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNote,
  deleteNote,
  listNoteQuestionIds,
  noteQuestionIdFromKey,
  noteStorageKey,
  readLegacyNotes,
  readNoteText,
  readNotes,
  updateNote,
} from "@/lib/notes-store";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    get length() { return values.size; },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() } as unknown as Window);
});

afterEach(() => vi.unstubAllGlobals());

describe("account-scoped question notes", () => {
  it("does not show or migrate a shared legacy note into either account implicitly", () => {
    localStorage.setItem("medpruef_notes_42", "Account A's old private note");

    expect(readNotes(42, "account-a")).toEqual([]);
    expect(readNotes(42, "account-b")).toEqual([]);
    expect(listNoteQuestionIds("account-a")).toEqual([]);
    expect(listNoteQuestionIds("account-b")).toEqual([]);
    expect(noteQuestionIdFromKey("medpruef_notes_42", "account-a")).toBeNull();
    expect(readLegacyNotes()).toEqual([
      { question_id: 42, entries: [{ id: "legacy", text: "Account A's old private note", updatedAt: expect.any(Number) }] },
    ]);
    expect(localStorage.getItem("medpruef_notes_42")).toBe("Account A's old private note");
  });

  it("keeps each account's notes separately searchable and editable", () => {
    const [aNote] = addNote(42, "A's searchable cardiology note", "account-a");
    const [bNote] = addNote(42, "B's different note", "account-b");

    expect(noteStorageKey(42, "account-a")).not.toBe(noteStorageKey(42, "account-b"));
    expect(listNoteQuestionIds("account-a")).toEqual([42]);
    expect(listNoteQuestionIds("account-b")).toEqual([42]);
    expect(readNoteText(42, "\n\n", "account-a")).toContain("cardiology");
    expect(readNoteText(42, "\n\n", "account-b")).toBe("B's different note");

    updateNote(42, aNote.id, "A's edited searchable cardiology note", "account-a");
    expect(readNoteText(42, "\n\n", "account-a")).toContain("edited searchable");
    expect(readNoteText(42, "\n\n", "account-b")).toBe("B's different note");
    deleteNote(42, bNote.id, "account-b");
    expect(readNotes(42, "account-b")).toEqual([]);
    expect(readNotes(42, "account-a")).toHaveLength(1);
  });

  it("lists only keys belonging to the requested account and preserves legacy keys", () => {
    const keyA = noteStorageKey(8, "a")!;
    const keyB = noteStorageKey(9, "b")!;
    localStorage.setItem(keyA, JSON.stringify([{ id: "a", text: "private", updatedAt: 1 }]));
    localStorage.setItem(keyB, JSON.stringify([{ id: "b", text: "private", updatedAt: 1 }]));
    localStorage.setItem("medpruef_notes_9", "unclaimed legacy");

    expect(listNoteQuestionIds("a")).toEqual([8]);
    expect(listNoteQuestionIds("b")).toEqual([9]);
    expect(localStorage.getItem("medpruef_notes_9")).toBe("unclaimed legacy");
  });
});
