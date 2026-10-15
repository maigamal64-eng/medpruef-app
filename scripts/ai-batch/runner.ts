/**
 * Message Batches runner (a-anthropic-features, 2026-10-14).
 *
 * Offline and bulk generation (explanations, translations, content checks)
 * runs through the Anthropic Message Batches API at half the standard token
 * price. Scripts only, never a web route: the runner writes files in a state
 * directory and never touches the database. Callers turn the collected
 * results into staging files and guarded SQL (the a05/a29 rules still hold:
 * key_revision guards and cache_question_translation_if_current).
 *
 *   submit   items (custom_id + request params) -> one or more batches.
 *            Idempotent per item: an item that already has a succeeded result,
 *            or sits in a batch that has not been collected, is skipped.
 *            Stops before the worst case of the next item could pass --max-usd
 *            (the worst case is reserveCeilingMicro at half price).
 *   poll     refreshes every open batch's processing_status.
 *   collect  downloads results of ended batches once, appends one line per
 *            item to results.jsonl and the real cost to spend.jsonl.
 *            errored / expired / canceled items can be submitted again.
 *
 * Requests go through validateCallParams + buildRequestBody of the shared
 * wrapper, so the no-sampling, no-prefill and cache rules are identical to
 * the live routes. Credentials are keyless only (a-content-c1 review, [name]
 * 14 Oct: no static key may be used for a model call): defaultIo() resolves a
 * bearer token through scripts/content/lib/keyless-auth.ts (ANTHROPIC_AUTH_MODE
 * Credentials go only to https://api.anthropic.com and never follow a redirect.
 * submit, poll and collect hold an exclusive lock on the state directory, so
 * two runs on one directory cannot double-submit.
 */
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, appendFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  authHeaders,
  buildRequestBody,
  firstTextBlock,
  normalizeUsage,
  validateCallParams,
  type CallClaudeParams,
  type ClaudeUsage,
  type ContentBlock,
} from "@/lib/ai/anthropic";
import type { AnthropicAuth } from "@/lib/ai/credentials";
import { costMicroUsd, getModelSpec, measureInputBytes, RESERVE_FRAMING_TOKENS, reserveCeilingMicro, type ModelSpec } from "@/lib/ai/pricing";
import { isScriptOnlyModel, scriptModelSpec } from "./prices";
import { keylessAuth } from "../content/lib/keyless-auth";

export const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
/** API limit is 100,000 requests or 256 MB per batch; stay well under both. */
export const MAX_ITEMS_PER_BATCH = 5_000;
export const MAX_BATCH_BYTES = 128 * 1024 * 1024;
const CUSTOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
/** A failed item (errored, refused, empty, expired) is sent at most this often. */
export const MAX_ATTEMPTS_PER_ITEM = 3;
const API_TIMEOUT_MS = 60_000;
/** Results files can be large; their download gets a longer deadline. */
const RESULTS_TIMEOUT_MS = 600_000;

/** HTTP error from the Batches API (status kept so a clear 4xx can be told apart from a lost answer). */
export class BatchApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BatchApiError";
    this.status = status;
  }
}
const API_HOST = "api.anthropic.com";

/** Raised before any byte left the process (bad destination, no credential): a submit intent can be dropped. */
export class NotSentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NotSentError";
  }
}

/** JSON schema for structured outputs (sent as output_config.format). */
export interface JsonOutputFormat {
  type: "json_schema";
  schema: Record<string, unknown>;
}

/**
 * Request params for one item: the wrapper's params minus transport fields,
 * plus an optional structured-output schema. (a-content-c1 fork of the
 * a-anthropic-features runner: main's wrapper has no output_format yet, so
 * the runner adds output_config.format itself; same field name, so the two
 * copies dedupe when both branches land.)
 */
export type BatchParams = Pick<CallClaudeParams, "model" | "effort" | "system" | "messages" | "max_tokens" | "tools" | "tool_choice"> & {
  output_format?: JsonOutputFormat;
};

