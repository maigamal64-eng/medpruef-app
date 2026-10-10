import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { costMicroUsd } from "@/lib/ai/pricing";

const { requireUser, isFreeAccess, addBreadcrumb, captureServerError, world } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isFreeAccess: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureServerError: vi.fn(),
  world: { sb: null as unknown },
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser, isFreeAccess, isPaidAccess: vi.fn(() => true) }));
vi.mock("@/lib/free-access", () => ({
  canFreeUserReadQuestion: vi.fn(async () => true),
  logFreeCapHit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => world.sb }));
vi.mock("@/lib/sentry-capture", () => ({ addBreadcrumb, captureServerError }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterSec: 0 })),
  rateKey: vi.fn(() => "test-key"),
  rateLimitHeaders: vi.fn(() => ({})),
}));

const UID = "11111111-1111-4111-8111-111111111111";

interface Scenario {
  quota?: FakeResult; // ai_quota_take reply
  cap?: FakeResult; // ai_legacy_cost_month reply
  r2Columns?: boolean; // do the R2 ai_call_log columns exist
  localeColumn?: boolean; // does questions.ai_explanation_lang exist
  cachedAi?: string | null;
  questionError?: boolean; // the questions select fails
}

function setup(sc: Scenario = {}) {
  const s = { r2Columns: true, localeColumn: true, cachedAi: null as string | null, ...sc };
  // The route deletes a key from its update payload on the legacy retry, so snapshot each write.
  const updateSnapshots: Record<string, unknown>[] = [];
  const { sb, calls } = createFakeSupabase((call: FakeCall): FakeResult | undefined => {
    if (call.table === "rpc:ai_quota_take") return s.quota ?? { data: { ok: true, used: 1 } };
    if (call.table === "rpc:ai_legacy_cost_month") return s.cap ?? { data: 0 };
    if (call.table === "ai_call_log") {
      if (call.op === "select") {
        return s.r2Columns ? { data: [] } : { error: { code: "42703", message: "column ai_call_log.route does not exist" } };
      }
      if (call.op === "insert") {
        const p = call.payload as Record<string, unknown>;
        if (!s.r2Columns && "route" in p) return { error: { code: "PGRST204", message: "no route column" } };
        return {};
      }
    }
    if (call.table === "questions") {
      if (call.op === "select") {
        if (s.questionError) return { error: { code: "57014", message: "canceling statement due to statement timeout" } };
        if (!s.localeColumn && call.columns?.includes("ai_explanation_lang")) {
          return { error: { code: "42703", message: "column ai_explanation_lang does not exist" } };
        }
        return {
          data: {
            question: "Welches Organ produziert Insulin?",
            answer: "Pankreas",
            explanation: "Beta-Zellen der Langerhans-Inseln.",
            topic: "Endokrinologie",
            choices: [
              { text: "Pankreas", correct: true },
              { text: "Leber", correct: false },
            ],
            ai_explanation: s.cachedAi,
            ai_explanation_lang: null,
          },
        };
      }
      if (call.op === "update") {
        const p = call.payload as Record<string, unknown>;
        updateSnapshots.push({ ...p });
        if (!s.localeColumn && "ai_explanation_lang" in p) {
          return { error: { code: "42703", message: "column ai_explanation_lang does not exist" } };
        }
        return {};
      }
    }
    return {};
  });
  world.sb = sb;
  return {
    calls,
    inserts: () => calls.filter((c) => c.table === "ai_call_log" && c.op === "insert").map((c) => c.payload as Record<string, unknown>),
    updates: () => updateSnapshots,
    rpcs: (fn: string) => calls.filter((c) => c.table === `rpc:${fn}`),
  };
}

const THINKING_FIRST = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content: [
    { type: "thinking", thinking: "Let me work through the distractors.", signature: "sig" },
    { type: "text", text: "**TL;DR** Das Pankreas produziert Insulin." },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 1142, output_tokens: 558, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
};

