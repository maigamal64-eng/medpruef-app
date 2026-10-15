/**
 * Shared Anthropic Messages wrapper (contract C1, frozen in wave 0).
 *
 * Mandatory for the mentor, /api/ai-chat, /api/translate, /api/notes/transform
 * and src/lib/notes-safety.ts. Design rules, each one guarded by a test in
 * tests/unit/ai/anthropic.test.ts:
 *
 *  - Plain fetch, exactly one HTTP request per call. No hidden retries: a
 *    retry is a NEW callClaude() with its own reserve or cost row.
 *  - Reply text = the first content block whose type is "text". Never
 *    content[0]: Sonnet 5.x and Haiku 5.5 think by default, so content[0] is
 *    usually a thinking block (the 29 Aug 2026 ai-chat outage).
 *  - Never sends temperature, top_p, top_k, a thinking budget or an assistant
 *    prefill. Depth is set with output_config.effort only on models that
 *    accept it (Haiku 4.5 rejects effort with a 400).
 *  - Prompt caching: 5-minute TTL by default. A 1-hour breakpoint must be
 *    asked for explicitly ({type:"ephemeral", ttl:"1h"}), only on tools or
 *    system blocks, and must come before every 5-minute breakpoint; any other ttl
 *    value, or more than 4 breakpoints, is rejected before sending. A response
 *    that reports 1-hour cache writes for a request that asked for none raises
 *    AiCacheTtlViolation (with usage attached, so it is billed). Reserve
 *    ceilings price input at the 1-hour write rate when a request carries a
 *    1-hour breakpoint (oneHourPrefixBytes + reserveCeilingMicro).
 *  - Structured outputs: an optional JSON schema goes to
 *    output_config.format; callers keep their own parse and fallback.
 *  - Input above MAX_INPUT_BYTES is rejected before sending (callers trim
 *    history first with trimHistoryToFit from ./pricing).
 *  - Every error raised after the model was reached carries `usage` (when
 *    known) and `request_id`, so the ledger can bill it.
 *  - onMessageStart exposes input and cache token counts as soon as they are
 *    known (message_start when streaming, the full response otherwise), so the
 *    mentor can settle input early.
 */

import { MAX_INPUT_BYTES, getModelSpec, measureInputBytes, type TokenUsage } from "./pricing";
import { OAUTH_REQUEST_BETA, getAnthropicAuth, type AnthropicAuth } from "./credentials";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_TOKENS_CAP = 32_000;

// ─── Request types ──────────────────────────────────────────────────────

export type Effort = "low" | "medium" | "high";

/**
 * Ephemeral cache marker. No ttl = 5 minutes. `ttl: "1h"` is the only other
 * accepted value; an explicit "5m" or anything else is rejected at runtime.
 */
export interface CacheControl {
  type: "ephemeral";
  ttl?: "1h";
}

/** JSON schema for structured outputs (output_config.format). */
export interface JsonOutputFormat {
  type: "json_schema";
  schema: Record<string, unknown>;
}

export interface TextBlockParam {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

export interface ToolUseBlockParam {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: CacheControl;
}

export interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content: string | TextBlockParam[];
  is_error?: boolean;
  cache_control?: CacheControl;
}

/** Assistant thinking blocks echoed back unchanged within a tool loop. */
export interface ThinkingBlockParam {
  type: "thinking";
  thinking: string;
  signature: string;
}

export type ContentBlockParam = TextBlockParam | ToolUseBlockParam | ToolResultBlockParam | ThinkingBlockParam;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
  cache_control?: CacheControl;
}

/** Forced tool choice (any / tool) is a 400 on Sonnet 5.5, so only these. */
export type ToolChoice = { type: "auto"; disable_parallel_tool_use?: boolean } | { type: "none" };

export interface MessageStartInfo {
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  model: string;
  request_id: string | null;
}

