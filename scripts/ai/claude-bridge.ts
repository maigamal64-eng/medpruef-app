/**
 * Claude bridge for Python scripts (scripts/regenerate_ai_explanations.py).
 *
 * Reads one JSON request per stdin line and answers one line per request on
 * stdout, prefixed with "@@CLAUDE " (other stdout lines are not answers).
 * Calls go through callClaude, so the auth follows ANTHROPIC_AUTH_MODE:
 * stays in this process; Python never sees a credential.
 *
 * Request  {"id": 1, "op": "legacy_explain", "row": {question, answer, explanation, topic, choices},
 *           "lang": "de"|"en", "user": "...", "model": "claude-haiku-4-5", "max_tokens": 1024}
 * Answer   {"id": 1, "ok": true, "text": "...", "usage": {"input_tokens": n, "output_tokens": n}, "model": "..."}
 *          {"id": 1, "ok": false, "error": "<code>: <short message>"}
 *
 * legacy_explain uses the production /api/ai-chat system prompt
 * (buildLegacyExplainPrompt) and its citation guard, so cached explanations
 * written by the script match what learners get from the route.
 */
import readline from "node:readline";
import { AiError, callClaude } from "@/lib/ai/anthropic";
import { guardCitations } from "@/lib/ai/citation-guard";
import { buildLegacyExplainPrompt, type LegacyExplainRow } from "@/lib/ai/legacy-explain-prompt";
import { describeWifLocalError, installWifLocal } from "./wif-local";

export const ANSWER_PREFIX = "@@CLAUDE ";

export interface RunnerRequest {
  id?: unknown;
  op?: unknown;
  row?: unknown;
  lang?: unknown;
  user?: unknown;
  model?: unknown;
  max_tokens?: unknown;
}

type Call = typeof callClaude;

function errorText(err: unknown): string {
  if (err instanceof AiError) return `${err.code}: ${err.message.replace(/\s+/g, " ").slice(0, 200)}`;
  return "runner_error";
}

export async function handle(req: RunnerRequest, call: Call = callClaude): Promise<Record<string, unknown>> {
  const id = typeof req.id === "number" || typeof req.id === "string" ? req.id : null;
  if (req.op !== "legacy_explain") return { id, ok: false, error: "bad_request: unknown op" };
  const lang = req.lang === "en" ? "en" : "de";
  const row = req.row && typeof req.row === "object" ? (req.row as LegacyExplainRow) : null;
  if (!row || typeof row.question !== "string" || row.question.trim() === "") return { id, ok: false, error: "bad_request: row.question missing" };
  if (typeof req.user !== "string" || req.user.trim() === "") return { id, ok: false, error: "bad_request: user missing" };
  if (typeof req.model !== "string" || !req.model.startsWith("claude-")) return { id, ok: false, error: "bad_request: model must be a claude-* id" };
  const maxTokens = typeof req.max_tokens === "number" && req.max_tokens > 0 ? Math.min(Math.floor(req.max_tokens), 4096) : 1024;
  try {
    const res = await call({
      model: req.model,
      effort: "low",
      system: [{ type: "text", text: buildLegacyExplainPrompt(row, lang) }],
      messages: [{ role: "user", content: req.user }],
      max_tokens: maxTokens,
      timeoutMs: 60_000,
    });
    const text = guardCitations(res.text, lang).text;
    return { id, ok: true, text, model: res.model, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
  } catch (err) {
    return { id, ok: false, error: errorText(err) };
  }
}

export async function main(): Promise<number> {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    process.stderr.write("claude-runner: refusing to run on Vercel\n");
    return 2;
  }
  const provider = installWifLocal(process.env);
  if (provider) {
    // Fail fast before Python sends anything: one exchange, cached for the run.
    try {
      await provider.get();
    } catch (err) {
      process.stderr.write(`claude-runner: wif-local ${describeWifLocalError(err)}\n`);
      return 2;
    }
  }
  process.stdout.write(`${ANSWER_PREFIX}${JSON.stringify({ ready: true, auth: provider ? "wif-local" : "api_key" })}\n`);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: RunnerRequest;
    try {
      req = JSON.parse(line) as RunnerRequest;
    } catch {
      process.stdout.write(`${ANSWER_PREFIX}${JSON.stringify({ id: null, ok: false, error: "bad_request: not JSON" })}\n`);
      continue;
    }
    const answer = await handle(req);
    process.stdout.write(`${ANSWER_PREFIX}${JSON.stringify(answer)}\n`);
  }
  return 0;
}
