import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AiCacheTtlViolation,
  AiEmptyText,
  AiError,
  AiInputRejected,
  AiRefusal,
  AiTimeout,
  AiUpstream,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  buildRequestBody,
  callClaude,
  readSse,
  statusReachedModel,
  type CallClaudeParams,
} from "@/lib/ai/anthropic";
import { MAX_INPUT_BYTES, MODEL_IDS } from "@/lib/ai/pricing";
import { resetAnthropicAuthCacheForTests } from "@/lib/ai/credentials";

// Fixtures are synthesized from the documented API shapes (see fixtures/README.md).
const FIX = path.join(__dirname, "fixtures");
const thinkingFirst = JSON.parse(fs.readFileSync(path.join(FIX, "messages-thinking-first.json"), "utf8"));
const streamFixture = fs.readFileSync(path.join(FIX, "stream-thinking-first.sse"), "utf8");

function jsonResponse(body: unknown, init: { status?: number; requestId?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", "request-id": init.requestId ?? "req_fixture_1" },
  });
}

function sseResponse(text: string, chunkSize = 0, requestId = "req_stream_1"): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (chunkSize <= 0) controller.enqueue(bytes);
      else for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "request-id": requestId } });
}

function fetchReturning(res: Response | (() => Response)) {
  return vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return typeof res === "function" ? res() : res;
  });
}

function base(over: Partial<CallClaudeParams> = {}): CallClaudeParams {
  return {
    model: MODEL_IDS.SONNET_5_5,
    effort: "low",
    system: [{ type: "text", text: "Du bist ein Lernassistent.", cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "Was ist ein Spannungspneumothorax?" }],
    max_tokens: 700,
    apiKey: "test-key-not-real",
    ...over,
  };
}

function sentBody(f: ReturnType<typeof fetchReturning>): Record<string, unknown> {
  const init = f.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("callClaude: thinking-first response (synthesized documented-shape fixture)", () => {
  it("takes text from the first block of type text, never content[0]", async () => {
    const f = fetchReturning(jsonResponse(thinkingFirst));
    const r = await callClaude(base({ fetchImpl: f as unknown as typeof fetch }));
    expect(thinkingFirst.content[0].type).toBe("thinking");
    expect(r.text).toBe(thinkingFirst.content[1].text);
    expect(r.blocks).toHaveLength(2);
    expect(r.toolUses).toEqual([]);
    expect(r.stop_reason).toBe("end_turn");
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.request_id).toBe("req_fixture_1");
    expect(r.usage).toMatchObject({ input_tokens: 1142, output_tokens: 558, cache_read_input_tokens: 1536, cache_creation_input_tokens: 0 });
  });

  it("asserts zero 1-hour cache writes on a normal response", async () => {
    const f = fetchReturning(jsonResponse(thinkingFirst));
    const r = await callClaude(base({ fetchImpl: f as unknown as typeof fetch }));
    expect(r.usage.cache_creation?.ephemeral_1h_input_tokens).toBe(0);
  });

  it("calls onMessageStart with input and cache tokens", async () => {
    const f = fetchReturning(jsonResponse(thinkingFirst));
    const onMessageStart = vi.fn();
    await callClaude(base({ fetchImpl: f as unknown as typeof fetch, onMessageStart }));
    expect(onMessageStart).toHaveBeenCalledTimes(1);
    expect(onMessageStart.mock.calls[0][0]).toMatchObject({ input_tokens: 1142, cache_read_input_tokens: 1536, request_id: "req_fixture_1" });
  });

  it("raises AiCacheTtlViolation (with usage, billable) when the response reports 1h writes", async () => {
    const bad = structuredClone(thinkingFirst);
    bad.usage.cache_creation_input_tokens = 900;
    bad.usage.cache_creation = { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 900 };
    const f = fetchReturning(jsonResponse(bad));
    const err = await callClaude(base({ fetchImpl: f as unknown as typeof fetch })).catch((e) => e);
    expect(err).toBeInstanceOf(AiCacheTtlViolation);
    expect(err.reachedModel).toBe(true);
    expect(err.usage.cache_creation.ephemeral_1h_input_tokens).toBe(900);
  });

  it("raises AiEmptyText (billable, with usage) when only a thinking block comes back", async () => {
    const onlyThinking = { ...structuredClone(thinkingFirst), content: [thinkingFirst.content[0]], stop_reason: "max_tokens" };
    const f = fetchReturning(jsonResponse(onlyThinking));
    const err = await callClaude(base({ fetchImpl: f as unknown as typeof fetch })).catch((e) => e);
    expect(err).toBeInstanceOf(AiEmptyText);
    expect(err).toBeInstanceOf(AiError);
    expect(err.reachedModel).toBe(true);
    expect(err.stop_reason).toBe("max_tokens");
    expect(err.usage.output_tokens).toBe(558);
    expect(err.request_id).toBe("req_fixture_1");
  });

  it("does not treat a tool_use-only turn as empty", async () => {
    const toolTurn = {
      ...structuredClone(thinkingFirst),
      content: [thinkingFirst.content[0], { type: "tool_use", id: "toolu_1", name: "get_dates", input: { exam_key: "sip4a" } }],
      stop_reason: "tool_use",
    };
    const f = fetchReturning(jsonResponse(toolTurn));
    const r = await callClaude(base({ fetchImpl: f as unknown as typeof fetch }));
    expect(r.text).toBe("");
    expect(r.toolUses).toHaveLength(1);
    expect(r.toolUses[0].name).toBe("get_dates");
  });
});

