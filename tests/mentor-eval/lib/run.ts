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
  /** Set when the case ended in a transient upstream error after its re-runs: not graded, not a failure. */
  notEvaluated?: string;
  /** Runs of this case (re-runs only after a transient upstream error). */
  attempts: number;
  /** How each earlier, transiently failed run ended. */
  earlierAttempts?: Array<{ error: string | null; errorCodes: string[]; alerts: string[] }>;
  text: string;
  calls: number;
  costMicro: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Ops alerts the turn raised (validator_error, tool_error, overrun, ...): the detail behind an upstream_error. */
  alerts: string[];
  /** One entry per model call: how it ended. */
  callTrace: Array<{ ok: boolean; stopReason: string | null; toolUses: string[]; outputTokens: number | null; textChars: number | null; ms: number; errorCode?: string; errorMessage?: string; rawText?: string }>;
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
    /** Cases that still ended in a transient upstream error after their re-runs: not graded; the run cannot pass until they are re-run. */
    not_evaluated: string[];
    ground_truth_from_files: boolean;
    spent_micro: number;
    spent_usd: number;
    models: string[];
    /** true unless the model was real: scripted and stub runs invent their usage, so their token numbers prove the plumbing only. */
    synthetic_usage: boolean;
  };
  bar: BarResult[];
  barPass: boolean;
  /** PASS: every case graded and the bar met. FAIL: a graded case misses the bar. INCOMPLETE: the graded cases meet the bar but some were not evaluated (re-run needed). */
  status: "PASS" | "FAIL" | "INCOMPLETE";
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

  const notEvaluated: string[] = [];
  for (const c of cases) {
    const o = result.outcomes.get(c.id);
    if (!o) continue;
    outcomes.push(o);
    if (o.notEvaluated) {
      // Gate round 8: a transient API failure is reported, never graded as a citation or answer failure.
      notEvaluated.push(c.id);
      reports.push({
        id: c.id, category: c.category, kind: "not_evaluated", lang: c.lang, pass: false, critical: [], failures: [], soft: [],
        refused: null, refusalLink: null, citations: [], error: o.error, notEvaluated: o.notEvaluated, attempts: o.attempts ?? 1, ...(o.earlierAttempts ? { earlierAttempts: o.earlierAttempts } : {}), text: o.text,
        calls: o.calls.length, costMicro: o.calls.reduce((n, x) => n + (x.costMicro ?? 0), 0) + (o.earlierAttemptsCostMicro ?? 0),
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, alerts: [...o.alerts],
        callTrace: o.calls.map((x) => ({ ok: x.ok, stopReason: x.stopReason, toolUses: [...x.toolUses], outputTokens: x.usage?.output_tokens ?? null, textChars: x.textChars ?? null, ms: x.ms, ...(x.errorCode ? { errorCode: x.errorCode } : {}), ...(x.errorMessage ? { errorMessage: x.errorMessage } : {}) })),
      });
      continue;
    }

    // Resolve what the answer cited: the loader proves derived ids (sitting.*, app.*), files prove data ids.
    const cited = new Set<string>(o.final ? [...o.final.answer_blocks.flatMap((b) => b.fact_ids), ...o.final.citations.map((x) => x.fact_id)] : []);
    const resolved = new Map<string, { read_on?: string; text_en?: string; text_de?: string } | null>();
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
      truthText: (globs) => {
        const rows = new Map((records ? factsMatching(records, globs) : []).map((r) => [r.id,r]));
        for (const id of globs) { const r=resolved.get(id); if (r && typeof r.text_en === "string" && typeof r.text_de === "string") rows.set(id,{id,text_en:r.text_en,text_de:r.text_de} as FactRecord); }
        return [...rows.values()].map((r)=>`${r.text_en}\n${r.text_de}`).join("\n");
      },
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
      attempts: o.attempts ?? 1,
      ...(o.earlierAttempts ? { earlierAttempts: o.earlierAttempts } : {}),
      text: o.text,
      calls: o.calls.length,
      costMicro: o.calls.reduce((n, x) => n + (x.costMicro ?? 0), 0) + (o.earlierAttemptsCostMicro ?? 0),
      inputTokens: o.calls.reduce((n, x) => n + (x.usage?.input_tokens ?? 0), 0),
      outputTokens: o.calls.reduce((n, x) => n + (x.usage?.output_tokens ?? 0), 0),
      cacheReadTokens: o.calls.reduce((n, x) => n + (x.usage?.cache_read_input_tokens ?? 0), 0),
      cacheWriteTokens: o.calls.reduce((n, x) => n + (x.usage?.cache_creation_input_tokens ?? 0), 0),
      alerts: [...o.alerts],
      callTrace: o.calls.map((x) => ({
        ok: x.ok,
        stopReason: x.stopReason,
        toolUses: [...x.toolUses],
        outputTokens: x.usage?.output_tokens ?? null,
        textChars: x.textChars ?? null,
        ms: x.ms,
        ...(x.errorCode ? { errorCode: x.errorCode } : {}),
        ...(x.errorMessage ? { errorMessage: x.errorMessage } : {}),
        ...(x.rawText !== undefined ? { rawText: x.rawText } : {}),
      })),
    });
  }

  const bar = evaluatePassBar(scores, input.golden.pass_bar);
  const strictLanguageIds = new Set(cases.filter(c => c.require_language_match && !notEvaluated.includes(c.id)).map(c => c.id));
  const strictLanguageScores = scores.filter(s => strictLanguageIds.has(s.id));
  if (strictLanguageIds.size) {
    const matched = strictLanguageScores.filter(s => s.checks.languageMatch === true).length;
    bar.push({name:"native_language_match",label:"Strict native slice language match",required:"100% of selected strict cases",actual:`${matched}/${strictLanguageIds.size}`,n:strictLanguageIds.size,pass:matched === strictLanguageIds.size});
  }
  if (input.golden.precision_gate) {
    const answers = scores.filter(s => s.kind === "answer");
    const rate = answers.length ? answers.filter(s => s.soft.includes("validator_replaced")).length / answers.length : 0;
    const leaked = scores.length ? scores.filter(s => s.critical.some(c => /date/.test(c))).length / scores.length : 0;
    bar.push({name:"false_replacement_rate", label:"Grounded answers replaced", actual:String(rate), required:`< ${input.golden.precision_gate.false_replacement_rate_max}`, n:answers.length, pass:answers.length > 0 ? rate < input.golden.precision_gate.false_replacement_rate_max : null},
      {name:"leaked_unsupported_date_rate",label:"Unsupported dates leaked",actual:String(leaked),required:`<= ${input.golden.precision_gate.leaked_unsupported_date_rate_max}`,n:scores.length,pass:scores.length > 0 ? leaked <= input.golden.precision_gate.leaked_unsupported_date_rate_max : null},
      {name:"precision_case_completion",label:"Precision gate cases completed",actual:String(scores.length + notEvaluated.length),required:String(cases.length),n:cases.length,pass:scores.length + notEvaluated.length === cases.length && result.skippedForBudget.length === 0});
  }
  // Never graded as a failure, never a pass: every case must be evaluated for the run to pass.
  bar.push({name:"not_evaluated",label:"Cases not evaluated (transient API error after re-runs; re-run required)",required:"0",actual:notEvaluated.length ? `${notEvaluated.length} (${notEvaluated.join(", ")})` : "0",n:cases.length,pass:notEvaluated.length === 0});
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
      not_evaluated: notEvaluated,
      ground_truth_from_files: records !== null,
      spent_micro: result.spentMicro,
      spent_usd: result.spentMicro / 1_000_000,
      models,
      synthetic_usage: input.mode !== "live",
    },
    bar,
    // A bar line with nothing to grade (pass === null) does not fail the run, but a run with no cases at all does.
    barPass: scores.length > 0 && bar.every((b) => b.advisory || b.pass !== false),
    status: scores.length > 0 && bar.every((b) => b.advisory || b.pass !== false)
      ? "PASS"
      : notEvaluated.length > 0 && bar.every((b) => b.advisory || b.pass !== false || b.name === "not_evaluated")
        ? "INCOMPLETE"
        : "FAIL",
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