export interface CallClaudeParams {
  model: string;
  effort: Effort;
  /** Stable prefix first; put cache_control on the last stable block. */
  system: TextBlockParam[];
  messages: MessageParam[];
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  max_tokens: number;
  /** Structured outputs: the reply's first text block is JSON matching this schema. */
  output_format?: JsonOutputFormat;
  stream?: boolean;
  onMessageStart?: (info: MessageStartInfo) => void;
  /** Streaming only: each text delta, in order. */
  onTextDelta?: (text: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Static key override (tests). Ignored when `auth` is given. */
  apiKey?: string;
  /**
   * Explicit credentials. Default: getAnthropicAuth() from ./credentials,
   * which follows ANTHROPIC_AUTH_MODE (api_key = ANTHROPIC_API_KEY as before).
   */
  auth?: AnthropicAuth;
  /** Injection point for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

// ─── Response types ─────────────────────────────────────────────────────

export interface ClaudeUsage extends TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
}

export interface TextBlock {
  type: "text";
  text: string;
  [k: string]: unknown;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
  [k: string]: unknown;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  [k: string]: unknown;
}
export interface OtherBlock {
  type: string;
  [k: string]: unknown;
}
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | OtherBlock;

export interface CallClaudeResult {
  /** First block with type "text". Empty string only when toolUses is non-empty. */
  text: string;
  blocks: ContentBlock[];
  toolUses: ToolUseBlock[];
  usage: ClaudeUsage;
  stop_reason: string | null;
  model: string;
  request_id: string | null;
}

// ─── Typed errors ───────────────────────────────────────────────────────

export interface AiErrorDetails {
  reachedModel: boolean;
  usage?: ClaudeUsage | null;
  request_id?: string | null;
  status?: number | null;
  code?: string;
  cause?: unknown;
}

export class AiError extends Error {
  /** true when the model may have run (bill it); false only when it provably did not. */
  readonly reachedModel: boolean;
  readonly usage: ClaudeUsage | null;
  readonly request_id: string | null;
  readonly status: number | null;
  readonly code: string;
  constructor(message: string, d: AiErrorDetails) {
    super(message);
    this.name = "AiError";
    this.reachedModel = d.reachedModel;
    this.usage = d.usage ?? null;
    this.request_id = d.request_id ?? null;
    this.status = d.status ?? null;
    this.code = d.code ?? "ai_error";
    if (d.cause !== undefined) (this as { cause?: unknown }).cause = d.cause;
  }
}

/** Our timer fired. The model may have started, so reachedModel is true. */
export class AiTimeout extends AiError {
  constructor(message: string, d: Omit<AiErrorDetails, "reachedModel">) {
    super(message, { ...d, reachedModel: true, code: d.code ?? "timeout" });
    this.name = "AiTimeout";
  }
}

/** The model answered but produced no text block and no tool call. Billed. */
export class AiEmptyText extends AiError {
  readonly stop_reason: string | null;
  readonly blocks: ContentBlock[];
  constructor(message: string, d: Omit<AiErrorDetails, "reachedModel"> & { stop_reason: string | null; blocks: ContentBlock[] }) {
    super(message, { ...d, reachedModel: true, code: d.code ?? "empty_text" });
    this.name = "AiEmptyText";
    this.stop_reason = d.stop_reason;
    this.blocks = d.blocks;
  }
}

/** Upstream or transport failure. reachedModel false only for pre-generation rejections. */
export class AiUpstream extends AiError {
  constructor(message: string, d: AiErrorDetails) {
    super(message, { ...d, code: d.code ?? "upstream_error" });
    this.name = "AiUpstream";
  }
}

/** Rejected by this wrapper before any request was sent. Never billed. */
export class AiInputRejected extends AiError {
  constructor(message: string, code: string) {
    super(message, { reachedModel: false, code });
    this.name = "AiInputRejected";
  }
}

/** The response reported 1-hour cache writes. Carries usage so it is billed. */
export class AiCacheTtlViolation extends AiError {
  constructor(message: string, d: Omit<AiErrorDetails, "reachedModel">) {
    super(message, { ...d, reachedModel: true, code: "cache_ttl_violation" });
    this.name = "AiCacheTtlViolation";
  }
}

/** Refusal details as the API reports them (open set; read defensively). */
export interface StopDetails {
  type?: string;
  category?: string | null;
  explanation?: string | null;
  [k: string]: unknown;
}

/**
 * stop_reason "refusal": a safety classifier declined (HTTP 200). A mid-output
 * decline keeps a partial text block, so this is NEVER returned as success.
 * Billed (reachedModel true). Haiku 5.5 has no server-side fallback.
 */
export class AiRefusal extends AiError {
  readonly stop_details: StopDetails | null;
  readonly blocks: ContentBlock[];
  /** Partial text emitted before the decline (may be ""). Do not show it as an answer. */
  readonly partialText: string;
  constructor(message: string, d: Omit<AiErrorDetails, "reachedModel"> & { stop_details: StopDetails | null; blocks: ContentBlock[]; partialText: string }) {
    super(message, { ...d, reachedModel: true, code: "refusal" });
    this.name = "AiRefusal";
    this.stop_details = d.stop_details;
    this.blocks = d.blocks;
    this.partialText = d.partialText;
  }
}

function readStopDetails(x: unknown): StopDetails | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as StopDetails) : null;
}