describe("callClaude: refusals are never a success", () => {
  it("a mid-output refusal with partial text raises AiRefusal (billed, partial kept aside)", async () => {
    const refused = {
      ...structuredClone(thinkingFirst),
      content: [thinkingFirst.content[0], { type: "text", text: "Die Dosierung von" }],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "bio", explanation: "declined" },
    };
    const f = fetchReturning(jsonResponse(refused));
    const err = await callClaude(base({ fetchImpl: f as unknown as typeof fetch })).catch((e) => e);
    expect(err).toBeInstanceOf(AiRefusal);
    expect(err.reachedModel).toBe(true);
    expect(err.code).toBe("refusal");
    expect(err.partialText).toBe("Die Dosierung von");
    expect(err.stop_details).toMatchObject({ category: "bio" });
    expect(err.usage.output_tokens).toBe(558);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a refusal with no text and no stop_details is still AiRefusal, not AiEmptyText", async () => {
    const refused = { ...structuredClone(thinkingFirst), content: [], stop_reason: "refusal" };
    const err = await callClaude(base({ fetchImpl: fetchReturning(jsonResponse(refused)) as unknown as typeof fetch })).catch((e) => e);
    expect(err).toBeInstanceOf(AiRefusal);
    expect(err.stop_details).toBeNull();
    expect(err.partialText).toBe("");
  });

  it("a streamed refusal (stop_reason in message_delta) raises AiRefusal", async () => {
    const sse = streamFixture.replace(
      '"delta":{"stop_reason":"end_turn","stop_sequence":null}',
      '"delta":{"stop_reason":"refusal","stop_sequence":null,"stop_details":{"type":"refusal","category":"general_harms"}}',
    );
    expect(sse).not.toBe(streamFixture);
    const err = await callClaude(base({ stream: true, fetchImpl: fetchReturning(sseResponse(sse, 5)) as unknown as typeof fetch })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AiRefusal);
    expect(err.partialText).toBe("Die Anmeldung schließt um 12:00. 🩺 مرحبا");
    expect(err.stop_details).toMatchObject({ category: "general_harms" });
    expect(err.usage.output_tokens).toBe(212);
  });
});

