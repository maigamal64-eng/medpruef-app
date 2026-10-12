/**
 * Eval harness (W2-EVAL): runs golden cases through the SAME runMentorTurn the
 * route uses (C17), with the C16 in-memory test meter and wallet. No ledger
 * tables, no DB flag, no production write: the ledger, the wallet and the
 * database the tools read are all in memory per case.
 *
 * Everything the turn needs is injected (parts + callClaude), so the same
 * harness drives the real brain with a real model, the real brain with the
 * scripted model, and the stubs the unit tests use.
 */

import { costMicroUsd, measureInputBytes } from "@/lib/ai/pricing";
import { AiError } from "@/lib/ai/anthropic";
import type { CallClaudeParams } from "@/lib/ai/anthropic";
import { MENTOR_CONFIG_DEFAULTS, type MentorConfig } from "@/lib/mentor/config";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import type { Brain, CallClaudeFn, FactsLoader, MentorDeps, MessageParam, MeterUsage, RunMentorTurn } from "@/lib/mentor/seam";
import { InMemoryLedger, createTestHousePolicy, createTestMeter, createTestWallet } from "@/lib/mentor/test-meter";
import { createFakeDb, foreignReads, type FakeDb } from "./fake-db";
import type { CallRecord, FixturesFile, GoldenCase, SettleRecord, ToolCallRecord, TurnOutcome } from "./types";

export interface BrainEnv {
  db: () => FakeDb;
  canFreeRead: (db: unknown, userId: string, questionId: number) => Promise<boolean>;
  clock: () => Date;
}

export type BrainFactory = (env: BrainEnv) => Brain;

export interface HarnessParts {
  forCase?: (c: GoldenCase) => HarnessParts;
  /** Builds the turn runner; `alert` receives every ops alert the turn raises (overruns, settle failures, ...). */
  createRunTurn: (alert: (a: { kind: string; detail?: string }) => void) => RunMentorTurn;
  brainFactory: BrainFactory;
  facts: FactsLoader;
  /** Every official link the product may attach (refusals, fallbacks), so their hosts count as official. */
  officialLinks?: () => string[];
}

export interface HarnessOptions {
  parts: HarnessParts;
  callClaude: CallClaudeFn;
  fixtures: FixturesFile;
  asOf: Date;
  config?: Partial<MentorConfig>;
  /** Included credits per case, in micro-USD (default 5 USD, like an admin lot, so admission never blocks a case). */
  grantMicro?: number;
}

const DAY_MS = 86_400_000;
const GRANT_MICRO = 5_000_000;

