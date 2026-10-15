/**
 * a-anthropic-features: prompt-cache placement. The markers move, the prompt
 * text never does; the stable prefix (tools, core prompt, fact sheet) is byte
 * identical across learners, languages, modes and tool rounds.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AiCacheTtlViolation,
  AiInputRejected,
  buildRequestBody,
  cacheMarkersInOrder,
  callClaude,
  validateCallParams,
  type CallClaudeParams,
  type MessageParam,
} from "@/lib/ai/anthropic";
import { MODEL_IDS, oneHourPrefixBytes, reserveCeilingMicro, RESERVE_FRAMING_TOKENS } from "@/lib/ai/pricing";
import { cacheHitRate, chatCachePlan, withSystemBreakpoint, withSystemCacheTtl, withTailBreakpoint } from "@/lib/ai/cache-plan";
import { prepareCall } from "@/lib/mentor/turn";
import { MENTOR_CONFIG_DEFAULTS, readMentorConfig, type MentorConfig } from "@/lib/mentor/config";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { ctx, fakeDb } from "../mentor/brain/helpers";

const brain = createMentorBrain({ facts: getMentorFactsLoader(), db: () => fakeDb({}).db, clock: () => new Date("2026-10-14T08:00:00Z") });
const now = new Date("2026-10-14T08:00:00Z");

function prep(over: Partial<MentorConfig>, c = ctx({ now }), messages: MessageParam[] = [{ role: "user", content: "Wann ist die nächste SIP?" }], isLast = false) {
  const r = prepareCall({ brain, config: { ...MENTOR_CONFIG_DEFAULTS, ...over } }, c, messages, isLast);
  if (!r.ok) throw new Error(`prepareCall failed: ${r.error} ${r.detail ?? ""}`);
  return r;
}

/** JSON of everything up to and including the last system block that carries a marker. */
function cachedPrefix(p: CallClaudeParams): string {
  const last = p.system.map((b) => !!b.cache_control).lastIndexOf(true);
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "cache_control" ? undefined : v)));
  return JSON.stringify({ tools: strip(p.tools), system: strip(p.system.slice(0, last + 1)) });
}

