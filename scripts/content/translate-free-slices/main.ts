/**
 * Free-set explanation translation staging (a29, CNT-35, LX-21). Run through
 * scripts/content/translate-free-slices.mjs:
 *
 *   plan    (default, read-only): reads the free-set rows and their cached
 *           explanation translations, writes plan.json with missing cells
 *           per bank and language and a token estimate. No model call.
 *   stage   --live --max-usd <n> [--pilot 50] [--langs ru,uk] [--model id]
 *           translates missing cells with the same prompt as POST
 *           /api/translate and appends them to staging.jsonl. Never writes the
 *           database. Stops before the next call could pass --max-usd.
 *   sql     --staging <file> --signoff <file> writes apply.sql: guarded
 *           INSERTs for languages with a dated passing native review only.
 *   sample  --staging <file> [--per-lang 30] writes signoff-template.json
 *           with sample ids per language for the native reviewers.
 *   batch-submit  --live --max-usd <n> [--pilot 50] [--langs ru,uk] [--model id]
 *           the same cells and prompt as stage, sent through the Message
 *           Batches API at half price (scripts/ai-batch/runner.ts). Batch
 *           state lives in <out>/batch; the --max-usd cap also counts the
 *           live stage ledger. Never writes the database.
 *   batch-collect  polls, collects ended batches and appends usable
 *           translations to staging.jsonl (same rows as stage, so sample and
 *           sql work unchanged). Run it again until no batch is open.
 *
 * Every database access is a SELECT. Keys come from the environment and are
 * never printed. Output goes to --out (default
 * reports/master-plan-2026-10-11/language-signoff/data).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { callClaude } from "@/lib/ai/anthropic";
import { collect as collectBatches, latestResults, openWorstMicro, poll as pollBatches, readResults, readState, spentMicro as batchSpentMicro, submit as submitBatches, type BatchItem } from "../../ai-batch/runner";
import { installWifLocal } from "../../ai/wif-local";
import { costMicroUsd } from "@/lib/ai/pricing";
import {
  buildTranslationSystem,
  buildTranslationUser,
  isTranslationTarget,
  isUsableTranslation,
  TRANSLATION_LANG_LABELS,
  type TranslationTarget,
} from "@/lib/explanation-translation";
import {
  SLICE_EXAMS,
  STAGE_FIELD,
  STAGE_LANGS,
  buildApplySql,
  estimateTokens,
  pilotCells,
  planCells,
  priorSpendMicro,
  sliceIds,
  sourceHash,
  translationCustomId,
  type CachedCell,
  type Cell,
  type SignoffEntry,
  type SourceRow,
  type StagedRow,
} from "./lib";

if (process.env.VERCEL_ENV === "production") process.exit(2);
installWifLocal();

// The launcher runs with cwd at the repository root.
const ROOT = process.cwd();
const DEFAULT_OUT = path.join(ROOT, "reports", "master-plan-2026-10-11", "language-signoff", "data");
// pick-translation-batch A / pick-translation-model A: the free-set batch runs
// on the quality model; the on-demand route model is a separate decision.
const DEFAULT_MODEL = "claude-sonnet-5";

function args(argv: string[]): Record<string, string | boolean> {
  const a: Record<string, string | boolean> = { mode: argv[0] && !argv[0].startsWith("--") ? argv[0] : "plan" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[k.slice(2)] = true;
    else {
      a[k.slice(2)] = next;
      i++;
    }
  }
  return a;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    process.stderr.write("translate-free-slices: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for plan and stage.\n");
    process.exit(2);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readSlice(): Promise<{ cells: Cell[]; summaries: unknown[]; sources: Map<number, string> }> {
  const sb = db();
  const cells: Cell[] = [];
  const summaries: unknown[] = [];
  const sources = new Map<number, string>();
  for (const exam of SLICE_EXAMS) {
    const ids = sliceIds(exam);
    const { data: rows, error } = await sb.from("questions").select("id, exam_type, is_active, explanation").in("id", ids);
    if (error) throw new Error(`questions read failed: ${error.message}`);
    const { data: cached, error: cErr } = await sb
      .from("question_translations")
      .select("question_id, lang, field, translated_text")
      .eq("field", STAGE_FIELD)
      .in("question_id", ids);
    if (cErr) throw new Error(`question_translations read failed: ${cErr.message}`);
    for (const r of (rows ?? []) as SourceRow[]) if (r.explanation) sources.set(r.id, r.explanation);
    const plan = planCells(exam, ids, (rows ?? []) as SourceRow[], (cached ?? []) as CachedCell[]);
    cells.push(...plan.cells);
    summaries.push(plan.summary);
  }
  return { cells, summaries, sources };
}

function outDir(a: Record<string, string | boolean>): string {
  const dir = typeof a.out === "string" ? path.resolve(a.out) : DEFAULT_OUT;
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function plan(a: Record<string, string | boolean>) {
  const { cells, summaries } = await readSlice();
  const tokens = estimateTokens(cells);
  const report = {
    generated_at: new Date().toISOString(),
    rule: "free set (src/lib/free-set.ts freeSetIds), explanation field, languages " + STAGE_LANGS.join(", "),
    missing_cells: cells.length,
    estimated_tokens: tokens,
    estimated_usd: {
      [DEFAULT_MODEL]: costMicroUsd(DEFAULT_MODEL, { input_tokens: tokens.input, output_tokens: tokens.output }) / 1_000_000,
      "claude-haiku-4-5": costMicroUsd("claude-haiku-4-5", { input_tokens: tokens.input, output_tokens: tokens.output }) / 1_000_000,
    },
    banks: summaries,
  };
  const file = path.join(outDir(a), "plan.json");
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`plan: ${cells.length} missing cells, about ${tokens.input} input and ${tokens.output} output tokens. Written ${path.relative(ROOT, file)}\n`);
}

async function stage(a: Record<string, string | boolean>) {
  if (a.live !== true) {
    process.stderr.write("stage: pass --live to call the model (spends API credit). Nothing was called.\n");
    process.exit(2);
  }
  const maxUsd = Number(a["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 18) {
    process.stderr.write("stage: --max-usd between 0 and 18 is required (pick-translation-batch A stops at 18 USD).\n");
    process.exit(2);
  }
  const model = typeof a.model === "string" ? a.model : DEFAULT_MODEL;
  const langs = typeof a.langs === "string" ? a.langs.split(",").filter(isTranslationTarget) : [...STAGE_LANGS];
  const { cells, sources } = await readSlice();
  let todo = cells.filter((c) => langs.includes(c.lang));
  if (typeof a.pilot === "string") todo = pilotCells(todo, Math.max(1, Math.min(200, Number(a.pilot) || 50)));
  const file = path.join(outDir(a), "staging.jsonl");
  const done = new Set<string>();
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as StagedRow;
      done.add(`${r.question_id}:${r.lang}:${r.source_sha256}`);
    }
  }
  // The cap covers the whole batch, not one run: every call appends its spend
  // to spend.jsonl (next to the staging file, so keep one --out per batch) and
  // the next run starts from that total.
  const maxMicro = Math.round(maxUsd * 1_000_000);
  const ledger = path.join(path.dirname(file), "spend.jsonl");
  // The 18 USD cap covers live staging and batches together: add what the
  // batch runner spent and the worst case of its open batches.
  const batchDir = path.join(path.dirname(file), "batch");
  const prior = (existsSync(ledger) ? priorSpendMicro(readFileSync(ledger, "utf8")) : 0) + batchCommittedMicro(batchDir);
  if (prior >= maxMicro) {
    process.stderr.write(`stage: earlier runs already spent ${(prior / 1_000_000).toFixed(4)} USD of the ${maxUsd} USD cap. Nothing was called.\n`);
    process.exit(2);
  }
  let spent = 0;
  let staged = 0;
  let failed = 0;
  try {
    for (const cell of todo) {
      if (done.has(`${cell.question_id}:${cell.lang}:${cell.source_sha256}`)) continue;
      const source = sources.get(cell.question_id);
      if (!source || sourceHash(source) !== cell.source_sha256) continue;
      // Stop before the next call could exceed the budget (output at most 4096 tokens).
      const worst = costMicroUsd(model, { input_tokens: Math.ceil((source.length + 1300) / 2), output_tokens: 4096 });
      if (prior + spent + worst > maxMicro) break;
      try {
        const res = await callClaude({
          model,
          effort: "low",
          max_tokens: 4096,
          timeoutMs: 30_000,
          system: [{ type: "text", text: buildTranslationSystem(TRANSLATION_LANG_LABELS[cell.lang as TranslationTarget]) }],
          messages: [{ role: "user", content: buildTranslationUser(source) }],
        });
        const callMicro = costMicroUsd(model, res.usage);
        spent += callMicro;
        appendFileSync(ledger, `${JSON.stringify({ at: new Date().toISOString(), model, micro: callMicro })}\n`);
        const text = res.text.trim();
        if (!isUsableTranslation(text, source)) {
          failed += 1;
          continue;
        }
        const row: StagedRow = { ...cell, field: STAGE_FIELD, translated_text: text, source_model: model, staged_at: new Date().toISOString() };
        appendFileSync(file, `${JSON.stringify(row)}\n`);
        staged += 1;
      } catch (err) {
        // A failed call may still have run (timeout after generation): book
        // its reported usage, else the worst case, so the cap stays honest.
        const usage = (err as { usage?: Parameters<typeof costMicroUsd>[1] }).usage;
        const callMicro = usage ? costMicroUsd(model, usage) : worst;
        spent += callMicro;
        appendFileSync(ledger, `${JSON.stringify({ at: new Date().toISOString(), model, micro: callMicro, failed: true })}\n`);
        failed += 1;
        process.stderr.write(`stage: question ${cell.question_id} ${cell.lang} failed (${(err as Error).name})\n`);
      }
    }
  } finally {
    // Per-call lines above carry the spend (a kill mid-run keeps them); this
    // summary line books nothing.
    appendFileSync(ledger, `${JSON.stringify({ at: new Date().toISOString(), model, micro: 0, run_total_micro: spent, staged, failed })}\n`);
  }
  process.stdout.write(`stage: ${staged} staged, ${failed} failed, ${(spent / 1_000_000).toFixed(4)} USD this run, ${((prior + spent) / 1_000_000).toFixed(4)} USD in total. Staging file ${path.relative(ROOT, file)} (not the database).\n`);
}

interface BatchMeta {
  custom_id: string;
  cell: Cell;
  source: string;
  model: string;
}

function stagedKeys(file: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(file)) return done;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as StagedRow;
    done.add(`${r.question_id}:${r.lang}:${r.source_sha256}`);
  }
  return done;
}

/** Batch spend so far plus the worst case of batches not yet collected (items priced from the meta sidecar). */
function batchCommittedMicro(batchDir: string): number {
  if (!existsSync(batchDir)) return 0;
  const metaFile = path.join(batchDir, "items-meta.jsonl");
  const items = new Map<string, BatchItem>();
  if (existsSync(metaFile)) {
    for (const m of readJsonl<BatchMeta>(metaFile)) {
      items.set(m.custom_id, {
        custom_id: m.custom_id,
        params: {
          model: m.model,
          effort: "low",
          max_tokens: 4096,
          system: [{ type: "text", text: buildTranslationSystem(TRANSLATION_LANG_LABELS[m.cell.lang as TranslationTarget]) }],
          messages: [{ role: "user", content: buildTranslationUser(m.source) }],
        },
      });
    }
  }
  return batchSpentMicro(batchDir) + openWorstMicro(readState(batchDir), items);
}

