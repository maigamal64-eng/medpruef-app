/**
 * Pure rules for the free-set explanation translation staging job (a29,
 * CNT-35, LX-21, pick-translation-batch A). No I/O, no env.
 *
 * The slice is the free set the learner can actually read: freeSetIds() from
 * src/lib/free-set.ts (the committed a-free-set data, 150 per bank spread
 * across topics), not the old 150 lowest ids. A unit test pins this module to
 * the same function free-tier.ts serves (loadFreeSliceIds).
 */
import { createHash } from "node:crypto";
import { freeSetIds } from "@/lib/free-set";
import { isTranslationTarget, isUsableTranslation, TRANSLATION_TARGETS, type TranslationTarget } from "@/lib/explanation-translation";

export const SLICE_EXAMS = ["kenntnispruefung", "kmp_innsbruck", "pharma"] as const;
export type SliceExam = (typeof SLICE_EXAMS)[number];

/** CNT-35 target: all seven languages, explanation field only. */
export const STAGE_FIELD = "explanation" as const;
export const STAGE_LANGS: readonly TranslationTarget[] = TRANSLATION_TARGETS;

/** A source shorter than this is fixed by content work first (b06/b12), never translated. */
export const MIN_SOURCE_CHARS = 80;

export function sliceIds(exam: SliceExam): number[] {
  return [...freeSetIds(exam)];
}

export function allSliceIds(): Map<SliceExam, number[]> {
  return new Map(SLICE_EXAMS.map((exam) => [exam, sliceIds(exam)]));
}

export interface SourceRow {
  id: number;
  exam_type: string;
  is_active: boolean;
  explanation: string | null;
}

export interface CachedCell {
  question_id: number;
  lang: string;
  field: string;
  translated_text: string | null;
}

export interface Cell {
  question_id: number;
  exam: SliceExam;
  lang: TranslationTarget;
  source_sha256: string;
  source_chars: number;
}

export interface PlanSummary {
  exam: SliceExam;
  slice: number;
  inactive: number[];
  shortSource: number[];
  perLang: Record<TranslationTarget, { cached: number; unusable: number; missing: number }>;
}

export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Message Batches custom_id, stable per cell and source text: a changed source is a new item. */
export function translationCustomId(cell: Pick<Cell, "question_id" | "lang" | "source_sha256">): string {
  return `q${cell.question_id}_${cell.lang}_${cell.source_sha256.slice(0, 16)}`;
}

/**
 * Which cells to stage: active slice rows with a usable source, in every
 * target language, minus cells that already hold a usable translation. A
 * cached blank or stub row counts as unusable and is listed, not overwritten
 * (the insert path is ON CONFLICT DO NOTHING; removing it is a separate step).
 */
export function planCells(
  exam: SliceExam,
  ids: readonly number[],
  sources: readonly SourceRow[],
  cached: readonly CachedCell[],
  langs: readonly TranslationTarget[] = STAGE_LANGS,
): { cells: Cell[]; summary: PlanSummary } {
  const byId = new Map(sources.map((row) => [row.id, row]));
  const have = new Map<string, string | null>();
  for (const c of cached) if (c.field === STAGE_FIELD) have.set(`${c.question_id}:${c.lang}`, c.translated_text);
  const perLang = Object.fromEntries(langs.map((l) => [l, { cached: 0, unusable: 0, missing: 0 }])) as PlanSummary["perLang"];
  const inactive: number[] = [];
  const shortSource: number[] = [];
  const cells: Cell[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !row.is_active || row.exam_type !== exam) {
      inactive.push(id);
      continue;
    }
    const source = (row.explanation ?? "").trim();
    if (source.length < MIN_SOURCE_CHARS) {
      shortSource.push(id);
      continue;
    }
    for (const lang of langs) {
      const key = `${id}:${lang}`;
      if (have.has(key)) {
        if (isUsableTranslation(have.get(key), source)) perLang[lang].cached += 1;
        else perLang[lang].unusable += 1;
        continue;
      }
      perLang[lang].missing += 1;
      cells.push({ question_id: id, exam, lang, source_sha256: sourceHash(row.explanation ?? ""), source_chars: source.length });
    }
  }
  return { cells, summary: { exam, slice: ids.length, inactive, shortSource, perLang } };
}