// ─── Validation ─────────────────────────────────────────────────────────

const EFFORTS: ReadonlySet<string> = new Set(["low", "medium", "high"]);
const FORBIDDEN_TOP_LEVEL = ["temperature", "top_p", "top_k", "thinking", "prefill"] as const;

function checkCacheControl(cc: unknown, where: string): void {
  if (cc === undefined) return;
  if (!cc || typeof cc !== "object") throw new AiInputRejected(`Invalid cache_control at ${where}`, "bad_cache_control");
  const keys = Object.keys(cc as object);
  const ttl = (cc as { ttl?: unknown }).ttl;
  if ((cc as { type?: unknown }).type !== "ephemeral" || keys.some((k) => k !== "type" && k !== "ttl") || (keys.includes("ttl") && ttl !== "1h")) {
    // {type:"ephemeral"} is the 5-minute default; {type:"ephemeral", ttl:"1h"}
    // is the only opt-in. An explicit "5m" or any other value is refused, so a
    // 1h write can never be requested by a typo.
    throw new AiInputRejected(`Only 5-minute or explicit 1-hour cache_control is allowed (${where})`, "cache_ttl_not_allowed");
  }
}

/** Every cache_control marker in render order (tools -> system -> messages). */
export function cacheMarkersInOrder(p: Pick<CallClaudeParams, "tools" | "system" | "messages">): CacheControl[] {
  const out: CacheControl[] = [];
  const push = (cc: unknown) => {
    if (cc && typeof cc === "object") out.push(cc as CacheControl);
  };
  for (const t of p.tools ?? []) push(t?.cache_control);
  for (const b of p.system ?? []) push(b?.cache_control);
  for (const m of p.messages ?? []) {
    if (!m || typeof m.content === "string" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      push((b as { cache_control?: unknown })?.cache_control);
      const inner = (b as ToolResultBlockParam)?.type === "tool_result" ? (b as ToolResultBlockParam).content : null;
      if (Array.isArray(inner)) for (const ib of inner) push(ib?.cache_control);
    }
  }
  return out;
}

/** "1h" when the request carries any 1-hour breakpoint, else "5m". */
export function requestCacheTtl(p: Pick<CallClaudeParams, "tools" | "system" | "messages">): "5m" | "1h" {
  return cacheMarkersInOrder(p).some((c) => c.ttl === "1h") ? "1h" : "5m";
}

export const MAX_CACHE_BREAKPOINTS = 4;