describe("callClaude: request body", () => {
  it("never sends sampling params or thinking, sets effort only where supported", async () => {
    const f = fetchReturning(jsonResponse(thinkingFirst));
    await callClaude(base({ fetchImpl: f as unknown as typeof fetch }));
    const body = sentBody(f);
    for (const k of ["temperature", "top_p", "top_k", "thinking", "stream"]) expect(body).not.toHaveProperty(k);
    expect(body.output_config).toEqual({ effort: "low" });
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
  });

  it("omits effort for Haiku 4.5 (it 400s on effort) and for unknown models", () => {
    expect(buildRequestBody(base({ model: MODEL_IDS.HAIKU_4_5 }))).not.toHaveProperty("output_config");
    expect(buildRequestBody(base({ model: "claude-future-9" }))).not.toHaveProperty("output_config");
    expect(buildRequestBody(base({ model: MODEL_IDS.HAIKU_5_5 }))).toHaveProperty("output_config", { effort: "low" });
  });

  it("rejects sampling params smuggled in through a cast, without calling fetch", async () => {
    for (const k of ["temperature", "top_p", "top_k", "thinking"]) {
      const f = fetchReturning(jsonResponse(thinkingFirst));
      const p = { ...base({ fetchImpl: f as unknown as typeof fetch }), [k]: k === "thinking" ? { type: "adaptive" } : 0.2 };
      const err = await callClaude(p as unknown as CallClaudeParams).catch((e) => e);
      expect(err).toBeInstanceOf(AiInputRejected);
      expect(err.reachedModel).toBe(false);
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("refuses any cache_control ttl (1h or explicit 5m) before sending", async () => {
    for (const ttl of ["1h", "5m"]) {
      const f = fetchReturning(jsonResponse(thinkingFirst));
      const p = base({
        fetchImpl: f as unknown as typeof fetch,
        system: [{ type: "text", text: "x", cache_control: { type: "ephemeral", ttl } as unknown as { type: "ephemeral" } }],
      });
      const err = await callClaude(p).catch((e) => e);
      expect(err).toBeInstanceOf(AiInputRejected);
      expect(err.code).toBe("cache_ttl_not_allowed");
      expect(f).not.toHaveBeenCalled();
    }
    const f2 = fetchReturning(jsonResponse(thinkingFirst));
    const inMsg = base({
      fetchImpl: f2 as unknown as typeof fetch,
      messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "1h" } as never }] }],
    });
    await expect(callClaude(inMsg)).rejects.toBeInstanceOf(AiInputRejected);
    expect(f2).not.toHaveBeenCalled();
  });

  it("rejects assistant prefill, forced tool choice, images and over-cap input", async () => {
    const f = fetchReturning(jsonResponse(thinkingFirst));
    const fi = f as unknown as typeof fetch;
    const cases: CallClaudeParams[] = [
      base({ fetchImpl: fi, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "Die Antwort ist" }] }),
      base({ fetchImpl: fi, tool_choice: { type: "any" } as never }),
      base({
        fetchImpl: fi,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://x/y.png" } } as never] }],
      }),
      base({ fetchImpl: fi, messages: [{ role: "user", content: "x".repeat(MAX_INPUT_BYTES + 1) }] }),
      base({ fetchImpl: fi, effort: "max" as never }),
      base({ fetchImpl: fi, max_tokens: 0 }),
    ];
    const codes: string[] = [];
    for (const c of cases) {
      const err = await callClaude(c).catch((e) => e);
      expect(err).toBeInstanceOf(AiInputRejected);
      codes.push(err.code);
    }
    expect(codes).toEqual(["prefill_not_allowed", "forced_tool_choice", "non_text_block", "input_too_large", "bad_params", "bad_params"]);
    expect(f).not.toHaveBeenCalled();
  });

  it("fails without an API key and without calling fetch", async () => {
    const f = fetchReturning(jsonResponse(thinkingFirst));
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const err = await callClaude(base({ apiKey: undefined, fetchImpl: f as unknown as typeof fetch })).catch((e) => e);
      expect(err).toBeInstanceOf(AiUpstream);
      expect(err.code).toBe("no_api_key");
      expect(err.reachedModel).toBe(false);
      expect(f).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe("callClaude: no hidden retries", () => {
  it.each([
    [529, false],
    [429, false],
    [400, false],
    [500, true],
    [503, true],
  ])("HTTP %i is one request, AiUpstream reachedModel=%s", async (status, reached) => {
    const f = fetchReturning(() => jsonResponse({ type: "error", error: { type: "x", message: "y" } }, { status, requestId: "req_err" }));
    const err = await callClaude(base({ fetchImpl: f as unknown as typeof fetch })).catch((e) => e);
    expect(f).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(AiUpstream);
    expect(err.status).toBe(status);
    expect(err.reachedModel).toBe(reached);
    expect(err.request_id).toBe("req_err");
    expect(statusReachedModel(status)).toBe(reached);
  });

  it("network errors: connect-phase means not reached, anything else means reached", async () => {
    const mk = (code: string) =>
      vi.fn(async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code } });
      });
    const notFound = mk("ENOTFOUND");
    const e1 = await callClaude(base({ fetchImpl: notFound as unknown as typeof fetch })).catch((e) => e);
    expect(e1).toBeInstanceOf(AiUpstream);
    expect(e1.reachedModel).toBe(false);
    expect(notFound).toHaveBeenCalledTimes(1);
    const reset = mk("ECONNRESET");
    const e2 = await callClaude(base({ fetchImpl: reset as unknown as typeof fetch })).catch((e) => e);
    expect(e2.reachedModel).toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("timeout raises AiTimeout (reached) after exactly one request", async () => {
    const hang = vi.fn(
      (_u: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    const err = await callClaude(base({ fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 })).catch((e) => e);
    expect(err).toBeInstanceOf(AiTimeout);
    expect(err.reachedModel).toBe(true);
    expect(hang).toHaveBeenCalledTimes(1);
  });

  it("an external abort is AiUpstream 'aborted', not a timeout", async () => {
    const ac = new AbortController();
    const hang = vi.fn(
      (_u: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    );
    const p = callClaude(base({ fetchImpl: hang as unknown as typeof fetch, signal: ac.signal, timeoutMs: 5_000 }));
    ac.abort();
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(AiUpstream);
    expect(err.code).toBe("aborted");
  });
});

describe("callClaude: streaming", () => {
  it("parses a thinking-first stream, fires onMessageStart before any text delta", async () => {
    const order: string[] = [];
    const deltas: string[] = [];
    const f = fetchReturning(sseResponse(streamFixture));
    const r = await callClaude(
      base({
        model: MODEL_IDS.HAIKU_5_5,
        stream: true,
        fetchImpl: f as unknown as typeof fetch,
        onMessageStart: (i) => {
          order.push(`start:${i.input_tokens}`);
        },
        onTextDelta: (t) => {
          order.push("delta");
          deltas.push(t);
        },
      }),
    );
    expect(sentBody(f).stream).toBe(true);
    expect(order[0]).toBe("start:2048");
    expect(order.filter((o) => o === "delta")).toHaveLength(2);
    expect(r.text).toBe("Die Anmeldung schließt um 12:00. 🩺 مرحبا");
    expect(deltas.join("")).toBe(r.text);
    expect(r.blocks[0].type).toBe("thinking");
    expect((r.blocks[0] as { signature?: string }).signature).toBe("EuYBCkQSYNTHETIC");
    expect(r.usage).toMatchObject({
      input_tokens: 2048,
      output_tokens: 212,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 640,
    });
    expect(r.usage.cache_creation?.ephemeral_1h_input_tokens).toBe(0);
    expect(r.stop_reason).toBe("end_turn");
    expect(r.request_id).toBe("req_stream_1");
  });

  it("is chunk-boundary safe (1, 3 and 7 byte chunks, and CRLF line endings)", async () => {
    const expected = "Die Anmeldung schließt um 12:00. 🩺 مرحبا";
    for (const size of [1, 3, 7]) {
      const r = await callClaude(
        base({ stream: true, fetchImpl: fetchReturning(sseResponse(streamFixture, size)) as unknown as typeof fetch }),
      );
      expect(r.text).toBe(expected);
    }
    const crlf = streamFixture.replace(/\n/g, "\r\n");
    for (const size of [1, 2, 5]) {
      const r = await callClaude(base({ stream: true, fetchImpl: fetchReturning(sseResponse(crlf, size)) as unknown as typeof fetch }));
      expect(r.text).toBe(expected);
      expect(r.usage.output_tokens).toBe(212);
    }
  });

  it("assembles streamed tool input JSON", async () => {
    const sse = [
      `event: message_start\ndata: {"type":"message_start","message":{"model":"claude-haiku-5-5","usage":{"input_tokens":10,"output_tokens":1}}}\n\n`,
      `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_9","name":"search_facts","input":{}}}\n\n`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query_de\\": \\"Anmel"}}\n\n`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"dung\\"}"}}\n\n`,
      `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":33}}\n\n`,
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
    ].join("");
    const r = await callClaude(base({ stream: true, fetchImpl: fetchReturning(sseResponse(sse, 4)) as unknown as typeof fetch }));
    expect(r.toolUses).toHaveLength(1);
    expect(r.toolUses[0].input).toEqual({ query_de: "Anmeldung" });
    expect(r.stop_reason).toBe("tool_use");
    expect(r.usage.output_tokens).toBe(33);
  });

  it("an error event mid-stream is AiUpstream, reached, with the usage seen so far", async () => {
    const sse =
      streamFixture.split("event: content_block_start")[0] +
      `event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n`;
    const err = await callClaude(base({ stream: true, fetchImpl: fetchReturning(sseResponse(sse)) as unknown as typeof fetch })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AiUpstream);
    expect(err.reachedModel).toBe(true);
    expect(err.usage.input_tokens).toBe(2048);
    expect(err.code).toBe("stream_overloaded_error");
  });

  it("a stream that ends without message_stop is AiUpstream stream_incomplete", async () => {
    const cut = streamFixture.split("event: message_delta")[0];
    const err = await callClaude(base({ stream: true, fetchImpl: fetchReturning(sseResponse(cut)) as unknown as typeof fetch })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AiUpstream);
    expect(err.code).toBe("stream_incomplete");
    expect(err.reachedModel).toBe(true);
  });

  it("readSse yields one event per blank-line-separated record", async () => {
    const res = sseResponse(": comment\n\nevent: a\ndata: 1\n\nevent: b\ndata: x\ndata: y\n\n", 2);
    const out = [];
    for await (const ev of readSse(res.body!)) out.push(ev);
    expect(out).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "x\ny" },
    ]);
  });
});

