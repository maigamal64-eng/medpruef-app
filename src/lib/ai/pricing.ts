/**
 * Anthropic price table, cost and reserve maths (contract C2, frozen in wave 0).
 *
 * Every number here is integer micro-USD per million tokens (1 USD =
 * 1,000,000 micro-USD), so "$0.10 / MTok" is 100_000. All cost maths stays in
 * integers and rounds UP once at the end, so MedPruef never under-meters.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing (read
 * 2026-10-10). The live page wins over any cached or briefed figure. Note:
 * the plan text for this contract listed Sonnet 5.5 cache reads as 200_000,
 * but the live page prices them at 0.05x input = $0.10 = 100_000 (footnote 2),
 * so 100_000 is what this table carries.
 *
 * Deliberately NOT in the table: Opus/Fable tiers. "Unknown model, price at
 * the top row" must stay a sane upper bound for the models MedPruef actually
 * runs, not $50/MTok output.
 *
 * Pure module: no imports, no env, no I/O. Callers pass an `alert` callback
 * (for example captureServerError) when they want unknown-model alerts shipped.
 */

/** Integer micro-USD per million tokens for each billable token class. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface ModelSpec {
  id: string;
  label: string;
  base: ModelPrice;
  /** Haiku 5.5 only: prompts over `thresholdTokens` pay `price` instead. */
  longContext?: { thresholdTokens: number; price: ModelPrice };
  /** Whether the API accepts `output_config.effort` for this model. */
  supportsEffort: boolean;
}

export const PRICE_TABLE_SOURCE = {
  url: "https://platform.claude.com/docs/en/about-claude/pricing",
  readOn: "2026-10-10",
} as const;

/** Model ids from the Anthropic docs (no date suffixes). Confirm with the
 * Models API once the production key is verified. */
export const MODEL_IDS = {
  HAIKU_5_5: "claude-haiku-5-5",
  SONNET_5_5: "claude-sonnet-5-5",
  SONNET_5: "claude-sonnet-5",
  HAIKU_4_5: "claude-haiku-4-5",
  SONNET_4_6: "claude-sonnet-4-6",
} as const;

export const MODEL_SPECS: Readonly<Record<string, ModelSpec>> = Object.freeze({
  [MODEL_IDS.HAIKU_5_5]: {
    id: MODEL_IDS.HAIKU_5_5,
    label: "Claude Haiku 5.5",
    base: { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite5m: 125_000, cacheWrite1h: 200_000 },
    longContext: {
      thresholdTokens: 100_000,
      price: { input: 500_000, output: 2_500_000, cacheRead: 50_000, cacheWrite5m: 625_000, cacheWrite1h: 1_000_000 },
    },
    supportsEffort: true,
  },
  [MODEL_IDS.SONNET_5_5]: {
    id: MODEL_IDS.SONNET_5_5,
    label: "Claude Sonnet 5.5",
    base: { input: 2_000_000, output: 10_000_000, cacheRead: 100_000, cacheWrite5m: 2_500_000, cacheWrite1h: 4_000_000 },
    supportsEffort: true,
  },
  [MODEL_IDS.SONNET_5]: {
    id: MODEL_IDS.SONNET_5,
    label: "Claude Sonnet 5",
    base: { input: 2_000_000, output: 10_000_000, cacheRead: 200_000, cacheWrite5m: 2_500_000, cacheWrite1h: 4_000_000 },
    supportsEffort: true,
  },
  [MODEL_IDS.SONNET_4_6]: {
    id: MODEL_IDS.SONNET_4_6,
    label: "Claude Sonnet 4.6",
    base: { input: 3_000_000, output: 15_000_000, cacheRead: 300_000, cacheWrite5m: 3_750_000, cacheWrite1h: 6_000_000 },
    supportsEffort: true,
  },
  [MODEL_IDS.HAIKU_4_5]: {
    id: MODEL_IDS.HAIKU_4_5,
    label: "Claude Haiku 4.5",
    base: { input: 1_000_000, output: 5_000_000, cacheRead: 100_000, cacheWrite5m: 1_250_000, cacheWrite1h: 2_000_000 },
    // Haiku 4.5 rejects output_config.effort with a 400.
    supportsEffort: false,
  },
});

/** Strip a trailing -YYYYMMDD snapshot suffix so dated ids price like their alias. */
export function normalizeModelId(model: string): string {
  const trimmed = String(model ?? "").trim();
  const m = /^(.*)-\d{8}$/.exec(trimmed);
  return m ? m[1] : trimmed;
}

export function getModelSpec(model: string): ModelSpec | null {
  return MODEL_SPECS[normalizeModelId(model)] ?? null;
}

/** Anthropic `usage` object (the subset that bills). */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

export class UnknownModelPriceError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(`No price for model "${model}"`);
    this.name = "UnknownModelPriceError";
    this.model = model;
  }
}

