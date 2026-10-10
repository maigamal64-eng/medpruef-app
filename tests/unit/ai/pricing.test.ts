import { describe, it, expect, vi } from "vitest";
import {
  MAX_INPUT_BYTES,
  MODEL_IDS,
  MODEL_SPECS,
  PRICE_TABLE_SOURCE,
  RESERVE_FRAMING_TOKENS,
  UnknownModelPriceError,
  allPriceRows,
  costMicroUsd,
  getModelSpec,
  measureInputBytes,
  normalizeModelId,
  reserveCeilingMicro,
  trimHistoryToFit,
  type TokenUsage,
} from "@/lib/ai/pricing";
import { validateCallParams, AiInputRejected, type MessageParam } from "@/lib/ai/anthropic";

/**
 * Expected values transcribed from the live pricing page
 * (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-10-10),
 * in USD per MTok: [input, 5m write, 1h write, cache read, output].
 * main-Claude re-diffs this block against the live page before R2.
 */
const LIVE_PAGE_USD: Record<string, [number, number, number, number, number]> = {
  "claude-haiku-5-5": [0.1, 0.125, 0.2, 0.01, 0.5], // prompts up to 100,000 tokens
  "claude-sonnet-5-5": [2, 2.5, 4, 0.1, 10], // cache read 0.05x input (footnote 2)
  "claude-sonnet-5": [2, 2.5, 4, 0.2, 10],
  "claude-sonnet-4-6": [3, 3.75, 6, 0.3, 15],
  "claude-haiku-4-5": [1, 1.25, 2, 0.1, 5],
};
const HAIKU_55_OVER_100K_USD: [number, number, number, number, number] = [0.5, 0.625, 1, 0.05, 2.5];
const toMicro = (usd: number) => Math.round(usd * 1_000_000);

