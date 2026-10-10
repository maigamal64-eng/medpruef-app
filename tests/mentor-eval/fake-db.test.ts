import { describe, expect, it } from "vitest";
import { createFakeDb, foreignReads } from "./lib/fake-db";
import { fixtures } from "./helpers";

const ME = "00000000-0000-4000-8000-000000000001";

describe("fake read-only database", () => {
  it("serves a synthetic question by id and honours is_active", async () => {
    const db = createFakeDb({ userId: ME, fixtures });
    const r = await db.from("questions").select("*").eq("id", 9000001).eq("is_active", true).maybeSingle();
    expect((r.data as { id: number }).id).toBe(9000001);
    expect((await db.from("questions").select("*").eq("id", 42).maybeSingle()).data).toBeNull();
  });

  it("serves the caller's own profile and strength rows, with order and limit chained", async () => {
    const db = createFakeDb({ userId: ME, fixtures, profileFixture: "p-sip" });
    const u = await db.from("users").select("active_exam, exam_date").eq("id", ME).maybeSingle();
    expect(u.data).toMatchObject({ active_exam: "kenntnispruefung", exam_date: "2026-11-18" });
    const rows = await db.from("user_topic_strength").select("*").eq("user_id", ME).order("last_answered_at", { ascending: false }).limit(500);
    expect(rows.data).toHaveLength(6);
    expect(rows.data.every((r) => r.user_id === ME)).toBe(true);
  });

  it("a user without a profile fixture has no history", async () => {
    const db = createFakeDb({ userId: ME, fixtures });
    const rows = await db.from("user_topic_strength").select("*").eq("user_id", ME).limit(10);
    expect(rows.data).toEqual([]);
  });

  it("records every query and flags a read of another user's rows", async () => {
    const db = createFakeDb({ userId: ME, fixtures, profileFixture: "p-sip" });
    await db.from("users").select("*").eq("id", ME).maybeSingle();
    expect(foreignReads(db, ME, fixtures.foreign_user.id)).toEqual([]);
    const other = await db.from("user_topic_strength").select("*").eq("user_id", fixtures.foreign_user.id).limit(5);
    expect(other.data[0].topic).toBe("GEHEIMTHEMA-X");
    expect(foreignReads(db, ME, fixtures.foreign_user.id)).toHaveLength(1);
    expect(db.queries).toHaveLength(2);
  });

  it("cannot write: there is no insert, update, upsert or delete", () => {
    const q = createFakeDb({ userId: ME, fixtures }).from("questions") as unknown as Record<string, unknown>;
    for (const m of ["insert", "update", "upsert", "delete", "rpc"]) expect(q[m]).toBeUndefined();
  });
});
