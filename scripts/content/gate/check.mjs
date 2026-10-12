import { createHash } from 'node:crypto';

export const PACKAGE = 'b20-activation-gate-ledger';
export const RULES = Object.freeze({ version: 1, ngram_size: 5, overlap_limit: 0.6, min_explanation: 80, max_batch: 50 });
export function normalize(text) {
  return String(text ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const contentHash = (text) => sha256(normalize(text));
export function reviewHash(row) {
  // Fixed order, no supplied hash can substitute for the actual reviewed content.
  return sha256(JSON.stringify([row.question, row.choices, row.answer, row.explanation,
    row.source_file, row.topic, row.exam_type]));
}
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
function readDateValid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
}
export function grams(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  if (words.length < RULES.ngram_size) return new Set(words.length ? [words.join(' ')] : []);
  return new Set(words.slice(0, words.length - RULES.ngram_size + 1)
    .map((_, i) => words.slice(i, i + RULES.ngram_size).join(' ')));
}
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  return [...a].filter((g) => b.has(g)).length / Math.min(a.size, b.size);
}
export function policyIds(policy) {
  return new Set([...(policy.open_picks ?? []).flatMap((pick) => pick.ids ?? []), ...(policy.protected?.ids ?? [])]);
}
export function eligibility(row, policy, corpus) {
  const errors = [];
  if (!Number.isSafeInteger(row.id) || row.id <= 114657) errors.push('ID_NOT_NEW');
  if (row.id >= 114259 && row.id <= 114657 || /^ARCHIVE_ORIGINAL_/i.test(row.source_file ?? '')) errors.push('ARCHIVE');
  if (policyIds(policy).has(row.id)) errors.push('FROZEN_ID');
  if (!Array.isArray(row.tags) || !row.tags.includes('authored-track-b')) errors.push('NOT_AUTHORED');
  if (row.tags?.some((tag) => (policy.protected?.track-a_applied_tags ?? ['visite-w1medic-2026-10-10', 'prefix-fixed-2026-10']).includes(tag))) errors.push('TRACK_A_APPLIED');
  if (row.tags?.some((tag) => /^duplicate-of(?:-active)?-\d+$/.test(tag))) errors.push('DUPLICATE_TAG');
  if (corpus.some((other) => other.tags?.some((tag) => tag === `duplicate-of-${row.id}` || tag === `duplicate-of-active-${row.id}`))) errors.push('PROTECTED_SURVIVOR');
  if (row.is_active !== false) errors.push('NOT_INACTIVE');
  return errors;
}
export function indexCorpus(corpus) {
  const hashes = new Map(), inverted = new Map(), sizes = new Map();
  for (const row of corpus) {
    for (const hash of new Set([row.content_hash, contentHash(row.question)])) {
      if (!hash) continue;
      if (!hashes.has(hash)) hashes.set(hash, new Set());
      hashes.get(hash).add(row.id);
    }
    if (row.is_active === true || row.id >= 114259 && row.id <= 114657 || /^ARCHIVE_ORIGINAL_/i.test(row.source_file ?? '')) {
      const tokens = grams(row.question); sizes.set(row.id, tokens.size);
      for (const token of tokens) {
        if (!inverted.has(token)) inverted.set(token, new Set());
        inverted.get(token).add(row.id);
      }
    }
  }
  return { hashes, inverted, sizes };
}
export function checkBatch(rows, entries, corpus, policy, index = indexCorpus(corpus)) {
  if (!Array.isArray(rows) || !rows.length || rows.length > RULES.max_batch) throw new Error('Batch must contain 1 to 50 rows');
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Repeated batch IDs');
  if (!Array.isArray(entries) || entries.length !== rows.length || new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error('One metadata entry required per row');
  if (rows.some((row) => !entries.some((e) => e.id === row.id))) throw new Error('Metadata IDs do not match rows');
  return rows.map((row) => {
    const entry = entries.find((entry) => entry.id === row.id);
    const errors = eligibility(row, policy, corpus);
    const choices = row.choices;
    if (!nonempty(row.question) || !normalize(row.question)) errors.push('EMPTY_STEM');
    if (!nonempty(row.source_file) || !nonempty(row.topic) || !['kenntnispruefung', 'kmp_innsbruck', 'pharma'].includes(row.exam_type)) errors.push('MISSING_PROVENANCE');
    if (!Array.isArray(choices) || choices.length < 4 || choices.length > 5 || choices.some((c) => !c || !nonempty(c.text) || !normalize(c.text) || typeof c.correct !== 'boolean' ||
      ('is_correct' in c && c.is_correct !== c.correct))) errors.push('OPTIONS');
    if (Array.isArray(choices) && new Set(choices.map((c) => normalize(c?.text))).size !== choices.length) errors.push('REPEATED_OPTIONS');
    if (!Array.isArray(choices) || !choices.some((c) => c?.correct === true)) errors.push('NO_CORRECT_OPTION');
    if (!nonempty(row.answer)) errors.push('EMPTY_ANSWER');
    if (!nonempty(row.explanation) || normalize(row.explanation).length < RULES.min_explanation) errors.push('SHORT_EXPLANATION');
    const hash = contentHash(row.question);
    if (row.content_hash !== hash) errors.push('HASH_MISMATCH');
    const hashClashes = [...(index.hashes.get(hash) ?? []), ...rows.filter((other) => contentHash(other.question) === hash).map((other) => other.id)]
      .filter((id) => id !== row.id);
    if (hashClashes.length) errors.push('DUPLICATE_HASH');
    const candidateGrams = grams(row.question);
    const shared = new Map();
    for (const token of candidateGrams) for (const id of index.inverted.get(token) ?? []) {
      if (id !== row.id) shared.set(id, (shared.get(id) ?? 0) + 1);
    }
    const near = [...shared].map(([id, count]) => ({ id, overlap: count / Math.min(candidateGrams.size, index.sizes.get(id)) }))
      .filter((match) => match.overlap >= RULES.overlap_limit);
    for (const other of rows) {
      if (other.id === row.id || index.sizes.has(other.id)) continue;
      const score = overlap(candidateGrams, grams(other.question));
      if (score >= RULES.overlap_limit) near.push({ id: other.id, overlap: score });
    }
    if (near.length) errors.push('NGRAM_OVERLAP');
    const reviews = entry.reviews;
    if (!Array.isArray(reviews) || reviews.length !== 2 || new Set(reviews.map((r) => r?.reviewer?.trim().toLowerCase())).size !== 2 || reviews.some((r) =>
      !nonempty(r?.reviewer) || r.verdict !== 'APPROVE' || r.explanation_consistent_with_key !== 'yes' || r.reviewed_content_sha256 !== reviewHash(row) ||
      !/^https:\/\/[^\s]+$/.test(r.source_url ?? '') || !/^[a-f0-9]{64}$/.test(r.source_sha256 ?? '') ||
      !readDateValid(r.read_on) || !nonempty(r.guideline_edition) || !nonempty(r.verdict_ref))) errors.push('TWO_MEDICAL_APPROVALS');
    const rights = entry.rights_basis;
    if (!rights || rights.status !== 'cleared' || !['original-authorship', 'permission', 'licensed', 'public-domain'].includes(rights.basis) ||
      !nonempty(rights.evidence_ref) || !nonempty(rights.recorded_by)) errors.push('RIGHTS_NOT_CLEARED');
    return { id: row.id, pass: errors.length === 0, errors: [...new Set(errors)],
      reviewed_content_sha256: reviewHash(row), content_hash: hash, hash_clashes: [...new Set(hashClashes)],
      overlap_matches: near, rules: RULES, reviews: reviews ?? [], rights_basis: rights ?? null };
  });
}
