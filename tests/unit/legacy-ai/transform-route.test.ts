import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeDb, makeDbState, OK_USAGE, rowsFor, type FakeDbState } from "./helpers";

const h = vi.hoisted(() => ({
  state: null as unknown as FakeDbState,
  db: null as unknown,
  callClaude: vi.fn(),
  requireUser: vi.fn(),
  isFreeAccess: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser: h.requireUser, isFreeAccess: h.isFreeAccess }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => h.db }));
vi.mock("@/lib/free-access", () => ({ canFreeUserReadQuestion: vi.fn(async () => true), logFreeCapHit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true }),
  rateKey: (...p: string[]) => p.join(":"),
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/ai/anthropic", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/anthropic")>()), callClaude: h.callClaude }));

import { POST } from "@/app/api/notes/transform/route";
import { AiRefusal, AiTimeout } from "@/lib/ai/anthropic";

const USER = "22222222-2222-4222-8222-222222222222";
const GOOD_JSON = JSON.stringify({ notes: [{ title: "ASS", blocks: [{ type: "keyfact", text: "ASS hemmt die COX." }], tags: ["ass"] }] });

function res(text: string) {
  return { text, blocks: [], toolUses: [], usage: OK_USAGE, stop_reason: "end_turn", model: "claude-haiku-4-5", request_id: "r" };
}
function req(body: Record<string, unknown> = { kind: "user_note", text: "Acetylsalicylsäure hemmt die Cyclooxygenase." }) {
  return POST(new NextRequest("http://localhost/api/notes/transform", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  h.state = makeDbState();
  h.db = makeDb(h.state);
  h.callClaude.mockReset();
  h.callClaude.mockResolvedValue(res(GOOD_JSON));
  h.requireUser.mockResolvedValue({ userId: USER });
  h.isFreeAccess.mockReturnValue(false);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("AI_TRANSFORM_DAILY_ATTEMPTS", "");
});
afterEach(() => vi.unstubAllEnvs());

const takes = () => h.state.rpcCalls.filter((c) => c.fn === "ai_quota_take");
const logRows = () => rowsFor(h.state, "ai_call_log");

describe("POST /api/notes/transform metering", () => {
  it("success: one attempt (limit 30), one cost row, note created", async () => {
    const r = await req();
    expect(r.status).toBe(201);
    expect(takes()).toHaveLength(1);
    expect(takes()[0].args).toEqual({ p_user: USER, p_route: "notes_transform", p_limit: 30 });
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({ user_id: USER, provider: "anthropic", route: "notes_transform", status: "ok", cost_usd: "0.001600" });
  });

  it("the daily cap is env-tunable", async () => {
    vi.stubEnv("AI_TRANSFORM_DAILY_ATTEMPTS", "9");
    await req();
    expect(takes()[0].args?.p_limit).toBe(9);
  });

  it("idempotent question: the existing note comes back free (no gate, no model, no row)", async () => {
    h.state.existingNote = { id: "old" };
    const r = await req({ kind: "question", source_ref: { question_id: 42 } });
    expect(r.status).toBe(200);
    expect((await r.json()).cached).toBe(true);
    expect(h.state.rpcCalls).toHaveLength(0);
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
  });

  it("unparseable answer: one repair retry, TWO cost rows, still ONE attempt", async () => {
    h.callClaude.mockResolvedValueOnce(res("not json at all")).mockResolvedValueOnce(res(GOOD_JSON));
    const r = await req();
    expect(r.status).toBe(201);
    expect(h.callClaude).toHaveBeenCalledTimes(2);
    expect(logRows()).toHaveLength(2);
    expect(takes()).toHaveLength(1);
  });

  it("a failed call (timeout) is logged with a cost and is NOT retried; the raw note is still saved", async () => {
    h.callClaude.mockRejectedValue(new AiTimeout("slow", { usage: null, request_id: null }));
    const r = await req();
    expect(r.status).toBe(201);
    expect(h.callClaude).toHaveBeenCalledTimes(1);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({ status: "timeout", success: false });
    expect(Number(logRows()[0].cost_usd)).toBeGreaterThan(0);
    const note = rowsFor(h.state, "notes")[0] as { metadata: { created_from: string } };
    expect(note.metadata.created_from).toBe("haiku_transform_fallback");
  });

  it("a refusal is logged as billable and not retried", async () => {
    h.callClaude.mockRejectedValue(new AiRefusal("declined", { usage: OK_USAGE, request_id: null, stop_details: null, blocks: [], partialText: "" }));
    await req();
    expect(h.callClaude).toHaveBeenCalledTimes(1);
    expect(logRows()[0]).toMatchObject({ status: "refusal", cost_usd: "0.001600" });
  });

  it("global cap: 503 resting (never 402), nothing taken, no model call", async () => {
    h.state.rpc.ai_spend_month = () => ({ data: 50_000_000, error: null });
    const r = await req();
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("AI_RESTING");
    expect(takes()).toHaveLength(0);
    expect(h.callClaude).not.toHaveBeenCalled();
  });

  it("per-user legacy cap: 429, never 402", async () => {
    h.state.rpc.ai_legacy_cost_month = () => ({ data: 3_000_000, error: null });
    const r = await req();
    expect(r.status).toBe(429);
    expect(takes()).toHaveLength(0);
  });

  it("daily cap reached: 429, never 402, no model call", async () => {
    h.state.rpc.ai_quota_take = () => ({ data: { ok: false, used: 30, reason: "limit_reached" }, error: null });
    const r = await req();
    expect(r.status).toBe(429);
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
  });

  it("DB error on the attempt refuses the call (fail closed)", async () => {
    h.state.rpc.ai_quota_take = () => ({ data: null, error: { message: "down" } });
    const r = await req();
    expect(r.status).toBe(503);
    expect(h.callClaude).not.toHaveBeenCalled();
  });

  it("the system prompt is separate from the user content", async () => {
    await req();
    const arg = h.callClaude.mock.calls[0][0];
    expect(arg.system[0].text).toMatch(/flash-note/);
    expect(arg.messages[0].content).toMatch(/^SOURCE CONTENT:/);
    expect(arg.effort).toBe("low");
    expect(arg.timeoutMs).toBe(25_000);
  });
});
