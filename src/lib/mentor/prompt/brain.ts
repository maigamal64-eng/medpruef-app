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
import { buildSystemBlocksV2 } from "../v2/prompt";
import { FIND_QUESTIONS_NAME, FIND_QUESTIONS_TOOL, runFindQuestions, type BankSearch, type FreeFilter } from "../v2/find-questions";

const TURN_STORE_MAX = 500;
const TURN_STORE_TTL_MS = 30 * 60 * 1000;

export interface MentorBrainOptions {
  facts?: MentorFactsLoader;
  /** Service DB client getter (default: getServiceClient, imported lazily). */
  db?: () => MentorDb | Promise<MentorDb>;
  /** Free-access override (tests). */
  canFreeRead?: (db: MentorDb, userId: string, questionId: number) => Promise<boolean>;
  clock?: () => Date;
  /**
   * a-mentor-better-1106 (MENTOR_V2_ENABLED): the v2 prompt and the find_questions tool.
   * Off (default): today's tools and system blocks, byte for byte.
   */
  v2?: boolean;
  /** v2 bank search override (eval and tests); default the Supabase search. */
  searchBank?: BankSearch;
  /** v2 free-access filter override (eval and tests); default filterFreeAccessibleQuestions. */
  freeFilter?: FreeFilter;
}

async function defaultDb(): Promise<MentorDb> {
  const { getServiceClient } = await import("@/lib/supabase");
  return getServiceClient();
}

export class MentorBrain implements Brain {
  readonly tools: ToolDefinition[];
  private readonly facts: MentorFactsLoader;
  private readonly opts: MentorBrainOptions;
  private readonly store = new Map<string, { fact: MentorFact; at: number }>();

  constructor(opts: MentorBrainOptions = {}) {
    this.opts = opts;
    this.facts = opts.facts ?? getMentorFactsLoader();
    // v2 appends its tool after the frozen four, so the v1 prefix stays byte-identical.
    this.tools = opts.v2 === true ? [...MENTOR_TOOLS, FIND_QUESTIONS_TOOL] : [...MENTOR_TOOLS];
  }

  private now(): Date {
    return this.opts.clock ? this.opts.clock() : new Date();
  }

  buildSystem(ctx: TurnContext): TextBlockParam[] {
    return this.opts.v2 === true ? buildSystemBlocksV2(ctx, this.facts.sheetFacts(ctx.now)) : buildSystemBlocks(ctx, this.facts.sheetFacts(ctx.now));
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
    if (this.opts.v2 === true && name === FIND_QUESTIONS_NAME) {
      return runFindQuestions(input, ctx, {
        db: this.opts.db ?? defaultDb,
        remember: (f) => this.remember(f),
        ...(this.opts.searchBank ? { search: this.opts.searchBank } : {}),
        ...(this.opts.freeFilter ? { freeFilter: this.opts.freeFilter } : {}),
      });
    }
    return runMentorTool(name, input, ctx, {
      facts: this.facts,
      db: this.opts.db ?? defaultDb,
      canFreeRead: this.opts.canFreeRead,
      remember: (f) => this.remember(f),
    });
  }

  validate(answer: string, facts: MentorFact[], retrievedIds?: Iterable<string>): ValidatedAnswer {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(this.now());
    return validateAnswer(answer, facts, { resolve: (id) => this.resolveFact(id), today, ...(retrievedIds ? { retrievedIds } : {}) });
  }
}

export function createMentorBrain(opts: MentorBrainOptions = {}): MentorBrain {
  return new MentorBrain(opts);
}