describe("mentor cache plan: stable prefix", () => {
  it("tools + core prompt + fact sheet are byte identical across learners, languages, modes and rounds", () => {
    const a = prep({ tailCache: true }, ctx({ now, lang: "de", mode: "facts", userId: "11111111-1111-4111-8111-111111111111" }));
    const b = prep({ tailCache: true }, ctx({ now, lang: "en", mode: "study", userId: "33333333-3333-4333-8333-333333333333" }));
    const c = prep({}, ctx({ now, lang: "tr", mode: "explain", questionId: 4711 }), [{ role: "user", content: "Erklären Sie" }], true);
    expect(cachedPrefix(a.params)).toBe(cachedPrefix(b.params));
    expect(cachedPrefix(a.params)).toBe(cachedPrefix(c.params));
    // The per-turn block sits after the breakpoint and holds no learner text.
    const marked = a.params.system.map((s) => !!s.cache_control);
    expect(marked).toEqual([false, true, false]);
    expect(a.params.system[2].text).toContain("TURN CONTEXT");
    expect(a.params.system[2].text).not.toContain("Wann ist");
  });

  it("puts one 5-minute breakpoint on the conversation tail and leaves the loop's messages unmarked", () => {
    const history: MessageParam[] = [
      { role: "user", content: "Erste Frage" },
      { role: "assistant", content: [{ type: "text", text: "Antwort" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"ok\":true}" }] },
    ];
    const r = prep({ tailCache: true }, ctx({ now }), history);
    const markers = cacheMarkersInOrder(r.params);
    expect(markers).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }]);
    const last = r.params.messages[r.params.messages.length - 1];
    expect(Array.isArray(last.content) && (last.content[0] as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    // prep.messages is what the loop keeps: unmarked, so markers never pile up.
    expect(JSON.stringify(r.messages)).not.toContain("cache_control");
    expect(JSON.stringify(history)).not.toContain("cache_control");
  });

  it("changes no prompt text: the request with markers equals the request without them once markers are stripped", () => {
    const on = prep({ tailCache: true });
    const off = prep({ tailCache: false });
    // A string content is the same prompt as one text block with that text;
    // normalise both forms, drop the markers, and the requests are identical.
    const norm = (m: MessageParam): MessageParam => (typeof m.content === "string" ? { ...m, content: [{ type: "text", text: m.content }] } : m);
    const strip = (p: CallClaudeParams) =>
      JSON.stringify(buildRequestBody({ ...p, messages: p.messages.map(norm) }), (k, v) => (k === "cache_control" ? undefined : v));
    expect(strip(on.params)).toBe(strip(off.params));
  });

  it("keeps the reserve ceiling and admission bar unchanged at the default 5-minute TTL", () => {
    const on = prep({ tailCache: true });
    const off = prep({});
    expect(on.ceilingMicro).toBe(off.ceilingMicro);
    expect(on.ceilingMicro).toBe(reserveCeilingMicro(MODEL_IDS.HAIKU_5_5, off.bytes, MENTOR_CONFIG_DEFAULTS.maxTokens));
  });

  it("MENTOR_FACTS_CACHE_TTL=1h marks the fact sheet 1h and prices that prefix at the 1-hour write rate", () => {
    const five = prep({ tailCache: true });
    const hour = prep({ factsCacheTtl: "1h", tailCache: true });
    expect(hour.params.system[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // 1h first, then the 5m tail: the API's TTL order.
    expect(cacheMarkersInOrder(hour.params).map((m) => m.ttl ?? "5m")).toEqual(["1h", "5m"]);
    expect(hour.ceilingMicro).toBeGreaterThan(five.ceilingMicro);
    expect(hour.ceilingMicro).toBeLessThanOrEqual(
      Math.ceil(((hour.bytes + RESERVE_FRAMING_TOKENS) * 200_000 + MENTOR_CONFIG_DEFAULTS.maxTokens * 500_000) / 1e6),
    );
  });

  it("reads the cache config from env (default 5m, tail off; only literal values switch)", () => {
    expect(readMentorConfig({}).factsCacheTtl).toBe("5m");
    expect(readMentorConfig({}).tailCache).toBe(false);
    expect(readMentorConfig({ MENTOR_FACTS_CACHE_TTL: "1h" }).factsCacheTtl).toBe("1h");
    expect(readMentorConfig({ MENTOR_FACTS_CACHE_TTL: "1H" }).factsCacheTtl).toBe("5m");
    expect(readMentorConfig({ MENTOR_TAIL_CACHE: "true" }).tailCache).toBe(true);
    expect(readMentorConfig({ MENTOR_TAIL_CACHE: "yes" }).tailCache).toBe(false);
  });

  it("defaults send exactly today's request: one 5-minute marker on the fact sheet, none in messages", () => {
    const r = prep({});
    expect(cacheMarkersInOrder(r.params)).toEqual([{ type: "ephemeral" }]);
    expect(r.params.messages).toBe(r.messages);
  });
});

describe("cache-plan helpers", () => {
  it("withTailBreakpoint: one marker on the last block, string content kept as the same text, inputs untouched", () => {
    const msgs: MessageParam[] = [
      { role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    const before = JSON.stringify(msgs);
    const out = withTailBreakpoint(msgs);
    expect(JSON.stringify(msgs)).toBe(before);
    expect(cacheMarkersInOrder({ messages: out, system: [], tools: [] })).toHaveLength(1);
    expect(out[2]).toEqual({ role: "user", content: [{ type: "text", text: "c", cache_control: { type: "ephemeral" } }] });
    expect(out[0].content).toEqual([{ type: "text", text: "a" }]);
  });

  it("withSystemCacheTtl only re-marks blocks that already carry a marker; withSystemBreakpoint marks the last block", () => {
    const sys = [{ type: "text" as const, text: "a" }, { type: "text" as const, text: "b", cache_control: { type: "ephemeral" as const } }];
    expect(withSystemCacheTtl(sys, "1h")).toEqual([{ type: "text", text: "a" }, { type: "text", text: "b", cache_control: { type: "ephemeral", ttl: "1h" } }]);
    expect(withSystemBreakpoint([{ type: "text", text: "x", cache_control: { type: "ephemeral" } }, { type: "text", text: "y" }])).toEqual([
      { type: "text", text: "x" },
      { type: "text", text: "y", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("chatCachePlan: no marker on a first explanation, system + tail markers on a follow-up, text unchanged", () => {
    const on = { AI_CHAT_FOLLOWUP_CACHE: "true" };
    const first = chatCachePlan("SYS", [{ role: "user", content: "Erklären" }], on);
    expect(cacheMarkersInOrder({ ...first, tools: [] })).toHaveLength(0);
    const follow = chatCachePlan("SYS", [
      { role: "user", content: "Erklären" },
      { role: "assistant", content: "Antwort" },
      { role: "user", content: "Warum?" },
    ], on);
    expect(cacheMarkersInOrder({ ...follow, tools: [] })).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }]);
    expect(follow.system[0].text).toBe("SYS");
    // Flag off (default): the follow-up goes out without markers, as today.
    const off = chatCachePlan("SYS", [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }], {});
    expect(cacheMarkersInOrder({ ...off, tools: [] })).toHaveLength(0);
  });

  it("cacheHitRate is reads over all prompt tokens, null without tokens", () => {
    expect(cacheHitRate({ input: 100, cacheRead: 900, cacheWrite: 0 })).toBeCloseTo(0.9);
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe("wrapper: TTL rules", () => {
  const base = (over: Partial<CallClaudeParams> = {}): CallClaudeParams => ({
    model: MODEL_IDS.HAIKU_5_5,
    effort: "low",
    system: [{ type: "text", text: "S", cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [{ role: "user", content: [{ type: "text", text: "q", cache_control: { type: "ephemeral" } }] }],
    max_tokens: 100,
    apiKey: "test-key-not-real",
    ...over,
  });

  it("accepts 1h on system before a 5m tail and sends it as given", () => {
    expect(() => validateCallParams(base())).not.toThrow();
    expect((buildRequestBody(base()).system as Array<{ cache_control: unknown }>)[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("rejects a 1h breakpoint after a 5m one, and more than four breakpoints", () => {
    const order = base({
      system: [
        { type: "text", text: "a", cache_control: { type: "ephemeral" } },
        { type: "text", text: "b", cache_control: { type: "ephemeral", ttl: "1h" } },
      ],
    });
    expect(() => validateCallParams(order)).toThrow(AiInputRejected);
    try { validateCallParams(order); } catch (e) { expect((e as AiInputRejected).code).toBe("cache_ttl_order"); }
    const five = base({ system: Array.from({ length: 5 }, (_, i) => ({ type: "text" as const, text: String(i), cache_control: { type: "ephemeral" as const } })), messages: [{ role: "user", content: "q" }] });
    expect(() => validateCallParams(five)).toThrow(/At most 4/);
  });

  it("bills 1h writes the request asked for; still raises AiCacheTtlViolation when it did not", async () => {
    const body = {
      model: MODEL_IDS.HAIKU_5_5,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 600, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 600 } },
    };
    const resp = () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const ok = await callClaude(base({ fetchImpl: vi.fn(async () => resp()) as unknown as typeof fetch }));
    expect(ok.usage.cache_creation?.ephemeral_1h_input_tokens).toBe(600);
    const err = await callClaude(base({
      system: [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }],
      fetchImpl: vi.fn(async () => resp()) as unknown as typeof fetch,
    })).catch((e) => e);
    expect(err).toBeInstanceOf(AiCacheTtlViolation);
  });
});

describe("reserve ceiling with a 1-hour prefix", () => {
  it("is unchanged without a 1h prefix, higher with one, never above the all-1h bound", () => {
    const m = MODEL_IDS.HAIKU_5_5;
    expect(reserveCeilingMicro(m, 10_000, 700, { oneHourBytes: 0 })).toBe(reserveCeilingMicro(m, 10_000, 700));
    const part = reserveCeilingMicro(m, 10_000, 700, { oneHourBytes: 8_000 });
    expect(part).toBe(Math.ceil(((8_000 + 512) * 200_000 + (10_512 - 8_512) * 125_000 + 700 * 500_000) / 1e6));
    expect(reserveCeilingMicro(m, 10_000, 700, { oneHourBytes: 50_000 })).toBe(Math.ceil((10_512 * 200_000 + 700 * 500_000) / 1e6));
    expect(() => reserveCeilingMicro(m, 10_000, 700, { oneHourBytes: -1 })).toThrow(TypeError);
  });

  it("oneHourPrefixBytes covers tools and system through the last 1h block, 0 without one", () => {
    expect(oneHourPrefixBytes({ system: [{}, { cache_control: { ttl: undefined } }] as never })).toBe(0);
    const sys = [{ type: "text", text: "a".repeat(100), cache_control: { type: "ephemeral", ttl: "1h" } }, { type: "text", text: "b".repeat(5000) }];
    const n = oneHourPrefixBytes({ system: sys as never, tools: [] });
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(5000);
  });
});
