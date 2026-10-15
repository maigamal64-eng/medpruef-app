/**
 * Explanation translation staging (a29, CNT-35, LX-21; a-content-c1 adds the
 * C4 whole-bank English scope, keyless credentials and back-translation QA).
 * Run through scripts/content/translate-free-slices.mjs:
 *
 *   plan    (default, read-only): reads the rows in scope and their cached
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
 *           live stage ledger and the QA batches. Never writes the database.
 *   batch-collect  polls, collects ended batches and appends usable
 *           translations to staging.jsonl (same rows as stage, so sample and
 *           sql work unchanged). Run it again until no batch is open.
 *   qa-submit  --live --max-usd <n> [--rate 0.05]   (C4 QA)
 *           a seeded 5 % sample per language of staging.jsonl: Claude Haiku
 *           5.5 back-translates into German and flags meaning drift
 *           (Message Batches, <out>/qa-batch). Same cap ledger.
 *   qa-collect  writes qa.jsonl and qa-summary.json (drift per language).
 *
 * Scope (C4, content.json): --scope free-set (default) is the a29 slice in
 * all seven languages. --scope bank is English only, for every active
 * question, ordered by 90-day exposure (hot rows first); it reads its source
 * rows and exposure from a pre-screen snapshot (--snapshot, see
 * scripts/content/prescreen.mjs) and the cached English cells from the
 * database (read-only). Its default model is claude-sonnet-5-5
 * (content.json C4); the free-set default stays claude-sonnet-5
 * (pick-translation-model A). The USD 18 cap per --out ledger
 * (pick-translation-batch A) holds for both scopes.
 *
 * wif, a-content-c1); a static API key is removed from the process and
 * refused. Every database access is a SELECT. Output goes to --out (default
 * reports/master-plan-2026-10-11/language-signoff/data, or .../data-en-bank
 * for --scope bank).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { callClaude } from "@/lib/ai/anthropic";
import type { AnthropicAuth } from "@/lib/ai/credentials";
import { MODEL_IDS, costMicroUsd } from "@/lib/ai/pricing";
import { collect as collectBatches, defaultIo, latestResults, openWorstMicro, poll as pollBatches, readResults, readState, spentMicro as batchSpentMicro, submit as submitBatches, type BatchItem, type RunnerIo } from "../../ai-batch/runner";
import { assertKeylessMode, dropStaticKeys, keylessAuth } from "../lib/keyless-auth";
import { buildTranslationSystem, buildTranslationUser, isTranslationTarget, isUsableTranslation, TRANSLATION_LANG_LABELS, type TranslationTarget } from "@/lib/explanation-translation";
import { readSnapshot } from "../prescreen/io";
import {
  BANK_SCOPE_LANGS,
  QA_SCHEMA,
  QA_SYSTEM,
  SLICE_EXAMS,
  STAGE_FIELD,
  STAGE_LANGS,
  buildApplySql,
  buildQaUser,
  estimateTokens,
  orderCellsHotFirst,
  parseQa,
  pilotCells,
  planCells,
  priorSpendMicro,
  qaCustomId,
  qaSample,
  sliceIds,
  sourceHash,
  translationCustomId,
  type CachedCell,
  type Cell,
  type SignoffEntry,
  type SourceRow,
  type StagedRow,
  type StageScope,
} from "./lib";

// pick-translation-batch A / pick-translation-model A: the free-set batch runs
// on the quality model; the on-demand route model is a separate decision.
const FREE_SET_MODEL = "claude-sonnet-5";
// content.json C4: the whole-bank English batch runs on Claude Sonnet 5.5.
const BANK_MODEL = MODEL_IDS.SONNET_5_5;
const QA_MODEL = MODEL_IDS.HAIKU_5_5;
const MAX_USD = 18;

type Args = Record<string, string | boolean>;

export interface Slice {
  cells: Cell[];
  summaries: unknown[];
  sources: Map<number, string>;
}

export interface TranslateDeps {
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
  err?: (line: string) => void;
  root?: string;
  /** Batches network (tests pass a fake API). */
  fetch?: typeof fetch;
  /** Keyless token resolver (default: the shared credential helper in a keyless mode). */
  resolveAuth?: () => Promise<AnthropicAuth>;
  /** Slice reader override (tests); default reads the database (SELECT only). */
  readSlice?: (scope: StageScope, a: Args) => Promise<Slice>;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const a: Args = { mode: argv[0] && !argv[0].startsWith("--") ? argv[0] : "plan" };
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

