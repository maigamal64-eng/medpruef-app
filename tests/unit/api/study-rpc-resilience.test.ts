import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ failedRpc: "", calls: [] as unknown[] }));
vi.mock("@/lib/auth-guard", () => ({
  resolveOptionalUser: () => "11111111-1111-4111-8111-111111111111",
  requireUser: async () => ({ userId: "11111111-1111-4111-8111-111111111111", tier: "pro", role: "user" }),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => {
  const { sb, calls } = createFakeSupabase((c) => {
    if (c.table === `rpc:${h.failedRpc}`) return { error: { code: "57014", message: "statement timeout" } };
    if (c.table === "users") return { data: { id: "11111111-1111-4111-8111-111111111111", tier: "pro", role: "user", tier_expires_at: null } };
    if (c.table.startsWith("rpc:")) return { data: [] };
    // A learner with history outside the curated opening (a-free-set), so the
    // unseen draw goes through the study RPC under test.
    if (c.table === "answer_history") return { data: [{ question_id: 1 }] };
    return { data: [] };
  });
  h.calls = calls;
  return sb;
} }));
import { GET as questions } from "@/app/api/questions/route";
import { GET as topicProgress } from "@/app/api/user/topic-progress/route";

beforeEach(() => { h.failedRpc = ""; h.calls = []; });
describe("study RPC outage recovery", () => {
  it("returns 503 on SQLSTATE 57014 without loading questions or claiming exhaustion/paywall", async () => {
    h.failedRpc = "get_study_question_ids";
    const r = await questions(new NextRequest("https://x/api/questions?practiceMode=unseen&examSource=kenntnispruefung"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Could not load your question history. Please retry." });
    expect((h.calls as FakeCall[]).some(c => c.table === "questions")).toBe(false);
  });
  it("distinguishes a successfully exhausted unseen pool from a timeout", async () => {
    const r = await questions(new NextRequest("https://x/api/questions?practiceMode=unseen&examSource=kenntnispruefung"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });
  it.each(["get_topic_counts", "get_user_topic_progress", "get_user_topic_attempt_stats"])("does not fabricate zero progress if %s times out", async rpc => {
    h.failedRpc = rpc;
    const r = await topicProgress(new NextRequest("https://x/api/user/topic-progress?examType=kenntnispruefung"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Could not load topic progress" });
  });
});
