/**
 * C1 bank-wide blind-answer and explanation pre-screen (a-content-c1,
 * 2026-10-14). Run through scripts/content/prescreen.mjs.
 *
 *   snapshot  --out <file> [--exposure-file <json>]
 *             read-only: active questions, 90-day answer counts per question
 *             and approved learner wrong-answer reports, into one JSON file.
 *             The only database access of the job (paged SELECTs).
 *   plan      --snapshot <file> --state <dir> [selection]
 *             no network: items per stage that the next step would send and
 *             a cost projection. Writes <state>/plan.json.
 *   step      --snapshot <file> --state <dir> --live --max-usd <n> [selection]
 *             polls and collects ended batches, then submits every item that
 *             can go now (pass 1 blind, pass 1 review once its blind answer is
 *             in, pass 2 on flagged and sampled rows). Run it again until it
 *             reports nothing open and nothing left. Idempotent per item.
 *   report    --snapshot <file> --state <dir> [--top 450] [--out <dir>]
 *             no network: verdicts.jsonl (one row per question with reason),
 *             queue.jsonl (ranked Content Medic queue, KEY-DOUBTS shape,
 *             pkg prescreen-2026-10) and cost-report.json.
 *   calibrate --snapshot <file> --out <ids.json> [--n 20] [--reports <dir>]
 *             picks known-outcome rows (b11 audit, KEY-DOUBTS, learner reports).
 *   calibrate-score --snapshot <file> --state <dir> --ids <ids.json>
 *             precision and recall of the flags on those rows.
 *
 * selection: [--scope hot|cold|all] [--ids <ids.json>] [--limit <n>]
 *            [--reports <dir> | --no-claims] [--include-claimed]
 *            [--pass2 flagged_and_sample|all|none] [--pass2-min-strength 0.45]
 *            [--effort1 low] [--effort2 medium]
 *
 * API key is removed from the process and refused. Nothing is ever written
 * to the database; every output is a file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collect, defaultIo, latestResults, poll, readResults, readState, spentMicro, submit, type ResultValidator, type RunnerIo } from "../../ai-batch/runner";
import { keylessAuth } from "../lib/keyless-auth";
import type { AnthropicAuth } from "@/lib/ai/credentials";
import {
  DEFAULT_SEED,
  PASS2_MIN_STRENGTH,
  buildRowStates,
  costByStage,
  inScope,
  keyDoubtLines,
  labelsFromB11,
  labelsFromKeyDoubts,
  labelsFromLearnerFlags,
  mergeLabels,
  nextItems,
  orderRows,
  orderedChoices,
  parseBlind,
  parseCustomId,
  parseReview,
  pass2Share,
  pickCalibration,
  projectMicro,
  rankQueue,
  scoreCalibration,
  verdictFor,
  type NextItemsOptions,
  type QuestionRow,
  type Scope,
} from "./lib";
import { SNAPSHOT_VERSION, exposureMap, loadClaims, parseExposureFile, readActiveRows, readAnswerCounts, readLearnerWrongKeyIds, readSnapshot, serviceClient, type ClaimSource, type Snapshot } from "./io";

/** Upper bound for --max-usd (the cap of one --state, all steps together): content.json C1 one-time USD 117 to 170 for the whole bank in one state. */
export const MAX_USD_PER_STEP = 200;
export const DEFAULT_TOP = 450;

export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
  now?: () => Date;
  /** Network for batches (tests pass a fake API); auth is always replaced by the keyless resolver. */
  fetch?: typeof fetch;
  /** Keyless token resolver (default: the shared credential helper in a keyless mode). */
  resolveAuth?: () => Promise<AnthropicAuth>;
  /** Snapshot reader override (tests). */
  readDb?: (since: Date) => Promise<Pick<Snapshot, "rows" | "answers_90d" | "learner_wrong_key_ids">>;
  /** Repository root for the default --reports (the main checkout's reports/). */
  root?: string;
}

type Args = Record<string, string | boolean>;

export function parseArgs(argv: string[]): Args {
  const a: Args = { mode: argv[0] && !argv[0].startsWith("--") ? argv[0] : "" };
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

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);