function checkBlock(b: unknown, where: string): void {
  if (!b || typeof b !== "object") throw new AiInputRejected(`Invalid content block at ${where}`, "bad_block");
  const t = (b as { type?: unknown }).type;
  switch (t) {
    case "text":
      if (typeof (b as TextBlockParam).text !== "string") throw new AiInputRejected(`Text block without text at ${where}`, "bad_block");
      break;
    case "tool_use":
    case "thinking":
      break;
    case "tool_result": {
      const c = (b as ToolResultBlockParam).content;
      if (Array.isArray(c)) {
        c.forEach((inner, i) => {
          if (!inner || (inner as { type?: unknown }).type !== "text") {
            // Images or documents in tool results cannot be bounded by bytes.
            throw new AiInputRejected(`Only text inside tool_result (${where}.content[${i}])`, "non_text_block");
          }
          checkCacheControl((inner as TextBlockParam).cache_control, `${where}.content[${i}]`);
        });
      } else if (typeof c !== "string") {
        throw new AiInputRejected(`Invalid tool_result content at ${where}`, "bad_block");
      }
      break;
    }
    default:
      // image, document, etc.: the byte cap cannot bound their token cost.
      throw new AiInputRejected(`Unsupported content block type "${String(t)}" at ${where}`, "non_text_block");
  }
  checkCacheControl((b as { cache_control?: unknown }).cache_control, where);
}

/** Throws AiInputRejected for any request this wrapper must never send. */
export function validateCallParams(p: CallClaudeParams): void {
  if (!p || typeof p !== "object") throw new AiInputRejected("params required", "bad_params");
  for (const k of FORBIDDEN_TOP_LEVEL) {
    if ((p as unknown as Record<string, unknown>)[k] !== undefined) {
      throw new AiInputRejected(`Parameter "${k}" is not allowed`, "forbidden_param");
    }
  }
  if (typeof p.model !== "string" || p.model.trim() === "") throw new AiInputRejected("model required", "bad_params");
  if (!EFFORTS.has(p.effort)) throw new AiInputRejected(`Invalid effort "${String(p.effort)}"`, "bad_params");
  if (!Number.isInteger(p.max_tokens) || p.max_tokens < 1 || p.max_tokens > MAX_OUTPUT_TOKENS_CAP) {
    throw new AiInputRejected(`max_tokens must be an integer in 1..${MAX_OUTPUT_TOKENS_CAP}`, "bad_params");
  }
  if (!Array.isArray(p.system)) throw new AiInputRejected("system must be an array of text blocks", "bad_params");
  p.system.forEach((b, i) => {
    if (!b || b.type !== "text" || typeof b.text !== "string") throw new AiInputRejected(`system[${i}] must be a text block`, "bad_params");
    checkCacheControl(b.cache_control, `system[${i}]`);
  });
  if (!Array.isArray(p.messages) || p.messages.length === 0) throw new AiInputRejected("messages required", "bad_params");
  if (p.messages[0].role !== "user") throw new AiInputRejected("first message must be from the user", "bad_params");
  if (p.messages[p.messages.length - 1].role !== "user") {
    // Assistant prefill is a 400 on Sonnet 5.x / Haiku 5.5, and not our pattern.
    throw new AiInputRejected("last message must be from the user (no prefill)", "prefill_not_allowed");
  }
  p.messages.forEach((m, i) => {
    if (m.role !== "user" && m.role !== "assistant") throw new AiInputRejected(`messages[${i}].role invalid`, "bad_params");
    if (typeof m.content === "string") return;
    if (!Array.isArray(m.content) || m.content.length === 0) throw new AiInputRejected(`messages[${i}].content invalid`, "bad_params");
    m.content.forEach((b, j) => checkBlock(b, `messages[${i}].content[${j}]`));
  });
  if (p.tools !== undefined) {
    if (!Array.isArray(p.tools)) throw new AiInputRejected("tools must be an array", "bad_params");
    p.tools.forEach((t, i) => {
      if (!t || typeof t.name !== "string" || typeof t.input_schema !== "object") throw new AiInputRejected(`tools[${i}] invalid`, "bad_params");
      checkCacheControl(t.cache_control, `tools[${i}]`);
    });
  }
  if (p.tool_choice !== undefined && p.tool_choice.type !== "auto" && p.tool_choice.type !== "none") {
    throw new AiInputRejected("tool_choice must be auto or none", "forced_tool_choice");
  }
  const markers = cacheMarkersInOrder(p);
  if (markers.length > MAX_CACHE_BREAKPOINTS) {
    throw new AiInputRejected(`At most ${MAX_CACHE_BREAKPOINTS} cache breakpoints are allowed (got ${markers.length})`, "too_many_cache_breakpoints");
  }
  // 1h markers stay in the tools/system prefix, so the reserve can price them
  // (oneHourPrefixBytes); the API also requires longer TTLs first.
  const messageMarkers = cacheMarkersInOrder({ messages: p.messages, system: [], tools: [] });
  if (messageMarkers.some((m) => m.ttl === "1h")) {
    throw new AiInputRejected("A 1-hour cache breakpoint is allowed only on tools or system blocks", "cache_ttl_not_allowed");
  }
  let seen5m = false;
  for (const m of markers) {
    if (m.ttl === "1h" && seen5m) throw new AiInputRejected("A 1-hour cache breakpoint must come before every 5-minute one", "cache_ttl_order");
    if (m.ttl !== "1h") seen5m = true;
  }
  if (p.output_format !== undefined) {
    const f = p.output_format as { type?: unknown; schema?: unknown };
    if (!f || f.type !== "json_schema" || !f.schema || typeof f.schema !== "object" || Array.isArray(f.schema)) {
      throw new AiInputRejected("output_format must be {type:'json_schema', schema:{...}}", "bad_params");
    }
  }
  const bytes = measureInputBytes({ system: p.system, messages: p.messages, tools: p.tools });
  if (bytes > MAX_INPUT_BYTES) {
    throw new AiInputRejected(`input is ${bytes} bytes, over the ${MAX_INPUT_BYTES}-byte cap`, "input_too_large");
  }
}

