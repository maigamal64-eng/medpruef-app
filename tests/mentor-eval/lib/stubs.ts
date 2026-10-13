/**
 * Hermetic stand-ins for the parts that other work packages own (W2-EVAL).
 *
 * This branch contains only the frozen contract: no turn loop (W2-CORE), no
 * brain, validator or facts loader (W2-BRAIN, W2-FACTS). To test the harness,
 * the scorer and the golden set here, the tests run them against these stubs:
 *
 *  - StubBrain    tool results that carry fact ids (the oracle cites from those),
 *                 the system prompt shape the scripted model reads (`lang=..`),
 *                 and a parser for the @@ wire protocol standing in for validate().
 *  - stubRunTurn  a minimal C17 loop: reserve -> call -> settle per API call, tools,
 *                 validate, one `final` event. It follows the contract in seam.ts;
 *                 it is not the production loop and is never used for the live run.
 *
 * The real run (`--real`) loads the real turn loop, brain and facts loader.
 */

import { costMicroUsd, measureInputBytes, reserveCeilingMicro } from "@/lib/ai/pricing";
import type { CallClaudeParams, ContentBlockParam, MessageParam, ToolResultBlockParam } from "@/lib/ai/anthropic";
import { creditsFromMicro, messagesLeftEstimate } from "@/lib/mentor/config";
import { daysUntilViennaDate } from "@/lib/exam-dates";
import { ownExamDateFromTools } from "@/lib/mentor/turn";
import { ownExamDateLine } from "@/lib/mentor/trust-copy";
import type { MentorAnswerBlock, MentorCitation, MentorRefusalReason, MentorSseEvent } from "@/lib/mentor/contract";
import { MENTOR_REFUSAL_REASONS } from "@/lib/mentor/contract";
import type { Brain, FactsLoader, MentorDeps, MentorTurnInput, RunMentorTurn, ToolResult, TurnContext, ValidatedAnswer } from "@/lib/mentor/seam";
import type { BrainFactory, HarnessParts } from "./harness";
import type { GoldenFile } from "./types";

export const STUB_LINK = "https://example.org/mentor-eval-stub/official";

/** A concrete fact id for a golden glob (`*` becomes `x`). */
export function concreteId(glob: string): string {
  return glob.replace(/\*/g, "x");
}

export function stubFactIds(file: GoldenFile): string[] {
  const ids = new Set<string>();
  for (const c of file.cases) for (const g of c.expect.cite_any ?? []) ids.add(concreteId(g));
  return [...ids].sort();
}

function parseProtocol(raw: string): { blocks: MentorAnswerBlock[]; refused?: MentorRefusalReason } {
  const blocks: MentorAnswerBlock[] = [];
  let refused: MentorRefusalReason | undefined;
  let cur: MentorAnswerBlock | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("@@LANG")) continue;
    if (line.startsWith("@@REFUSE")) {
      const m = /reason=(\w+)/.exec(line);
      if (m && (MENTOR_REFUSAL_REASONS as readonly string[]).includes(m[1])) refused = m[1] as MentorRefusalReason;
      continue;
    }
    if (line.startsWith("@@BLOCK")) {
      const m = /facts=([^\s]+)/.exec(line);
      cur = { text: "", fact_ids: m ? m[1].split(",").filter(Boolean) : [] };
      blocks.push(cur);
      continue;
    }
    if (cur) cur.text += (cur.text ? "\n" : "") + line;
    else if (line.trim()) {
      cur = { text: line, fact_ids: [] };
      blocks.push(cur);
    }
  }
  return { blocks: blocks.filter((b) => b.text.trim().length > 0), refused };
}

export interface StubBrainOptions {
  factIds: readonly string[];
}

export function createStubBrainFactory(opts: StubBrainOptions): BrainFactory {
  return (env): Brain => ({
    tools: [{ name: "stub_tool", description: "stub", input_schema: { type: "object" } }],
    buildSystem(ctx: TurnContext) {
      return [
        { type: "text", text: "You are the stub mentor." },
        { type: "text", text: `FACT SHEET (stub): ${opts.factIds.join(" ")}`, cache_control: { type: "ephemeral" } },
        { type: "text", text: `TURN CONTEXT\nlang=${ctx.lang}; mode=${ctx.mode}; question_id=${ctx.questionId ?? "none"}` },
      ];
    },
    async runTool(name, input, ctx): Promise<ToolResult> {
      // Reads like the real tools do (so the harness's fake db and foreign-read check are exercised).
      if (name === "get_my_progress") {
        const db = env.db();
        const u = await db.from("users").select("active_exam, exam_date").eq("id", ctx.userId).maybeSingle();
        await db.from("user_topic_strength").select("*").eq("user_id", ctx.userId).limit(500);
        // Gate9 P1: like the real tool, the own exam date and days left are structured fields (the turn appends the code-owned line).
        const examDate = (u.data as { exam_date?: unknown } | null)?.exam_date;
        const own = typeof examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? { exam_date: examDate, days_left: daysUntilViennaDate(examDate, ctx.now) } : {};
        return { content: JSON.stringify({ fact_id: `progress.${ctx.requestId}`, progress: "stub", ...own }), factIds: [`progress.${ctx.requestId}`] };
      }
      if (name === "get_question") {
        const id = (input as { id?: number }).id;
        const db = env.db();
        const row = await db.from("questions").select("*").eq("id", id).eq("is_active", true).maybeSingle();
        if (!row.data) return { content: JSON.stringify({ error: "not available" }), factIds: [], isError: true };
        if (!ctx.paidAccess && !(await env.canFreeRead(db, ctx.userId, Number(id)))) return { content: JSON.stringify({ error: "not available" }), factIds: [], isError: true };
        return { content: JSON.stringify({ fact_id: `question.${id}`, question: "stub" }), factIds: [`question.${id}`] };
      }
      const facts = opts.factIds.filter((f) => !f.startsWith("question.") && !f.startsWith("progress."));
      return { content: JSON.stringify({ facts: facts.map((f) => ({ fact_id: f })) }), factIds: facts };
    },
    validate(answer): ValidatedAnswer {
      const { blocks, refused } = parseProtocol(answer);
      const ids = [...new Set(blocks.flatMap((b) => b.fact_ids))];
      const citations: MentorCitation[] = ids
        .filter((i) => !i.startsWith("question.") && !i.startsWith("progress."))
        .map((i) => ({ fact_id: i, source_label: "Stub", source_url: STUB_LINK, read_on: "2026-10-10" }));
      return { blocks, citations, refused, refusalLink: refused ? STUB_LINK : undefined, replaced: false, rejected: [] };
    },
  });
}

