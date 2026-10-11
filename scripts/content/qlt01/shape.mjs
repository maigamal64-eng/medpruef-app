/**
 * QLT-01/TR-03 read-only shape audit, policy frozen 2026-10-11.
 * COUNT_RE (giu): \b([1-9]\d*|eine?|zwei|drei|vier|fünf)\s+(?:richtige[nrsm]?|korrekte[nrsm]?|correct)\s+(?:antwort(?:en)?|answers?)\b
 * Shape flags describe practice items, never prove a medical key or an official exam format.
 * A proposed N must pass a human medical review before any SQL is generated.
 */
import { filterDisplayableChoices } from "../../../src/lib/mcq.ts";

export const POLICY_VERSION = "qlt01-2026-10-11-v1";
export const COUNT_PATTERN = String.raw`\b([1-9]\d*|eine?|zwei|drei|vier|fünf)\s+(?:richtige[nrsm]?|korrekte[nrsm]?|correct)\s+(?:antwort(?:en)?|answers?)\b`;
const WORD_COUNTS = { ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5 };
const CONTENT_COLUMNS = new Set(["question", "choices", "answer", "explanation", "is_active"]);
const LEGACY_HINT = /(?:\(([1-9]\d*)(?:\s+(?:Answers?|Antworten?|richtige\s+Antworte))?\)|\[([1-9]\d*)\])\s*$/iu;