/** The exact JSON body sent. Built from an allowlist, so nothing else can leak in. */
export function buildRequestBody(p: CallClaudeParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.max_tokens,
    system: p.system,
    messages: p.messages,
  };
  if (p.tools && p.tools.length > 0) body.tools = p.tools;
  if (p.tool_choice) body.tool_choice = p.tool_choice;
  // Effort only where the API accepts it. Unknown models get no effort field
  // (safer to run at the model default than to 400).
  const outputConfig: Record<string, unknown> = {};
  if (getModelSpec(p.model)?.supportsEffort) outputConfig.effort = p.effort;
  if (p.output_format) outputConfig.format = { type: "json_schema", schema: p.output_format.schema };
  if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;
  if (p.stream) body.stream = true;
  return body;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function n(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;
}

/** Normalise a raw usage object; missing fields become 0. */
export function normalizeUsage(raw: unknown, prev?: ClaudeUsage): ClaudeUsage {
  const u = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const has = (k: string) => typeof u[k] === "number";
  const cc = u.cache_creation as Record<string, unknown> | null | undefined;
  return {
    input_tokens: has("input_tokens") ? n(u.input_tokens) : prev?.input_tokens ?? 0,
    output_tokens: has("output_tokens") ? n(u.output_tokens) : prev?.output_tokens ?? 0,
    cache_read_input_tokens: has("cache_read_input_tokens") ? n(u.cache_read_input_tokens) : prev?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: has("cache_creation_input_tokens")
      ? n(u.cache_creation_input_tokens)
      : prev?.cache_creation_input_tokens ?? 0,
    cache_creation:
      cc && typeof cc === "object"
        ? { ephemeral_5m_input_tokens: n(cc.ephemeral_5m_input_tokens), ephemeral_1h_input_tokens: n(cc.ephemeral_1h_input_tokens) }
        : prev?.cache_creation ?? null,
  };
}

