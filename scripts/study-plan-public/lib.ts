/**
 * Offline narrative drafting for the public study plan (M8). Pure helpers,
 * unit-tested in tests/unit/study-plan-public/narratives-script.test.ts.
 *
 * Every combination of bank, official sitting and hours a week gets one
 * request; the model writes two or three sentences per language with
 * placeholders only (no digits, no dates, no prices). Code fills the values
 * at render time from the live plan, and Lektor approves before anything shows.
 */
import { MODEL_IDS, MODEL_SPECS } from "../../src/lib/ai/pricing";
import { getExamLabel } from "../../src/lib/master-locale/exam-label";
import {
  NARRATIVE_PLACEHOLDERS,
  PUBLIC_PLAN_BANKS,
  PUBLIC_PLAN_HOURS,
  buildPublicPlan,
  narrativeKey,
  publicSittingOptions,
  validateNarrative,
  type NarrativeEntry,
  type TopicCountRow,
} from "../../src/lib/study-plan-public";
import type { PuypExamType } from "../../src/lib/exam-dates";
import type { EffortVerdict } from "../../src/lib/master-learning/plan-effort";

export const DRAFT_MODEL = MODEL_IDS.SONNET_5_5;
export const MAX_TOKENS = 4000;
/** Expected output per request (about 0.6k text plus thinking); the cap check uses MAX_TOKENS. */
export const EXPECTED_OUTPUT_TOKENS = 1200;
export const BATCH_DISCOUNT = 0.5;

export interface Combination {
  key: string;
  customId: string;
  bank: PuypExamType;
  sitting: string;
  hours: number;
  verdict: EffortVerdict;
  facts: Record<string, string | number | boolean>;
}

export function customIdFor(bank: string, sitting: string, hours: number): string {
  return `${bank}__${sitting}__h${hours}`;
}

export function keyFromCustomId(id: string): string | null {
  const m = /^([a-z_]+)__(\d{4}-\d{2}-\d{2})__h(\d{1,2})$/.exec(id);
  return m ? narrativeKey(m[1], m[2], Number(m[3])) : null;
}

/** Every combination the page can show today, with the plan facts the model sees. */
export function combinations(
  countsByBank: Partial<Record<PuypExamType, TopicCountRow[]>>,
  todayISO: string,
  now: Date = new Date(`${todayISO}T12:00:00Z`),
): Combination[] {
  const out: Combination[] = [];
  for (const bank of PUBLIC_PLAN_BANKS) {
    const counts = countsByBank[bank];
    if (!counts || counts.length === 0) continue;
    for (const option of publicSittingOptions(bank, now)) {
      for (const hours of PUBLIC_PLAN_HOURS) {
        const plan = buildPublicPlan({ query: { bank, sitting: option.date, hours }, topicCounts: counts, todayISO, now });
        if (!plan.verdict) continue;
        const newWeeks = plan.weeks.filter((w) => w.phase === "new").length;
        out.push({
          key: narrativeKey(bank, option.date, hours),
          customId: customIdFor(bank, option.date, hours),
          bank,
          sitting: option.date,
          hours,
          verdict: plan.verdict,
          facts: {
            exam_de: getExamLabel(bank, "full", "de"),
            exam_en: getExamLabel(bank, "full", "en"),
            sitting_names: option.labels.map((l) => l.en).join(", "),
            publishers: option.publishers.join(" and "),
            two_publishers: option.publishers.length > 1,
            weeks_to_sitting: Math.floor(plan.daysLeft / 7),
            hours_per_week: hours,
            questions_per_day: plan.dailyGoal,
            bank_questions: plan.bankTotal,
            reaches_whole_bank: plan.reachable >= plan.bankTotal,
            verdict: plan.verdict,
            new_material_weeks: newWeeks,
            review_weeks: plan.weeks.length - newWeeks,
            mock_exams_planned: plan.weeks.reduce((s, w) => s + w.simulations, 0),
          },
        });
      }
    }
  }
  return out;
}

export const SYSTEM_PROMPT = `You write the two or three sentence introduction above a study plan on MedPrüf, an exam-preparation site for internationally trained doctors preparing for Austrian medical exams (Austria, never Germany).

Write one German and one English version of the same short text (at most 380 characters each).

Hard rules:
- Use placeholders for every number, date and name of an exam or sitting: {exam}, {sitting}, {weeks}, {hours}, {per_week}, {review_from}. Code fills them. Write no digits at all, no dates, no months, no years.
- German addresses the reader formally (Sie, Ihr, Ihnen). Never du.
- No prices, no plan names, no "free" or "kostenlos".
- No promise about passing or exam results, no success rates, no guarantees.
- No advice on which exams the reader must take, on eligibility, admission or the recognition procedure.
- Do not call the questions official, real or original exam questions. They are practice questions.
- Never use em dashes or en dashes. Use commas, colons or full stops.
- Calm, factual, encouraging. Describe how the plan uses the time: new questions first, then review from {review_from}, and what the pace means. If the verdict is "tight" or "too_much", say plainly that time is short, without alarm.

Return JSON with the keys "de" and "en".`;

