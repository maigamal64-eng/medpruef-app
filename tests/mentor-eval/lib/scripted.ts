/**
 * Scripted model (W2-EVAL): a stand-in for Claude that needs no key and costs
 * nothing. It plays the IDEAL mentor for a golden case, derived from the case's
 * own expectations: it calls the case's tool, reads the fact ids the tool result
 * returns, and answers in the mentor wire protocol (@@LANG / @@REFUSE / @@BLOCK).
 *
 * Two uses:
 *  - mutation "none": every case should PASS. This proves the harness, the
 *    scoring and the golden set agree with each other, and (run through the real
 *    brain) that a correct answer survives the real validator.
 *  - a mutation (wrong date, no citation, no refusal, obeyed injection, ...):
 *    the matching cases must FAIL. This proves the eval can actually fail.
 *
 * It is NOT a prediction of how Haiku answers. The live run is W3-EVALRUN.
 */

import type { CallClaudeParams, CallClaudeResult, ClaudeUsage, ContentBlock, ToolUseBlock } from "@/lib/ai/anthropic";
import type { CallClaudeFn } from "@/lib/mentor/seam";
import { effectiveExpect, viennaDate } from "./score";
import type { Expect, FixturesFile, GoldenCase } from "./types";
import { globToRegExp, parseIso } from "./values";

export const MUTATIONS = ["none", "wrong_date", "wrong_fee", "no_cite", "no_refusal", "obey_injection", "swap_publisher", "unlabelled", "leak_protocol"] as const;
export type Mutation = (typeof MUTATIONS)[number];

const MON_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function renderDate(iso: string, lang: "de" | "en"): string {
  const d = parseIso(iso);
  return lang === "de" ? `${d.day}. ${MON_DE[d.month - 1]} ${d.year}` : `${d.day} ${MON_EN[d.month - 1]} ${d.year}`;
}

function shiftIso(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const FILING_QUESTION = {
  de: "Wo hast du deine Nostrifizierung eingereicht: Wien, Graz oder Innsbruck?",
  en: "Where did you file your Nostrifizierung application: Wien, Graz or Innsbruck?",
};
const UNCONFIRMED_LINE = {
  de: "Das ist nicht offiziell bestätigt. Bitte frag bei der zuständigen Stelle nach.",
  en: "That is not officially confirmed. Please ask the responsible office.",
};
const REFUSAL_LINE = {
  de: "Dabei kann ich dir hier nicht helfen. Bitte wende dich an die zuständige offizielle Stelle.",
  en: "I cannot help with that here. Please contact the responsible official office.",
};
const FLAG_LINE = {
  de: "Bitte melde diese Frage mit dem Flag-Button, die Lösung und die Erklärung passen nicht zusammen.",
  en: "Please report this question with the flag button, the key and the explanation do not match.",
};

function allText(messages: CallClaudeParams["messages"]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "tool_result" ? (typeof b.content === "string" ? b.content : b.content.map((x) => x.text).join("")) : b.type === "text" ? b.text : "")).join("")))
    .join("\n");
}

function toolResultText(messages: CallClaudeParams["messages"]): string {
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_result") out.push(typeof b.content === "string" ? b.content : b.content.map((x) => x.text).join(""));
    }
  }
  return out.join("\n");
}

function lastUserText(messages: CallClaudeParams["messages"]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return null;
}

function systemText(system: CallClaudeParams["system"]): string {
  return system.map((b) => b.text).join("\n");
}

export interface ScriptedOptions {
  cases: readonly GoldenCase[];
  fixtures: FixturesFile;
  /** Pinned today (Vienna) for days-left; same value the scorer uses. */
  todayVienna: string;
  mutation?: Mutation;
  /** Model id the fake response reports (priced by pricing.ts). */
  model?: string;
}

function findCase(opts: ScriptedOptions, message: string, lang: string, questionId: string): GoldenCase | null {
  const hits = opts.cases.filter((c) => c.message === message);
  const qid = (c: GoldenCase) => String(c.question_fixture ? opts.fixtures.questions[c.question_fixture]?.id ?? "none" : "none");
  return hits.find((c) => c.lang === lang && qid(c) === questionId) ?? hits.find((c) => c.lang === lang) ?? hits[0] ?? null;
}

/** Fact ids the tool results carried (`"fact_id":"..."` in the brain's JSON). */
function factIdsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/"fact_id"\s*:\s*"([^"]+)"/g)) ids.add(m[1]);
  return [...ids];
}

function pickIds(e: Expect, seen: string[]): string[] {
  const globs = (e.cite_any ?? []).map(globToRegExp);
  return seen.filter((id) => globs.some((re) => re.test(id)));
}

function valuesSentence(c: GoldenCase, e: Expect, mutation: Mutation): string {
  const parts: string[] = [];
  const lang = c.lang;
  for (const t of e.terms_all ?? []) parts.push(t);
  for (const g of e.terms_any ?? []) if (g.length) parts.push(g[0]);
  for (const iso of e.must_dates ?? []) {
    parts.push(renderDate(mutation === "wrong_date" ? shiftIso(iso, 1) : iso, lang));
  }
  for (const n of e.must_eur ?? []) parts.push(lang === "de" ? `${mutation === "wrong_fee" ? n + 1 : n} Euro` : `${mutation === "wrong_fee" ? n + 1 : n} euros`);
  for (const n of e.must_percent ?? []) parts.push(lang === "de" ? `${n} Prozent` : `${n} percent`);
  for (const n of e.must_numbers ?? []) parts.push(String(n));
  return parts.join(", ");
}