describe("price table", () => {
  it("matches the live pricing page exactly (integer micro-USD per MTok)", () => {
    expect(Object.keys(MODEL_SPECS).sort()).toEqual(Object.keys(LIVE_PAGE_USD).sort());
    for (const [id, [inp, w5, w1, cr, out]] of Object.entries(LIVE_PAGE_USD)) {
      expect(MODEL_SPECS[id].base, id).toEqual({
        input: toMicro(inp),
        cacheWrite5m: toMicro(w5),
        cacheWrite1h: toMicro(w1),
        cacheRead: toMicro(cr),
        output: toMicro(out),
      });
    }
    const [inp, w5, w1, cr, out] = HAIKU_55_OVER_100K_USD;
    expect(MODEL_SPECS["claude-haiku-5-5"].longContext).toEqual({
      thresholdTokens: 100_000,
      price: { input: toMicro(inp), cacheWrite5m: toMicro(w5), cacheWrite1h: toMicro(w1), cacheRead: toMicro(cr), output: toMicro(out) },
    });
    expect(PRICE_TABLE_SOURCE.readOn).toBe("2026-10-10");
  });

  it("Sonnet 5.5 cache read is 100000 (live page), not the 200000 in the plan text", () => {
    expect(MODEL_SPECS[MODEL_IDS.SONNET_5_5].base.cacheRead).toBe(100_000);
  });

  it("every value is a non-negative safe integer and the 5m write is the dearest input-class rate", () => {
    for (const row of allPriceRows()) {
      for (const v of Object.values(row)) expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
      expect(row.cacheWrite5m).toBeGreaterThanOrEqual(row.input);
      expect(row.input).toBeGreaterThanOrEqual(row.cacheRead);
    }
  });

  it("only Haiku 4.5 is flagged as not accepting effort", () => {
    expect(Object.values(MODEL_SPECS).filter((s) => !s.supportsEffort).map((s) => s.id)).toEqual(["claude-haiku-4-5"]);
  });

  it("normalises dated snapshot ids", () => {
    expect(normalizeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(getModelSpec("claude-sonnet-5-5-20260901")?.id).toBe("claude-sonnet-5-5");
    expect(getModelSpec("claude-sonnet-5-5")?.id).toBe("claude-sonnet-5-5");
    expect(getModelSpec("gpt-4o-mini")).toBeNull();
  });
});

describe("costMicroUsd", () => {
  it("prices the measured average chat call on Sonnet 5 (1,142 in / 558 out)", () => {
    // 1142 x 2.00 + 558 x 10.00 per MTok = 0.007864 USD
    expect(costMicroUsd("claude-sonnet-5", { input_tokens: 1142, output_tokens: 558 })).toBe(7864);
  });

  it("prices cache reads and 5m writes from the usage object", () => {
    const u: TokenUsage = {
      input_tokens: 100,
      output_tokens: 500,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 600,
      cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 0 },
    };
    // Haiku 5.5: 100x0.1 + 500x0.5 + 3000x0.01 + 600x0.125 = 10+250+30+75 = 365 micro... per MTok -> /1e6
    // exact: (100*100000 + 500*500000 + 3000*10000 + 600*125000)/1e6 = (1e7+2.5e8+3e7+7.5e7)/1e6 = 365
    expect(costMicroUsd(MODEL_IDS.HAIKU_5_5, u)).toBe(365);
    // Sonnet 5.5 cache read at 0.10: (100*2e6 + 500*1e7 + 3000*1e5 + 600*2.5e6)/1e6 = 200+5000+300+1500
    expect(costMicroUsd(MODEL_IDS.SONNET_5_5, u)).toBe(7000);
  });

  it("rounds up once, never down", () => {
    expect(costMicroUsd(MODEL_IDS.HAIKU_5_5, { input_tokens: 1, output_tokens: 0 })).toBe(1); // 0.1 micro -> 1
    expect(costMicroUsd(MODEL_IDS.HAIKU_5_5, { input_tokens: 10, output_tokens: 0 })).toBe(1); // exactly 1
    expect(costMicroUsd(MODEL_IDS.HAIKU_5_5, { input_tokens: 11, output_tokens: 0 })).toBe(2); // 1.1 -> 2
    expect(costMicroUsd(MODEL_IDS.HAIKU_5_5, { input_tokens: 0, output_tokens: 0 })).toBe(0);
  });

  it("prices any 1h writes at the 1h rate and unexplained cache writes at the 1h rate", () => {
    const explicit = costMicroUsd(MODEL_IDS.SONNET_5, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 },
    });
    expect(explicit).toBe(4000);
    const unexplained = costMicroUsd(MODEL_IDS.SONNET_5, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 0 },
    });
    expect(unexplained).toBe(400 * 2.5 + 600 * 4);
    // No breakdown at all: the wrapper only ever requests 5m writes.
    expect(costMicroUsd(MODEL_IDS.SONNET_5, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000 })).toBe(2500);
  });

  it("applies Haiku 5.5's over-100K tier when input + cache tokens exceed 100,000", () => {
    const at = { input_tokens: 40_000, output_tokens: 100, cache_read_input_tokens: 60_000 };
    const over = { input_tokens: 40_001, output_tokens: 100, cache_read_input_tokens: 60_000 };
    expect(costMicroUsd(MODEL_IDS.HAIKU_5_5, at)).toBe(Math.ceil((40_000 * 100_000 + 100 * 500_000 + 60_000 * 10_000) / 1e6));
    expect(costMicroUsd(MODEL_IDS.HAIKU_5_5, over)).toBe(Math.ceil((40_001 * 500_000 + 100 * 2_500_000 + 60_000 * 50_000) / 1e6));
  });

  it("rejects malformed token counts", () => {
    expect(() => costMicroUsd(MODEL_IDS.HAIKU_5_5, { input_tokens: -1, output_tokens: 0 })).toThrow(TypeError);
    expect(() => costMicroUsd(MODEL_IDS.HAIKU_5_5, { input_tokens: 1.5, output_tokens: 0 })).toThrow(TypeError);
    expect(() => costMicroUsd(MODEL_IDS.HAIKU_5_5, { input_tokens: NaN, output_tokens: 0 })).toThrow(TypeError);
  });

  it("unknown model: throws by default (mentor, fail closed)", () => {
    const alert = vi.fn();
    expect(() => costMicroUsd("claude-future-9", { input_tokens: 10, output_tokens: 10 }, { alert })).toThrow(UnknownModelPriceError);
    expect(alert).toHaveBeenCalledWith({ model: "claude-future-9", policy: "throw" });
  });

  it("unknown model with top_row (legacy): max over every row, alerts, never zero, never a crash", () => {
    const alert = vi.fn();
    const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 500, cache_creation_input_tokens: 300 };
    const charged = costMicroUsd("gpt-4o-mini", usage, { onUnknown: "top_row", alert });
    for (const id of Object.keys(MODEL_SPECS)) expect(charged).toBeGreaterThanOrEqual(costMicroUsd(id, usage));
    expect(charged).toBe(Math.ceil((1000 * 3_000_000 + 2000 * 15_000_000 + 500 * 300_000 + 300 * 3_750_000) / 1e6));
    expect(charged).toBeGreaterThan(0);
    expect(alert).toHaveBeenCalledWith({ model: "gpt-4o-mini", policy: "top_row", chargedMicro: charged });
  });
});