async function batchSubmit(a: Record<string, string | boolean>) {
  if (a.live !== true) {
    process.stderr.write("batch-submit: pass --live to submit (spends API credit). Nothing was sent.\n");
    process.exit(2);
  }
  const maxUsd = Number(a["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 18) {
    process.stderr.write("batch-submit: --max-usd between 0 and 18 is required (pick-translation-batch A stops at 18 USD).\n");
    process.exit(2);
  }
  const model = typeof a.model === "string" ? a.model : DEFAULT_MODEL;
  const langs = typeof a.langs === "string" ? a.langs.split(",").filter(isTranslationTarget) : [...STAGE_LANGS];
  const { cells, sources } = await readSlice();
  let todo = cells.filter((c) => langs.includes(c.lang));
  if (typeof a.pilot === "string") todo = pilotCells(todo, Math.max(1, Math.min(200, Number(a.pilot) || 50)));
  const dir = outDir(a);
  const done = stagedKeys(path.join(dir, "staging.jsonl"));
  const items: BatchItem[] = [];
  const metas: BatchMeta[] = [];
  for (const cell of todo) {
    if (done.has(`${cell.question_id}:${cell.lang}:${cell.source_sha256}`)) continue;
    const source = sources.get(cell.question_id);
    if (!source || sourceHash(source) !== cell.source_sha256) continue;
    const custom_id = translationCustomId(cell);
    items.push({
      custom_id,
      params: {
        model,
        effort: "low",
        max_tokens: 4096,
        system: [{ type: "text", text: buildTranslationSystem(TRANSLATION_LANG_LABELS[cell.lang as TranslationTarget]) }],
        messages: [{ role: "user", content: buildTranslationUser(source) }],
      },
    });
    metas.push({ custom_id, cell, source, model });
  }
  const batchDir = path.join(dir, "batch");
  mkdirSync(batchDir, { recursive: true });
  // The meta sidecar maps results back to cells at collect time.
  if (metas.length) appendFileSync(path.join(batchDir, "items-meta.jsonl"), `${metas.map((m) => JSON.stringify(m)).join("\n")}\n`);
  const ledger = path.join(dir, "spend.jsonl");
  const livePrior = existsSync(ledger) ? priorSpendMicro(readFileSync(ledger, "utf8")) : 0;
  const r = await submitBatches(batchDir, items, { maxUsd, extraPriorMicro: livePrior });
  process.stdout.write(`batch-submit: ${r.submitted} cells in ${r.batches.length} batch(es); ${r.skippedDone} already done or open, ${r.skippedBudget} over the ${maxUsd} USD cap. State ${path.relative(ROOT, batchDir)} (not the database).\n`);
}

async function batchCollect(a: Record<string, string | boolean>) {
  const dir = outDir(a);
  const batchDir = path.join(dir, "batch");
  await pollBatches(batchDir);
  const c = await collectBatches(batchDir);
  const metaFile = path.join(batchDir, "items-meta.jsonl");
  const metas = new Map<string, BatchMeta>();
  if (existsSync(metaFile)) for (const m of readJsonl<BatchMeta>(metaFile)) metas.set(m.custom_id, m);
  const file = path.join(dir, "staging.jsonl");
  const done = stagedKeys(file);
  let staged = 0;
  let unusable = 0;
  for (const r of latestResults(readResults(batchDir)).values()) {
    if (r.type !== "succeeded" || !r.text) continue;
    const m = metas.get(r.custom_id);
    if (!m) continue;
    const key = `${m.cell.question_id}:${m.cell.lang}:${m.cell.source_sha256}`;
    if (done.has(key)) continue;
    const text = r.text.trim();
    if (!isUsableTranslation(text, m.source)) {
      unusable += 1;
      continue;
    }
    const row: StagedRow = { ...m.cell, field: STAGE_FIELD, translated_text: text, source_model: r.model ?? m.model, staged_at: new Date().toISOString() };
    appendFileSync(file, `${JSON.stringify(row)}\n`);
    done.add(key);
    staged += 1;
  }
  const open = readState(batchDir).batches.filter((b) => !b.collected_at).length;
  process.stdout.write(`batch-collect: ${c.collected} results collected (USD ${(c.micro / 1_000_000).toFixed(4)}), ${staged} staged, ${unusable} unusable, ${open} batch(es) still open. Staging file ${path.relative(ROOT, file)} (not the database).\n`);
}

function readJsonl<T>(file: string): T[] {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

function sql(a: Record<string, string | boolean>) {
  if (typeof a.staging !== "string" || typeof a.signoff !== "string") {
    process.stderr.write("sql: --staging <staging.jsonl> and --signoff <signoff.json> are required.\n");
    process.exit(2);
  }
  const rows = readJsonl<StagedRow>(a.staging);
  const signoff = (JSON.parse(readFileSync(a.signoff, "utf8")) as { languages: SignoffEntry[] }).languages;
  const out = buildApplySql(rows, signoff);
  const file = path.join(outDir(a), "apply.sql");
  writeFileSync(file, out.sql);
  process.stdout.write(`sql: ${out.included} rows in ${path.relative(ROOT, file)}, ${out.skipped} skipped (unapproved language or unusable). Not applied.\n`);
}

function sample(a: Record<string, string | boolean>) {
  if (typeof a.staging !== "string") {
    process.stderr.write("sample: --staging <staging.jsonl> is required.\n");
    process.exit(2);
  }
  const per = Math.max(1, Math.min(100, Number(a["per-lang"]) || 30));
  const rows = readJsonl<StagedRow>(a.staging);
  const languages = STAGE_LANGS.map((lang) => ({
    lang,
    reviewer: null,
    reviewed_on: null,
    verdict: "pending",
    critical_errors: null,
    ...(lang === "ar" ? { countersigned_by_owner: null } : {}),
    sample_ids: pilotCells(rows.filter((r) => r.lang === lang), per).map((r) => r.question_id),
  }));
  const file = path.join(outDir(a), "signoff-template.json");
  writeFileSync(file, `${JSON.stringify({ generated_at: new Date().toISOString(), languages }, null, 2)}\n`);
  process.stdout.write(`sample: ${path.relative(ROOT, file)}\n`);
}

const a = args(process.argv.slice(2).filter((x) => x !== "--"));
const modes: Record<string, (a: Record<string, string | boolean>) => unknown> = { plan, stage, sql, sample, "batch-submit": batchSubmit, "batch-collect": batchCollect };
const run = modes[String(a.mode)];
if (!run) {
  process.stderr.write("usage: translate-free-slices.mjs [plan|stage|sql|sample] (see header)\n");
  process.exit(2);
}
Promise.resolve(run(a)).catch((err) => {
  process.stderr.write(`translate-free-slices: ${(err as Error).message}\n`);
  process.exit(1);
});