/** First block with type "text". Never content[0]. */
export function firstTextBlock(blocks: ContentBlock[]): TextBlock | null {
  for (const b of blocks) if (b && b.type === "text" && typeof (b as TextBlock).text === "string") return b as TextBlock;
  return null;
}

function toolUsesOf(blocks: ContentBlock[]): ToolUseBlock[] {
  return blocks.filter((b): b is ToolUseBlock => !!b && b.type === "tool_use");
}

// Connection-phase failures provably never reached the model.
const CONNECT_PHASE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_DNS",
  "CERT_HAS_EXPIRED",
]);

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = e?.code ?? e?.cause?.code;
  return typeof c === "string" ? c : undefined;
}

/** HTTP statuses where Anthropic rejected the request before generation. */
export function statusReachedModel(status: number): boolean {
  if (status >= 400 && status < 500) return false; // 400/401/403/404/413/429...
  if (status === 529) return false; // overloaded: not admitted
  return true; // other 5xx: we cannot prove it did not run (bill conservatively)
}

function finish(
  blocks: ContentBlock[],
  usage: ClaudeUsage,
  stop_reason: string | null,
  model: string,
  request_id: string | null,
  stop_details: StopDetails | null = null,
  oneHourRequested = false,
): CallClaudeResult {
  if (!oneHourRequested && usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens > 0) {
    throw new AiCacheTtlViolation(
      `Response reported ${usage.cache_creation.ephemeral_1h_input_tokens} one-hour cache write tokens`,
      { usage, request_id },
    );
  }
  const text = firstTextBlock(blocks);
  const toolUses = toolUsesOf(blocks);
  if (stop_reason === "refusal") {
    throw new AiRefusal(`Model declined (category ${String(stop_details?.category ?? "unknown")})`, {
      usage,
      request_id,
      stop_details,
      blocks,
      partialText: text?.text ?? "",
    });
  }
  if ((!text || text.text.length === 0) && toolUses.length === 0) {
    throw new AiEmptyText(`No text block in response (stop_reason ${String(stop_reason)})`, {
      usage,
      request_id,
      stop_reason,
      blocks,
    });
  }
  return { text: text?.text ?? "", blocks, toolUses, usage, stop_reason, model, request_id };
}