function need(a: Args, k: string): string {
  const v = a[k];
  if (typeof v !== "string" || v === "") throw new Error(`--${k} is required`);
  return v;
}

function readIds(file: string): number[] {
  const j = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const ids = Array.isArray(j) ? j : (j as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) throw new Error(`${file}: expected an array of ids or {ids: [...]}`);
  return ids.filter((x): x is number => Number.isSafeInteger(x));
}

interface Selection {
  rows: QuestionRow[];
  claims: Map<number, string[]>;
  claimSources: ClaimSource[];
  skippedClaimed: number;
  opts: NextItemsOptions;
}

function select(a: Args, snap: Snapshot, root: string): Selection {
  const exposure = exposureMap(snap);
  const scope = (typeof a.scope === "string" ? a.scope : "all") as Scope;
  if (!["hot", "cold", "all"].includes(scope)) throw new Error("--scope must be hot, cold or all");
  let claims = new Map<number, string[]>();
  let claimSources: ClaimSource[] = [];
  if (a["no-claims"] !== true) {
    const loaded = loadClaims(typeof a.reports === "string" ? path.resolve(a.reports) : path.join(root, "reports"));
    claims = loaded.claims;
    claimSources = loaded.sources;
  }
  const only = typeof a.ids === "string" ? new Set(readIds(a.ids)) : null;
  let rows = orderRows(
    snap.rows.filter((r) => r.is_active && (only ? only.has(r.id) : inScope(r, exposure.get(r.id), scope))),
    exposure,
  );
  let skippedClaimed = 0;
  if (a["include-claimed"] !== true && !only) {
    const before = rows.length;
    rows = rows.filter((r) => !claims.has(r.id));
    skippedClaimed = before - rows.length;
  }
  if (typeof a.limit === "string") rows = rows.slice(0, Math.max(0, Math.floor(Number(a.limit)) || 0));
  const pass2 = (typeof a.pass2 === "string" ? a.pass2 : "flagged_and_sample") as NonNullable<NextItemsOptions["pass2"]>;
  if (!["flagged_and_sample", "all", "none"].includes(pass2)) throw new Error("--pass2 must be flagged_and_sample, all or none");
  const min = typeof a["pass2-min-strength"] === "string" ? Number(a["pass2-min-strength"]) : PASS2_MIN_STRENGTH;
  if (!Number.isFinite(min) || min < 0 || min > 1.3) throw new Error("--pass2-min-strength must be between 0 and 1.3");
  const effort = (k: string, d: "low" | "medium") => {
    const v = typeof a[k] === "string" ? (a[k] as string) : d;
    if (!["low", "medium", "high"].includes(v)) throw new Error(`--${k} must be low, medium or high`);
    return v as "low" | "medium" | "high";
  };
  return { rows, claims, claimSources, skippedClaimed, opts: { pass2, pass2MinStrength: min, seed: DEFAULT_SEED, effort1: effort("effort1", "low"), effort2: effort("effort2", "medium") } };
}

/**
 * Collect-time check: a pre-screen answer whose JSON does not parse for its
 * row is stored as errored ("invalid_json"), so the item is sent again (at
 * most three batches) instead of leaving the row incomplete for good.
 */
export function answerValidator(rows: readonly QuestionRow[]): ResultValidator {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (line) => {
    const id = parseCustomId(line.custom_id);
    const row = id ? byId.get(id.questionId) : undefined;
    if (!id || !row || line.text === null) return null;
    const n = orderedChoices(row).length;
    try {
      if (id.stage === "p1b" || id.stage === "p2b" || id.stage === "p2bf") parseBlind(line.text, n);
      else parseReview(line.text, n);
      return null;
    } catch {
      return "invalid_json";
    }
  };
}

