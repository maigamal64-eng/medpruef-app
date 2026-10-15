import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeDb, makeDbState, OK_USAGE, rowsFor, type FakeDbState } from "./helpers";

const h = vi.hoisted(() => ({
  state: null as unknown as FakeDbState,
  db: null as unknown,
  callClaude: vi.fn(),
  requireUser: vi.fn(),
  isFreeAccess: vi.fn(),
  captureServerError: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser: h.requireUser, isFreeAccess: h.isFreeAccess }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => h.db }));
vi.mock("@/lib/free-access", () => ({ canFreeUserReadQuestion: vi.fn(async () => true), logFreeCapHit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true }),
  rateKey: (...p: string[]) => p.join(":"),
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: h.captureServerError }));
vi.mock("@/lib/ai/anthropic", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/anthropic")>()), callClaude: h.callClaude }));

import { POST } from "@/app/api/translate/route";
import { AiRefusal, AiTimeout, AiUpstream } from "@/lib/ai/anthropic";
import { costMicroUsd } from "@/lib/ai/pricing";

const USER = "11111111-1111-4111-8111-111111111111";

function req(body: Record<string, unknown> = { questionId: 42, lang: "en", field: "ai_explanation" }) {
  return POST(new NextRequest("http://localhost/api/translate", { method: "POST", body: JSON.stringify(body) }));
}

const okResult = { text: "An English explanation.", blocks: [], toolUses: [], usage: OK_USAGE, stop_reason: "end_turn", model: "claude-haiku-4-5", request_id: "r1" };

beforeEach(() => {
  h.state = makeDbState();
  h.db = makeDb(h.state);
  h.callClaude.mockReset();
  h.callClaude.mockResolvedValue(okResult);
  h.requireUser.mockResolvedValue({ userId: USER });
  h.isFreeAccess.mockReturnValue(false);
  h.captureServerError.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_TRANSLATE_DAILY_ATTEMPTS", "");
  vi.stubEnv("AI_FALLBACK_MODEL", "");
  vi.stubEnv("OPENAI_TRANSLATE_MODEL", "");
  vi.stubEnv("ANTHROPIC_TRANSLATE_MODEL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const takes = () => h.state.rpcCalls.filter((c) => c.fn === "ai_quota_take");
const logRows = () => rowsFor(h.state, "ai_call_log");

describe("POST /api/translate metering", () => {
  it("cache hit: served free, no gate, no quota take, no model call, no log row", async () => {
    h.state.cachedTranslation = { translated_text: "cached", source_model: "claude-haiku-4-5", created_at: "x" };
    const res = await req();
    expect(res.status).toBe(200);
    expect((await res.json()).cached).toBe(true);
    expect(h.state.rpcCalls).toHaveLength(0);
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
  });

  it("success: paid takes no daily attempt (issue 10), one ai_call_log row with route, provider, status and cost", async () => {
    const res = await req();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.translatedText).toBe("An English explanation.");
    expect(j.cached).toBe(false);
    expect(takes()).toHaveLength(0);
    const rows = logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      route: "translate",
      status: "ok",
      success: true,
      in_tokens: 350,
      out_tokens: 250,
      cost_usd: "0.001600",
      question_id: 42,
    });
    expect(rowsFor(h.state, "question_translations")).toHaveLength(1);
    expect(rowsFor(h.state, "user_events")).toHaveLength(1);
  });

  it("gate order: legacy lane spend (split read, shared fallback before the a38 changeset), then the workspace meter (free = house-funded), then user cap, then the quota take (free only)", async () => {
    h.isFreeAccess.mockReturnValue(true);
    // a-anthropic-features: the meter is read at most once a minute per instance; start cold.
    const { resetSpendMeterCacheForTests } = await import("@/lib/ai/workspace-spend");
    resetSpendMeterCacheForTests();
    await req();
    expect(h.state.rpcCalls.map((c) => c.fn)).toEqual(["ai_spend_month_split", "ai_spend_cap", "ai_spend_month", "ai_spend_month", "ai_legacy_cost_month", "ai_quota_take", "cache_question_translation_if_current"]);
  });

  it("paid gate order: spend and monthly user cap still apply, no daily quota take", async () => {
    await req();
    expect(h.state.rpcCalls.map((c) => c.fn)).toEqual(["ai_spend_month_split", "ai_spend_cap", "ai_spend_month", "ai_legacy_cost_month", "cache_question_translation_if_current"]);
  });

  it("MUX-106 A: a legacy surge over the legacy share rests translate; mentor spend does not", async () => {
    h.state.rpc.ai_spend_month_split = () => ({ data: { mentor_micro: 0, legacy_micro: 25_000_000 }, error: null });
    expect((await req()).status).toBe(503);
    h.state.rpc.ai_spend_month_split = () => ({ data: { mentor_micro: 49_000_000, legacy_micro: 1_000 }, error: null });
    expect((await req()).status).toBe(200);
  });

  it("free users keep their 5 a day", async () => {
    h.isFreeAccess.mockReturnValue(true);
    await req();
    expect(takes()[0].args?.p_limit).toBe(5);
  });

  it("a lower configured cap also lowers the free allowance; paid ignores it", async () => {
    vi.stubEnv("AI_TRANSLATE_DAILY_ATTEMPTS", "3");
    await req();
    expect(takes()).toHaveLength(0);
    h.state = makeDbState();
    h.db = makeDb(h.state);
    h.isFreeAccess.mockReturnValue(true);
    await req();
    expect(takes()[0].args?.p_limit).toBe(3);
  });

  it("free daily cap reached: 429 QUOTA_EXCEEDED, no model call, translate_cap_hit logged", async () => {
    h.isFreeAccess.mockReturnValue(true);
    h.state.rpc.ai_quota_take = () => ({ data: { ok: false, used: 5, reason: "limit_reached" }, error: null });
    const res = await req();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("QUOTA_EXCEEDED");
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
    const events = rowsFor(h.state, "user_events") as { event_type: string; event_data: Record<string, unknown> }[];
    expect(events.map((e) => e.event_type)).toEqual(["translate_cap_hit"]);
    expect(events[0].event_data).toMatchObject({ limit: 5, question_id: 42, lang: "en", field: "ai_explanation" });
  });

  it("DB error on the quota take refuses the call (fail closed)", async () => {
    h.isFreeAccess.mockReturnValue(true);
    h.state.rpc.ai_quota_take = () => ({ data: null, error: { message: "boom" } });
    const res = await req();
    expect(res.status).toBe(503);
    expect(h.callClaude).not.toHaveBeenCalled();
  });

  it("DB error on the global spend check refuses the call", async () => {
    h.state.rpc.ai_spend_month = () => ({ data: null, error: { message: "boom" } });
    const res = await req();
    expect(res.status).toBe(503);
    expect(takes()).toHaveLength(0);
    expect(h.callClaude).not.toHaveBeenCalled();
  });

  it("global cap reached: 503 resting message, no attempt taken, no model call", async () => {
    h.state.rpc.ai_spend_month = () => ({ data: 50_000_000, error: null });
    const res = await req();
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j.code).toBe("AI_RESTING");
    expect(j.error).toMatch(/resting/i);
    expect(takes()).toHaveLength(0);
    expect(h.callClaude).not.toHaveBeenCalled();
  });

  it("per-user legacy cap reached: 429 limit message, no attempt taken", async () => {
    h.state.rpc.ai_legacy_cost_month = () => ({ data: "3000000", error: null });
    const res = await req();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("LEGACY_CAP_REACHED");
    expect(takes()).toHaveLength(0);
    expect(h.callClaude).not.toHaveBeenCalled();
  });

  it("a 404 source never burns an attempt", async () => {
    h.state.question = null;
    const res = await req();
    expect(res.status).toBe(404);
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("Anthropic timeout is logged with a non-null cost, then OpenAI answers and is logged too (two rows)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "oa-key");
    h.callClaude.mockRejectedValue(new AiTimeout("timed out", { usage: null, request_id: null }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Fallback text" } }], usage: { prompt_tokens: 300, completion_tokens: 200 } }), { status: 200 })),
    );
    const res = await req();
    expect(res.status).toBe(200);
    expect((await res.json()).sourceModel).toBe("gpt-4o-mini");
    const rows = logRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ provider: "anthropic", route: "translate", status: "timeout", success: false, error_code: "timeout" });
    expect(Number(rows[0].cost_usd)).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ provider: "openai", model: "gpt-4o-mini", route: "translate", status: "ok", in_tokens: 300, out_tokens: 200 });
    expect(Number(rows[1].cost_usd)).toBeGreaterThan(0);
    expect(takes()).toHaveLength(0); // paid: no daily attempt (issue 10)
  });

  it("both providers fail: 503, both failures logged", async () => {
    vi.stubEnv("OPENAI_API_KEY", "oa-key");
    h.callClaude.mockRejectedValue(new AiUpstream("HTTP 500", { reachedModel: true, status: 500, code: "http_500" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    const res = await req();
    expect(res.status).toBe(503);
    const rows = logRows();
    expect(rows.map((r) => [r.provider, r.status])).toEqual([["anthropic", "upstream_error"], ["openai", "upstream_error"]]);
    expect(rows.every((r) => r.cost_usd !== null)).toBe(true);
  });

  it("a 4xx that never reached the model books 0 cost but is still logged", async () => {
    h.callClaude.mockRejectedValue(new AiUpstream("HTTP 429", { reachedModel: false, status: 429, code: "http_429" }));
    const res = await req();
    expect(res.status).toBe(503);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({ status: "upstream_error", cost_usd: "0.000000", error_code: "http_429" });
  });

  it("a failed ai_call_log write is reported, never silent", async () => {
    h.state.insertErrors.ai_call_log = [{ code: "XX000", message: "down" }, { code: "XX000", message: "down" }];
    const res = await req();
    expect(res.status).toBe(200);
    expect(h.captureServerError).toHaveBeenCalledTimes(1);
  });

  it("no API key: nothing is sent and nothing is logged", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await req();
    expect(res.status).toBe(503);
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
  });
});

