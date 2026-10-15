/**
 * a-anthropic-features: Message Batches runner. A fake Batches API proves
 * submit -> poll -> collect, idempotency per item, the budget stop, the
 * shared wrapper rules and half-price billing. No network.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BATCHES_URL,
  batchCeilingMicro,
  batchCostMicro,
  buildBatchRequest,
  collect,
  latestResults,
  parseResultLine,
  poll,
  readResults,
  readState,
  spentMicro,
  submit,
  type BatchItem,
  type RunnerIo,
} from "../../../scripts/ai-batch/runner";
import { translationCustomId } from "../../../scripts/content/translate-free-slices/lib";
import { costMicroUsd, MODEL_IDS } from "@/lib/ai/pricing";

const MODEL = MODEL_IDS.SONNET_5;

function item(id: string, text = "Bitte übersetzen."): BatchItem {
  return {
    custom_id: id,
    params: { model: MODEL, effort: "low", max_tokens: 1000, system: [{ type: "text", text: "Translate." }], messages: [{ role: "user", content: text }] },
  };
}

/** In-memory Batches API: creates batches, ends them on demand, serves JSONL results. */
function fakeApi() {
  const batches = new Map<string, { requests: Array<{ custom_id: string; params: Record<string, unknown> }>; ended: boolean }>();
  const calls: Array<{ method: string; url: string; body?: unknown; headers: Record<string, string> }> = [];
  let n = 0;
  let loseNextCreateResponse = false;
  const created = new Map<string, string>();
  const outcome = new Map<string, "succeeded" | "errored" | "refusal">();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const method = String(init.method);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, headers: init.headers as Record<string, string> });
    if (method === "POST" && url === BATCHES_URL) {
      const id = `msgbatch_${++n}`;
      batches.set(id, { requests: body.requests, ended: false });
      created.set(id, new Date("2026-10-14T10:00:10Z").toISOString());
      if (loseNextCreateResponse) {
        loseNextCreateResponse = false;
        throw new Error("socket hang up");
      }
      return new Response(JSON.stringify({ id, processing_status: "in_progress" }), { status: 200 });
    }
    if (method === "GET" && url === `${BATCHES_URL}?limit=100`) {
      const data = [...batches.entries()].map(([id, b]) => ({ id, created_at: created.get(id), processing_status: b.ended ? "ended" : "in_progress", request_counts: { processing: b.ended ? 0 : b.requests.length, succeeded: b.ended ? b.requests.length : 0, errored: 0, canceled: 0, expired: 0 } }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    const m = /\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(url);
    if (m && method === "GET") {
      const b = batches.get(m[1]);
      if (!b) return new Response("nope", { status: 404 });
      if (!m[2]) {
        return new Response(JSON.stringify({ id: m[1], processing_status: b.ended ? "ended" : "in_progress", results_url: b.ended ? `${BATCHES_URL}/${m[1]}/results` : null }), { status: 200 });
      }
      const lines = b.requests.map((r) => {
        const o = outcome.get(r.custom_id) ?? "succeeded";
        if (o === "errored") return JSON.stringify({ custom_id: r.custom_id, result: { type: "errored", error: { type: "error", error: { type: "overloaded_error" } } } });
        return JSON.stringify({
          custom_id: r.custom_id,
          result: {
            type: "succeeded",
            message: {
              model: MODEL,
              stop_reason: o === "refusal" ? "refusal" : "end_turn",
              content: [{ type: "thinking", thinking: "" }, { type: "text", text: o === "refusal" ? "" : `T(${r.custom_id})` }],
              usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            },
          },
        });
      });
      return new Response(lines.join("\n") + "\n", { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
  const io: RunnerIo = { fetch: fetchImpl, auth: async () => ({ kind: "api_key", value: "test-key-not-real" }), now: () => new Date("2026-10-14T10:00:00Z") };
  return { io, calls, batches, outcome, endAll: () => batches.forEach((b) => (b.ended = true)), loseNext: () => (loseNextCreateResponse = true) };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ai-batch-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("building requests", () => {
  it("uses the wrapper's body (no stream, no sampling) and refuses bad ids and forbidden params", () => {
    const r = buildBatchRequest(item("q1_ru_abc"));
    expect(r.custom_id).toBe("q1_ru_abc");
    expect(r.params).toMatchObject({ model: MODEL, max_tokens: 1000, output_config: { effort: "low" } });
    expect(r.params).not.toHaveProperty("stream");
    expect(r.params).not.toHaveProperty("temperature");
    expect(() => buildBatchRequest(item("has space"))).toThrow(/custom_id/);
    expect(() => buildBatchRequest({ custom_id: "x", params: { ...item("x").params, temperature: 0 } as never })).toThrow();
  });

  it("bills half the standard price, and the worst case is half the live reserve", () => {
    const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null };
    expect(batchCostMicro(MODEL, usage)).toBe(Math.ceil(costMicroUsd(MODEL, usage) / 2));
    expect(batchCeilingMicro(item("a").params)).toBeGreaterThan(0);
  });

  it("translation custom ids are stable per cell and source and valid for the API", () => {
    const id = translationCustomId({ question_id: 4711, lang: "ru", source_sha256: "a".repeat(64) });
    expect(id).toBe(`q4711_ru_${"a".repeat(16)}`);
    expect(() => buildBatchRequest(item(id))).not.toThrow();
  });
});

describe("submit, poll, collect", () => {
  it("runs end to end and books the real half-price cost", async () => {
    const api = fakeApi();
    const s = await submit(dir, [item("a"), item("b")], { maxUsd: 5, io: api.io });
    expect(s).toMatchObject({ submitted: 2, skippedDone: 0, skippedBudget: 0 });
    expect(readState(dir).batches).toHaveLength(1);
    expect(api.calls[0].headers["x-api-key"]).toBe("test-key-not-real");
    expect((await poll(dir, { io: api.io }))[0].processing_status).toBe("in_progress");
    expect((await collect(dir, { io: api.io })).collected).toBe(0);
    api.endAll();
    await poll(dir, { io: api.io });
    const c = await collect(dir, { io: api.io });
    expect(c).toMatchObject({ collected: 2, succeeded: 2, failed: 0 });
    const res = latestResults(readResults(dir));
    expect(res.get("a")?.text).toBe("T(a)");
    const one = batchCostMicro(MODEL, { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null });
    expect(spentMicro(dir)).toBe(2 * one);
    // Collecting again never re-books a batch.
    expect((await collect(dir, { io: api.io })).collected).toBe(0);
    expect(spentMicro(dir)).toBe(2 * one);
  });

  it("is idempotent per item: done or open items are never sent again; failed ones are", async () => {
    const api = fakeApi();
    api.outcome.set("b", "errored");
    api.outcome.set("c", "refusal");
    await submit(dir, [item("a"), item("b"), item("c")], { maxUsd: 5, io: api.io });
    // Still open: nothing new goes out.
    const again = await submit(dir, [item("a"), item("b"), item("c")], { maxUsd: 5, io: api.io });
    expect(again).toMatchObject({ submitted: 0, skippedDone: 3 });
    api.endAll();
    await poll(dir, { io: api.io });
    const c = await collect(dir, { io: api.io });
    expect(c).toMatchObject({ succeeded: 1, failed: 2 });
    const latest = latestResults(readResults(dir));
    expect(latest.get("c")).toMatchObject({ type: "errored", error: "refusal", text: null });
    api.outcome.clear();
    const retry = await submit(dir, [item("a"), item("b"), item("c"), item("c")], { maxUsd: 5, io: api.io });
    expect(retry).toMatchObject({ submitted: 2, skippedDone: 2 });
    const sent = api.calls.filter((x) => x.method === "POST").at(-1)!.body as { requests: Array<{ custom_id: string }> };
    expect(sent.requests.map((r) => r.custom_id)).toEqual(["b", "c"]);
  });

  it("stops before the worst case could pass the cap, counting open batches and earlier spend", async () => {
    const api = fakeApi();
    const ceiling = batchCeilingMicro(item("a").params);
    const maxUsd = (ceiling * 2.5) / 1_000_000;
    const first = await submit(dir, [item("a"), item("b"), item("c")], { maxUsd, io: api.io });
    expect(first).toMatchObject({ submitted: 2, skippedBudget: 1 });
    // Open batch worst case counts: nothing more fits.
    expect(await submit(dir, [item("d")], { maxUsd, io: api.io })).toMatchObject({ submitted: 0, skippedBudget: 1 });
    // Spend booked elsewhere under the same cap also counts.
    const dir2 = mkdtempSync(path.join(tmpdir(), "ai-batch-"));
    expect(await submit(dir2, [item("a")], { maxUsd, io: api.io, extraPriorMicro: Math.round(maxUsd * 1_000_000) })).toMatchObject({ submitted: 0 });
    rmSync(dir2, { recursive: true, force: true });
  });

  it("records a batch id in the state file before the next chunk", async () => {
    const api = fakeApi();
    await submit(dir, [item("a")], { maxUsd: 5, io: api.io });
    const state = JSON.parse(readFileSync(path.join(dir, "batch-state.json"), "utf8"));
    expect(state.batches[0]).toMatchObject({ id: "msgbatch_1", custom_ids: ["a"], collected_at: null });
  });
});

describe("reviewer round 1", () => {
  it("a lost create response leaves an intent record: items stay blocked, poll adopts the batch, nothing is sent twice", async () => {
    const api = fakeApi();
    api.loseNext();
    await expect(submit(dir, [item("a"), item("b")], { maxUsd: 5, io: api.io })).rejects.toThrow(/socket hang up/);
    expect(readState(dir).batches[0]).toMatchObject({ id: null, custom_ids: ["a", "b"] });
    expect(await submit(dir, [item("a"), item("b")], { maxUsd: 5, io: api.io })).toMatchObject({ submitted: 0, skippedDone: 2 });
    expect(api.batches.size).toBe(1);
    await poll(dir, { io: api.io });
    expect(readState(dir).batches[0].id).toBe("msgbatch_1");
    api.endAll();
    await poll(dir, { io: api.io });
    expect((await collect(dir, { io: api.io })).succeeded).toBe(2);
  });

  it("a clear 4xx on create drops the intent so the items are free again", async () => {
    const api = fakeApi();
    const io: RunnerIo = { ...api.io, fetch: (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch };
    await expect(submit(dir, [item("a")], { maxUsd: 5, io })).rejects.toThrow(/HTTP 429/);
    expect(readState(dir).batches).toEqual([]);
    expect(await submit(dir, [item("a")], { maxUsd: 5, io: api.io })).toMatchObject({ submitted: 1 });
  });

  it("a re-collected batch does not count a failure twice", async () => {
    const { blockedIds } = await import("../../../scripts/ai-batch/runner");
    const fail = (batch_id: string) => ({ custom_id: "x", batch_id, type: "errored" as const, text: null, stop_reason: null, model: null, usage: null, cost_micro: 0, error: "refusal", collected_at: "t" });
    expect(blockedIds({ batches: [] }, [fail("b1"), fail("b1"), fail("b2")]).has("x")).toBe(false);
    expect(blockedIds({ batches: [] }, [fail("b1"), fail("b2"), fail("b3")]).has("x")).toBe(true);
  });

  it("a failed item is sent at most three times", async () => {
    const api = fakeApi();
    api.outcome.set("x", "refusal");
    for (let i = 0; i < 4; i++) {
      await submit(dir, [item("x")], { maxUsd: 5, io: api.io });
      api.endAll();
      await poll(dir, { io: api.io });
      await collect(dir, { io: api.io });
    }
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(3);
  });

  it("never sends credentials to a results_url outside api.anthropic.com", async () => {
    const api = fakeApi();
    await submit(dir, [item("a")], { maxUsd: 5, io: api.io });
    const st = readState(dir);
    st.batches[0].processing_status = "ended";
    st.batches[0].results_url = "https://evil.example/results";
    const { writeState } = await import("../../../scripts/ai-batch/runner");
    writeState(dir, st);
    await expect(collect(dir, { io: api.io })).rejects.toThrow(/refusing to send credentials/);
    expect(api.calls.some((c) => c.url.startsWith("https://evil"))).toBe(false);
  });
});

describe("parseResultLine", () => {
  it("reads the first text block, never content[0], and ignores malformed lines", () => {
    const line = JSON.stringify({ custom_id: "x", result: { type: "succeeded", message: { model: MODEL, stop_reason: "end_turn", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "Hallo" }], usage: { input_tokens: 1, output_tokens: 1 } } } });
    expect(parseResultLine(line, "b1", "t")).toMatchObject({ type: "succeeded", text: "Hallo" });
    expect(parseResultLine("not json", "b1", "t")).toBeNull();
    expect(parseResultLine(JSON.stringify({ custom_id: "x", result: { type: "expired" } }), "b1", "t")).toMatchObject({ type: "expired", cost_micro: 0 });
  });
});

describe("a-content-c1 runner fork", () => {
  it("an answer cut off at max_tokens is billed but not usable, and can be sent again", () => {
    const line = JSON.stringify({ custom_id: "x", result: { type: "succeeded", message: { model: MODEL, stop_reason: "max_tokens", content: [{ type: "text", text: "{\"picks\": [\"A\"" }], usage: { input_tokens: 10, output_tokens: 10 } } } });
    const r = parseResultLine(line, "b1", "t");
    expect(r).toMatchObject({ type: "errored", error: "max_tokens", text: null });
    expect(r!.cost_micro).toBeGreaterThan(0);
  });

  it("structured outputs and effort go into output_config; Opus 5.5 is priced from the script table", () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
    const r = buildBatchRequest({ custom_id: "p2b_1_0123456789abcdef", params: { model: "claude-opus-5-5", effort: "medium", max_tokens: 100, system: [{ type: "text", text: "s" }], messages: [{ role: "user", content: "x" }], output_format: { type: "json_schema", schema } } });
    expect(r.params).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium", format: { type: "json_schema", schema } } });
    expect(r.params).not.toHaveProperty("output_format");
    expect(batchCeilingMicro({ model: "claude-opus-5-5", effort: "medium", max_tokens: 1000, system: [{ type: "text", text: "s" }], messages: [{ role: "user", content: "x" }] })).toBeGreaterThan(batchCeilingMicro({ model: MODEL_IDS.SONNET_5_5, effort: "medium", max_tokens: 1000, system: [{ type: "text", text: "s" }], messages: [{ role: "user", content: "x" }] }));
    // Batch price for Opus 5.5: USD 2 / 10 per MTok.
    expect(batchCostMicro("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null })).toBe(2_000_000);
    expect(() => buildBatchRequest({ custom_id: "x", params: { model: "claude-unknown-9", effort: "low", max_tokens: 10, system: [{ type: "text", text: "s" }], messages: [{ role: "user", content: "x" }] } })).toThrow(/no price/);
  });
});