export function userPrompt(c: Combination): string {
  return `Plan facts (for your understanding only; write placeholders, not these values):\n${JSON.stringify(c.facts, null, 2)}\n\nPlaceholders you may use: ${NARRATIVE_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`;
}

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: { de: { type: "string" }, en: { type: "string" } },
  required: ["de", "en"],
  additionalProperties: false,
} as const;

export interface BatchRequest {
  custom_id: string;
  params: Record<string, unknown>;
}

/** One Message Batches request. No temperature or prefill (rejected on current models). */
export function batchRequest(c: Combination): BatchRequest {
  return {
    custom_id: c.customId,
    params: {
      model: DRAFT_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: userPrompt(c) }],
    },
  };
}

/** Rough token count for the estimate (4 characters a token, rounded up). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** USD estimate for a batch: expected and worst case (every request at MAX_TOKENS). */
export function estimateUsd(requests: readonly BatchRequest[]): { expected: number; worst: number; inputTokens: number } {
  const spec = MODEL_SPECS[DRAFT_MODEL];
  const inputTokens = requests.reduce((s, r) => s + approxTokens(JSON.stringify(r.params)), 0);
  const inUsd = (inputTokens * spec.base.input) / 1e12;
  const out = (tokens: number) => (requests.length * tokens * spec.base.output) / 1e12;
  return {
    inputTokens,
    expected: (inUsd + out(EXPECTED_OUTPUT_TOKENS)) * BATCH_DISCOUNT,
    worst: (inUsd + out(MAX_TOKENS)) * BATCH_DISCOUNT,
  };
}

export interface ResultLine {
  custom_id: string;
  result: {
    type: "succeeded" | "errored" | "canceled" | "expired";
    message?: { stop_reason?: string; content?: { type: string; text?: string }[] };
    error?: unknown;
  };
}

export type ParsedResult =
  | { ok: true; customId: string; de: string; en: string }
  | { ok: false; customId: string; reason: string };

/** Reads one results line: the first text block, parsed as {de, en}. Never content[0]. */
export function parseResult(line: ResultLine): ParsedResult {
  const id = line.custom_id;
  if (line.result.type !== "succeeded") return { ok: false, customId: id, reason: line.result.type };
  const msg = line.result.message;
  if (msg?.stop_reason === "refusal") return { ok: false, customId: id, reason: "refusal" };
  if (msg?.stop_reason === "max_tokens") return { ok: false, customId: id, reason: "max_tokens" };
  const text = msg?.content?.find((b) => b.type === "text")?.text;
  if (!text) return { ok: false, customId: id, reason: "no_text" };
  try {
    const parsed = JSON.parse(text) as { de?: unknown; en?: unknown };
    if (typeof parsed.de !== "string" || typeof parsed.en !== "string") return { ok: false, customId: id, reason: "bad_shape" };
    return { ok: true, customId: id, de: parsed.de.trim(), en: parsed.en.trim() };
  } catch {
    return { ok: false, customId: id, reason: "bad_json" };
  }
}

export interface DraftEntry extends NarrativeEntry {
  issues: string[];
}

export function draftEntry(c: Combination, r: Extract<ParsedResult, { ok: true }>, draftedOn: string): DraftEntry {
  return {
    key: c.key,
    bank: c.bank,
    sitting: c.sitting,
    hours: c.hours,
    verdict: c.verdict,
    de: r.de,
    en: r.en,
    status: "draft",
    model: DRAFT_MODEL,
    drafted_on: draftedOn,
    issues: [...validateNarrative(r.de, "de").map((i) => `de:${i}`), ...validateNarrative(r.en, "en").map((i) => `en:${i}`)],
  };
}

/** Approved entry for narratives.data.json (Lektor's decision recorded with name and date). */
export function approveEntry(d: DraftEntry, by: string, on: string, hash: (text: string) => string): NarrativeEntry {
  if (d.issues.length > 0) throw new Error(`${d.key} has open issues: ${d.issues.join(", ")}`);
  const { issues: _issues, ...rest } = d;
  void _issues;
  return { ...rest, status: "approved", approved_by: by, approved_on: on, text_sha256: hash(`${d.de}\n${d.en}`) };
}