function idFor(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(12, "0")}`;
}

export function userIdFor(index: number): string {
  return idFor("00000000-0000-4000-8000", index + 1);
}

function historyOf(c: GoldenCase): MessageParam[] {
  return (c.history ?? []).map((h) => ({ role: h.role, content: h.text }));
}

export function textOfFinal(final: MentorFinalEvent): string {
  return final.answer_blocks.map((b) => b.text).join("\n\n");
}

export async function runCase(h: HarnessOptions, c: GoldenCase, index: number): Promise<TurnOutcome> {
  const parts = h.parts.forCase?.(c) ?? h.parts;
  const started = Date.now();
  const userId = userIdFor(index);
  const config: MentorConfig = { ...MENTOR_CONFIG_DEFAULTS, ...(h.config ?? {}), enabled: true, aiFeaturesEnabled: true };
  const nowMs = h.asOf.getTime();
  const ledger = new InMemoryLedger(() => nowMs);
  ledger.grant({
    userId,
    packageId: "included_admin",
    kind: "admin",
    source: "admin_included",
    sourceId: `${userId}:${h.asOf.toISOString().slice(0, 7)}`,
    micro: h.grantMicro ?? GRANT_MICRO,
    startsAt: new Date(nowMs - DAY_MS),
    expiresAt: new Date(nowMs + 30 * DAY_MS),
  });

  const baseMeter = createTestMeter(ledger, userId);
  const reserves: Array<{ callIndex: number; ceilingMicro: number }> = [];
  const settles: SettleRecord[] = [];
  const meter: typeof baseMeter = {
    ...baseMeter,
    async reserve(requestId, callIndex, ceilingMicro) {
      reserves.push({ callIndex, ceilingMicro });
      return baseMeter.reserve(requestId, callIndex, ceilingMicro);
    },
    async settle(requestId, callIndex, actualMicro, usage: MeterUsage, billUser) {
      const r = await baseMeter.settle(requestId, callIndex, actualMicro, usage, billUser);
      settles.push({ callIndex, chargedMicro: r.chargedMicro, overrun: r.overrun, billedTo: r.billedTo });
      return r;
    },
  };

  const calls: CallRecord[] = [];
  const callClaude: CallClaudeFn = async (params: CallClaudeParams) => {
    const t0 = Date.now();
    const rec: CallRecord = {
      callIndex: calls.length,
      model: params.model,
      effort: params.effort,
      maxTokens: params.max_tokens,
      inputBytes: measureInputBytes({ system: params.system, messages: params.messages, tools: params.tools }),
      ceilingMicro: null,
      usage: null,
      costMicro: null,
      stopReason: null,
      toolUses: [],
      ms: 0,
      ok: false,
    };
    calls.push(rec);
    try {
      const r = await h.callClaude(params);
      rec.usage = { ...r.usage, model: r.model };
      rec.costMicro = costMicroUsd(r.model || params.model, r.usage, { onUnknown: "top_row", alert: () => undefined });
      rec.stopReason = r.stop_reason;
      rec.toolUses = r.toolUses.map((t) => t.name);
      rec.textChars = typeof r.text === "string" ? r.text.length : 0;
      if (r.toolUses.length === 0 && typeof r.text === "string") rec.rawText = r.text.slice(0, 4000);
      rec.ok = true;
      return r;
    } catch (err) {
      rec.ok = false;
      rec.errorCode = err instanceof AiError ? err.code : "error";
      rec.errorMessage = String((err as Error)?.message ?? err).slice(0, 200);
      if (err instanceof AiError && err.usage) {
        rec.usage = { ...err.usage, model: params.model };
        rec.costMicro = costMicroUsd(params.model, err.usage, { onUnknown: "top_row", alert: () => undefined });
      }
      throw err;
    } finally {
      rec.ms = Date.now() - t0;
    }
  };

  const db = createFakeDb({ userId, fixtures: h.fixtures, profileFixture: c.profile_fixture });
  const freeReadable = new Set(Object.values(h.fixtures.questions).filter((q) => q.free_readable !== false).map((q) => q.id));
  const rawBrain = parts.brainFactory({
    db: () => db,
    canFreeRead: async (_db, _user, questionId) => freeReadable.has(questionId),
    clock: () => h.asOf,
  });
  const toolCalls: ToolCallRecord[] = [];
  const brain: typeof rawBrain = {
    get tools() {
      return rawBrain.tools;
    },
    buildSystem: (ctx) => rawBrain.buildSystem(ctx),
    validate: (answer, facts, retrievedIds) => rawBrain.validate(answer, facts, retrievedIds),
    resolveFact: (id) => rawBrain.resolveFact?.(id) ?? null,
    async runTool(name, input, ctx) {
      const r = await rawBrain.runTool(name, input, ctx);
      toolCalls.push({ name, input, factIds: [...(r.factIds ?? [])], isError: r.isError === true });
      return r;
    },
  };

  const alerts: string[] = [];
  const runTurn = parts.createRunTurn((a) => alerts.push(`${a.kind}${a.detail ? `: ${a.detail}` : ""}`));
  const deps: MentorDeps = {
    meter,
    brain,
    facts: parts.facts,
    callClaude,
    clock: { now: () => h.asOf },
    wallet: createTestWallet(ledger),
    house: createTestHousePolicy(config.houseFreeFailsPerDay),
    config,
  };

  const events: MentorSseEvent[] = [];
  const deltas: string[] = [];
  let final: MentorFinalEvent | null = null;
  let error: TurnOutcome["error"] = null;
  const question = c.question_fixture ? h.fixtures.questions[c.question_fixture] : undefined;
  try {
    for await (const ev of runTurn(deps, {
      requestId: idFor("00000000-0000-4000-9000", index + 1),
      userId,
      conversationId: idFor("00000000-0000-4000-a000", index + 1),
      request: {
        client_request_id: idFor("00000000-0000-4000-9000", index + 1), message: c.message, lang: c.lang, mode: c.mode, ...(question ? { question_id: question.id } : {}),
        ...(c.filing_university ? {filing_university:c.filing_university} : {}),
        ...(c.selected_option_text !== undefined ? {selected_option_text:c.selected_option_text} : {}),
        ...(c.was_correct !== undefined ? {was_correct:c.was_correct} : {}) },
      history: historyOf(c),
      paidAccess: c.paid !== false,
    })) {
      events.push(ev);
      if (ev.type === "delta") deltas.push(ev.text);
      else if (ev.type === "final") final = ev;
      else if (ev.type === "error") error = ev.error;
    }
  } catch (err) {
    alerts.push(`turn_threw: ${String((err as Error)?.message ?? err)}`);
    error = "upstream_error";
  }

  for (const r of reserves) if (calls[r.callIndex]) calls[r.callIndex].ceilingMicro = r.ceilingMicro;
  const foreign = foreignReads(db, userId, h.fixtures.foreign_user.id);
  if (foreign.length > 0) alerts.push(`cross_user_read: ${foreign.length} query(ies) touched another user's rows`);
  for (const s of settles) if (s.overrun) alerts.push(`overrun: call ${s.callIndex} charged above its ceiling`);

  return {
    events: events.map((e) => ({ type: e.type })),
    final,
    error,
    text: final ? textOfFinal(final) : deltas.join(""),
    calls,
    toolCalls,
    settles,
    alerts,
    ledgerReconciles: ledger.reconciles(userId),
    ms: Date.now() - started,
  };
}

export interface RunAllOptions {
  concurrency?: number;
  /** Stop starting new cases once this much recomputed cost (micro-USD) is spent. */
  maxMicro?: number;
  onCase?: (c: GoldenCase, outcome: TurnOutcome, done: number, total: number) => void;
}

export interface RunAllResult {
  outcomes: Map<string, TurnOutcome>;
  skippedForBudget: string[];
  spentMicro: number;
}

export async function runAll(h: HarnessOptions, cases: readonly GoldenCase[], opts: RunAllOptions = {}): Promise<RunAllResult> {
  const concurrency = Math.max(1, Math.min(4, opts.concurrency ?? 1));
  const outcomes = new Map<string, TurnOutcome>();
  const skipped: string[] = [];
  let spent = 0;
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= cases.length) return;
      const c = cases[i];
      if (opts.maxMicro !== undefined && spent >= opts.maxMicro) {
        skipped.push(c.id);
        continue;
      }
      const o = await runCase(h, c, i);
      spent += o.calls.reduce((s, x) => s + (x.costMicro ?? 0), 0);
      outcomes.set(c.id, o);
      done++;
      opts.onCase?.(c, o, done, cases.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { outcomes, skippedForBudget: skipped, spentMicro: spent };
}
