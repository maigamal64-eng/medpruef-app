/**
 * The mentor Brain (C17, W2-BRAIN): prompt + read-only tools + code validator.
 * Lives under prompt/ because the W2-BRAIN globs are prompt/**, tools/**,
 * validator.ts and facts-loader.ts.
 *
 * Usage (W2-CORE route, W2-EVAL runner):
 *   const facts = getMentorFactsLoader();
 *   const brain = createMentorBrain({ facts });
 *   deps = { ..., brain, facts }
 *
 * The brain keeps a small per-process turn store of INTERNAL facts (question
 * rows and progress snapshots its tools returned) so validate() can check
 * numbers taken from them even though the frozen signature only passes facts.
 */

import type { ToolDefinition, TextBlockParam } from "@/lib/ai/anthropic";
import { getMentorFactsLoader, type MentorFactsLoader } from "../facts-loader";
import type { Brain, MentorFact, ToolResult, TurnContext, ValidatedAnswer } from "../seam";
import { MENTOR_TOOLS } from "../tools/definitions";
import { runMentorTool, type MentorDb } from "../tools/run";
import { validateAnswer } from "../validator";
import { buildSystemBlocks } from "./system";

const TURN_STORE_MAX = 500;
const TURN_STORE_TTL_MS = 30 * 60 * 1000;

export interface MentorBrainOptions {
  facts?: MentorFactsLoader;
  /** Service DB client getter (default: getServiceClient, imported lazily). */
  db?: () => MentorDb | Promise<MentorDb>;
  /** Free-access override (tests). */
  canFreeRead?: (db: MentorDb, userId: string, questionId: number) => Promise<boolean>;
  clock?: () => Date;
}

async function defaultDb(): Promise<MentorDb> {
  const { getServiceClient } = await import("@/lib/supabase");
  return getServiceClient();
}

export class MentorBrain implements Brain {
  readonly tools: ToolDefinition[] = [...MENTOR_TOOLS];
  private readonly facts: MentorFactsLoader;
  private readonly opts: MentorBrainOptions;
  private readonly store = new Map<string, { fact: MentorFact; at: number }>();

  constructor(opts: MentorBrainOptions = {}) {
    this.opts = opts;
    this.facts = opts.facts ?? getMentorFactsLoader();
  }

  private now(): Date {
    return this.opts.clock ? this.opts.clock() : new Date();
  }

  buildSystem(ctx: TurnContext): TextBlockParam[] {
    return buildSystemBlocks(ctx, this.facts.sheetFacts(ctx.now));
  }

  private remember(fact: MentorFact): void {
    const t = this.now().getTime();
    for (const [k, v] of this.store) if (t - v.at > TURN_STORE_TTL_MS) this.store.delete(k);
    this.store.delete(fact.id);
    this.store.set(fact.id, { fact, at: t });
    while (this.store.size > TURN_STORE_MAX) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  /** Synchronous resolver used by validate(): turn store first, then assertable loader facts. */
  resolveFact(id: string): MentorFact | null {
    const hit = this.store.get(id);
    if (hit && this.now().getTime() - hit.at <= TURN_STORE_TTL_MS) return hit.fact;
    return this.facts.peek(id, this.now());
  }

  runTool(name: string, input: unknown, ctx: TurnContext): Promise<ToolResult> {
    return runMentorTool(name, input, ctx, {
      facts: this.facts,
      db: this.opts.db ?? defaultDb,
      canFreeRead: this.opts.canFreeRead,
      remember: (f) => this.remember(f),
    });
  }

  validate(answer: string, facts: MentorFact[]): ValidatedAnswer {
    return validateAnswer(answer, facts, { resolve: (id) => this.resolveFact(id) });
  }
}

export function createMentorBrain(opts: MentorBrainOptions = {}): MentorBrain {
  return new MentorBrain(opts);
}