describe("reserveCeilingMicro", () => {
  it("= (bytes + 512) x 5m-write price + maxTokens x output price, rounded up", () => {
    // Haiku 5.5: (10,000 + 512) x 0.125 + 700 x 0.50 = 1314 + 350 = 1664 micro-USD
    expect(reserveCeilingMicro(MODEL_IDS.HAIKU_5_5, 10_000, 700)).toBe(Math.ceil((10_512 * 125_000 + 700 * 500_000) / 1e6));
    // Sonnet 5.5 at the cap: (90,512 x 2.5 + 700 x 10) = 226,280 + 7,000
    expect(reserveCeilingMicro(MODEL_IDS.SONNET_5_5, MAX_INPUT_BYTES, 700)).toBe(233_280);
  });

  it("bounds the real cost of any call whose input fits the byte budget (randomised)", () => {
    let seed = 1234567;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (const id of Object.keys(MODEL_SPECS)) {
      for (let i = 0; i < 400; i++) {
        const bytes = rnd(MAX_INPUT_BYTES + 1);
        const maxTokens = 1 + rnd(4000);
        // Tokens never exceed bytes; the 512 margin covers framing and the tool prompt.
        const promptTokens = rnd(bytes + RESERVE_FRAMING_TOKENS + 1);
        const read = rnd(promptTokens + 1);
        const write = rnd(promptTokens - read + 1);
        const usage = {
          input_tokens: promptTokens - read - write,
          cache_read_input_tokens: read,
          cache_creation_input_tokens: write,
          cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 },
          output_tokens: rnd(maxTokens + 1),
        };
        expect(costMicroUsd(id, usage)).toBeLessThanOrEqual(reserveCeilingMicro(id, bytes, maxTokens));
      }
    }
  });

  it("throws for unknown models, over-cap input and bad arguments", () => {
    expect(() => reserveCeilingMicro("claude-future-9", 100, 100)).toThrow(UnknownModelPriceError);
    expect(() => reserveCeilingMicro(MODEL_IDS.HAIKU_5_5, MAX_INPUT_BYTES + 1, 100)).toThrow(RangeError);
    expect(() => reserveCeilingMicro(MODEL_IDS.HAIKU_5_5, -1, 100)).toThrow(TypeError);
    expect(() => reserveCeilingMicro(MODEL_IDS.HAIKU_5_5, 100, 0)).toThrow(TypeError);
  });
});

// ─── Property test: no call can reach the over-100K-token price tier ─────

const ALPHABETS = [
  "abcdefghijklmnopqrstuvwxyz ÄÖÜäöüß.,", // German
  "абвгдеёжзийклмнопрстуфхцчшщъыьэюя ", // Cyrillic (2 bytes each)
  "ابتثجحخدذرزسشصضطظعغفقكلمنهوي ", // Arabic (2 bytes)
  "Ⅱ€✓中文한국어", // 3-byte
  "🩺💊🧠🫀👩🏽‍⚕️", // 4-byte and ZWJ sequences
];