/**
 * 'throw'   : the mentor. An unpriced model fails closed.
 * 'top_row' : legacy routes. Price at the most expensive row in the table and
 *             alert. Never zero and never a crash.
 */
export type UnknownModelPolicy = "throw" | "top_row";

export interface UnknownModelAlert {
  model: string;
  policy: UnknownModelPolicy;
  chargedMicro?: number;
}

export interface CostOptions {
  onUnknown?: UnknownModelPolicy;
  alert?: (info: UnknownModelAlert) => void;
}

function tok(n: number | null | undefined, field: string): number {
  if (n == null) return 0;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new TypeError(`Invalid token count for ${field}: ${String(n)}`);
  }
  return n;
}

interface SplitUsage {
  input: number;
  output: number;
  cacheRead: number;
  write5m: number;
  write1h: number;
  promptTokens: number;
}

function splitUsage(usage: TokenUsage): SplitUsage {
  if (!usage || typeof usage !== "object") throw new TypeError("usage is required");
  const input = tok(usage.input_tokens, "input_tokens");
  const output = tok(usage.output_tokens, "output_tokens");
  const cacheRead = tok(usage.cache_read_input_tokens, "cache_read_input_tokens");
  const created = tok(usage.cache_creation_input_tokens, "cache_creation_input_tokens");
  let write5m = created;
  let write1h = 0;
  if (usage.cache_creation && typeof usage.cache_creation === "object") {
    const b5 = tok(usage.cache_creation.ephemeral_5m_input_tokens, "ephemeral_5m_input_tokens");
    const b1 = tok(usage.cache_creation.ephemeral_1h_input_tokens, "ephemeral_1h_input_tokens");
    // Any part of the total the breakdown does not explain is priced at the
    // dearer 1h rate (conservative).
    const unexplained = Math.max(0, created - b5 - b1);
    write5m = b5;
    write1h = b1 + unexplained;
  }
  return { input, output, cacheRead, write5m, write1h, promptTokens: input + cacheRead + write5m + write1h };
}

function numerator(p: ModelPrice, u: SplitUsage): number {
  return (
    u.input * p.input +
    u.output * p.output +
    u.cacheRead * p.cacheRead +
    u.write5m * p.cacheWrite5m +
    u.write1h * p.cacheWrite1h
  );
}

function ceilMicro(numer: number): number {
  // numer is micro-USD x 1e6; every factor is an integer, so this is exact
  // well inside Number.MAX_SAFE_INTEGER for any request MedPruef can send.
  return Math.ceil(numer / 1_000_000);
}

/** Price row a request with these token counts is billed at. */
export function priceRowFor(spec: ModelSpec, promptTokens: number): ModelPrice {
  if (spec.longContext && promptTokens > spec.longContext.thresholdTokens) return spec.longContext.price;
  return spec.base;
}

/** Every price row in the table (base and long-context rows). */
export function allPriceRows(): ModelPrice[] {
  const rows: ModelPrice[] = [];
  for (const spec of Object.values(MODEL_SPECS)) {
    rows.push(spec.base);
    if (spec.longContext) rows.push(spec.longContext.price);
  }
  return rows;
}

/**
 * Integer micro-USD cost of one call, rounded up.
 * Unknown model: throws by default; with onUnknown 'top_row' it is charged the
 * maximum cost across every row of the table for this exact token mix (a true
 * upper bound for any listed model) and `alert` fires.
 */
export function costMicroUsd(model: string, usage: TokenUsage, opts: CostOptions = {}): number {
  const u = splitUsage(usage);
  const spec = getModelSpec(model);
  if (spec) return ceilMicro(numerator(priceRowFor(spec, u.promptTokens), u));

  const policy = opts.onUnknown ?? "throw";
  if (policy !== "top_row") {
    opts.alert?.({ model, policy });
    throw new UnknownModelPriceError(model);
  }
  let worst = 0;
  for (const row of allPriceRows()) worst = Math.max(worst, numerator(row, u));
  const charged = ceilMicro(worst);
  const alert = opts.alert ?? defaultAlert;
  alert({ model, policy, chargedMicro: charged });
  return charged;
}

function defaultAlert(info: UnknownModelAlert): void {
  console.error(`[ai-pricing] unknown model priced at top row: ${info.model} (${info.chargedMicro ?? "n/a"} micro-USD)`);
}

// ─── Input cap ──────────────────────────────────────────────────────────

/**
 * Hard cap on the UTF-8 byte size of everything sent (system, history, tool
 * definitions, tool results). A token always covers at least one byte, so
 * 90,000 bytes is at most 90,000 tokens; plus the 512-token framing margin
 * (which also covers the 286 to 406 token tool-use system prompt) it stays
 * below Haiku 5.5's 100K-token price step.
 */
export const MAX_INPUT_BYTES = 90_000;
export const RESERVE_FRAMING_TOKENS = 512;

