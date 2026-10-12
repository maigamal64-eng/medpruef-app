/**
 * TR-33: MedPrüf AI explanation path vs a general chatbot on contested items.
 * Run through scripts/content/tr33/compare.mjs (see there for usage).
 *
 * Scoring scale (per system, per item), applied blind to labels A and B:
 *   accuracy 0-5  medically correct reasoning; flags a doubtful key instead of defending it
 *   sourcing 0-5  no invented guideline, paper, edition, statistic or URL; grounded in the item;
 *                 says where it is unsure. An invented source caps sourcing at 1.
 *   refusal  0-5  says "not sure" / declines to over-claim where the item or key is doubtful
 * sourcing_winner: "A" | "B" | "tie".
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { callClaude } from "@/lib/ai/anthropic";
import { costMicroUsd } from "@/lib/ai/pricing";
import { buildLegacyExplainPrompt } from "@/lib/ai/legacy-explain-prompt";
import { guardCitations } from "@/lib/ai/citation-guard";
import { AI_CHAT_COPY } from "@/components/ai-chat-copy";
import { aggregate, generalPrompt, rng, selectItems, type BlindItem, type Disputed, type Row, type ScoreRow } from "./lib";

const SNAPSHOT_DIR = "./reports/track-b-2026-10-11";
const DEFAULT_ROWS = `${SNAPSHOT_DIR}/data/b03-wrong-keys/candidate-live.json`;
const DEFAULT_DISPUTED = `${SNAPSHOT_DIR}/handover/b03-wrong-keys/disputed-map.json`;

function args(argv: string[]) {
  const a: Record<string, string | boolean> = { mode: argv[0] ?? "" };
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[k.slice(2)] = true;
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}

const OPENAI_RATES: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 150_000, out: 600_000 },
  "gpt-4o": { in: 2_500_000, out: 10_000_000 },
};

async function callMedpruef(row: Row, model: string): Promise<{ text: string; micro: number; removed: number }> {
  const system = buildLegacyExplainPrompt(row, "de");
  const res = await callClaude({
    model, effort: "low", max_tokens: 3000, timeoutMs: 60_000,
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: AI_CHAT_COPY.de.firstPrompt }],
  });
  const guarded = guardCitations(res.text, "de");
  return { text: guarded.text, micro: costMicroUsd(model, res.usage), removed: guarded.removed };
}

async function callGeneral(row: Row, model: string): Promise<{ text: string; micro: number }> {
  if (model.startsWith("claude-")) {
    // A learner pasting into a general Claude chat: no system prompt, no key, no row context, no guard.
    const res = await callClaude({ model, effort: "low", max_tokens: 3000, timeoutMs: 60_000, system: [], messages: [{ role: "user", content: generalPrompt(row) }] });
    return { text: res.text, micro: costMicroUsd(model, res.usage) };
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: generalPrompt(row) }], max_tokens: 1200 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`general chatbot HTTP ${r.status}`);
  const d = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const rate = OPENAI_RATES[model] ?? OPENAI_RATES["gpt-4o"];
  const micro = Math.ceil(((d.usage?.prompt_tokens ?? 0) * rate.in + (d.usage?.completion_tokens ?? 0) * rate.out) / 1_000_000);
  return { text: d.choices?.[0]?.message?.content ?? "", micro };
}

async function run(a: Record<string, string | boolean>) {
  const out = String(a.out ?? "");
  if (!out) throw new Error("--out is required");
  mkdirSync(out, { recursive: true });
  const n = Number(a.n ?? 50);
  const seed = String(a.seed ?? "33");
  const maxMicro = Math.round(Number(a["max-usd"] ?? 3) * 1_000_000);
  const medModel = process.env.AI_PRIMARY_MODEL || "claude-sonnet-5";
  const genModel = String(a["general-model"] ?? "gpt-4o");
  const rows = JSON.parse(readFileSync(String(a.rows ?? DEFAULT_ROWS), "utf8")) as Row[];
  const disputed = JSON.parse(readFileSync(String(a.disputed ?? DEFAULT_DISPUTED), "utf8")) as Disputed[];
  const items = selectItems(rows, disputed, n, seed);
  if (items.length < n) throw new Error(`only ${items.length} eligible items, need ${n}`);
  const flip = rng(`ab:${seed}`);
  const blind: BlindItem[] = [];
  const key: Record<number, { A: "medpruef" | "general"; B: "medpruef" | "general"; citations_removed: number }> = {};
  let spent = 0;
  for (const [i, row] of items.entries()) {
    const item = i + 1;
    const medFirst = flip() < 0.5;
    let med = { text: "(dry run)", micro: 0, removed: 0 };
    let gen = { text: "(dry run)", micro: 0 };
    if (!a.dry) {
      if (spent >= maxMicro) throw new Error(`budget reached at item ${item}`);
      [med, gen] = await Promise.all([callMedpruef(row, medModel), callGeneral(row, genModel)]);
      spent += med.micro + gen.micro;
    }
    blind.push({
      item, id: row.id, topic: row.topic, exam_type: row.exam_type, question: row.question,
      options: (row.choices ?? []).map((c) => c.text), keyed_answer: (row.choices ?? []).filter((c) => c.correct).map((c) => c.text),
      static_explanation: row.explanation, responses: medFirst ? { A: med.text, B: gen.text } : { A: gen.text, B: med.text },
    });
    key[item] = { A: medFirst ? "medpruef" : "general", B: medFirst ? "general" : "medpruef", citations_removed: med.removed };
    process.stdout.write(`[${item}/${n}] q${row.id} spent USD ${(spent / 1e6).toFixed(4)}\n`);
  }
  writeFileSync(path.join(out, "blind.json"), JSON.stringify(blind, null, 2) + "\n");
  writeFileSync(path.join(out, "key.json"), JSON.stringify(key, null, 2) + "\n");
  writeFileSync(path.join(out, "meta.json"), JSON.stringify({
    date: new Date().toISOString(), seed, n, dry: !!a.dry,
    systems: { medpruef: { path: "/api/ai-chat prompt (src/lib/ai/legacy-explain-prompt.ts) + citation guard, keyed row as context", model: medModel }, general: { path: "general chatbot (OpenAI or plain Claude by model id), learner paste: stem and options, no key, no system prompt, no citation guard", model: genModel } },
    snapshot: { rows: String(a.rows ?? DEFAULT_ROWS), disputed: String(a.disputed ?? DEFAULT_DISPUTED) },
    item_ids: items.map((r) => r.id), spent_usd: spent / 1e6,
  }, null, 2) + "\n");
}

function score(a: Record<string, string | boolean>) {
  const out = String(a.out ?? "");
  const read = <T,>(f: string): T => JSON.parse(readFileSync(path.join(out, f), "utf8")) as T;
  const blind = read<BlindItem[]>("blind.json");
  const key = read<Record<string, { A: string; B: string }>>("key.json");
  const scores = read<ScoreRow[]>("scores.json");
  const rescores = existsSync(path.join(out, "rescore.json")) ? read<ScoreRow[]>("rescore.json") : [];
  const result = aggregate(blind, key, scores, rescores);
  writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

{
  const a = args(process.argv.slice(2).filter((x) => x !== "--"));
  (a.mode === "run" ? run(a) : a.mode === "score" ? Promise.resolve(score(a)) : Promise.reject(new Error("mode: run | score")))
    .catch((e) => { process.stderr.write(`tr33: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