describe("POST /api/translate Anthropic fallback (AI_FALLBACK_MODEL is a Claude model)", () => {
  const FALLBACK = "claude-sonnet-4-6";
  const openaiFetch = vi.fn(async () => new Response("must not be called", { status: 500 }));

  beforeEach(() => {
    vi.stubEnv("AI_FALLBACK_MODEL", FALLBACK);
    vi.stubEnv("OPENAI_API_KEY", "oa-key"); // present on purpose: it must never be used
    openaiFetch.mockClear();
    vi.stubGlobal("fetch", openaiFetch);
  });

  it("Haiku fails, claude-sonnet-4-6 answers through the wrapper: two anthropic rows, Sonnet 4.6 cost, no OpenAI call", async () => {
    h.callClaude
      .mockRejectedValueOnce(new AiUpstream("HTTP 500", { reachedModel: true, status: 500, code: "http_500" }))
      .mockResolvedValueOnce({ ...okResult, model: FALLBACK, text: "Sonnet fallback translation." });
    const res = await req();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.translatedText).toBe("Sonnet fallback translation.");
    expect(j.sourceModel).toBe(FALLBACK);

    expect(h.callClaude).toHaveBeenCalledTimes(2);
    const [first, second] = h.callClaude.mock.calls.map((c) => c[0] as { model: string; max_tokens: number; effort: string; system: unknown; messages: unknown });
    expect(first.model).toBe("claude-haiku-4-5");
    expect(second).toMatchObject({ model: FALLBACK, max_tokens: 1400, effort: "low" });
    expect(second.system).toEqual(first.system);
    expect(second.messages).toEqual(first.messages);
    expect(openaiFetch).not.toHaveBeenCalled();

    const rows = logRows();
    expect(rows.map((r) => [r.provider, r.model, r.status])).toEqual([
      ["anthropic", "claude-haiku-4-5", "upstream_error"],
      ["anthropic", FALLBACK, "ok"],
    ]);
    expect(Number(rows[0].cost_usd)).toBeGreaterThan(0);
    expect(Number(rows[1].cost_usd)).toBeCloseTo(costMicroUsd(FALLBACK, OK_USAGE) / 1e6, 9);
    expect(takes()).toHaveLength(0); // paid: no daily attempt (issue 10)
    expect(rowsFor(h.state, "question_translations")[0]).toMatchObject({ source_model: FALLBACK });
  });

  it("a refusal is never re-sent to the fallback model", async () => {
    h.callClaude.mockRejectedValueOnce(
      new AiRefusal("declined", { usage: OK_USAGE, request_id: "r", stop_details: null, blocks: [], partialText: "" }),
    );
    const res = await req();
    expect(res.status).toBe(503);
    expect(h.callClaude).toHaveBeenCalledTimes(1);
    expect(openaiFetch).not.toHaveBeenCalled();
    expect(logRows().map((r) => r.status)).toEqual(["refusal"]);
  });

  it("both Claude models fail: 503, both logged with a cost, no OpenAI call", async () => {
    h.callClaude.mockRejectedValue(new AiTimeout("timed out", { usage: null, request_id: null }));
    const res = await req();
    expect(res.status).toBe(503);
    expect(h.callClaude).toHaveBeenCalledTimes(2);
    expect(openaiFetch).not.toHaveBeenCalled();
    const rows = logRows();
    expect(rows.map((r) => [r.model, r.status])).toEqual([
      ["claude-haiku-4-5", "timeout"],
      [FALLBACK, "timeout"],
    ]);
    expect(rows.every((r) => Number(r.cost_usd) > 0)).toBe(true);
  });

  it("a slot naming the translate primary makes one call only", async () => {
    vi.stubEnv("AI_FALLBACK_MODEL", "claude-haiku-4-5");
    h.callClaude.mockRejectedValue(new AiUpstream("HTTP 500", { reachedModel: true, status: 500, code: "http_500" }));
    const res = await req();
    expect(res.status).toBe(503);
    expect(h.callClaude).toHaveBeenCalledTimes(1);
    expect(openaiFetch).not.toHaveBeenCalled();
  });
});