const THINKING_ONLY_MAX_TOKENS = {
  ...THINKING_FIRST,
  content: [{ type: "thinking", thinking: "Long reasoning that never ends...", signature: "sig" }],
  stop_reason: "max_tokens",
  usage: { input_tokens: 1142, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const OPENAI_OK = { choices: [{ message: { content: "Fallback explanation" } }], usage: { prompt_tokens: 1000, completion_tokens: 400 } };

type FetchCall = { url: string; body: Record<string, unknown> };
function stubFetch(handlers: { anthropic?: () => Response; openai?: () => Response }) {
  const seen: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      seen.push({ url, body });
      if (url.includes("api.anthropic.com")) return (handlers.anthropic ?? (() => json(THINKING_FIRST, 200, { "request-id": "req_abc" })))();
      if (url.includes("api.openai.com")) return (handlers.openai ?? (() => json(OPENAI_OK)))();
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return seen;
}

type Msg = { role: string; content: string };
async function post(body: { messages?: Msg[]; lang?: string; questionId?: number; regenerate?: boolean } = {}) {
  const { POST } = await import("@/app/api/ai-chat/route");
  return POST(
    new NextRequest("https://example.test/api/ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: 42,
        lang: "de",
        messages: [{ role: "user", content: "Erkläre diese Frage." }],
        ...body,
      }),
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ userId: UID, tier: "pro", role: "user" });
  isFreeAccess.mockReturnValue(false);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_PRIMARY_MODEL", "claude-sonnet-5");
  vi.stubEnv("ANTHROPIC_MODEL", "");
  vi.stubEnv("AI_FEATURES_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER_MODE", "auto");
  vi.stubEnv("AI_CHAT_DAILY_ATTEMPTS", "");
  vi.stubEnv("AI_LEGACY_USER_MONTHLY_CAP_MICRO", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("thinking-first response", () => {
  it("returns the text block and sends explicit effort and a thinking-safe max_tokens", async () => {
    const t = setup();
    const seen = stubFetch({});
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toBe("**TL;DR** Das Pankreas produziert Insulin.");

    const body = seen[0].body as { output_config?: { effort?: string }; max_tokens?: number; system?: { text: string }[]; messages?: Msg[] };
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
    expect(body.messages?.[0]).toEqual({ role: "user", content: "Erkläre diese Frage." });

    const rows = t.inserts();
    expect(rows).toHaveLength(1);
    const expected = costMicroUsd("claude-sonnet-5", { input_tokens: 1142, output_tokens: 558 });
    expect(rows[0]).toMatchObject({
      user_id: UID,
      provider: "anthropic",
      model: "claude-sonnet-5",
      in_tokens: 1142,
      out_tokens: 558,
      success: true,
      error_code: null,
      route: "ai_chat",
      status: "ok",
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      question_id: 42,
    });
    expect(Number(rows[0].cost_usd)).toBeCloseTo(expected / 1e6, 9);
    expect(expected).toBeGreaterThan(0);
  });

  it("drops the exam name and the guideline-citation instruction from the system prompt", async () => {
    setup();
    const seen = stubFetch({});
    await post();
    const system = (seen[0].body.system as { text: string }[])[0].text;
    expect(system).not.toMatch(/Kenntnispr/);
    expect(system).not.toMatch(/ERC 2021|ESC|ÖDG|Impfplan|AGES/);
    expect(system).not.toMatch(/cite the guideline/i);
    expect(system).toContain("QUESTION CONTEXT");
  });
});

describe("empty or failed upstream calls are metered", () => {
  it("thinking-only response stopped by max_tokens: 503, one empty_text row with a cost", async () => {
    const t = setup();
    stubFetch({ anthropic: () => json(THINKING_ONLY_MAX_TOKENS, 200, { "request-id": "req_x" }) });
    const res = await post();
    expect(res.status).toBe(503);
    const rows = t.inserts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "anthropic", success: false, status: "empty_text", error_code: "empty_text", out_tokens: 3000 });
    expect(Number(rows[0].cost_usd)).toBeCloseTo(costMicroUsd("claude-sonnet-5", { input_tokens: 1142, output_tokens: 3000 }) / 1e6, 9);
    expect(Number(rows[0].cost_usd)).toBeGreaterThan(0);
    expect(t.updates()).toHaveLength(0); // nothing cached
  });

  it("HTTP 500 without usage: input estimate, not null and not zero", async () => {
    const t = setup();
    stubFetch({ anthropic: () => json({ error: { type: "api_error" } }, 500) });
    const res = await post();
    expect(res.status).toBe(503);
    const row = t.inserts()[0];
    expect(row).toMatchObject({ provider: "anthropic", status: "upstream_error", error_code: "http_500", success: false });
    expect(Number(row.cost_usd)).toBeGreaterThan(0);
    // R2-05: books at least the full output budget, never an input-only estimate.
    expect(Number(row.cost_usd)).toBeGreaterThanOrEqual(costMicroUsd("claude-sonnet-5", { input_tokens: 0, output_tokens: 3000 }) / 1e6);
  });

  it("R2-03: a question fetch failure refuses before any quota, model call or cache write", async () => {
    const t = setup({ questionError: true });
    const seen = stubFetch({});
    const res = await post();
    expect(res.status).toBe(503);
    expect(seen).toHaveLength(0);
    expect(t.rpcs("ai_quota_take")).toHaveLength(0);
    expect(t.inserts()).toHaveLength(0);
    expect(t.updates()).toHaveLength(0);
  });

  it("HTTP 529 (never admitted) is logged at cost 0", async () => {
    const t = setup();
    stubFetch({ anthropic: () => json({ error: { type: "overloaded_error" } }, 529) });
    await post();
    const row = t.inserts()[0];
    expect(row).toMatchObject({ status: "upstream_error", error_code: "http_529" });
    expect(Number(row.cost_usd)).toBe(0);
  });

  it("Anthropic failure then OpenAI success: two rows, one quota attempt, provider openai with cost", async () => {
    const t = setup();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubFetch({ anthropic: () => json({ error: {} }, 500) });
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toBe("Fallback explanation");
    const rows = t.inserts();
    expect(rows.map((r) => [r.provider, r.success])).toEqual([
      ["anthropic", false],
      ["openai", true],
    ]);
    // gpt-4o-mini: 1000 in x 0.15 + 400 out x 0.60 per 1M = 0.00039 USD
    expect(Number(rows[1].cost_usd)).toBeCloseTo(0.00039, 6);
    expect(rows[1]).toMatchObject({ model: "gpt-4o-mini", in_tokens: 1000, out_tokens: 400, route: "ai_chat", status: "ok" });
    expect(t.rpcs("ai_quota_take")).toHaveLength(1);
  });

  it("OpenAI-only mode writes an openai row even when it fails", async () => {
    const t = setup();
    vi.stubEnv("AI_PROVIDER_MODE", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubFetch({ openai: () => json({ error: {} }, 500) });
    const res = await post();
    expect(res.status).toBe(503);
    const rows = t.inserts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "openai", success: false, error_code: "http_500" });
    expect(Number(rows[0].cost_usd)).toBeGreaterThan(0);
  });

  it("a refusal returns a neutral 503, is billed, is never cached and never goes to OpenAI", async () => {
    const t = setup();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const seen = stubFetch({
      anthropic: () =>
        json({
          ...THINKING_FIRST,
          content: [{ type: "text", text: "partial text that must not be shown" }],
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "other" },
        }),
    });
    const res = await post();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("partial text");
    expect(seen.every((c) => c.url.includes("anthropic"))).toBe(true);
    const rows = t.inserts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "refusal", success: false });
    expect(Number(rows[0].cost_usd)).toBeGreaterThan(0);
    expect(t.updates()).toHaveLength(0);
  });

  it("no provider configured: one explanatory row at cost 0", async () => {
    const t = setup();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const seen = stubFetch({});
    const res = await post();
    expect(res.status).toBe(503);
    expect(seen).toHaveLength(0);
    expect(t.inserts()[0]).toMatchObject({ provider: "none", error_code: "no_provider_configured" });
  });
});