export function scopeOf(a: Args): StageScope {
  const s = typeof a.scope === "string" ? a.scope : "free-set";
  if (s !== "free-set" && s !== "bank") throw new UsageError("--scope must be free-set or bank");
  return s;
}

/** Languages for this run: the bank scope is English only (content.json C4). */
export function langsFor(a: Args, scope: StageScope): TranslationTarget[] {
  const requested = typeof a.langs === "string" ? a.langs.split(",").filter(isTranslationTarget) : scope === "bank" ? [...BANK_SCOPE_LANGS] : [...STAGE_LANGS];
  if (scope === "bank" && requested.some((l) => !BANK_SCOPE_LANGS.includes(l))) throw new UsageError("--scope bank stages English only (content.json C4); other languages stay on the free set.");
  return requested;
}

function modelFor(a: Args, scope: StageScope): string {
  return typeof a.model === "string" ? a.model : scope === "bank" ? BANK_MODEL : FREE_SET_MODEL;
}

function db(env: NodeJS.ProcessEnv) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new UsageError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for plan and stage (read-only).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readFreeSetSlice(env: NodeJS.ProcessEnv): Promise<Slice> {
  const sb = db(env);
  const cells: Cell[] = [];
  const summaries: unknown[] = [];
  const sources = new Map<number, string>();
  for (const exam of SLICE_EXAMS) {
    const ids = sliceIds(exam);
    const { data: rows, error } = await sb.from("questions").select("id, exam_type, is_active, explanation").in("id", ids);
    if (error) throw new Error(`questions read failed: ${error.message}`);
    const { data: cached, error: cErr } = await sb.from("question_translations").select("question_id, lang, field, translated_text").eq("field", STAGE_FIELD).in("question_id", ids);
    if (cErr) throw new Error(`question_translations read failed: ${cErr.message}`);
    for (const r of (rows ?? []) as SourceRow[]) if (r.explanation) sources.set(r.id, r.explanation);
    const plan = planCells(exam, ids, (rows ?? []) as SourceRow[], (cached ?? []) as CachedCell[]);
    cells.push(...plan.cells);
    summaries.push(plan.summary);
  }
  return { cells, summaries, sources };
}

/** Cached English explanation cells, paged by id (read-only). */
async function readCachedEnglish(env: NodeJS.ProcessEnv): Promise<CachedCell[]> {
  const sb = db(env);
  const out: CachedCell[] = [];
  let last = 0;
  for (;;) {
    const { data, error } = await sb
      .from("question_translations")
      .select("id, question_id, lang, field, translated_text")
      .eq("field", STAGE_FIELD)
      .eq("lang", "en")
      .gt("id", last)
      .order("id", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`question_translations read failed: ${error.message}`);
    const rows = (data ?? []) as Array<CachedCell & { id: number }>;
    out.push(...rows);
    if (rows.length < 1000) return out;
    last = rows[rows.length - 1].id;
  }
}

/** Whole-bank English cells from a pre-screen snapshot, hot rows first. */
export function bankSlice(snapshotFile: string, cached: readonly CachedCell[], langs: readonly TranslationTarget[]): Slice {
  const snap = readSnapshot(snapshotFile);
  const cells: Cell[] = [];
  const summaries: unknown[] = [];
  const sources = new Map<number, string>();
  for (const exam of SLICE_EXAMS) {
    const rows = snap.rows.filter((r) => r.exam_type === exam);
    const src: SourceRow[] = rows.map((r) => ({ id: r.id, exam_type: r.exam_type, is_active: r.is_active, explanation: r.explanation }));
    for (const r of src) if (r.explanation) sources.set(r.id, r.explanation);
    const plan = planCells(exam, rows.map((r) => r.id), src, cached, langs);
    cells.push(...plan.cells);
    summaries.push({ ...plan.summary, inactive: plan.summary.inactive.length, shortSource: plan.summary.shortSource.length });
  }
  return { cells: orderCellsHotFirst(cells, snap.answers_90d), summaries, sources };
}