describe("TR-11 source-checked translation cache", () => {
  it.each(["explanation", "ai_explanation"])("delayed %s generation cannot restore an old key cache hit", async (field) => {
    let finish!: (result: typeof okResult) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    h.callClaude.mockImplementationOnce(() => { started(); return new Promise<typeof okResult>((resolve) => { finish = resolve; }); });
    const source = h.state.question?.[field];
    const pending = req({ questionId: 42, lang: "en", field });
    await entered;
    h.state.question = { ...h.state.question, key_revision: 1, ai_explanation: null };
    h.state.cachedTranslation = null;
    finish(okResult);
    expect((await pending).status).toBe(200);
    expect(h.state.cachedTranslation).toBeNull();
    expect(rowsFor(h.state, "question_translations")).toHaveLength(0);
    expect(h.state.rpcCalls.find((c) => c.fn === "cache_question_translation_if_current")?.args).toMatchObject({ p_key_revision: 0, p_source_text: source });
    // A subsequent POST goes through generation again, never returns cached:true.
    h.state.question = { ...h.state.question, ai_explanation: "Current explanation" };
    const response = await req({ questionId: 42, lang: "en", field });
    expect((await response.json()).cached).toBe(false);
    expect(h.callClaude).toHaveBeenCalledTimes(2);
  });

  it("an unavailable source-validation RPC never falls back to an unguarded insert", async () => {
    h.state.rpc.cache_question_translation_if_current = () => ({ data: null, error: { code: "PGRST202", message: "RPC unavailable" } });
    expect((await req()).status).toBe(200);
    expect(rowsFor(h.state, "question_translations")).toHaveLength(0);
    expect(h.state.cachedTranslation).toBeNull();
  });
});

describe("before the key_revision migration is applied", () => {
  it("still translates, but skips the cache write instead of inserting unguarded", async () => {
    h.state.missingKeyRevision = true;
    const res = await req();
    expect(res.status).toBe(200);
    expect((await res.json()).translatedText).toBe("An English explanation.");
    expect(h.state.rpcCalls.map((c) => c.fn)).not.toContain("cache_question_translation_if_current");
    expect(rowsFor(h.state, "question_translations")).toHaveLength(0);
  });
});
