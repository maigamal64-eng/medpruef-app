/**
 * Evaluation driver (W2-EVAL): golden set + parts + model -> graded report.
 * Pure of process state: the CLI (cli.ts) reads args, env and files, this runs.
 */

import { evaluatePassBar, buildTokenReport, categoryStats, type BarResult, type CategoryStat, type TokenReport } from "./aggregate";
import { runAll, type HarnessOptions, type HarnessParts, type RunAllOptions } from "./harness";
import { factsMatching, officialHostsOf, readOnDatesOf, type FactRecord } from "./facts-source";
import { scoreCase, viennaDate, type CaseScore, type ScoreContext } from "./score";
import type { FixturesFile, GoldenCase, GoldenFile, TurnOutcome } from "./types";
import { hostOf } from "./values";
import type { CallClaudeFn } from "@/lib/mentor/seam";
import type { MentorConfig } from "@/lib/mentor/config";

export interface EvalInput {
  golden: GoldenFile;
  fixtures: FixturesFile;
  parts: HarnessParts;
  callClaude: CallClaudeFn;
  /** Facts files read independently of the loader; null when the directory is absent. */
  factRecords: readonly FactRecord[] | null;
  /** Extra hosts a link may point at (the stub adds its example.org link). */
  extraHosts?: readonly string[];
  /** Ids the loader cannot prove from the files but the run may legitimately cite (stub ids). */
  extraKnownIds?: ReadonlySet<string>;
  cases?: readonly GoldenCase[];
  config?: Partial<MentorConfig>;
  run?: RunAllOptions;
  mode: string;
}