export interface BatchItem {
  custom_id: string;
  params: BatchParams;
}

export interface BatchRecord {
  /**
   * null = intent: written before the create call, filled after it. A record
   * without an id blocks its items (a lost response must not double-spend)
   * until poll adopts the matching batch from the API listing.
   */
  id: string | null;
  custom_ids: string[];
  submitted_at: string;
  processing_status: string;
  results_url: string | null;
  collected_at: string | null;
  /** Worst case of the whole batch at batch price, booked against the cap until it is collected. */
  worst_micro?: number;
}

export interface RunnerState {
  batches: BatchRecord[];
}

export interface ResultLine {
  custom_id: string;
  batch_id: string;
  type: "succeeded" | "errored" | "canceled" | "expired";
  text: string | null;
  stop_reason: string | null;
  model: string | null;
  usage: ClaudeUsage | null;
  cost_micro: number;
  error: string | null;
  collected_at: string;
}

export interface RunnerIo {
  fetch: typeof fetch;
  auth: () => Promise<AnthropicAuth>;
  now: () => Date;
}

/** Keyless by default: no caller of the runner can reach a static API key. */
export function defaultIo(): RunnerIo {
  return { fetch: globalThis.fetch.bind(globalThis), auth: async () => keylessAuth()(), now: () => new Date() };
}

/**
 * Exclusive lock on a state directory (a lock file holding the pid, created by link). A
 * lock whose process is gone is taken over; a live one makes the run stop.
 */
export async function withStateLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, ".runner.lock");
  // The pid is written to a private file first and linked into place, so the
  // lock never exists without its pid (a reader can never see it empty).
  const mine = path.join(dir, `.runner.lock.${process.pid}.${Date.now()}`);
  writeFileSync(mine, String(process.pid));
  let held = false;
  try {
    for (let attempt = 0; attempt < 2 && !held; attempt++) {
      try {
        linkSync(mine, lock);
        held = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        let pid = NaN;
        try {
          pid = Number(readFileSync(lock, "utf8").trim());
        } catch {
          /* removed meanwhile: retry */
        }
        let alive = false;
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            alive = true;
          } catch (e) {
            alive = (e as NodeJS.ErrnoException).code === "EPERM";
          }
        }
        if (alive) throw new Error(`another run (pid ${pid}) holds ${lock}; wait for it to finish. Nothing was sent.`);
        if (Number.isSafeInteger(pid) && pid > 0) unlinkSync(lock);
      }
    }
  } finally {
    unlinkSync(mine);
  }
  if (!held) throw new Error(`could not take ${lock}. Nothing was sent.`);
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

// ─── Files ───────────────────────────────────────────────────────────────

export function statePaths(dir: string) {
  return {
    state: path.join(dir, "batch-state.json"),
    results: path.join(dir, "results.jsonl"),
    spend: path.join(dir, "spend.jsonl"),
  };
}

export function readState(dir: string): RunnerState {
  const p = statePaths(dir).state;
  if (!existsSync(p)) return { batches: [] };
  const s = JSON.parse(readFileSync(p, "utf8")) as RunnerState;
  return { batches: Array.isArray(s.batches) ? s.batches : [] };
}

/** Atomic write (temp file + rename) so a kill never leaves half a state file. */
export function writeState(dir: string, state: RunnerState): void {
  mkdirSync(dir, { recursive: true });
  const p = statePaths(dir).state;
  writeFileSync(`${p}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${p}.tmp`, p);
}

export function readResults(dir: string): ResultLine[] {
  const p = statePaths(dir).results;
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ResultLine);
}