export function authHeaders(auth: AnthropicAuth): Record<string, string> {
  if (auth.kind === "bearer") {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${auth.value}`,
      "anthropic-beta": OAUTH_REQUEST_BETA,
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }
  return {
    "content-type": "application/json",
    "x-api-key": auth.value,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

// ─── Main entry ─────────────────────────────────────────────────────────

/**
 * One Anthropic Messages call. Exactly one HTTP request, never retried.
 * Throws AiInputRejected, AiTimeout, AiEmptyText, AiRefusal, AiUpstream or
 * AiCacheTtlViolation (all extend AiError).
 */
export async function callClaude(params: CallClaudeParams): Promise<CallClaudeResult> {
  validateCallParams(params);
  // getAnthropicAuth, so this call still makes exactly one Messages request.
  let auth: AnthropicAuth;
  if (params.auth) auth = params.auth;
  else if (params.apiKey !== undefined) {
    if (!params.apiKey) throw new AiUpstream("ANTHROPIC_API_KEY is not set", { reachedModel: false, code: "no_api_key" });
    auth = { kind: "api_key", value: params.apiKey };
  } else auth = await getAnthropicAuth();
  const doFetch = params.fetchImpl ?? fetch;
  const body = buildRequestBody(params);
  const oneHourRequested = requestCacheTtl(params) === "1h";

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) controller.abort();
    else params.signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  let request_id: string | null = null;
  let partialUsage: ClaudeUsage | null = null;

  const abortError = (cause: unknown): AiError =>
    timedOut
      ? new AiTimeout(`Anthropic call timed out after ${params.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`, {
          usage: partialUsage,
          request_id,
          cause,
        })
      : new AiUpstream("Anthropic call aborted by caller", { reachedModel: true, usage: partialUsage, request_id, code: "aborted", cause });

  try {
    let res: Response;
    try {
      res = await doFetch(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: authHeaders(auth),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw abortError(err);
      const code = errorCode(err);
      throw new AiUpstream(`Network error calling Anthropic${code ? ` (${code})` : ""}`, {
        reachedModel: !(code && CONNECT_PHASE_CODES.has(code)),
        code: "network_error",
        cause: err,
      });
    }

    request_id = res.headers.get("request-id");

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        /* ignore */
      }
      throw new AiUpstream(`Anthropic HTTP ${res.status}${detail ? `: ${detail}` : ""}`, {
        reachedModel: statusReachedModel(res.status),
        status: res.status,
        request_id,
        code: `http_${res.status}`,
      });
    }

    if (!params.stream) {
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch (err) {
        if (controller.signal.aborted) throw abortError(err);
        throw new AiUpstream("Unreadable Anthropic response body", { reachedModel: true, request_id, code: "bad_body", cause: err });
      }
      const usage = normalizeUsage(data.usage);
      partialUsage = usage;
      const model = typeof data.model === "string" ? data.model : params.model;
      params.onMessageStart?.({
        input_tokens: usage.input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        model,
        request_id,
      });
      const blocks = Array.isArray(data.content) ? (data.content as ContentBlock[]) : [];
      return finish(
        blocks,
        usage,
        typeof data.stop_reason === "string" ? data.stop_reason : null,
        model,
        request_id,
        readStopDetails(data.stop_details),
        oneHourRequested,
      );
    }

    // ── Streaming ──
    if (!res.body) throw new AiUpstream("Streaming response has no body", { reachedModel: true, request_id, code: "no_body" });
    const state: StreamState = {
      blocks: [],
      partialJson: new Map(),
      usage: null,
      stop_reason: null,
      stop_details: null,
      model: params.model,
      sawStop: false,
    };
    try {
      for await (const ev of readSse(res.body)) {
        applyStreamEvent(ev, state, params, request_id);
        partialUsage = state.usage;
        if (state.sawStop) break;
      }
    } catch (err) {
      if (err instanceof AiError) throw err;
      if (controller.signal.aborted) throw abortError(err);
      throw new AiUpstream("Stream read failed", { reachedModel: true, usage: state.usage, request_id, code: "stream_error", cause: err });
    }
    if (!state.sawStop || !state.usage) {
      throw new AiUpstream("Stream ended before message_stop", {
        reachedModel: true,
        usage: state.usage,
        request_id,
        code: "stream_incomplete",
      });
    }
    return finish(state.blocks, state.usage, state.stop_reason, state.model, request_id, state.stop_details, oneHourRequested);
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onOuterAbort);
  }
}

// ─── SSE parsing ────────────────────────────────────────────────────────

export interface SseEvent {
  event: string | null;
  data: string;
}

/** Minimal text/event-stream reader (events separated by a blank line). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let heldCR = false; // a chunk ending in "\r" may be the first half of "\r\n"
  const append = (chunk: string) => {
    let c = (heldCR ? "\r" : "") + chunk;
    heldCR = c.endsWith("\r");
    if (heldCR) c = c.slice(0, -1);
    buf += c.replace(/\r\n?/g, "\n");
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      append(decoder.decode(value, { stream: true }));
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const ev = parseSseChunk(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (ev) yield ev;
      }
    }
    append(decoder.decode());
    if (heldCR) buf += "\n";
    const tail = parseSseChunk(buf);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseSseChunk(raw: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (event === null && data.length === 0) return null;
  return { event, data: data.join("\n") };
}

interface StreamState {
  blocks: ContentBlock[];
  partialJson: Map<number, string>;
  usage: ClaudeUsage | null;
  stop_reason: string | null;
  stop_details: StopDetails | null;
  model: string;
  sawStop: boolean;
}

function applyStreamEvent(ev: SseEvent, s: StreamState, p: CallClaudeParams, request_id: string | null): void {
  if (!ev.data) return;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(ev.data) as Record<string, unknown>;
  } catch {
    throw new AiUpstream("Malformed stream event", { reachedModel: true, usage: s.usage, request_id, code: "stream_bad_event" });
  }
  const type = (d.type as string) ?? ev.event;
  switch (type) {
    case "message_start": {
      const msg = (d.message ?? {}) as Record<string, unknown>;
      if (typeof msg.model === "string") s.model = msg.model;
      s.usage = normalizeUsage(msg.usage);
      p.onMessageStart?.({
        input_tokens: s.usage.input_tokens,
        cache_read_input_tokens: s.usage.cache_read_input_tokens,
        cache_creation_input_tokens: s.usage.cache_creation_input_tokens,
        model: s.model,
        request_id,
      });
      return;
    }
    case "content_block_start": {
      const i = Number(d.index);
      const cb = { ...((d.content_block ?? {}) as ContentBlock) };
      if (cb.type === "text" && typeof cb.text !== "string") (cb as TextBlock).text = "";
      if (cb.type === "thinking" && typeof cb.thinking !== "string") (cb as ThinkingBlock).thinking = "";
      s.blocks[i] = cb;
      return;
    }
    case "content_block_delta": {
      const i = Number(d.index);
      const delta = (d.delta ?? {}) as Record<string, unknown>;
      const cb = s.blocks[i];
      if (!cb) return;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        (cb as TextBlock).text = String((cb as TextBlock).text ?? "") + delta.text;
        p.onTextDelta?.(delta.text);
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        (cb as ThinkingBlock).thinking = String((cb as ThinkingBlock).thinking ?? "") + delta.thinking;
      } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
        (cb as ThinkingBlock).signature = delta.signature;
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        s.partialJson.set(i, (s.partialJson.get(i) ?? "") + delta.partial_json);
      }
      return;
    }
    case "content_block_stop": {
      const i = Number(d.index);
      const cb = s.blocks[i];
      if (cb && cb.type === "tool_use" && s.partialJson.has(i)) {
        const raw = s.partialJson.get(i) ?? "";
        try {
          (cb as ToolUseBlock).input = raw.trim() === "" ? {} : JSON.parse(raw);
        } catch {
          throw new AiUpstream("Tool input JSON did not parse", { reachedModel: true, usage: s.usage, request_id, code: "tool_input_invalid" });
        }
      }
      return;
    }
    case "message_delta": {
      const delta = (d.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.stop_reason === "string") s.stop_reason = delta.stop_reason;
      const sd = readStopDetails(delta.stop_details) ?? readStopDetails(d.stop_details);
      if (sd) s.stop_details = sd;
      // message_delta usage is cumulative: take what it states, keep the rest.
      s.usage = normalizeUsage(d.usage, s.usage ?? undefined);
      return;
    }
    case "message_stop":
      s.sawStop = true;
      return;
    case "ping":
      return;
    case "error": {
      const e = (d.error ?? {}) as Record<string, unknown>;
      throw new AiUpstream(`Anthropic stream error: ${String(e.type ?? "unknown")} ${String(e.message ?? "")}`.trim(), {
        reachedModel: true,
        usage: s.usage,
        request_id,
        code: `stream_${String(e.type ?? "error")}`,
      });
    }
    default:
      return; // unknown event types are ignored, per the API versioning policy
  }
}