describe("quota and cap fail closed", () => {
  it("counts attempts through ai_quota_take with the configured daily limit", async () => {
    const t = setup();
    vi.stubEnv("AI_CHAT_DAILY_ATTEMPTS", "7");
    stubFetch({});
    await post();
    const calls = t.rpcs("ai_quota_take");
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({ p_user: UID, p_route: "ai_chat", p_limit: 7 });
  });

  it("a DB error on the quota returns 503 and never calls the model", async () => {
    setup({ quota: { error: { message: "connection reset" } } });
    const seen = stubFetch({});
    const res = await post();
    expect(res.status).toBe(503);
    expect(seen).toHaveLength(0);
    expect(captureServerError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ phase: "quota-check", failClosed: true }));
  });

  it("an ok:false db_error reply from the RPC is also a 503", async () => {
    setup({ quota: { data: { ok: false, used: null, reason: "db_error", sqlstate: "42501" } } });
    const seen = stubFetch({});
    expect((await post()).status).toBe(503);
    expect(seen).toHaveLength(0);
  });

  it("limit reached returns 429 with Vienna wording and no model call", async () => {
    setup({ quota: { data: { ok: false, used: 15, reason: "limit_reached" } } });
    const seen = stubFetch({});
    const res = await post();
    expect(res.status).toBe(429);
    const j = await res.json();
    expect(j.error).toBe("quota_exceeded");
    expect(j.message).toMatch(/Vienna/);
    expect(j.message).not.toMatch(/CET/);
    expect(typeof j.retry_after).toBe("number");
    expect(seen).toHaveLength(0);
  });

  it("a monthly cost-cap DB error returns 503 before any quota is taken", async () => {
    const t = setup({ cap: { error: { message: "boom" } } });
    const seen = stubFetch({});
    expect((await post()).status).toBe(503);
    expect(seen).toHaveLength(0);
    expect(t.rpcs("ai_quota_take")).toHaveLength(0);
  });

  it("a user at the legacy monthly cap gets 429 and burns no attempt", async () => {
    const t = setup({ cap: { data: 3_000_000 } });
    const seen = stubFetch({});
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("monthly_cap_reached");
    expect(seen).toHaveLength(0);
    expect(t.rpcs("ai_quota_take")).toHaveLength(0);
  });
});