/** Rough token estimate for planning only: about 3.5 characters per token, output about 1.2x input. */
export function estimateTokens(cells: readonly Cell[], systemChars = 1300): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const c of cells) {
    input += Math.ceil((c.source_chars + systemChars) / 3.5);
    output += Math.ceil((c.source_chars * 1.2) / 3.5);
  }
  return { input, output };
}

/** Deterministic pilot pick: spread over languages and banks, first N in a stable order. */
export function pilotCells(cells: readonly Cell[], n: number): Cell[] {
  const order = [...cells].sort((a, b) => a.lang.localeCompare(b.lang) || a.exam.localeCompare(b.exam) || a.question_id - b.question_id);
  const buckets = new Map<string, Cell[]>();
  for (const c of order) {
    const k = `${c.lang}:${c.exam}`;
    buckets.set(k, [...(buckets.get(k) ?? []), c]);
  }
  const out: Cell[] = [];
  const queues = [...buckets.values()];
  while (out.length < n && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
      if (out.length >= n) break;
    }
  }
  return out;
}

export interface StagedRow extends Cell {
  field: typeof STAGE_FIELD;
  translated_text: string;
  source_model: string;
  staged_at: string;
}

export interface SignoffEntry {
  lang: TranslationTarget;
  reviewer: string | null;
  reviewed_on: string | null;
  verdict: "pass" | "fail" | "pending";
  critical_errors: number | null;
  countersigned_by_owner?: string | null;
}

/** A language may be applied only with a dated passing native review (Arabic also countersigned by [name]). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function languageApproved(entry: SignoffEntry | undefined): boolean {
  if (!entry || !isTranslationTarget(entry.lang) || entry.verdict !== "pass" || !entry.reviewer) return false;
  if (!entry.reviewed_on || !ISO_DATE.test(entry.reviewed_on) || !Number.isFinite(Date.parse(entry.reviewed_on))) return false;
  if (entry.critical_errors === null || entry.critical_errors > 0) return false;
  if (entry.lang === "ar" && !entry.countersigned_by_owner) return false;
  return true;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The guard-checked changeset: one INSERT per staged row of an approved
 * language. Each insert only lands while the live explanation still hashes to
 * the staged source and the question is active, and never replaces an
 * existing cell. Rows of unapproved languages and unusable texts are skipped.
 */
export function buildApplySql(rows: readonly StagedRow[], signoff: readonly SignoffEntry[]): { sql: string; included: number; skipped: number } {
  const approved = new Set(signoff.filter(languageApproved).map((e) => e.lang));
  const lines: string[] = [
    "-- a29 free-set explanation translations (generated, review before running).",
    "-- Guard: inserts only where the live explanation still matches the staged source hash.",
    "BEGIN;",
  ];
  let included = 0;
  let skipped = 0;
  for (const r of rows) {
    if (
      !isTranslationTarget(r.lang) ||
      !approved.has(r.lang) ||
      !Number.isInteger(r.question_id) ||
      r.question_id <= 0 ||
      r.field !== STAGE_FIELD ||
      !isUsableTranslation(r.translated_text) ||
      !/^[0-9a-f]{64}$/.test(r.source_sha256)
    ) {
      skipped += 1;
      continue;
    }
    included += 1;
    lines.push(
      "INSERT INTO public.question_translations (question_id, lang, field, translated_text, source_model)",
      `SELECT q.id, ${sqlString(r.lang)}, 'explanation', ${sqlString(r.translated_text.trim())}, ${sqlString(r.source_model)}`,
      `FROM public.questions q WHERE q.id = ${r.question_id} AND q.is_active`,
      `  AND encode(sha256(convert_to(q.explanation, 'UTF8')), 'hex') = ${sqlString(r.source_sha256)}`,
      "ON CONFLICT (question_id, lang, field) DO NOTHING;",
    );
  }
  lines.push("COMMIT;");
  return { sql: `${lines.join("\n")}\n`, included, skipped };
}

