/**
 * Command line of the mentor eval (W2-EVAL). Entered through
 * scripts/mentor-eval.ts (vite-node) via scripts/mentor-eval.mjs.
 *
 *   node scripts/mentor-eval.mjs --lint                      structure + ground truth, no model, no key
 *   node scripts/mentor-eval.mjs --stub [--mutate <name>]    hermetic self-check with stubs (works on any branch)
 *   node scripts/mentor-eval.mjs --scripted [--mutate <n>]   real turn loop, brain and facts + the scripted model (free)
 *   node scripts/mentor-eval.mjs --live --max-usd 0.60       real Haiku calls (needs ANTHROPIC_API_KEY in the env)
 *
 * Common flags: --ids a,b  --category c  --lang de|en  --limit N  --concurrency 1..4
 *               --out file.json  --json  --golden f  --fixtures f  --facts-dir d  --as-of ISO  --model id
 * Exit codes: 0 pass bar met, 1 pass bar missed, 2 usage or environment error.
 *
 * Safety: --live refuses when VERCEL_ENV=production, never prints the key, stops at
 * --max-usd (recomputed from the usage objects with pricing.ts) and reads/writes no
 * production data: ledger, wallet and the tool database are in memory per case.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { callClaude } from "@/lib/ai/anthropic";
import { MENTOR_CONFIG_DEFAULTS } from "@/lib/mentor/config";
import { checkMinCounts } from "./aggregate";
import { defaultFactsDir, loadFactRecords } from "./facts-source";
import { lintGolden } from "./lint";
import { loadRealParts } from "./real-parts";
import { evaluate, selectCases, type EvalReport } from "./run";
import { createScriptedCallClaude, MUTATIONS, type Mutation } from "./scripted";
import { viennaDate } from "./score";
import { STUB_LINK, createStubParts, stubFactIds } from "./stubs";
import type { FixturesFile, GoldenFile } from "./types";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export interface CliArgs {
  mode: "lint" | "stub" | "scripted" | "live";
  mutation: Mutation;
  ids: string[];
  category?: string;
  lang?: string;
  limit?: number;
  concurrency: number;
  maxUsd?: number;
  out?: string;
  json: boolean;
  golden?: string;
  fixtures?: string;
  factsDir?: string;
  asOf?: string;
  model?: string;
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): CliArgs {
  const a: CliArgs = { mode: "scripted", mutation: "none", ids: [], concurrency: 1, json: false };
  const need = (i: number, k: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`missing value for ${k}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    switch (k) {
      case "--lint": a.mode = "lint"; break;
      case "--stub": a.mode = "stub"; break;
      case "--scripted": a.mode = "scripted"; break;
      case "--live": a.mode = "live"; break;
      case "--mutate": {
        const m = need(i++, k);
        if (!(MUTATIONS as readonly string[]).includes(m)) throw new UsageError(`unknown mutation ${m} (${MUTATIONS.join(", ")})`);
        a.mutation = m as Mutation;
        break;
      }
      case "--ids": a.ids = need(i++, k).split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--category": a.category = need(i++, k); break;
      case "--lang": a.lang = need(i++, k); break;
      case "--limit": a.limit = Number(need(i++, k)); break;
      case "--concurrency": a.concurrency = Number(need(i++, k)); break;
      case "--max-usd": a.maxUsd = Number(need(i++, k)); break;
      case "--out": a.out = need(i++, k); break;
      case "--json": a.json = true; break;
      case "--golden": a.golden = need(i++, k); break;
      case "--fixtures": a.fixtures = need(i++, k); break;
      case "--facts-dir": a.factsDir = need(i++, k); break;
      case "--as-of": a.asOf = need(i++, k); break;
      case "--model": a.model = need(i++, k); break;
      default:
        throw new UsageError(`unknown argument ${k}`);
    }
  }
  if (a.limit !== undefined && (!Number.isInteger(a.limit) || a.limit < 0)) throw new UsageError("--limit must be a non-negative integer");
  if (!Number.isInteger(a.concurrency) || a.concurrency < 1 || a.concurrency > 4) throw new UsageError("--concurrency must be 1 to 4");
  if (a.maxUsd !== undefined && (!Number.isFinite(a.maxUsd) || a.maxUsd <= 0)) throw new UsageError("--max-usd must be a positive number");
  if (a.mutation !== "none" && a.mode !== "stub" && a.mode !== "scripted") throw new UsageError("--mutate only works with --stub or --scripted");
  return a;
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DEFAULT_GOLDEN = path.join(HERE, "..", "golden.json");
const DEFAULT_FIXTURES = path.join(HERE, "..", "fixtures.json");

export function loadGolden(file: string = DEFAULT_GOLDEN): GoldenFile {
  return JSON.parse(fs.readFileSync(file, "utf8")) as GoldenFile;
}
export function loadFixtures(file: string = DEFAULT_FIXTURES): FixturesFile {
  return JSON.parse(fs.readFileSync(file, "utf8")) as FixturesFile;
}

function usd(micro: number): string {
  return `USD ${(micro / 1_000_000).toFixed(4)}`;
}
function num(n: number, d = 0): string {
  return n.toFixed(d);
}

export function formatSummary(r: EvalReport): string {
  const L: string[] = [];
  L.push(`Mentor eval: ${r.barPass ? "PASS" : "FAIL"} (${r.meta.mode}, ${r.meta.cases_run}/${r.meta.cases_selected} cases${r.meta.cases_selected !== r.meta.cases_total ? ` of ${r.meta.cases_total}` : ""}, as_of ${r.meta.as_of}, spent ${usd(r.meta.spent_micro)})`);
  if (!r.meta.ground_truth_from_files) L.push("  note: content/mentor-facts not found, so allowed values come from the golden file only");
  if (r.meta.skipped_for_budget.length) L.push(`  budget stop: ${r.meta.skipped_for_budget.length} case(s) not run`);
  L.push("");
  L.push("Failures first:");
  if (r.failing.length === 0) L.push("  none");
  for (const f of r.failing.slice(0, 40)) {
    const bits = [...f.critical.map((c) => `CRITICAL ${c}`), ...f.failures];
    L.push(`  - ${f.id}: ${bits.join("; ")}`);
  }
  if (r.failing.length > 40) L.push(`  ... ${r.failing.length - 40} more in the JSON report`);
  L.push("");
  L.push("Pass bar:");
  for (const b of r.bar) L.push(`  ${b.pass === null ? "n/a " : b.pass ? "PASS" : b.advisory ? "WARN" : "FAIL"}  ${b.label}: ${b.actual} (needs ${b.required})`);
  L.push("");
  L.push("By category:");
  for (const c of r.categories) L.push(`  ${c.category.padEnd(12)} ${c.passed}/${c.cases} passed${c.errored ? `, ${c.errored} errored` : ""}${c.critical ? `, ${c.critical} critical` : ""}`);
  L.push("");
  const t = r.tokens;
  L.push(r.meta.synthetic_usage ? "Tokens per message (SYNTHETIC usage from the scripted model: this proves the plumbing, it is not a measurement):" : "Tokens per message (measured from the API usage objects):");
  L.push(`  messages ${t.messages}, calls ${t.calls} (mean ${num(t.callsPerMessage.mean, 2)}, max ${t.callsPerMessage.max})`);
  L.push(`  input ${num(t.perMessage.inputTokens)}  output ${num(t.perMessage.outputTokens)}  cache read ${num(t.perMessage.cacheReadTokens)}  cache write ${num(t.perMessage.cacheWriteTokens)}`);
  L.push(`  cost mean ${usd(t.perMessage.costMicro.mean)}, p50 ${usd(t.perMessage.costMicro.p50)}, p95 ${usd(t.perMessage.costMicro.p95)}, max ${usd(t.perMessage.costMicro.max)}`);
  L.push(`  cache read share ${(t.cacheReadShare * 100).toFixed(1)}%, input tokens per byte ${t.inputTokensPerByte.toFixed(3)}, max (input tokens minus bytes) ${t.maxInputTokensMinusBytes} (reserve margin 512)`);
  L.push(`  actual over reserve ceiling: max ${(t.maxActualOverCeiling * 100).toFixed(1)}%, overrun calls ${t.overrunCalls}, ledger reconcile failures ${t.ledgerReconcileFailures}`);
  L.push("");
  const s = r.soft;
  L.push(`Soft: language match ${s.languageMatchRate === null ? "n/a" : `${(s.languageMatchRate * 100).toFixed(1)}%`}, refusal reason match ${s.refusalReasonMatchRate === null ? "n/a" : `${(s.refusalReasonMatchRate * 100).toFixed(1)}%`}, em dash ${s.emDashCases}, too long ${s.tooLongCases}, validator replaced ${s.validatorReplacedCases}`);
  return L.join("\n");
}

export async function main(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: Io): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.err(`mentor-eval: ${(err as Error).message}`);
    return 2;
  }

  let golden: GoldenFile;
  let fixtures: FixturesFile;
  try {
    golden = loadGolden(args.golden);
    fixtures = loadFixtures(args.fixtures);
  } catch (err) {
    io.err(`mentor-eval: cannot read golden or fixtures: ${(err as Error).message}`);
    return 2;
  }
  if (args.asOf) golden = { ...golden, as_of: args.asOf };

  const factsDir = args.factsDir ?? defaultFactsDir();
  const factRecords = loadFactRecords(factsDir);

  if (args.mode === "lint") {
    const lint = lintGolden(golden, fixtures, { facts: factRecords });
    for (const e of lint.errors) io.err(`ERROR ${e}`);
    for (const w of lint.warnings) io.err(`warn  ${w}`);
    const counts = checkMinCounts(golden).map((c) => `${c.key} ${c.actual}/${c.min}`).join(", ");
    io.out(`lint: ${golden.cases.length} cases, ${lint.errors.length} errors, ${lint.warnings.length} warnings, ground truth ${lint.groundTruthChecked ? `checked against ${factRecords?.length} facts` : "NOT checked (no content/mentor-facts)"}; counts ${counts}`);
    return lint.errors.length === 0 ? 0 : 1;
  }

  // Never run a model call or a harness against production.
  if (env.VERCEL_ENV === "production") {
    io.err("mentor-eval: refusing to run with VERCEL_ENV=production");
    return 2;
  }
  if (args.mode === "live") {
    if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.trim() === "") {
      io.err("mentor-eval: --live needs ANTHROPIC_API_KEY in the environment (the value is never printed)");
      return 2;
    }
  }
  const lintFirst = lintGolden(golden, fixtures, { facts: factRecords });
  if (lintFirst.errors.length > 0) {
    for (const e of lintFirst.errors.slice(0, 20)) io.err(`ERROR ${e}`);
    io.err("mentor-eval: golden set failed lint; fix it before running (use --lint)");
    return 2;
  }

  const cases = selectCases(golden, { ids: args.ids, category: args.category, lang: args.lang, limit: args.limit });
  if (cases.length === 0) {
    io.err("mentor-eval: no case matches the filters");
    return 2;
  }

  let parts;
  try {
    parts = args.mode === "stub" ? createStubParts(golden) : await loadRealParts();
  } catch (err) {
    io.err(`mentor-eval: ${(err as Error).message}`);
    return 2;
  }

  const todayVienna = viennaDate(new Date(golden.as_of));
  const model = args.model ?? MENTOR_CONFIG_DEFAULTS.modelDefault;
  const call =
    args.mode === "live"
      ? callClaude
      : createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna, mutation: args.mutation, model: args.mode === "stub" ? model : model });

  const maxUsd = args.mode === "live" ? args.maxUsd ?? 1 : args.maxUsd;
  const t0 = Date.now();
  let report: EvalReport;
  try {
    report = await evaluate({
      golden,
      fixtures,
      parts,
      callClaude: call,
      factRecords,
      extraHosts: args.mode === "stub" ? ["example.org"] : [],
      extraKnownIds: args.mode === "stub" ? new Set(stubFactIds(golden)) : undefined,
      cases,
      config: { modelDefault: model },
      run: {
        concurrency: args.concurrency,
        maxMicro: maxUsd !== undefined ? Math.round(maxUsd * 1_000_000) : undefined,
        onCase: (c, o, done, total) => {
          if (!args.json) io.err(`[${done}/${total}] ${c.id} ${o.error ?? (o.final ? "ok" : "no final")} ${usd(o.calls.reduce((n, x) => n + (x.costMicro ?? 0), 0))}`);
        },
      },
      mode: args.mode === "scripted" && args.mutation !== "none" ? `scripted+${args.mutation}` : args.mode === "stub" && args.mutation !== "none" ? `stub+${args.mutation}` : args.mode,
    });
  } catch (err) {
    io.err(`mentor-eval: run failed: ${(err as Error).message}`);
    return 2;
  }

  const outFile = args.out ?? path.join(os.tmpdir(), `mentor-eval-${args.mode}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ ...report, meta: { ...report.meta, wall_ms: Date.now() - t0, stub_link: args.mode === "stub" ? STUB_LINK : undefined } }, null, 2));

  if (args.json) io.out(JSON.stringify(report, null, 2));
  else {
    io.out(formatSummary(report));
    io.out(`\nJSON report: ${outFile}`);
  }
  return report.barPass ? 0 : 1;
}