describe("request shape", () => {
  it("a follow-up that starts with the assistant turn gets a leading user turn and is not cached", async () => {
    const t = setup();
    const seen = stubFetch({});
    const res = await post({
      messages: [
        { role: "assistant", content: "Erste Erklärung." },
        { role: "user", content: "Und warum nicht die Leber?" },
      ],
    });
    expect(res.status).toBe(200);
    const sent = seen[0].body.messages as Msg[];
    expect(sent[0].role).toBe("user");
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(t.updates()).toHaveLength(0);
  });

  it("rejects a conversation whose last turn is not the user's, before the quota", async () => {
    const t = setup();
    const seen = stubFetch({});
    const res = await post({ messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] });
    expect(res.status).toBe(400);
    expect(t.rpcs("ai_quota_take")).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it("malformed bodies never burn an attempt", async () => {
    const t = setup();
    stubFetch({});
    expect((await post({ messages: [] })).status).toBe(400);
    expect(t.rpcs("ai_quota_take")).toHaveLength(0);
  });

  it("the 402 text carries no stale price and points at /pricing", async () => {
    setup();
    isFreeAccess.mockReturnValue(true);
    const seen = stubFetch({});
    const res = await post();
    expect(res.status).toBe(402);
    const j = await res.json();
    expect(j.error).toBe("upgrade_required");
    expect(j.message).not.toMatch(/€\s?9\b|9\s?€/);
    expect(j.message).toContain("/pricing");
    expect(seen).toHaveLength(0);
  });

  it("the kill switch returns 503 without touching the database or the model", async () => {
    const t = setup();
    vi.stubEnv("AI_FEATURES_ENABLED", "false");
    const seen = stubFetch({});
    expect((await post()).status).toBe(503);
    expect(seen).toHaveLength(0);
    expect(t.calls).toHaveLength(0);
  });
});

describe("R2 columns are written only when they exist", () => {
  it("falls back to the legacy columns when the probe finds no R2 columns", async () => {
    const t = setup({ r2Columns: false });
    stubFetch({});
    const res = await post();
    expect(res.status).toBe(200);
    const rows = t.inserts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("route");
    expect(rows[0]).not.toHaveProperty("status");
    expect(rows[0]).not.toHaveProperty("cache_read_tokens");
    expect(rows[0]).toMatchObject({ provider: "anthropic", success: true });
  });

  it("probes once per instance when the columns exist", async () => {
    const t = setup();
    stubFetch({});
    await post();
    await post();
    const probes = t.calls.filter((c) => c.table === "ai_call_log" && c.op === "select");
    expect(probes).toHaveLength(1);
  });
});

describe("explanation locale cache (ported from tests/unit/api/ai-chat-route.test.ts)", () => {
  it("does not cache an English response when the locale column is absent", async () => {
    const t = setup({ localeColumn: false });
    stubFetch({});
    const res = await post({ lang: "en" });
    expect(res.status).toBe(200);
    expect(t.updates()).toEqual([expect.objectContaining({ ai_explanation_lang: "en" })]);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "cache_write_skipped", data: expect.objectContaining({ reason: "missing_locale_column_for_english_response" }) }),
    );
  });

  it("keeps the legacy German write when the locale column is absent", async () => {
    const t = setup({ localeColumn: false });
    stubFetch({});
    expect((await post({ lang: "de" })).status).toBe(200);
    const u = t.updates();
    expect(u).toHaveLength(2);
    expect(u[0]).toEqual(expect.objectContaining({ ai_explanation_lang: "de" }));
    expect(u[1]).toEqual(expect.objectContaining({ ai_explanation: "**TL;DR** Das Pankreas produziert Insulin." }));
    expect(u[1]).not.toHaveProperty("ai_explanation_lang");
  });

  it("writes the requested locale when the column exists", async () => {
    const t = setup();
    stubFetch({});
    expect((await post({ lang: "en" })).status).toBe(200);
    expect(t.updates()).toEqual([
      expect.objectContaining({ ai_explanation: "**TL;DR** Das Pankreas produziert Insulin.", ai_explanation_lang: "en" }),
    ]);
    expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ message: "cache_write_ok" }));
  });

  it("does not cache a reply that was cut off by max_tokens", async () => {
    const t = setup();
    stubFetch({
      anthropic: () => json({ ...THINKING_FIRST, stop_reason: "max_tokens" }),
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(t.updates()).toHaveLength(0);
  });
});
