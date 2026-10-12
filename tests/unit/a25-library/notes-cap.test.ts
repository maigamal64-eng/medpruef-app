/**
 * a25 UX-STU-51 (pick-ux-stu-51 B): the free note allowance is lifetime.
 * readNoteAllowance reads the a25 counter and falls back to the live note
 * count (lifetime:false) only when the counter relation does not exist yet.
 */
import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import {
  canFreeAccountDelete,
  isMissingRelationError,
  NoteAllowanceError,
  parseNoteAllowance,
  readNoteAllowance,
  remainingNotes,
  type AllowanceClient,
} from "@/lib/notes-cap";
import { FREE_NOTE_LIMIT } from "@/lib/notes";

const USER = "11111111-1111-4111-8111-111111111111";
function client(handler: (call: FakeCall) => FakeResult | undefined) {
  const fake = createFakeSupabase(handler);
  return { sb: fake.sb as unknown as AllowanceClient, calls: fake.calls };
}

describe("readNoteAllowance", () => {
  it("returns the lifetime total once the counter exists", async () => {
    const { sb, calls } = client((call) => (call.table === "note_creation_counts" ? { data: { created_total: 7 } } : { count: 3 }));
    await expect(readNoteAllowance(sb, USER)).resolves.toEqual({ used: 7, limit: FREE_NOTE_LIMIT, lifetime: true });
    // The live note table is never consulted on the lifetime path.
    expect(calls.map((c) => c.table)).toEqual(["note_creation_counts"]);
    expect(calls[0].filters).toContainEqual({ kind: "eq", column: "user_id", value: USER });
  });

  it("reads a missing counter row as zero created notes", async () => {
    const { sb } = client(() => ({ data: null }));
    await expect(readNoteAllowance(sb, USER)).resolves.toEqual({ used: 0, limit: FREE_NOTE_LIMIT, lifetime: true });
  });

  it.each(["PGRST205", "42P01", "42883"])("falls back to the live active count when the counter is missing (%s)", async (code) => {
    const { sb, calls } = client((call) =>
      call.table === "note_creation_counts" ? { error: { code, message: "missing" } } : { count: 4 },
    );
    await expect(readNoteAllowance(sb, USER)).resolves.toEqual({ used: 4, limit: FREE_NOTE_LIMIT, lifetime: false });
    const live = calls.find((c) => c.table === "notes");
    expect(live?.filters).toEqual([
      { kind: "eq", column: "user_id", value: USER },
      { kind: "eq", column: "is_active", value: true },
    ]);
  });

  it("throws on any other read error (never grants a slot on doubt)", async () => {
    const { sb } = client(() => ({ error: { code: "57014", message: "timeout" } }));
    await expect(readNoteAllowance(sb, USER)).rejects.toBeInstanceOf(NoteAllowanceError);
  });

  it("throws when the fallback count fails too", async () => {
    const { sb } = client((call) =>
      call.table === "note_creation_counts" ? { error: { code: "PGRST205" } } : { error: { code: "08006" } },
    );
    await expect(readNoteAllowance(sb, USER)).rejects.toBeInstanceOf(NoteAllowanceError);
  });
});

describe("allowance helpers", () => {
  it("matches missing-relation codes only, not messages", () => {
    expect(isMissingRelationError({ code: "PGRST205" })).toBe(true);
    expect(isMissingRelationError({ message: "relation does not exist" })).toBe(false);
    expect(isMissingRelationError(null)).toBe(false);
  });
  it("never goes below zero remaining", () => {
    expect(remainingNotes({ used: 12, limit: 10, lifetime: true })).toBe(0);
    expect(remainingNotes({ used: 4, limit: 10, lifetime: true })).toBe(6);
  });
  it("lets a free account delete only with lifetime counting", () => {
    expect(canFreeAccountDelete({ lifetime: true })).toBe(true);
    expect(canFreeAccountDelete({ lifetime: false })).toBe(false);
    expect(canFreeAccountDelete(null)).toBe(false);
  });
  it("parses the client cap block strictly", () => {
    expect(parseNoteAllowance({ used: 4, limit: 10, lifetime: true })).toEqual({ used: 4, limit: 10, lifetime: true });
    expect(parseNoteAllowance(null)).toBeNull();
    expect(parseNoteAllowance({ used: "4", limit: 10, lifetime: true })).toBeNull();
    expect(parseNoteAllowance({ used: 4, limit: 10 })).toBeNull();
  });
});