/** UTF-8 byte length of the JSON of everything that is sent as input.
 * JSON escaping only adds bytes, so this over-counts (safe direction). */
export function measureInputBytes(input: { system?: unknown; messages?: unknown; tools?: unknown }): number {
  const json = JSON.stringify({ system: input.system ?? null, messages: input.messages ?? null, tools: input.tools ?? null });
  return new TextEncoder().encode(json).length;
}

interface TrimmableMessage {
  role: string;
  content: unknown;
}

function startsCleanUserTurn(m: TrimmableMessage | undefined): boolean {
  if (!m || m.role !== "user") return false;
  if (Array.isArray(m.content)) {
    return !m.content.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result");
  }
  return true;
}

/**
 * Drop the oldest history until the request fits MAX_INPUT_BYTES. The kept
 * history always starts on a plain user turn (never an orphaned tool_result).
 * Returns null when even the newest user turn alone does not fit; the caller
 * must then reject the input.
 */
export function trimHistoryToFit<M extends TrimmableMessage>(
  input: { system?: unknown; messages: M[]; tools?: unknown },
  maxBytes: number = MAX_INPUT_BYTES,
): { messages: M[]; dropped: number; bytes: number } | null {
  const { messages } = input;
  for (let start = 0; start < messages.length; start++) {
    const kept = messages.slice(start);
    if (!startsCleanUserTurn(kept[0])) continue;
    const bytes = measureInputBytes({ system: input.system, messages: kept, tools: input.tools });
    if (bytes <= maxBytes) return { messages: kept, dropped: start, bytes };
  }
  return null;
}

/**
 * Worst-case cost of one call before it is made, in integer micro-USD,
 * rounded up: (input bytes + 512 framing tokens) x the 5-minute cache-write
 * price (the dearest input rate of a 5-minute request) + maxTokens x the
 * output price. Thinking bills as output and is bounded by maxTokens.
 * A request with a 1-hour breakpoint passes `oneHourBytes` (the bytes of the
 * tools and system blocks up to that breakpoint, oneHourPrefixBytes): that
 * part plus the framing tokens is priced at the 1-hour write rate instead.
 * Without it the result is byte for byte the 5-minute ceiling.
 * Unknown models and over-cap inputs throw (the mentor fails closed).
 */
export function reserveCeilingMicro(model: string, inputBytes: number, maxTokens: number, opts: { oneHourBytes?: number } = {}): number {
  const spec = getModelSpec(model);
  if (!spec) throw new UnknownModelPriceError(model);
  if (!Number.isInteger(inputBytes) || inputBytes < 0) throw new TypeError(`Invalid inputBytes: ${inputBytes}`);
  if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new TypeError(`Invalid maxTokens: ${maxTokens}`);
  if (inputBytes > MAX_INPUT_BYTES) throw new RangeError(`inputBytes ${inputBytes} exceeds MAX_INPUT_BYTES ${MAX_INPUT_BYTES}`);
  const inputTokensBound = inputBytes + RESERVE_FRAMING_TOKENS;
  const row = priceRowFor(spec, inputTokensBound);
  const oneHour = opts.oneHourBytes ?? 0;
  if (!Number.isInteger(oneHour) || oneHour < 0) throw new TypeError(`Invalid oneHourBytes: ${oneHour}`);
  if (oneHour === 0) return ceilMicro(inputTokensBound * row.cacheWrite5m + maxTokens * row.output);
  // The 1-hour part (with the framing tokens, conservatively) at the 1-hour
  // rate, the rest at the 5-minute rate. Never above the all-1h bound.
  const hourTokens = Math.min(inputTokensBound, oneHour + RESERVE_FRAMING_TOKENS);
  return ceilMicro(hourTokens * row.cacheWrite1h + (inputTokensBound - hourTokens) * row.cacheWrite5m + maxTokens * row.output);
}

/**
 * UTF-8 bytes of the cached prefix up to the last 1-hour breakpoint (tools,
 * then system blocks through the last block marked ttl "1h"). 0 when the
 * request has no 1-hour breakpoint in tools or system. Over-counts like
 * measureInputBytes (safe direction for the reserve).
 */
export function oneHourPrefixBytes(input: { system?: Array<{ cache_control?: { ttl?: string } }>; tools?: Array<{ cache_control?: { ttl?: string } }> }): number {
  const tools = input.tools ?? [];
  const system = input.system ?? [];
  let lastSys = -1;
  system.forEach((b, i) => {
    if (b?.cache_control?.ttl === "1h") lastSys = i;
  });
  const toolHour = tools.some((t) => t?.cache_control?.ttl === "1h");
  if (lastSys < 0 && !toolHour) return 0;
  return measureInputBytes({ system: lastSys >= 0 ? system.slice(0, lastSys + 1) : [], messages: [], tools });
}