async function readScope(scope: StageScope, a: Args, deps: TranslateDeps, env: NodeJS.ProcessEnv): Promise<Slice> {
  if (deps.readSlice) return deps.readSlice(scope, a);
  if (scope === "free-set") return readFreeSetSlice(env);
  if (typeof a.snapshot !== "string") throw new UsageError("--scope bank needs --snapshot <pre-screen snapshot.json> (scripts/content/prescreen.mjs snapshot).");
  return bankSlice(a.snapshot, await readCachedEnglish(env), langsFor(a, scope));
}

function outDir(a: Args, scope: StageScope, root: string): string {
  const def = path.join(root, "reports", "master-plan-2026-10-11", "language-signoff", scope === "bank" ? "data-en-bank" : "data");
  const dir = typeof a.out === "string" ? path.resolve(a.out) : def;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function maxUsdOf(a: Args, mode: string): number {
  const maxUsd = Number(a["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > MAX_USD) throw new UsageError(`${mode}: --max-usd between 0 and ${MAX_USD} is required (pick-translation-batch A stops at ${MAX_USD} USD per --out ledger).`);
  return maxUsd;
}

function readJsonl<T>(file: string): T[] {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

function stagedKeys(file: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(file)) return done;
  for (const r of readJsonl<StagedRow>(file)) done.add(`${r.question_id}:${r.lang}:${r.source_sha256}`);
  return done;
}

interface BatchMeta {
  custom_id: string;
  cell: Cell;
  source: string;
  model: string;
}

function translationItem(model: string, lang: TranslationTarget, source: string, custom_id: string): BatchItem {
  return {
    custom_id,
    params: {
      model,
      effort: "low",
      max_tokens: 4096,
      system: [{ type: "text", text: buildTranslationSystem(TRANSLATION_LANG_LABELS[lang]) }],
      messages: [{ role: "user", content: buildTranslationUser(source) }],
    },
  };
}

interface QaMeta {
  custom_id: string;
  row: StagedRow;
  source: string;
}

function qaItem(m: QaMeta): BatchItem {
  return {
    custom_id: m.custom_id,
    params: {
      model: QA_MODEL,
      effort: "low",
      max_tokens: 4096,
      system: [{ type: "text", text: QA_SYSTEM }],
      messages: [{ role: "user", content: buildQaUser(m.source, m.row.translated_text, TRANSLATION_LANG_LABELS[m.row.lang]) }],
      output_format: { type: "json_schema", schema: QA_SCHEMA },
    },
  };
}

/** Spend plus the worst case of open batches, for the translation batches (<out>/batch). */
function translationCommittedMicro(dir: string): number {
  const tDir = path.join(dir, "batch");
  if (!existsSync(tDir)) return 0;
  const items = new Map<string, BatchItem>();
  const metaFile = path.join(tDir, "items-meta.jsonl");
  if (existsSync(metaFile)) for (const m of readJsonl<BatchMeta>(metaFile)) items.set(m.custom_id, translationItem(m.model, m.cell.lang, m.source, m.custom_id));
  return batchSpentMicro(tDir) + openWorstMicro(readState(tDir), items);
}

/** The same for the QA batches (<out>/qa-batch). */
function qaCommittedMicro(dir: string): number {
  const qDir = path.join(dir, "qa-batch");
  if (!existsSync(qDir)) return 0;
  const items = new Map<string, BatchItem>();
  const metaFile = path.join(qDir, "items-meta.jsonl");
  if (existsSync(metaFile)) for (const m of readJsonl<QaMeta>(metaFile)) items.set(m.custom_id, qaItem(m));
  return batchSpentMicro(qDir) + openWorstMicro(readState(qDir), items);
}

function liveLedgerMicro(dir: string): number {
  const ledger = path.join(dir, "spend.jsonl");
  return existsSync(ledger) ? priorSpendMicro(readFileSync(ledger, "utf8")) : 0;
}

function runnerIo(deps: TranslateDeps, env: NodeJS.ProcessEnv): RunnerIo {
  const base = defaultIo();
  return { fetch: deps.fetch ?? base.fetch, now: base.now, auth: keylessAuth(deps.resolveAuth, env) };
}

export async function runTranslate(argv: string[], deps: TranslateDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const err = deps.err ?? ((l: string) => process.stderr.write(`${l}\n`));
  const root = deps.root ?? process.cwd();
  const a = parseArgs(argv.filter((x) => x !== "--"));
  const scope = scopeOf(a);
  const rel = (p: string) => path.relative(root, p);

  switch (a.mode) {
    case "plan": {
      const langs = langsFor(a, scope);
      const { cells, summaries } = await readScope(scope, a, deps, env);
      const todo = cells.filter((c) => langs.includes(c.lang));
      const tokens = estimateTokens(todo);
      const model = modelFor(a, scope);
      const report = {
        generated_at: new Date().toISOString(),
        scope,
        rule:
          scope === "bank"
            ? "every active question in the pre-screen snapshot, explanation field, English only (content.json C4), hot rows first"
            : "free set (src/lib/free-set.ts freeSetIds), explanation field, languages " + STAGE_LANGS.join(", "),
        missing_cells: todo.length,
        estimated_tokens: tokens,
        estimated_usd_standard: { [model]: costMicroUsd(model, { input_tokens: tokens.input, output_tokens: tokens.output }) / 1_000_000 },
        estimated_usd_batch: { [model]: costMicroUsd(model, { input_tokens: tokens.input, output_tokens: tokens.output }) / 2_000_000 },
        banks: summaries,
      };
      const file = path.join(outDir(a, scope, root), "plan.json");
      writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
      out(`plan: ${todo.length} missing cells (${scope}), about ${tokens.input} input and ${tokens.output} output tokens, about USD ${report.estimated_usd_batch[model].toFixed(2)} at batch price on ${model}. Written ${rel(file)}`);
      return 0;
    }

    case "stage": {
      if (a.live !== true) throw new UsageError("stage: pass --live to call the model (spends API credit). Nothing was called.");
      const maxUsd = maxUsdOf(a, "stage");
      // Keyless only (a-content-c1): refuse before any read or call; no static key may remain.
      assertKeylessMode(env);
      dropStaticKeys(env);
      // Same rule as the batch paths: a bearer token from the keyless helper, checked on every call.
      const getAuth = keylessAuth(deps.resolveAuth, env);
      const model = modelFor(a, scope);
      const langs = langsFor(a, scope);
      const { cells, sources } = await readScope(scope, a, deps, env);
      let todo = cells.filter((c) => langs.includes(c.lang));
      if (typeof a.pilot === "string") todo = pilotCells(todo, Math.max(1, Math.min(200, Number(a.pilot) || 50)));
      const dir = outDir(a, scope, root);
      const file = path.join(dir, "staging.jsonl");
      const done = stagedKeys(file);
      // The cap covers the whole --out, not one run: live calls, translation
      // batches and QA batches together.
      const maxMicro = Math.round(maxUsd * 1_000_000);
      const ledger = path.join(dir, "spend.jsonl");
      const prior = liveLedgerMicro(dir) + translationCommittedMicro(dir) + qaCommittedMicro(dir);
      if (prior >= maxMicro) throw new UsageError(`stage: earlier runs already spent ${(prior / 1_000_000).toFixed(4)} USD of the ${maxUsd} USD cap. Nothing was called.`);
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
          // Outside the try: no token means nothing was sent, so nothing is booked and the run stops.
          const auth = await getAuth();
          try {
            const res = await callClaude({
              auth,
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
          } catch (e) {
            // A failed call may still have run (timeout after generation): book
            // its reported usage, else the worst case, so the cap stays honest.
            const usage = (e as { usage?: Parameters<typeof costMicroUsd>[1] }).usage;
            const callMicro = usage ? costMicroUsd(model, usage) : worst;
            spent += callMicro;
            appendFileSync(ledger, `${JSON.stringify({ at: new Date().toISOString(), model, micro: callMicro, failed: true })}\n`);
            failed += 1;
            err(`stage: question ${cell.question_id} ${cell.lang} failed (${(e as Error).name})`);
          }
        }
      } finally {
        appendFileSync(ledger, `${JSON.stringify({ at: new Date().toISOString(), model, micro: 0, run_total_micro: spent, staged, failed })}\n`);
      }
      out(`stage: ${staged} staged, ${failed} failed, ${(spent / 1_000_000).toFixed(4)} USD this run, ${((prior + spent) / 1_000_000).toFixed(4)} USD in total. Staging file ${rel(file)} (not the database).`);
      return 0;
    }

    case "batch-submit": {
      if (a.live !== true) throw new UsageError("batch-submit: pass --live to submit (spends API credit). Nothing was sent.");
      const maxUsd = maxUsdOf(a, "batch-submit");
      const io = runnerIo(deps, env);
      const model = modelFor(a, scope);
      const langs = langsFor(a, scope);
      const { cells, sources } = await readScope(scope, a, deps, env);
      let todo = cells.filter((c) => langs.includes(c.lang));
      if (typeof a.pilot === "string") todo = pilotCells(todo, Math.max(1, Math.min(200, Number(a.pilot) || 50)));
      if (typeof a.limit === "string") todo = todo.slice(0, Math.max(0, Math.floor(Number(a.limit)) || 0));
      const dir = outDir(a, scope, root);
      const done = stagedKeys(path.join(dir, "staging.jsonl"));
      const items: BatchItem[] = [];
      const metas: BatchMeta[] = [];
      for (const cell of todo) {
        if (done.has(`${cell.question_id}:${cell.lang}:${cell.source_sha256}`)) continue;
        const source = sources.get(cell.question_id);
        if (!source || sourceHash(source) !== cell.source_sha256) continue;
        const custom_id = translationCustomId(cell);
        items.push(translationItem(model, cell.lang, source, custom_id));
        metas.push({ custom_id, cell, source, model });
      }
      const batchDir = path.join(dir, "batch");
      mkdirSync(batchDir, { recursive: true });
      // The meta sidecar maps results back to cells at collect time.
      if (metas.length) appendFileSync(path.join(batchDir, "items-meta.jsonl"), `${metas.map((m) => JSON.stringify(m)).join("\n")}\n`);
      // The runner counts its own directory; the rest of the --out ledger is added here.
      const extra = liveLedgerMicro(dir) + qaCommittedMicro(dir);
      const r = await submitBatches(batchDir, items, { maxUsd, extraPriorMicro: extra, io });
      out(`batch-submit: ${r.submitted} cells in ${r.batches.length} batch(es); ${r.skippedDone} already done or open, ${r.skippedBudget} over the ${maxUsd} USD cap, ${r.invalid.length} invalid. State ${rel(batchDir)} (not the database).`);
      return 0;
    }

    case "batch-collect": {
      const io = runnerIo(deps, env);
      const dir = outDir(a, scope, root);
      const batchDir = path.join(dir, "batch");
      await pollBatches(batchDir, { io });
      const c = await collectBatches(batchDir, { io });
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
      out(`batch-collect: ${c.collected} results collected (USD ${(c.micro / 1_000_000).toFixed(4)}), ${staged} staged, ${unusable} unusable, ${open} batch(es) still open. Staging file ${rel(file)} (not the database).`);
      return 0;
    }

    case "qa-submit": {
      if (a.live !== true) throw new UsageError("qa-submit: pass --live to submit (spends API credit). Nothing was sent.");
      const maxUsd = maxUsdOf(a, "qa-submit");
      const io = runnerIo(deps, env);
      const dir = outDir(a, scope, root);
      const staging = path.join(dir, "staging.jsonl");
      if (!existsSync(staging)) throw new UsageError(`qa-submit: ${rel(staging)} not found; stage or batch-collect first.`);
      const metaFile = path.join(dir, "batch", "items-meta.jsonl");
      const sources = new Map<string, string>();
      if (existsSync(metaFile)) for (const m of readJsonl<BatchMeta>(metaFile)) sources.set(`${m.cell.question_id}:${m.cell.source_sha256}`, m.source);
      if (sources.size === 0 || typeof a.snapshot === "string" || !existsSync(metaFile)) {
        // Live-staged rows have no meta sidecar: take sources from the scope read.
        const slice = await readScope(scope, a, deps, env);
        for (const [id, s] of slice.sources) sources.set(`${id}:${sourceHash(s)}`, s);
      }
      const rate = typeof a.rate === "string" ? Math.max(0.01, Math.min(0.5, Number(a.rate) || 0.05)) : 0.05;
      const sample = qaSample(readJsonl<StagedRow>(staging), rate);
      const metas: QaMeta[] = [];
      for (const row of sample) {
        const source = sources.get(`${row.question_id}:${row.source_sha256}`);
        if (!source) continue;
        metas.push({ custom_id: qaCustomId(row), row, source });
      }
      const qaDir = path.join(dir, "qa-batch");
      mkdirSync(qaDir, { recursive: true });
      if (metas.length) appendFileSync(path.join(qaDir, "items-meta.jsonl"), `${metas.map((m) => JSON.stringify(m)).join("\n")}\n`);
      const extra = liveLedgerMicro(dir) + translationCommittedMicro(dir);
      const r = await submitBatches(qaDir, metas.map(qaItem), { maxUsd, extraPriorMicro: extra, io });
      out(`qa-submit: ${r.submitted} sampled rows (${sample.length} in the ${Math.round(rate * 100)} % sample, ${sample.length - metas.length} without a source) in ${r.batches.length} batch(es); ${r.skippedDone} already done or open, ${r.skippedBudget} over the cap, ${r.invalid.length} invalid. State ${rel(qaDir)}.`);
      return 0;
    }

    case "qa-collect": {
      const io = runnerIo(deps, env);
      const dir = outDir(a, scope, root);
      const qaDir = path.join(dir, "qa-batch");
      await pollBatches(qaDir, { io });
      const c = await collectBatches(qaDir, { io });
      const metaFile = path.join(qaDir, "items-meta.jsonl");
      const metas = new Map<string, QaMeta>();
      if (existsSync(metaFile)) for (const m of readJsonl<QaMeta>(metaFile)) metas.set(m.custom_id, m);
      const lines: string[] = [];
      const summary: Record<string, { checked: number; drift: number; major: number; unparsed: number }> = {};
      for (const r of latestResults(readResults(qaDir)).values()) {
        const m = metas.get(r.custom_id);
        if (!m) continue;
        const s = (summary[m.row.lang] ??= { checked: 0, drift: 0, major: 0, unparsed: 0 });
        if (r.type !== "succeeded" || !r.text) continue;
        try {
          const v = parseQa(r.text);
          s.checked += 1;
          if (v.meaning_drift) s.drift += 1;
          if (v.severity === "major") s.major += 1;
          lines.push(JSON.stringify({ question_id: m.row.question_id, lang: m.row.lang, source_sha256: m.row.source_sha256, ...v, model: r.model }));
        } catch {
          s.unparsed += 1;
        }
      }
      writeFileSync(path.join(dir, "qa.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
      writeFileSync(path.join(dir, "qa-summary.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), model: QA_MODEL, note: "Machine QA only; native sign-off still decides any apply (a29).", by_lang: summary }, null, 2)}\n`);
      const open = readState(qaDir).batches.filter((b) => !b.collected_at).length;
      out(`qa-collect: ${c.collected} results (USD ${(c.micro / 1_000_000).toFixed(4)}), ${lines.length} rows judged, ${open} batch(es) still open. Written ${rel(path.join(dir, "qa-summary.json"))}.`);
      return 0;
    }

    case "sql": {
      if (typeof a.staging !== "string" || typeof a.signoff !== "string") throw new UsageError("sql: --staging <staging.jsonl> and --signoff <signoff.json> are required.");
      const rows = readJsonl<StagedRow>(a.staging);
      const signoff = (JSON.parse(readFileSync(a.signoff, "utf8")) as { languages: SignoffEntry[] }).languages;
      const res = buildApplySql(rows, signoff);
      const file = path.join(outDir(a, scope, root), "apply.sql");
      writeFileSync(file, res.sql);
      out(`sql: ${res.included} rows in ${rel(file)}, ${res.skipped} skipped (unapproved language or unusable). Not applied.`);
      return 0;
    }

    case "sample": {
      if (typeof a.staging !== "string") throw new UsageError("sample: --staging <staging.jsonl> is required.");
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
      const file = path.join(outDir(a, scope, root), "signoff-template.json");
      writeFileSync(file, `${JSON.stringify({ generated_at: new Date().toISOString(), languages }, null, 2)}\n`);
      out(`sample: ${rel(file)}`);
      return 0;
    }

    default:
      throw new UsageError("usage: translate-free-slices.mjs [plan|stage|sql|sample|batch-submit|batch-collect|qa-submit|qa-collect] (see header)");
  }
}

// Entry point only when started by its launcher (vite-node does not keep the file in argv).
if (process.env.MEDPRUF_SCRIPT_ENTRY === "translate-free-slices") {
  if (process.env.VERCEL_ENV === "production") process.exit(2);
  runTranslate(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`translate-free-slices: ${(e as Error).message}\n`);
      process.exit(e instanceof UsageError ? 2 : 1);
    });
}
