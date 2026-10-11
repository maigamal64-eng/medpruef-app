import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveMentorReport } from "@/app/api/mentor/report/handler";
import { USER, REQ } from "./helpers";

function db(answer: unknown = { text: "Canonical answer", fact_ids: ["source.one"], lang: "de" }) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const eq = vi.fn(() => query);
  const gte = vi.fn(() => query);
  const query = { select: () => query, eq, gte, maybeSingle: async () => ({ data: answer, error: null }) };
  const from = vi.fn((table: string) => table === "ai_mentor_message" ? query : { upsert });
  return { client: { from } as unknown as SupabaseClient, upsert, eq, gte };
}

describe("MUX-54 server-owned reports", () => {
  it("stores only the owner's canonical answer and facts, never client-supplied answer text", async () => {
    const s = db();
    expect(await saveMentorReport(s.client, USER, { request_id: REQ, reason: "date_wrong", answer_text: "forged", fact_ids: ["forged"], lang: "ar" })).toBe(true);
    expect(s.eq).toHaveBeenCalledWith("user_id", USER);
    expect(s.eq).toHaveBeenCalledWith("request_id", REQ);
    expect(s.eq).toHaveBeenCalledWith("role", "assistant");
    expect(s.gte).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(s.upsert).toHaveBeenCalledWith({ user_id: USER, request_id: REQ, reason: "date_wrong", details: null, answer_text: "Canonical answer", fact_ids: ["source.one"], lang: "de" }, { onConflict: "user_id,request_id", ignoreDuplicates: true });
  });
  it("cannot report a foreign, missing or expired answer", async () => {
    const s = db(null);
    expect(await saveMentorReport(s.client, USER, { request_id: REQ, reason: "other" })).toBe(false);
    expect(s.upsert).not.toHaveBeenCalled();
  });
  it.each([{ request_id: "bad", reason: "other" }, { request_id: REQ, reason: "refund" }, { request_id: REQ, reason: "other", details: "x".repeat(1501) }])("rejects invalid payload %j", async body => {
    const s = db(); expect(await saveMentorReport(s.client, USER, body)).toBe(false);
    expect(s.upsert).not.toHaveBeenCalled();
  });
});