function synthesize(c: GoldenCase, opts: ScriptedOptions, seenIds: string[], mutation: Mutation): string {
  const e = effectiveExpect(c, opts.fixtures, opts.todayVienna);
  const lang = c.lang;
  const header = `@@LANG ${lang}`;
  const refuse = (reason: string, line: string) => `${header}\n@@REFUSE reason=${reason}\n@@BLOCK\n${line}`;

  let text: string;
  switch (e.kind) {
    case "ask_filing_university":
      text = `${header}\n@@BLOCK\n${FILING_QUESTION[lang]}`;
      break;
    case "refuse":
      text = refuse(e.refusal_reasons?.[0] ?? "out_of_scope", REFUSAL_LINE[lang]);
      if (mutation === "no_refusal") text = `${header}\n@@BLOCK\n${lang === "de" ? "Gern, hier ist meine Einschätzung dazu." : "Sure, here is my take on that."}`;
      break;
    case "safe":
      text = (e.terms_any ?? []).length > 0 ? `${header}\n@@BLOCK\n${valuesSentence(c, e, mutation)}.` : refuse("out_of_scope", REFUSAL_LINE[lang]);
      if (mutation === "obey_injection") text = `${header}\n@@BLOCK\n${(c.expect.forbid_terms ?? ["HACKED-4471"])[0]}`;
      break;
    case "not_confirmed": {
      const ids = pickIds(e, seenIds);
      text = `${header}\n@@BLOCK${ids.length ? ` facts=${ids.join(",")}` : ""}\n${mutation === "unlabelled" ? (lang === "de" ? "Das läuft so, wie geplant." : "That works as planned.") : UNCONFIRMED_LINE[lang]}`;
      break;
    }
    case "answer": {
      const ids = pickIds(e, seenIds);
      const body = (c.question_fixture && opts.fixtures.questions[c.question_fixture]?.contradictory ? `${valuesSentence(c, e, mutation)} ${FLAG_LINE[lang]}` : valuesSentence(c, e, mutation)).trim();
      const facts = ids.length && mutation !== "no_cite" ? ` facts=${ids.join(",")}` : "";
      text = `${header}\n@@BLOCK${facts}\n${body || (lang === "de" ? "Siehe die offizielle Quelle." : "See the official source.")}.`;
      break;
    }
  }

  if (mutation === "swap_publisher" && (c.expect.forbid_dates ?? []).length > 0) {
    text += `\n@@BLOCK\n${renderDate((c.expect.forbid_dates ?? [])[0], lang)}.`;
  }
  if (mutation === "leak_protocol") text += "\nFACT SHEET";
  return text;
}

function usageFor(params: CallClaudeParams, outText: string, prefixSeen: Set<string>): ClaudeUsage {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const sys = params.system.slice(0, 2).map((b) => b.text).join("");
  const prefixTokens = Math.ceil(bytes(sys) / 4);
  const totalIn = Math.ceil(bytes(JSON.stringify(params.messages)) / 4) + Math.ceil(bytes(systemText(params.system)) / 4);
  const rest = Math.max(1, totalIn - prefixTokens);
  const hit = prefixSeen.has(sys);
  prefixSeen.add(sys);
  return {
    input_tokens: rest,
    output_tokens: Math.max(8, Math.ceil(bytes(outText) / 4)),
    cache_read_input_tokens: hit ? prefixTokens : 0,
    cache_creation_input_tokens: hit ? 0 : prefixTokens,
    cache_creation: { ephemeral_5m_input_tokens: hit ? 0 : prefixTokens, ephemeral_1h_input_tokens: 0 },
  };
}

/** The scripted model. One instance may serve many cases (prefix cache is simulated across calls). */
export function createScriptedCallClaude(opts: ScriptedOptions): CallClaudeFn {
  const mutation = opts.mutation ?? "none";
  const model = opts.model ?? "claude-haiku-5-5";
  const prefixSeen = new Set<string>();
  let n = 0;

  return async (params: CallClaudeParams): Promise<CallClaudeResult> => {
    n++;
    const message = lastUserText(params.messages);
    const lang = /lang=(\w+)/.exec(systemText(params.system))?.[1] ?? "de";
    const questionId = /question_id=(\w+)/.exec(systemText(params.system))?.[1] ?? "none";
    const c = message ? findCase(opts, message, lang, questionId) : null;
    if (!c) throw new Error(`scripted model: no golden case matches the last user message (${String(message).slice(0, 60)})`);

    const hasToolResult = toolResultText(params.messages).length > 0;
    const toolsOpen = (params.tools?.length ?? 0) > 0 && params.tool_choice?.type !== "none";
    params.onMessageStart?.({ input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model, request_id: `req_scripted_${n}` });

    if (!hasToolResult && toolsOpen && c.oracle?.tool) {
      const use: ToolUseBlock = { type: "tool_use", id: `toolu_scripted_${n}`, name: c.oracle.tool.name, input: c.oracle.tool.input };
      const blocks: ContentBlock[] = [use];
      return { text: "", blocks, toolUses: [use], usage: usageFor(params, JSON.stringify(use.input), prefixSeen), stop_reason: "tool_use", model, request_id: `req_scripted_${n}` };
    }

    const seen = factIdsIn(toolResultText(params.messages) || allText(params.messages));
    const text = synthesize(c, opts, seen, mutation);
    params.onTextDelta?.(text);
    return { text, blocks: [{ type: "text", text }], toolUses: [], usage: usageFor(params, text, prefixSeen), stop_reason: "end_turn", model, request_id: `req_scripted_${n}` };
  };
}

export function todayViennaOf(asOf: Date): string {
  return viennaDate(asOf);
}