export interface CaseReport {
  id: string;
  category: string;
  kind: string;
  lang: string;
  pass: boolean;
  critical: string[];
  failures: string[];
  soft: string[];
  refused: string | null;
  refusalLink: string | null;
  citations: string[];
  error: string | null;
  text: string;
  calls: number;
  costMicro: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface EvalReport {
  meta: {
    mode: string;
    as_of: string;
    golden_version: number;
    /** Cases in the golden file. */
    cases_total: number;
    /** Cases selected by the filters. */
    cases_selected: number;
    cases_run: number;
    skipped_for_budget: string[];
    ground_truth_from_files: boolean;
    spent_micro: number;
    spent_usd: number;
    models: string[];
    /** true unless the model was real: scripted and stub runs invent their usage, so their token numbers prove the plumbing only. */
    synthetic_usage: boolean;
  };
  bar: BarResult[];
  barPass: boolean;
  categories: CategoryStat[];
  soft: { languageMatchRate: number | null; refusalReasonMatchRate: number | null; emDashCases: number; tooLongCases: number; validatorReplacedCases: number };
  tokens: TokenReport;
  failing: CaseScore[];
  cases: CaseReport[];
}

const EXTRA_OFFICIAL_HOSTS = ["medpruf.com", "whop.com"];

export async function evaluate(input: EvalInput): Promise<EvalReport> {
  const asOf = new Date(input.golden.as_of);
  const todayVienna = viennaDate(asOf);
  const cases = input.cases ?? input.golden.cases;
  const records = input.factRecords;
  const knownIds = new Set<string>([...(records ?? []).map((r) => r.id), ...(input.extraKnownIds ?? [])]);
  const linkHosts = (input.parts.officialLinks?.() ?? []).map((u) => hostOf(u)).filter((h): h is string => h !== null);
  const hosts = officialHostsOf(records ?? [], [...EXTRA_OFFICIAL_HOSTS, ...(input.extraHosts ?? []), ...linkHosts]);
  const baseAllow = [...readOnDatesOf(records ?? []), todayVienna];

  const harness: HarnessOptions = {
    parts: input.parts,
    callClaude: input.callClaude,
    fixtures: input.fixtures,
    asOf,
    config: input.config,
  };
  const result = await runAll(harness, cases, input.run ?? {});

  const questionIds = new Set(Object.values(input.fixtures.questions).map((q) => q.id));
  const scores: CaseScore[] = [];
  const reports: CaseReport[] = [];
  const outcomes: TurnOutcome[] = [];

  for (const c of cases) {
    const o = result.outcomes.get(c.id);
    if (!o) continue;
    outcomes.push(o);

    // Resolve what the answer cited: the loader proves derived ids (sitting.*, app.*), files prove data ids.
    const cited = new Set<string>(o.final ? [...o.final.answer_blocks.flatMap((b) => b.fact_ids), ...o.final.citations.map((x) => x.fact_id)] : []);
    const resolved = new Map<string, { read_on?: string } | null>();
    for (const id of cited) {
      if (/^question\.\d+$/.test(id)) {
        resolved.set(id, questionIds.has(Number(id.slice(9))) ? {} : null);
      } else if (id.startsWith("progress.")) {
        resolved.set(id, {});
      } else if (knownIds.has(id)) {
        resolved.set(id, records?.find((r) => r.id === id) ?? {});
      } else {
        try {
          const f = await input.parts.facts.byIds([id]);
          resolved.set(id, f.find((x) => x.id === id) ?? null);
        } catch {
          resolved.set(id, null);
        }
      }
    }
    const allow = [...baseAllow, ...[...resolved.values()].map((r) => r?.read_on).filter((d): d is string => typeof d === "string")];
    const ctx: ScoreContext = {
      truthText: (globs) => (records ? factsMatching(records, globs).map((r) => `${r.text_en}\n${r.text_de}`).join("\n") : ""),
      resolveFact: (id) => resolved.get(id) !== null && resolved.has(id),
      officialHosts: hosts,
      alwaysAllowDates: allow,
      todayVienna,
      fixtures: input.fixtures,
    };
    const s = scoreCase(c, o, ctx);
    scores.push(s);
    reports.push({
      id: c.id,
      category: c.category,
      kind: s.kind,
      lang: c.lang,
      pass: s.pass,
      critical: s.critical,
      failures: s.failures,
      soft: s.soft,
      refused: o.final?.refused ?? null,
      refusalLink: o.final?.refusal_link ?? null,
      citations: o.final ? [...new Set([...o.final.answer_blocks.flatMap((b) => b.fact_ids), ...o.final.citations.map((x) => x.fact_id)])] : [],
      error: o.error,
      text: o.text,
      calls: o.calls.length,
      costMicro: o.calls.reduce((n, x) => n + (x.costMicro ?? 0), 0),
      inputTokens: o.calls.reduce((n, x) => n + (x.usage?.input_tokens ?? 0), 0),
      outputTokens: o.calls.reduce((n, x) => n + (x.usage?.output_tokens ?? 0), 0),
      cacheReadTokens: o.calls.reduce((n, x) => n + (x.usage?.cache_read_input_tokens ?? 0), 0),
      cacheWriteTokens: o.calls.reduce((n, x) => n + (x.usage?.cache_creation_input_tokens ?? 0), 0),
    });
  }

  const bar = evaluatePassBar(scores, input.golden.pass_bar);
  const lang = scores.filter((s) => s.checks.languageMatch !== undefined);
  const reasons = scores.filter((s) => s.checks.reasonMatch !== undefined);
  const models = [...new Set(outcomes.flatMap((o) => o.calls.map((c) => c.model)))];
  return {
    meta: {
      mode: input.mode,
      as_of: input.golden.as_of,
      golden_version: input.golden.version,
      cases_total: input.golden.cases.length,
      cases_selected: cases.length,
      cases_run: outcomes.length,
      skipped_for_budget: result.skippedForBudget,
      ground_truth_from_files: records !== null,
      spent_micro: result.spentMicro,
      spent_usd: result.spentMicro / 1_000_000,
      models,
      synthetic_usage: input.mode !== "live",
    },
    bar,
    // A bar line with nothing to grade (pass === null) does not fail the run, but a run with no cases at all does.
    barPass: scores.length > 0 && bar.every((b) => b.advisory || b.pass !== false),
    categories: categoryStats(scores),
    soft: {
      languageMatchRate: lang.length ? lang.filter((s) => s.checks.languageMatch).length / lang.length : null,
      refusalReasonMatchRate: reasons.length ? reasons.filter((s) => s.checks.reasonMatch).length / reasons.length : null,
      emDashCases: scores.filter((s) => s.soft.includes("em_dash")).length,
      tooLongCases: scores.filter((s) => s.soft.includes("too_long")).length,
      validatorReplacedCases: scores.filter((s) => s.soft.includes("validator_replaced")).length,
    },
    tokens: buildTokenReport(outcomes),
    failing: scores.filter((s) => !s.pass),
    cases: reports,
  };
}

export function selectCases(file: GoldenFile, filter: { ids?: string[]; category?: string; lang?: string; limit?: number }): GoldenCase[] {
  let cases = file.cases.slice();
  if (filter.ids?.length) {
    const set = new Set(filter.ids);
    cases = cases.filter((c) => set.has(c.id));
  }
  if (filter.category) cases = cases.filter((c) => c.category === filter.category);
  if (filter.lang) cases = cases.filter((c) => c.lang === filter.lang);
  if (filter.limit !== undefined && filter.limit >= 0) cases = cases.slice(0, filter.limit);
  return cases;
}