// ─── Credentials (ANTHROPIC_AUTH_MODE) ──────────────────────────────────

const oidc = vi.hoisted(() => ({ getVercelOidcToken: vi.fn(async () => "eyJ.vercel.identity") }));
vi.mock("@vercel/oidc", () => oidc);

describe("callClaude: credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetAnthropicAuthCacheForTests();
    oidc.getVercelOidcToken.mockClear();
  });

  function sentInit(f: ReturnType<typeof fetchReturning>): RequestInit {
    return f.mock.calls[0][1] as RequestInit;
  }

  it("default mode sends exactly the pre-WIF headers with the env key", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_MODE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api-env");
    const f = fetchReturning(jsonResponse(thinkingFirst));
    await callClaude(base({ apiKey: undefined, fetchImpl: f as unknown as typeof fetch }));
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(ANTHROPIC_MESSAGES_URL);
    expect(sentInit(f).headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "sk-ant-api-env",
      "anthropic-version": ANTHROPIC_VERSION,
    });
    expect(Object.keys(sentInit(f).headers as object)).toEqual(["content-type", "x-api-key", "anthropic-version"]);
  });

  it("an explicit empty apiKey still fails with no_api_key (old ?? semantics)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api-env");
    const f = fetchReturning(jsonResponse(thinkingFirst));
    const err = await callClaude(base({ apiKey: "", fetchImpl: f as unknown as typeof fetch })).catch((e) => e);
    expect(err.code).toBe("no_api_key");
    expect(f).not.toHaveBeenCalled();
  });

  it("a bearer token is sent as Authorization with the OAuth beta header, never x-api-key", async () => {
    const f = fetchReturning(jsonResponse(thinkingFirst));
    await callClaude(base({ apiKey: undefined, auth: { kind: "bearer", value: "sk-ant-oat01-x", expiresAt: Date.now() + 3600_000 }, fetchImpl: f as unknown as typeof fetch }));
    const h = sentInit(f).headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer sk-ant-oat01-x");
    expect(h["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(h["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(h).not.toHaveProperty("x-api-key");
  });

  it("wif mode: the exchange is a separate fetch, the Messages call stays one request", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_MODE", "wif");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_WIF_RULE_ID", "fdrl_t");
    vi.stubEnv("ANTHROPIC_WIF_ORG_ID", "org");
    vi.stubEnv("ANTHROPIC_WIF_SERVICE_ACCOUNT_ID", "svac_t");
    vi.stubEnv("ANTHROPIC_WIF_AUDIENCE", "");
    const exchange = vi.fn(async () => jsonResponse({ access_token: "sk-ant-oat01-live", token_type: "Bearer", expires_in: 3600 }));
    vi.stubGlobal("fetch", exchange);
    const f = fetchReturning(() => jsonResponse(thinkingFirst));
    await callClaude(base({ apiKey: undefined, fetchImpl: f as unknown as typeof fetch }));
    await callClaude(base({ apiKey: undefined, fetchImpl: f as unknown as typeof fetch }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(exchange).toHaveBeenCalledTimes(1); // cached for the second call
    expect((exchange.mock.calls[0] as unknown as [string])[0]).toBe("https://api.anthropic.com/v1/oauth/token");
    expect(oidc.getVercelOidcToken).toHaveBeenCalledWith(expect.objectContaining({ audience: "https://api.anthropic.com", jti: expect.any(String) }));
    expect((sentInit(f).headers as Record<string, string>).authorization).toBe("Bearer [secret]");
  });

  it("wif mode with a failed exchange and no key: wif_exchange_failed, nothing sent to Messages", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_MODE", "wif");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_WIF_RULE_ID", "fdrl_t");
    vi.stubEnv("ANTHROPIC_WIF_ORG_ID", "org");
    vi.stubEnv("ANTHROPIC_WIF_SERVICE_ACCOUNT_ID", "svac_t");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const f = fetchReturning(jsonResponse(thinkingFirst));
    const err = await callClaude(base({ apiKey: undefined, fetchImpl: f as unknown as typeof fetch })).catch((e) => e);
    expect(err).toBeInstanceOf(AiUpstream);
    expect(err.code).toBe("wif_exchange_failed");
    expect(err.reachedModel).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