export function plainText(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

export function statedCounts(stem) {
  return [...plainText(stem).matchAll(new RegExp(COUNT_PATTERN, "giu"))]
    .map(match => WORD_COUNTS[match[1].toLowerCase()] ?? Number(match[1]));
}

export function activeClaims(lines) {
  const latest = new Map();
  for (const line of lines) {
    if (!line.claim || !line.pkg || !Array.isArray(line.ids) || !Array.isArray(line.columns)) {
      throw new Error("Malformed row claim; audit cannot establish exclusions");
    }
    latest.set(line.claim, line);
  }
  return [...latest.values()].filter(claim => claim.status === "active" &&
    claim.table === "questions" && claim.pkg !== "b08-shape-hygiene" &&
    claim.columns.some(column => CONTENT_COLUMNS.has(column)));
}

export function exclusionIndex(rows, freeze, claims = []) {
  if (!Array.isArray(freeze.open_picks) || !Array.isArray(freeze.protected?.ids) ||
      !Array.isArray(freeze.protected?.track-a_applied_tags) ||
      !Array.isArray(freeze.archive?.id_range)) throw new Error("Incomplete freeze policy");
  const index = new Map();
  const add = (id, reason) => index.set(id, [...new Set([...(index.get(id) ?? []), reason])]);
  for (const pick of freeze.open_picks) for (const id of pick.ids ?? []) add(id, `open-pick:${pick.id}`);
  for (const id of freeze.protected.ids) add(id, "protected-partner");
  for (const claim of activeClaims(claims)) for (const id of claim.ids) add(id, `claimed:${claim.pkg}`);
  for (const row of rows) {
    if (!Array.isArray(row.tags) && row.tags !== null) throw new Error(`Invalid tags on question ${row.id}`);
    for (const tag of row.tags ?? []) {
      const survivor = /^duplicate-of-(?:active-)?(\d+)$/.exec(tag);
      if (survivor) add(Number(survivor[1]), `duplicate-survivor:${row.id}`);
      if (freeze.protected.track-a_applied_tags.includes(tag)) add(row.id, `track-a-applied:${tag}`);
    }
    if ((row.id >= freeze.archive.id_range[0] && row.id <= freeze.archive.id_range[1]) ||
        String(row.source_file ?? "").startsWith("ARCHIVE_ORIGINAL_")) add(row.id, "archive");
  }
  return index;
}

export function inspectShape(row) {
  // NULL or [] means free recall in the app, not a malformed MCQ.
  if (row.choices === null || (Array.isArray(row.choices) && row.choices.length === 0)) return null;
  if (!Array.isArray(row.choices)) return { codes: ["malformed_choices"], stored_options: null, displayed_options: null, correct_count: null, stated_counts: statedCounts(row.question) };
  const malformed = row.choices.some(choice => !choice || typeof choice.text !== "string" || typeof choice.correct !== "boolean");
  const codes = [];
  if (malformed) codes.push("malformed_choices");
  if (!malformed && row.choices.some(choice => choice.correct && /^[\s?.\-\u2013\u2014_]*$/u.test(choice.text))) codes.push("unusable_correct_choice");
  const correctCount = row.choices.filter(choice => choice?.correct === true).length;
  // Do not coerce malformed keys into a plausible rendered key.
  const displayed = malformed ? null : filterDisplayableChoices(row.choices);
  const stated = statedCounts(row.question);
  const legacy = LEGACY_HINT.exec(plainText(row.question));
  const legacyCount = legacy ? Number(legacy[1] ?? legacy[2]) : null;
  if (correctCount === 0) codes.push("no_correct_choice");
  if (correctCount >= 2 && stated.length === 0) codes.push("multi_without_n");
  if (stated.some(n => n !== correctCount)) codes.push("stated_n_key_mismatch");
  if (legacyCount !== null && legacyCount !== correctCount) codes.push("legacy_n_key_mismatch");
  if (stated.length > 1) codes.push("multiple_count_annotations");
  if (row.choices.length < 4) codes.push("under_four_options");
  if (row.choices.length > 5) codes.push("over_five_options");
  if (correctCount > 3) codes.push("four_plus_correct");
  if (displayed && displayed.length !== row.choices.length) codes.push("placeholder_options_hidden");
  if (displayed && displayed.length < 4) codes.push("displayed_under_four_options");
  if (!codes.length) return null;
  return { codes, stored_options: row.choices.length, displayed_options: displayed?.length ?? null,
    correct_count: correctCount, stated_counts: stated, legacy_count_hint: legacyCount };
}

export function buildReport(rows, freeze, claims = [], metadata = {}) {
  const ids = new Set();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || ids.has(row.id) || typeof row.is_active !== "boolean") {
      throw new Error("Question snapshot has duplicate ids or invalid row identity/state");
    }
    ids.add(row.id);
  }
  const excluded = exclusionIndex(rows, freeze, claims);
  const findings = [];
  const summary = {};
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (!row.is_active || !["kenntnispruefung", "kmp_innsbruck"].includes(row.exam_type)) continue;
    const totals = summary[row.exam_type] ??= { active_rows: 0, mcq_rows: 0, four_option_rows: 0, flagged_rows: 0, eligible_rows: 0, excluded_rows: 0, codes: {} };
    totals.active_rows++;
    if (Array.isArray(row.choices) && row.choices.length) totals.mcq_rows++;
    if (Array.isArray(row.choices) && row.choices.length === 4) totals.four_option_rows++;
    const shape = inspectShape(row);
    if (!shape) continue;
    totals.flagged_rows++;
    const reasons = excluded.get(row.id) ?? [];
    if (reasons.length) totals.excluded_rows++; else totals.eligible_rows++;
    for (const code of shape.codes) totals.codes[code] = (totals.codes[code] ?? 0) + 1;
    const onlyMissingN = shape.codes.length === 1 && shape.codes[0] === "multi_without_n";
    const nonSelection = /ordnen|richtig.{0,12}falsch|zuordn|reihenfolge|beurteilen|beurteile|bewerte|bewerten|überprüfen|bei\s+jeder\s+aussage|folgende\s+aussage\s+ist|welche\s+aussage\s+ist/iu.test(plainText(row.question));
    const copyUnsafe = /[\u2013\u2014\u0600-\u06ff]/u.test(String(row.question ?? ""));
    const canPropose = onlyMissingN && !nonSelection && !copyUnsafe && typeof row.question === "string";
    findings.push({ id: row.id, exam_type: row.exam_type, ...shape, exclusion_reasons: reasons,
      disposition: reasons.length ? "excluded" : canPropose ? "n_candidate_needs_medical_read" : "needs_medical_shape_decision",
      proposed_question: !reasons.length && canPropose ? (LEGACY_HINT.test(row.question.trim()) ? row.question.trim().replace(LEGACY_HINT, `(${shape.correct_count} richtige Antworten)`) : `${row.question.trim()} (${shape.correct_count} richtige Antworten)`) : null,
      question: row.question, answer: row.answer, choices: row.choices, explanation: row.explanation,
      source_file: row.source_file, tags: row.tags });
  }
  return { schema_version: 1, policy: { version: POLICY_VERSION, count_pattern: COUNT_PATTERN, flags: "giu",
    scope: ["kenntnispruefung", "kmp_innsbruck"], option_count_reference: 5, maximum_correct_reference: 3,
    note: "Shape reference is an audit criterion. It is not a claim about official exam items or medical correctness." },
    metadata, snapshot_rows: rows.length, summary, findings };
}