/** Spend booked so far (real cost of collected results), micro-USD. */
export function spentMicro(dir: string): number {
  const p = statePaths(dir).spend;
  if (!existsSync(p)) return 0;
  let total = 0;
  for (const l of readFileSync(p, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const m = Number((JSON.parse(l) as { micro?: unknown }).micro);
    if (Number.isFinite(m) && m > 0) total += m;
  }
  return total;
}

// ─── Pricing ─────────────────────────────────────────────────────────────

function n0(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0;
}

/** Standard-price cost of a script-only model (same token classes as the app table). */
function scriptCostMicro(spec: ModelSpec, usage: ClaudeUsage): number {
  const p = spec.base;
  const cc = usage.cache_creation ?? null;
  const w1h = n0(cc?.ephemeral_1h_input_tokens);
  const w5m = cc ? n0(cc.ephemeral_5m_input_tokens) : n0(usage.cache_creation_input_tokens);
  const numer = n0(usage.input_tokens) * p.input + n0(usage.output_tokens) * p.output + n0(usage.cache_read_input_tokens) * p.cacheRead + w5m * p.cacheWrite5m + w1h * p.cacheWrite1h;
  return Math.ceil(numer / 1_000_000);
}

/** Batch price = half the standard price for every token class, rounded up. */
export function batchCostMicro(model: string, usage: ClaudeUsage): number {
  const scriptSpec = isScriptOnlyModel(model) ? scriptModelSpec(model) : null;
  const standard = scriptSpec ? scriptCostMicro(scriptSpec, usage) : costMicroUsd(model, usage, { onUnknown: "top_row" });
  return Math.ceil(standard / 2);
}

/** Worst case of one item at batch price (the live reserve ceiling, halved). */
export function batchCeilingMicro(params: BatchParams): number {
  // The structured-output schema (and the format instruction the API adds for it) count as input too.
  const schemaBytes = params.output_format ? Buffer.byteLength(JSON.stringify(params.output_format.schema)) + 2_000 : 0;
  const bytes = measureInputBytes({ system: params.system, messages: params.messages, tools: params.tools }) + schemaBytes;
  const scriptSpec = isScriptOnlyModel(params.model) ? scriptModelSpec(params.model) : null;
  if (scriptSpec) {
    // Same bound as reserveCeilingMicro: every input byte a token at the cache-write price, plus max_tokens of output.
    const inputBound = bytes + RESERVE_FRAMING_TOKENS;
    return Math.ceil(Math.ceil((inputBound * scriptSpec.base.cacheWrite5m + params.max_tokens * scriptSpec.base.output) / 1_000_000) / 2);
  }
  return Math.ceil(reserveCeilingMicro(params.model, bytes, params.max_tokens) / 2);
}

// ─── Building requests ──────────────────────────────────────────────────

/** One batch request line, validated by the shared wrapper rules. Throws on a bad item. */
export function buildBatchRequest(item: BatchItem): { custom_id: string; params: Record<string, unknown> } {
  if (!CUSTOM_ID_RE.test(item.custom_id)) throw new Error(`custom_id must match ${CUSTOM_ID_RE}: ${item.custom_id}`);
  const { output_format, ...rest } = item.params;
  const params: CallClaudeParams = { ...rest, stream: false };
  validateCallParams(params);
  if (!getModelSpec(params.model) && !scriptModelSpec(params.model)) throw new Error(`no price for model ${params.model}; add it to the app or script price table first`);
  const body = buildRequestBody(params);
  delete body.stream;
  const outputConfig: Record<string, unknown> = { ...((body.output_config as Record<string, unknown> | undefined) ?? {}) };
  // buildRequestBody sends effort only for models in the app table; script-only models get it here.
  if (isScriptOnlyModel(params.model) && scriptModelSpec(params.model)?.supportsEffort) outputConfig.effort = params.effort;
  if (output_format !== undefined) {
    if (!output_format || output_format.type !== "json_schema" || !output_format.schema || typeof output_format.schema !== "object") {
      throw new Error("output_format must be {type:'json_schema', schema:{...}}");
    }
    outputConfig.format = { type: "json_schema", schema: output_format.schema };
  }
  if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;
  return { custom_id: item.custom_id, params: body };
}

/**
 * Item ids that must not be submitted again: succeeded, in a batch (or an
 * unconfirmed submission) not yet collected, or failed MAX_ATTEMPTS_PER_ITEM times.
 */
export function blockedIds(state: RunnerState, results: readonly ResultLine[]): Set<string> {
  const blocked = new Set<string>();
  // Attempts are counted per batch, so a re-collected batch (crash between
  // writing results and marking it collected) never counts twice.
  const failures = new Map<string, Set<string>>();
  for (const r of results) {
    if (r.type === "succeeded") blocked.add(r.custom_id);
    else failures.set(r.custom_id, (failures.get(r.custom_id) ?? new Set()).add(r.batch_id));
  }
  for (const [id, batches] of failures) if (batches.size >= MAX_ATTEMPTS_PER_ITEM) blocked.add(id);
  for (const b of state.batches) if (!b.collected_at) for (const id of b.custom_ids) blocked.add(id);
  return blocked;
}

export interface SubmitPlan {
  chunks: Array<Array<{ custom_id: string; params: Record<string, unknown> }>>;
  /** Worst case per chunk (same order as chunks). */
  chunkWorst: number[];
  skippedDone: number;
  /** Items that failed validation (bad id, params or price); logged by id, never sent. */
  invalid: Array<{ custom_id: string; error: string }>;
  skippedBudget: number;
  worstMicro: number;
}

/**
 * Which items go out now: not blocked, unique, within the budget (prior
 * spend + worst case of everything still open + this plan <= maxMicro),
 * chunked under the per-batch limits.
 */
export function planSubmit(items: readonly BatchItem[], state: RunnerState, results: readonly ResultLine[], opts: { maxMicro: number; priorMicro: number; openWorstMicro: number }): SubmitPlan {
  const blocked = blockedIds(state, results);
  const seen = new Set<string>();
  const chunks: SubmitPlan["chunks"] = [];
  const chunkWorst: number[] = [];
  const invalid: SubmitPlan["invalid"] = [];
  let current: SubmitPlan["chunks"][number] = [];
  let currentBytes = 0;
  let currentWorst = 0;
  let worst = 0;
  let skippedDone = 0;
  let skippedBudget = 0;
  let budgetHit = false;
  for (const item of items) {
    if (blocked.has(item.custom_id) || seen.has(item.custom_id)) {
      skippedDone++;
      continue;
    }
    seen.add(item.custom_id);
    if (budgetHit) {
      skippedBudget++;
      continue;
    }
    let req: ReturnType<typeof buildBatchRequest>;
    let ceiling: number;
    try {
      req = buildBatchRequest(item);
      ceiling = batchCeilingMicro(item.params);
    } catch (err) {
      // One bad item never stops the step; it is reported and left out.
      invalid.push({ custom_id: String(item.custom_id), error: (err as Error).message.slice(0, 200) });
      continue;
    }
    if (opts.priorMicro + opts.openWorstMicro + worst + ceiling > opts.maxMicro) {
      budgetHit = true;
      skippedBudget++;
      continue;
    }
    const bytes = Buffer.byteLength(JSON.stringify(req));
    if (current.length >= MAX_ITEMS_PER_BATCH || currentBytes + bytes > MAX_BATCH_BYTES) {
      chunks.push(current);
      chunkWorst.push(currentWorst);
      current = [];
      currentBytes = 0;
      currentWorst = 0;
    }
    current.push(req);
    currentBytes += bytes;
    currentWorst += ceiling;
    worst += ceiling;
  }
  if (current.length > 0) {
    chunks.push(current);
    chunkWorst.push(currentWorst);
  }
  return { chunks, chunkWorst, skippedDone, invalid, skippedBudget, worstMicro: worst };
}

// ─── HTTP ────────────────────────────────────────────────────────────────

async function api(io: RunnerIo, url: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number }): Promise<Response> {
  // Credentials only ever go to the Anthropic API over https (results_url comes from a file).
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== API_HOST || target.port !== "") {
    throw new NotSentError(`refusing to send credentials to ${target.protocol}//${target.host}`);
  }
  let auth: AnthropicAuth;
  try {
    auth = await io.auth();
  } catch (err) {
    throw new NotSentError((err as Error).message, { cause: err });
  }
  const headers = authHeaders(auth);
  const res = await io.fetch(target.href, {
    method: init.method,
    headers,
    // A redirect would carry the credential to wherever it points; never follow one.
    redirect: "error",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? API_TIMEOUT_MS),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new BatchApiError(res.status, `Anthropic batches HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}

/** Flat worst case for an open item of an older record without worst_micro that the caller cannot price (above an Opus 5.5 review's ceiling). */
export const UNPRICED_OPEN_ITEM_MICRO = 150_000;

/**
 * Worst case of items in batches that are submitted but not collected yet:
 * the worst case recorded at submit time, so a later run with a narrower
 * selection still books the whole open batch.
 */
export function openWorstMicro(state: RunnerState, itemsById: ReadonlyMap<string, BatchItem>): number {
  let total = 0;
  for (const b of state.batches) {
    if (b.collected_at) continue;
    if (typeof b.worst_micro === "number" && Number.isFinite(b.worst_micro) && b.worst_micro >= 0) {
      total += b.worst_micro;
      continue;
    }
    for (const id of b.custom_ids) {
      const item = itemsById.get(id);
      total += item ? batchCeilingMicro(item.params) : UNPRICED_OPEN_ITEM_MICRO;
    }
  }
  return total;
}

export async function submit(
  dir: string,
  items: readonly BatchItem[],
  opts: { maxUsd: number; io?: RunnerIo; /** Spend booked elsewhere under the same cap (for example a live staging ledger). */ extraPriorMicro?: number },
): Promise<{ submitted: number; batches: string[]; skippedDone: number; skippedBudget: number; invalid: SubmitPlan["invalid"] }> {
  return withStateLock(dir, () => submitLocked(dir, items, opts));
}

async function submitLocked(
  dir: string,
  items: readonly BatchItem[],
  opts: { maxUsd: number; io?: RunnerIo; extraPriorMicro?: number },
): Promise<{ submitted: number; batches: string[]; skippedDone: number; skippedBudget: number; invalid: SubmitPlan["invalid"] }> {
  const io = opts.io ?? defaultIo();
  const state = readState(dir);
  const results = readResults(dir);
  const byId = new Map(items.map((i) => [i.custom_id, i]));
  const plan = planSubmit(items, state, results, {
    maxMicro: Math.round(opts.maxUsd * 1_000_000),
    priorMicro: spentMicro(dir) + Math.max(0, opts.extraPriorMicro ?? 0),
    openWorstMicro: openWorstMicro(state, byId),
  });
  const ids: string[] = [];
  let submitted = 0;
  for (const [ci, chunk] of plan.chunks.entries()) {
    // Intent first: if the create call succeeds but its answer is lost (or
    // the process dies), the items stay blocked and booked at their worst
    // case until poll adopts the batch, so a re-run never double-spends.
    const record: BatchRecord = {
      id: null,
      custom_ids: chunk.map((c) => c.custom_id),
      submitted_at: io.now().toISOString(),
      processing_status: "submitting",
      results_url: null,
      collected_at: null,
      worst_micro: plan.chunkWorst[ci],
    };
    state.batches.push(record);
    writeState(dir, state);
    let res: Response;
    try {
      res = await api(io, BATCHES_URL, { method: "POST", body: { requests: chunk } });
    } catch (err) {
      // A clear 4xx (incl. 429) means no batch was created: drop the intent so
      // its items are free again. Timeouts, network errors and 5xx keep it.
      // So does a failure before anything was sent (no credential, refused destination).
      if (err instanceof NotSentError || (err instanceof BatchApiError && err.status >= 400 && err.status < 500)) {
        state.batches = state.batches.filter((x) => x !== record);
        writeState(dir, state);
      }
      throw err;
    }
    const b = (await res.json()) as { id?: unknown; processing_status?: unknown };
    if (typeof b.id !== "string") throw new Error("batch create returned no id");
    record.id = b.id;
    record.processing_status = typeof b.processing_status === "string" ? b.processing_status : "in_progress";
    writeState(dir, state);
    ids.push(b.id);
    submitted += chunk.length;
  }
  return { submitted, batches: ids, skippedDone: plan.skippedDone, skippedBudget: plan.skippedBudget, invalid: plan.invalid };
}

/**
 * An unconfirmed submission (id null) adopts the one listed batch created
 * after its intent time with the same request count that no record holds.
 * Ambiguous or missing: it stays unconfirmed (items blocked); check the
 * Console and edit batch-state.json by hand.
 */
async function adoptUnconfirmed(io: RunnerIo, state: RunnerState): Promise<void> {
  const pending = state.batches.filter((b) => b.id === null);
  if (pending.length === 0) return;
  const res = await api(io, `${BATCHES_URL}?limit=100`, { method: "GET" });
  const list = ((await res.json()) as { data?: unknown }).data;
  if (!Array.isArray(list)) return;
  const known = new Set(state.batches.map((b) => b.id).filter((x): x is string => typeof x === "string"));
  for (const rec of pending) {
    const since = Date.parse(rec.submitted_at) - 60_000;
    const matches = (list as Array<Record<string, unknown>>).filter((x) => {
      const counts = (x.request_counts ?? {}) as Record<string, unknown>;
      const total = ["processing", "succeeded", "errored", "canceled", "expired"].reduce((s, k) => s + (Number(counts[k]) || 0), 0);
      return typeof x.id === "string" && !known.has(x.id) && Date.parse(String(x.created_at)) >= since && total === rec.custom_ids.length;
    });
    if (matches.length !== 1) continue;
    rec.id = String(matches[0].id);
    rec.processing_status = typeof matches[0].processing_status === "string" ? matches[0].processing_status : "in_progress";
    known.add(rec.id);
  }
}

export async function poll(dir: string, opts: { io?: RunnerIo } = {}): Promise<Array<{ id: string; processing_status: string }>> {
  return withStateLock(dir, () => pollLocked(dir, opts));
}

async function pollLocked(dir: string, opts: { io?: RunnerIo }): Promise<Array<{ id: string; processing_status: string }>> {
  const io = opts.io ?? defaultIo();
  const state = readState(dir);
  await adoptUnconfirmed(io, state);
  const out: Array<{ id: string; processing_status: string }> = [];
  for (const b of state.batches) {
    if (b.id === null) {
      out.push({ id: "(unconfirmed submission)", processing_status: b.processing_status });
      continue;
    }
    if (b.collected_at || b.processing_status === "ended") {
      out.push({ id: b.id, processing_status: b.processing_status });
      continue;
    }
    const res = await api(io, `${BATCHES_URL}/${encodeURIComponent(b.id)}`, { method: "GET" });
    const j = (await res.json()) as { processing_status?: unknown; results_url?: unknown };
    if (typeof j.processing_status === "string") b.processing_status = j.processing_status;
    if (typeof j.results_url === "string") b.results_url = j.results_url;
    out.push({ id: b.id, processing_status: b.processing_status });
  }
  writeState(dir, state);
  return out;
}

/** One results-file line to a ResultLine (pure). */
export function parseResultLine(raw: string, batchId: string, collectedAt: string): ResultLine | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const custom_id = typeof j.custom_id === "string" ? j.custom_id : null;
  const result = (j.result ?? {}) as Record<string, unknown>;
  const type = result.type;
  if (!custom_id || (type !== "succeeded" && type !== "errored" && type !== "canceled" && type !== "expired")) return null;
  if (type !== "succeeded") {
    const err = (result.error ?? {}) as Record<string, unknown>;
    const inner = (err.error ?? err) as Record<string, unknown>;
    return { custom_id, batch_id: batchId, type, text: null, stop_reason: null, model: null, usage: null, cost_micro: 0, error: type === "errored" ? String(inner.type ?? "error") : type, collected_at: collectedAt };
  }
  const msg = (result.message ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(msg.content) ? (msg.content as ContentBlock[]) : [];
  const usage = normalizeUsage(msg.usage);
  const model = typeof msg.model === "string" ? msg.model : null;
  const stop = typeof msg.stop_reason === "string" ? msg.stop_reason : null;
  const text = firstTextBlock(blocks)?.text ?? null;
  // A refusal, an answer cut off at max_tokens (truncated JSON or a half
  // translation) or an empty answer is billed but is not a usable result;
  // the item can be sent again (at most MAX_ATTEMPTS_PER_ITEM batches).
  const usable = stop !== "refusal" && stop !== "max_tokens" && text !== null && text.trim() !== "";
  return {
    custom_id,
    batch_id: batchId,
    type: usable ? "succeeded" : "errored",
    text: usable ? text : null,
    stop_reason: stop,
    model,
    usage,
    cost_micro: model ? batchCostMicro(model, usage) : 0,
    error: usable ? null : stop === "refusal" ? "refusal" : stop === "max_tokens" ? "max_tokens" : "empty_text",
    collected_at: collectedAt,
  };
}

/**
 * Optional check of a succeeded answer (for example: does the JSON parse for
 * this row). A non-null return is the error; the line is stored as errored,
 * still billed, and the item can be sent again like a refusal.
 */
export type ResultValidator = (line: ResultLine) => string | null;

export async function collect(dir: string, opts: { io?: RunnerIo; validate?: ResultValidator } = {}): Promise<{ collected: number; succeeded: number; failed: number; micro: number }> {
  return withStateLock(dir, () => collectLocked(dir, opts));
}

async function collectLocked(dir: string, opts: { io?: RunnerIo; validate?: ResultValidator }): Promise<{ collected: number; succeeded: number; failed: number; micro: number }> {
  const io = opts.io ?? defaultIo();
  const state = readState(dir);
  const paths = statePaths(dir);
  let collected = 0;
  let succeeded = 0;
  let failed = 0;
  let micro = 0;
  for (const b of state.batches) {
    if (b.id === null || b.collected_at || b.processing_status !== "ended" || !b.results_url) continue;
    const res = await api(io, b.results_url, { method: "GET", timeoutMs: RESULTS_TIMEOUT_MS });
    const body = await res.text();
    const at = io.now().toISOString();
    const lines: string[] = [];
    let batchMicro = 0;
    for (const raw of body.split("\n")) {
      if (!raw.trim()) continue;
      let r = parseResultLine(raw, b.id, at);
      if (!r) continue;
      if (r.type === "succeeded" && opts.validate) {
        let problem: string | null;
        try {
          problem = opts.validate(r);
        } catch (err) {
          problem = (err as Error).message.slice(0, 80) || "invalid";
        }
        if (problem) r = { ...r, type: "errored", text: null, error: problem };
      }
      lines.push(JSON.stringify(r));
      batchMicro += r.cost_micro;
      if (r.type === "succeeded") succeeded++;
      else failed++;
      collected++;
    }
    // Results and spend first, then the collected mark: a crash in between
    // re-collects the batch, and readers keep the last line per custom_id.
    if (lines.length) appendFileSync(paths.results, `${lines.join("\n")}\n`);
    appendFileSync(paths.spend, `${JSON.stringify({ at, batch_id: b.id, micro: batchMicro })}\n`);
    b.collected_at = at;
    writeState(dir, state);
    micro += batchMicro;
  }
  return { collected, succeeded, failed, micro };
}

/** Latest result per custom_id (a re-collected or re-submitted item keeps its newest line). */
export function latestResults(results: readonly ResultLine[]): Map<string, ResultLine> {
  const m = new Map<string, ResultLine>();
  for (const r of results) {
    const prev = m.get(r.custom_id);
    if (!prev || prev.type !== "succeeded" || r.type === "succeeded") m.set(r.custom_id, r);
  }
  return m;
}

export function readItemsJsonl(file: string): BatchItem[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BatchItem);
}
