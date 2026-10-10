/**
 * Shared fakes for the W2-CORE tests. Synthetic only: no real facts, dates or fees.
 */
import type { CallClaudeParams, CallClaudeResult, ClaudeUsage, ContentBlock, ToolUseBlock } from "@/lib/ai/anthropic";
import { MENTOR_CONFIG_DEFAULTS, type MentorConfig } from "@/lib/mentor/config";
import type { MentorChatRequest } from "@/lib/mentor/contract";
import type { Brain, FactsLoader, MentorDeps, MentorFact, MentorTurnInput, ValidatedAnswer } from "@/lib/mentor/seam";
import { InMemoryLedger, createTestHousePolicy, createTestMeter, createTestWallet } from "@/lib/mentor/test-meter";

export const USER = "11111111-1111-4111-8111-111111111111";
export const REQ = "22222222-2222-4222-8222-222222222222";
export const CONV = "33333333-3333-4333-8333-333333333333";
export const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

export function usage(input: number, output: number, extra: Partial<ClaudeUsage> = {}): ClaudeUsage {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: null,
    ...extra,
  };
}

export function fact(id: string): MentorFact {
  return {
    id,
    exam_key: "general",
    topic: "glossary",
    filing_university: "all",
    text_de: `Beispielfakt ${id}`,
    text_en: `Example fact ${id}`,
    aliases: [],
    source_url: `https://example.org/${id}`,
    source_label: "Fixture",
    edition: "fixture",
    read_on: "2026-10-10",
    verdict: "confirmed",
    review_every_days: 30,
    status: "live",
  };
}

/** Brain fake: answer text becomes one block; values containing "9999" are "unsupported" and get replaced. */
export function fakeBrain(over: Partial<Brain> = {}): Brain & { toolCalls: Array<{ name: string; input: unknown }> } {
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  const brain: Brain & { toolCalls: typeof toolCalls } = {
    toolCalls,
    buildSystem: () => [{ type: "text", text: "Synthetic mentor system prompt.", cache_control: { type: "ephemeral" } }],
    tools: [
      { name: "search_facts", description: "search", input_schema: { type: "object", properties: { query_de: { type: "string" } } } },
      { name: "get_dates", description: "dates", input_schema: { type: "object", properties: {} } },
    ],
    async runTool(name, input) {
      toolCalls.push({ name, input });
      return { content: `result for ${name}`, factIds: ["fx.one"] };
    },
    validate(answer: string, facts: MentorFact[]): ValidatedAnswer {
      const replaced = answer.includes("9999");
      return {
        blocks: [{ text: replaced ? "Bitte auf der offiziellen Seite prüfen." : answer, fact_ids: facts.map((f) => f.id) }],
        citations: facts.map((f) => ({ fact_id: f.id, source_label: f.source_label, source_url: f.source_url, read_on: f.read_on })),
        replaced,
        rejected: replaced ? [{ value: "9999", reason: "not_in_cited_facts" }] : [],
      };
    },
    ...over,
  };
  return brain;
}

export function fakeFacts(): FactsLoader & { requested: string[][] } {
  const requested: string[][] = [];
  return {
    requested,
    async byIds(ids) {
      requested.push(ids);
      return ids.map(fact);
    },
    async search() {
      return [];
    },
    async dates() {
      return { sittings: [], facts: [] };
    },
  };
}

export type Step =
  | { text: string; toolUses?: Array<{ id: string; name: string; input?: unknown }>; usage?: ClaudeUsage; model?: string; extraBlocks?: ContentBlock[] }
  | { throw: unknown; startUsage?: ClaudeUsage };

/** Scripted callClaude: one step per API call. Fires onMessageStart like the wrapper does. */
export function scriptedClaude(steps: Step[]) {
  const calls: CallClaudeParams[] = [];
  const fn = async (params: CallClaudeParams): Promise<CallClaudeResult> => {
    calls.push(params);
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`no scripted step for call ${calls.length}`);
    if ("throw" in step) {
      if (step.startUsage) {
        params.onMessageStart?.({
          input_tokens: step.startUsage.input_tokens,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          model: params.model,
          request_id: "req_x",
        });
      }
      throw step.throw;
    }
    const u = step.usage ?? usage(1000, 200);
    params.onMessageStart?.({
      input_tokens: u.input_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens,
      model: step.model ?? params.model,
      request_id: "req_x",
    });
    const toolUses: ToolUseBlock[] = (step.toolUses ?? []).map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: t.input ?? {} }));
    const blocks: ContentBlock[] = [
      { type: "thinking", thinking: "synthetic thinking", signature: "sig" },
      ...(step.extraBlocks ?? []),
      ...(step.text ? [{ type: "text", text: step.text }] : []),
      ...toolUses,
    ];
    return { text: step.text, blocks, toolUses, usage: u, stop_reason: toolUses.length ? "tool_use" : "end_turn", model: step.model ?? params.model, request_id: "req_x" };
  };
  return { fn, calls };
}

export function config(over: Partial<MentorConfig> = {}): MentorConfig {
  return { ...MENTOR_CONFIG_DEFAULTS, aiFeaturesEnabled: true, enabled: true, ...over };
}

export function grant(ledger: InMemoryLedger, micro: number, sourceId = "g1", userId = USER): void {
  const r = ledger.grant({
    userId,
    packageId: "gift_admin",
    kind: "gift",
    source: "admin_gift",
    sourceId,
    micro,
    startsAt: new Date(T0 - 1000),
    expiresAt: new Date(T0 + 30 * 86_400_000),
  });
  if (!r.ok) throw new Error(`grant failed ${r.reason}`);
}

export function request(over: Partial<MentorChatRequest> = {}): MentorChatRequest {
  return { message: "Wie melde ich mich an?", lang: "de", mode: "facts", ...over };
}

export function turnInput(over: Partial<MentorTurnInput> = {}): MentorTurnInput {
  return { requestId: REQ, userId: USER, conversationId: CONV, request: request(), history: [], paidAccess: true, ...over };
}

export function makeDeps(steps: Step[], opts: { grantMicro?: number; houseFree?: number; cfg?: Partial<MentorConfig>; brain?: Partial<Brain> } = {}) {
  const ledger = new InMemoryLedger(() => T0);
  if (opts.grantMicro !== undefined && opts.grantMicro > 0) grant(ledger, opts.grantMicro);
  const claude = scriptedClaude(steps);
  const brain = fakeBrain(opts.brain);
  const facts = fakeFacts();
  const deps: MentorDeps = {
    meter: createTestMeter(ledger, USER),
    brain,
    facts,
    callClaude: claude.fn,
    clock: { now: () => new Date(T0) },
    wallet: createTestWallet(ledger),
    house: createTestHousePolicy(opts.houseFree ?? 3),
    config: config(opts.cfg),
  };
  return { deps, ledger, claude, brain, facts };
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