/** Spend recorded by earlier stage runs (data/spend.jsonl, one JSON object per run). */
export function priorSpendMicro(ledger: string): number {
  let total = 0;
  for (const line of ledger.split("\n")) {
    if (!line.trim()) continue;
    const micro = Number((JSON.parse(line) as { micro?: unknown }).micro);
    if (Number.isFinite(micro) && micro > 0) total += micro;
  }
  return total;
}

// ─── C4 (a-content-c1): English for the whole bank, QA by back-translation ──

/**
 * content.json C4: the whole-bank scope stages English only. The other six
 * languages stay on the free set (CNT-35); a whole-bank run for them waits
 * for a native reviewer.
 */
export const BANK_SCOPE_LANGS: readonly TranslationTarget[] = ["en"];
export type StageScope = "free-set" | "bank";

/** Hot rows first (90-day answers, most first), then by id: the learners' questions get English first. */
export function orderCellsHotFirst(cells: readonly Cell[], answers90d: Readonly<Record<string, number>>): Cell[] {
  const n = (id: number) => Math.max(0, Number(answers90d[String(id)] ?? 0) || 0);
  return [...cells].sort((a, b) => n(b.question_id) - n(a.question_id) || a.question_id - b.question_id || a.lang.localeCompare(b.lang));
}

/** Seeded, stable QA sample: about `rate` of the staged rows per language, at least one per language. */
export function qaSample(rows: readonly StagedRow[], rate = 0.05, seed = "c4-qa-2026-10"): StagedRow[] {
  const byLang = new Map<string, StagedRow[]>();
  for (const r of rows) byLang.set(r.lang, [...(byLang.get(r.lang) ?? []), r]);
  const out: StagedRow[] = [];
  for (const list of byLang.values()) {
    const ranked = [...list].sort((a, b) => qaRank(a, seed).localeCompare(qaRank(b, seed)));
    out.push(...ranked.slice(0, Math.max(1, Math.round(list.length * rate))));
  }
  return out;
}

function qaRank(r: StagedRow, seed: string): string {
  return createHash("sha256").update(`${seed}:${r.question_id}:${r.lang}:${r.source_sha256}`, "utf8").digest("hex");
}

export function qaCustomId(r: Pick<StagedRow, "question_id" | "lang" | "source_sha256">): string {
  return `qa${r.question_id}_${r.lang}_${r.source_sha256.slice(0, 16)}`;
}

export const QA_SYSTEM = [
  "You check machine translations of German medical exam explanations (Austrian licensing exams).",
  "You get the German source and its translation. First translate the translation back into German (back_translation). Then compare the meaning of the back-translation with the source.",
  "meaning_drift is true when a medical fact, number, dose, drug, negation, laterality or the answer the explanation supports differs, or when content is missing or added. Wording, word order and register do not count.",
  "severity: none, minor (meaning slightly shifted, a learner would not learn something wrong) or major (a learner would learn something wrong or miss a key fact).",
  "note: at most one English sentence naming the drift; empty when there is none. Return only the JSON object the schema asks for.",
].join("\n");

export const QA_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["back_translation", "meaning_drift", "severity", "note"],
  properties: {
    back_translation: { type: "string" },
    meaning_drift: { type: "boolean" },
    severity: { type: "string", enum: ["none", "minor", "major"] },
    note: { type: "string" },
  },
};

export interface QaVerdict {
  meaning_drift: boolean;
  severity: "none" | "minor" | "major";
  note: string;
  back_translation_chars: number;
}

export function buildQaUser(source: string, translated: string, langLabel: string): string {
  return [`German source:`, source.trim(), "", `Translation (${langLabel}):`, translated.trim()].join("\n");
}

export function parseQa(text: string): QaVerdict {
  const j = JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")) as Record<string, unknown>;
  if (typeof j.meaning_drift !== "boolean") throw new Error("meaning_drift not a boolean");
  if (j.severity !== "none" && j.severity !== "minor" && j.severity !== "major") throw new Error("severity invalid");
  if (typeof j.back_translation !== "string" || typeof j.note !== "string") throw new Error("text fields missing");
  return { meaning_drift: j.meaning_drift, severity: j.severity, note: j.note.trim().slice(0, 300), back_translation_chars: j.back_translation.length };
}