function runnerIo(deps: CliDeps, env: NodeJS.ProcessEnv): RunnerIo {
  const base = defaultIo();
  return {
    fetch: deps.fetch ?? base.fetch,
    now: deps.now ?? base.now,
    // Keyless only: refuses any other ANTHROPIC_AUTH_MODE and deletes a static key from env.
    auth: keylessAuth(deps.resolveAuth, env),
  };
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const now = deps.now ?? (() => new Date());
  const root = deps.root ?? process.cwd();
  const a = parseArgs(argv.filter((x) => x !== "--"));

  switch (a.mode) {
    case "snapshot": {
      const file = path.resolve(need(a, "out"));
      const at = now();
      const since = new Date(at.getTime() - 90 * 86_400_000);
      let data: Pick<Snapshot, "rows" | "answers_90d" | "learner_wrong_key_ids">;
      if (deps.readDb) data = await deps.readDb(since);
      else {
        const sb = serviceClient();
        const rows = await readActiveRows(sb);
        const answers_90d = typeof a["exposure-file"] === "string" ? parseExposureFile(readFileSync(a["exposure-file"], "utf8")) : await readAnswerCounts(sb, since);
        data = { rows, answers_90d, learner_wrong_key_ids: await readLearnerWrongKeyIds(sb) };
      }
      const snap: Snapshot = { version: SNAPSHOT_VERSION, generated_at: at.toISOString(), source: typeof a["exposure-file"] === "string" ? "questions + exposure file" : "questions + answer_history (90 days)", ...data };
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(snap)}\n`);
      const hot = Object.keys(snap.answers_90d).length;
      out(`snapshot: ${snap.rows.length} active rows, ${hot} answered in 90 days, ${snap.learner_wrong_key_ids.length} approved wrong-answer reports. Written ${file} (read-only, no database write).`);
      return 0;
    }

    case "plan": {
      const snap = readSnapshot(need(a, "snapshot"));
      const dir = path.resolve(need(a, "state"));
      const sel = select(a, snap, root);
      const states = buildRowStates(sel.rows, readResults(dir));
      const next = nextItems(states.values(), sel.opts);
      const measured = costByStage(readResults(dir));
      const notStarted = sel.rows.filter((r) => !states.get(r.id)?.p1b).length;
      const share = pass2Share(states.values(), sel.opts).share ?? 0.2;
      const proj = projectMicro(notStarted, share, measured);
      const plan = {
        generated_at: now().toISOString(),
        snapshot_generated_at: snap.generated_at,
        rows_selected: sel.rows.length,
        skipped_claimed: sel.skippedClaimed,
        claim_sources: sel.claimSources,
        next_items_by_stage: next.byStage,
        rows_not_started: notStarted,
        pass2_share_assumed: share,
        projected_usd_for_rows_not_started: Number(usd(proj.micro)),
        projection_basis: proj.basis,
        spent_usd: Number(usd(spentMicro(dir))),
      };
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
      out(`plan: ${sel.rows.length} rows (${sel.skippedClaimed} claimed rows skipped), next step sends ${next.items.length} items ${JSON.stringify(next.byStage)}; about USD ${usd(proj.micro)} for the ${notStarted} rows not started (batch price, pass 2 share ${share.toFixed(2)}). No model call.`);
      return 0;
    }

    case "step": {
      if (a.live !== true) throw new Error("step: pass --live to submit batches (spends API credit). Nothing was sent.");
      const maxUsd = Number(a["max-usd"]);
      if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > MAX_USD_PER_STEP) throw new Error(`step: --max-usd between 0 and ${MAX_USD_PER_STEP} is required (it caps everything spent in this --state, all steps together).`);
      const snap = readSnapshot(need(a, "snapshot"));
      const dir = path.resolve(need(a, "state"));
      const sel = select(a, snap, root);
      const io = runnerIo(deps, env);
      mkdirSync(dir, { recursive: true });
      let collected = { collected: 0, succeeded: 0, failed: 0, micro: 0 };
      if (readState(dir).batches.length > 0) {
        await poll(dir, { io });
        collected = await collect(dir, { io, validate: answerValidator(snap.rows) });
      }
      const states = buildRowStates(sel.rows, readResults(dir));
      const next = nextItems(states.values(), sel.opts);
      const r = next.items.length ? await submit(dir, next.items, { maxUsd, io }) : { submitted: 0, batches: [] as string[], skippedDone: 0, skippedBudget: 0, invalid: [] as Array<{ custom_id: string; error: string }> };
      for (const bad of r.invalid.slice(0, 20)) out(`step: invalid item ${bad.custom_id} not sent: ${bad.error}`);
      const open = readState(dir).batches.filter((b) => !b.collected_at).length;
      out(
        `step: collected ${collected.collected} results (${collected.succeeded} ok, ${collected.failed} failed, USD ${usd(collected.micro)}); submitted ${r.submitted} items in ${r.batches.length} batch(es) ${JSON.stringify(next.byStage)}; ${r.skippedDone} already done or open, ${r.skippedBudget} held by the USD ${maxUsd} cap; ${open} batch(es) open; spent USD ${usd(spentMicro(dir))} in this state.`,
      );
      if (open === 0 && next.items.length === 0) out("step: nothing open and nothing left to send. Run report.");
      else if (r.skippedBudget > 0 && open === 0) out("step: the cap holds the rest; raise --max-usd only within the agreed budget.");
      else out("step: run step again once the open batches end (usually within an hour, at most 24 hours).");
      return 0;
    }

    case "report": {
      const snap = readSnapshot(need(a, "snapshot"));
      const dir = path.resolve(need(a, "state"));
      const outDir = typeof a.out === "string" ? path.resolve(a.out) : dir;
      const sel = select({ ...a, "include-claimed": true }, snap, root);
      const exposure = exposureMap(snap);
      const results = readResults(dir);
      const states = buildRowStates(sel.rows, results);
      const verdicts = [...states.values()].map((st) => verdictFor(st, exposure.get(st.row.id), sel.claims));
      const top = typeof a.top === "string" ? Math.max(0, Math.floor(Number(a.top)) || 0) : DEFAULT_TOP;
      const queue = rankQueue(verdicts, top);
      const ts = now().toISOString();
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "verdicts.jsonl"), verdicts.map((v) => JSON.stringify(v)).join("\n") + (verdicts.length ? "\n" : ""));
      const lines = keyDoubtLines(queue, ts, path.join(outDir, "verdicts.jsonl"));
      writeFileSync(path.join(outDir, "queue.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
      const stages = costByStage([...latestResults(results).values()]);
      const allLines = costByStage(results);
      const flagged = verdicts.filter((v) => v.status === "flagged");
      const byBank = (xs: typeof verdicts) => Object.fromEntries(["kmp_innsbruck", "kenntnispruefung", "pharma"].map((b) => [b, xs.filter((v) => v.exam_type === b).length]));
      const notStarted = verdicts.filter((v) => !states.get(v.id)?.p1b).length;
      const share = pass2Share(states.values(), sel.opts);
      const proj = projectMicro(notStarted, share.share ?? 0.2, allLines);
      const cost = {
        generated_at: ts,
        snapshot_generated_at: snap.generated_at,
        price_basis: "Message Batches, half the standard price (Sonnet 5.5 USD 1/5, Opus 5.5 USD 2/10 per MTok after the 50 % discount)",
        spent_usd: Number(usd(spentMicro(dir))),
        by_stage_all_attempts: allLines.map((c) => ({ ...c, usd: Number(usd(c.micro)) })),
        by_stage_latest: stages.map((c) => ({ ...c, usd: Number(usd(c.micro)) })),
        refusals: allLines.reduce((s, c) => s + c.refusals, 0),
        rows: { selected: verdicts.length, complete: verdicts.filter((v) => v.status !== "incomplete").length, flagged: flagged.length, clean: verdicts.filter((v) => v.status === "clean").length, incomplete: verdicts.filter((v) => v.status === "incomplete").length },
        flagged_by_bank: byBank(flagged),
        claimed_flagged_not_queued: flagged.filter((v) => v.claimed_by.length > 0).length,
        queue: { top, size: queue.length, by_bank: byBank(queue) },
        pass2: share,
        projection_for_rows_not_started: { rows: notStarted, usd: Number(usd(proj.micro)), basis: proj.basis },
      };
      writeFileSync(path.join(outDir, "cost-report.json"), `${JSON.stringify(cost, null, 2)}\n`);
      out(`report: ${verdicts.length} verdicts (${cost.rows.flagged} flagged, ${cost.rows.clean} clean, ${cost.rows.incomplete} incomplete); queue ${queue.length} rows; spent USD ${usd(spentMicro(dir))}. Files in ${outDir} (no database write).`);
      return 0;
    }

    case "calibrate": {
      const snap = readSnapshot(need(a, "snapshot"));
      const reports = typeof a.reports === "string" ? path.resolve(a.reports) : path.join(root, "reports");
      const b11 = path.join(reports, "track-b-2026-10-11", "handover", "b11-explanation-audit", "audit.json");
      const kd = path.join(reports, "track-b-2026-10-11", "data", "KEY-DOUBTS.jsonl");
      if (!existsSync(b11) || !existsSync(kd)) throw new Error(`calibrate: b11 audit.json and KEY-DOUBTS.jsonl not found under ${reports}; pass --reports <dir>`);
      const labels = mergeLabels(labelsFromB11(JSON.parse(readFileSync(b11, "utf8")) as Array<Record<string, unknown>>), labelsFromKeyDoubts(readFileSync(kd, "utf8")), labelsFromLearnerFlags(snap.learner_wrong_key_ids));
      const n = typeof a.n === "string" ? Math.max(1, Math.min(400, Math.floor(Number(a.n)) || 20)) : 20;
      const ids = pickCalibration(labels, new Map(snap.rows.map((r) => [r.id, r])), n);
      const file = path.resolve(need(a, "out"));
      const pos = ids.filter((id) => labels.get(id)?.key_doubt || labels.get(id)?.explanation_defect).length;
      writeFileSync(file, `${JSON.stringify({ generated_at: now().toISOString(), n: ids.length, known_positive: pos, known_negative: ids.length - pos, labels_available: labels.size, ids, labels: ids.map((id) => labels.get(id)) }, null, 2)}\n`);
      out(`calibrate: ${ids.length} rows (${pos} known doubtful, ${ids.length - pos} known clean) of ${labels.size} labelled. Written ${file}.`);
      return 0;
    }

    case "calibrate-score": {
      const snap = readSnapshot(need(a, "snapshot"));
      const dir = path.resolve(need(a, "state"));
      const j = JSON.parse(readFileSync(need(a, "ids"), "utf8")) as { ids: number[]; labels: Array<{ id: number; key_doubt: boolean; explanation_defect: boolean; source: string[] } | undefined> };
      const labels = new Map(j.labels.filter((l): l is NonNullable<typeof l> => !!l).map((l) => [l.id, l]));
      const rows = snap.rows.filter((r) => j.ids.includes(r.id));
      const states = buildRowStates(rows, readResults(dir));
      const rep = { generated_at: now().toISOString(), ...scoreCalibration(states, labels, j.ids), pass2: pass2Share(states.values()), spent_usd: Number(usd(spentMicro(dir))), note_on_n: j.ids.length < 100 ? `n=${j.ids.length}: a sanity check of the pipeline and the request shapes, not a precision estimate. Use --n 329 (about USD 4 to 6 at batch price) before choosing models and effort.` : null };
      writeFileSync(path.join(dir, "calibration.json"), `${JSON.stringify(rep, null, 2)}\n`);
      out(`calibrate-score: ${rep.rows_scored} rows scored, ${rep.rows_incomplete} incomplete; any-flag precision ${rep.any_flag.p1.precision ?? "n/a"}, recall ${rep.any_flag.p1.recall ?? "n/a"}. Written ${path.join(dir, "calibration.json")}.`);
      return 0;
    }

    default:
      throw new Error("usage: prescreen.mjs snapshot|plan|step|report|calibrate|calibrate-score (see scripts/content/prescreen/main.ts)");
  }
}

// Entry point only when started by its launcher (vite-node does not keep the file in argv).
if (process.env.MEDPRUF_SCRIPT_ENTRY === "prescreen") {
  if (process.env.VERCEL_ENV === "production") process.exit(2);
  runCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`prescreen: ${(err as Error).message}\n`);
      process.exit(1);
    });
}