function makeRng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}

function randomText(rng: (n: number) => number, maxChars: number): string {
  const chars = [...ALPHABETS[rng(ALPHABETS.length)]];
  const len = rng(maxChars + 1);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[rng(chars.length)];
  return out;
}

describe("MAX_INPUT_BYTES property", () => {
  it("90,000 bytes + 512 framing (covers the up-to-406-token tool prompt) stays under 100,000 tokens", () => {
    expect(MAX_INPUT_BYTES).toBe(90_000);
    expect(RESERVE_FRAMING_TOKENS).toBeGreaterThanOrEqual(406);
    expect(MAX_INPUT_BYTES + RESERVE_FRAMING_TOKENS).toBeLessThan(100_000);
  });

  it("trimmed histories always fit, start on a user turn, and are rejected only when the last turn alone is too big", () => {
    const rng = makeRng(42);
    for (let trial = 0; trial < 300; trial++) {
      const turns = 1 + rng(30);
      const messages: MessageParam[] = [];
      for (let i = 0; i < turns; i++) {
        messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: randomText(rng, rng(4) === 0 ? 30_000 : 3_000) });
      }
      if (messages[messages.length - 1].role !== "user") messages.push({ role: "user", content: randomText(rng, 500) });
      const system = [{ type: "text" as const, text: randomText(rng, 2_000) }];
      const fit = trimHistoryToFit({ system, messages });
      if (fit === null) {
        const lastOnly = measureInputBytes({ system, messages: messages.slice(-1) });
        expect(lastOnly).toBeGreaterThan(MAX_INPUT_BYTES);
        continue;
      }
      expect(fit.bytes).toBeLessThanOrEqual(MAX_INPUT_BYTES);
      expect(fit.messages[0].role).toBe("user");
      expect(fit.messages[fit.messages.length - 1]).toBe(messages[messages.length - 1]);
      // The wrapper accepts what the trimmer produced.
      expect(() =>
        validateCallParams({ model: MODEL_IDS.HAIKU_5_5, effort: "low", system, messages: fit.messages, max_tokens: 700 }),
      ).not.toThrow();
      // Token upper bound: one token per byte at most.
      expect(fit.bytes + RESERVE_FRAMING_TOKENS).toBeLessThan(100_000);
    }
  });

  it("the wrapper rejects every input whose measured size is over the cap", () => {
    const rng = makeRng(7);
    for (let trial = 0; trial < 60; trial++) {
      const content = randomText(rng, 60_000) + randomText(rng, 60_000);
      const p = { model: MODEL_IDS.HAIKU_5_5, effort: "low" as const, system: [], messages: [{ role: "user" as const, content }], max_tokens: 700 };
      const bytes = measureInputBytes(p);
      if (bytes > MAX_INPUT_BYTES) expect(() => validateCallParams(p)).toThrow(AiInputRejected);
      else expect(() => validateCallParams(p)).not.toThrow();
    }
  });

  it("measures UTF-8 bytes, so multibyte scripts count more than their length", () => {
    const ar = "مرحبا";
    const emoji = "🩺";
    expect(measureInputBytes({ messages: [ar] }) - measureInputBytes({ messages: [""] })).toBe(10);
    expect(measureInputBytes({ messages: [emoji] }) - measureInputBytes({ messages: [""] })).toBe(4);
  });

  it("never keeps an orphaned tool_result at the head of a trimmed history", () => {
    const big = "x".repeat(50_000);
    const messages: MessageParam[] = [
      { role: "user", content: big },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_dates", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
      { role: "assistant", content: "ok" },
      { role: "user", content: "next question" },
    ];
    const fit = trimHistoryToFit({ messages });
    expect(fit).not.toBeNull();
    expect(fit!.messages).toEqual(messages.slice(4));
  });
});