export function createStubFacts(): FactsLoader {
  return {
    async byIds() {
      return [];
    },
    async search() {
      return [];
    },
    async dates() {
      return { sittings: [], facts: [] };
    },
  };
}

/** Minimal C17 loop (stub only). */
export function createStubRunTurn(alert: (a: { kind: string; detail?: string }) => void): RunMentorTurn {
  return async function* (deps: MentorDeps, input: MentorTurnInput): AsyncGenerator<MentorSseEvent> {
    const { meter, brain, callClaude, clock, wallet, config } = deps;
    const ctx: TurnContext = {
      userId: input.userId,
      requestId: input.requestId,
      lang: input.request.lang,
      mode: input.request.mode,
      questionId: input.request.question_id,
      now: clock.now(),
      paidAccess: input.paidAccess,
    };
    await wallet.ensureIncludedGrants(input.userId, ctx.now);
    let messages: MessageParam[] = [...input.history, { role: "user", content: input.request.message }];
    const factIds = new Set<string>();
    const toolResults: Array<{ name: string; result: ToolResult }> = [];
    let answer: string | null = null;
    for (let i = 0; i < config.maxToolRounds; i++) {
      const isLast = i === config.maxToolRounds - 1;
      const system = brain.buildSystem(ctx);
      const tools = [...brain.tools];
      const bytes = measureInputBytes({ system, messages, tools });
      const ceiling = reserveCeilingMicro(config.modelDefault, bytes, config.maxTokens);
      const reserved = await meter.reserve(input.requestId, i, ceiling);
      if (!reserved.ok) {
        yield { type: "error", error: reserved.reason === "insufficient" ? "credits_exhausted" : "reserve_failed" };
        return;
      }
      const params: CallClaudeParams = {
        model: config.modelDefault,
        effort: config.effort,
        system,
        messages,
        tools,
        ...(isLast ? { tool_choice: { type: "none" as const } } : {}),
        max_tokens: config.maxTokens,
      };
      const r = await callClaude(params);
      const cost = costMicroUsd(r.model || params.model, r.usage, { onUnknown: "throw" });
      const s = await meter.settle(input.requestId, i, cost, { ...r.usage, model: r.model }, true);
      if (s.overrun) alert({ kind: "overrun", detail: `call ${i}` });
      if (r.toolUses.length > 0 && !isLast) {
        const results: ToolResultBlockParam[] = [];
        for (const tu of r.toolUses) {
          const res = await brain.runTool(tu.name, tu.input, ctx);
          res.factIds.forEach((f) => factIds.add(f));
          toolResults.push({ name: tu.name, result: res });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: res.content, ...(res.isError ? { is_error: true } : {}) });
        }
        messages = [...messages, { role: "assistant", content: r.blocks as ContentBlockParam[] }, { role: "user", content: results }];
        continue;
      }
      answer = r.text;
      break;
    }
    if (!answer) {
      yield { type: "error", error: "upstream_error" };
      return;
    }
    const v = brain.validate(answer, []);
    // Gate9 P1, as in turn.ts: a study answer gets the code-owned own-exam-date line once.
    const own = !v.refused ? ownExamDateFromTools(toolResults) : null;
    if (own) {
      const line = ownExamDateLine(ctx.lang, own.examDate, own.daysLeft);
      if (!v.blocks.some((b) => b.text.includes(line))) v.blocks.push({ text: line, fact_ids: [] });
    }
    for (const b of v.blocks) yield { type: "delta", text: b.text };
    const bal = await wallet.balance(input.userId);
    yield {
      type: "final",
      conversation_id: input.conversationId,
      answer_blocks: v.blocks,
      citations: v.citations,
      ...(v.refused ? { refused: v.refused, refusal_link: v.refusalLink } : {}),
      credits_left: creditsFromMicro(bal.availableMicro),
      messages_left_estimate: messagesLeftEstimate(bal.availableMicro, await wallet.avgMessageCostMicro(input.userId)),
    };
  };
}

export function createStubParts(file: GoldenFile): HarnessParts {
  const ids = stubFactIds(file);
  return {
    createRunTurn: (alert) => createStubRunTurn(alert),
    brainFactory: createStubBrainFactory({ factIds: ids }),
    facts: createStubFacts(),
  };
}
