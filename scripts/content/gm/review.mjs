#!/usr/bin/env node
// a44: source and n-gram review of the reviewed Gerichtsmedizin set (read-only).
//
//   node scripts/content/gm/review.mjs     writes reports/master-plan-2026-10-11/gm-delivery/review.json
//
// Per row: the fetched source copy exists and matches its recorded sha256, the
// authoring anchor sentence occurs in it, the explanation names its source,
// and copying is measured with the b20 gate's own 5-token grams against the
// source text (stem, options, explanation body) plus the longest shared word
// run. Statute text may be quoted (official texts are free of copyright in
// Austria, § 7 UrhG); article sources may not be mirrored, so a long run from
// an article is a finding. Stem overlap inside the set is checked as well.
// The live bank overlap is the b20 gate's job at activation time.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grams, normalize, overlap, RULES } from '../gate/check.mjs';
import { GATE_HELD, HANDOVER, PINNED, loadRows, sha256 } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'reports/master-plan-2026-10-11/gm-delivery/review.json');
const ARTICLE_RUN_LIMIT = 12;

function longestRun(a, b) {
  const x = normalize(a).split(' ').filter(Boolean), y = normalize(b).split(' ').filter(Boolean);
  const index = new Map();
  y.forEach((w, i) => { if (!index.has(w)) index.set(w, []); index.get(w).push(i); });
  let best = 0;
  for (let i = 0; i < x.length; i++) {
    for (const j of index.get(x[i]) ?? []) {
      let k = 0;
      while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}
const body = (explanation) => explanation.replace(/\s*Quelle:[\s\S]*$/, '');
// Anchors are compared as b27 authored them: case and whitespace (incl. no-break
// spaces) folded only. The gate's normalize() strips "<...>" spans, which
// swallows text in articles that print p < 0.05.
const fold = (text) => String(text ?? '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim();

export function review() {
  const manifest = JSON.parse(readFileSync(join(HANDOVER, 'sources-manifest.json'), 'utf8'));
  if (sha256(readFileSync(join(HANDOVER, 'sources-manifest.json'), 'utf8')) !== PINNED['sources-manifest.json']) throw new Error('sources-manifest.json changed');
  const sources = new Map(manifest.map((s) => [s.id, s]));
  const items = loadRows();
  const texts = new Map();
  const rows = items.map(({ authorKey, authoring, row }) => {
    const findings = [];
    const src = sources.get(authoring?.source_id);
    if (!src) findings.push('source not in manifest');
    let text = '';
    if (src) {
      const path = join(HANDOVER, src.text_path);
      if (!existsSync(path)) findings.push('source text copy missing');
      else { text = texts.get(path) ?? readFileSync(path, 'utf8'); texts.set(path, text); }
      const raw = join(HANDOVER, src.text_path.replace(/\.txt$/, '.raw'));
      if (existsSync(raw) && sha256(readFileSync(raw)) !== src.sha256) findings.push('raw source sha256 differs from manifest');
      if (authoring.source_sha256 !== src.sha256) findings.push('row source sha256 differs from manifest');
      if (authoring.source_url !== src.url) findings.push('row source url differs from manifest');
    }
    const anchorFound = !!text && !!authoring?.source_anchor && fold(text).includes(fold(authoring.source_anchor));
    if (!anchorFound) findings.push('anchor sentence not found in the source copy');
    if (!/Quelle: .+/.test(row.explanation)) findings.push('explanation names no source');
    const kind = authoring?.kind === 'law' ? 'law' : 'article';
    const sourceGrams = grams(text);
    const stemOverlap = overlap(grams(row.question), sourceGrams);
    const optionText = row.choices.map((c) => c.text).join(' ');
    const run = Math.max(longestRun(row.question, text), longestRun(optionText, text), longestRun(body(row.explanation), text));
    if (kind === 'article' && run >= ARTICLE_RUN_LIMIT) findings.push(`article run of ${run} words`);
    return { author_key: authorKey, anki_note_id: row.anki_note_id, kind, source_id: authoring?.source_id, anchor_found: anchorFound,
      stem_source_overlap: Number(stemOverlap.toFixed(3)), longest_shared_run_words: run, findings };
  });
  const stems = items.map(({ authorKey, row }) => ({ authorKey, g: grams(row.question) }));
  const internal = [];
  for (let i = 0; i < stems.length; i++) for (let j = i + 1; j < stems.length; j++) {
    const score = overlap(stems[i].g, stems[j].g);
    if (score >= RULES.overlap_limit) internal.push({ a: stems[i].authorKey, b: stems[j].authorKey, overlap: Number(score.toFixed(3)) });
  }
  const flagged = rows.filter((r) => r.findings.length);
  // A pair is resolved when one side is held out of every activation batch.
  const unresolved = internal.filter((p) => !GATE_HELD[p.a] && !GATE_HELD[p.b]);
  return {
    note: 'Agent reference (a44). Generated by scripts/content/gm/review.mjs from the pinned b27 files; read-only. Article sources are English and the rows German, so n-grams can only show verbatim reuse; close paraphrase of an article question was checked by b27 rights-drop.json and both Medic reads.',
    gm_set_sha256: PINNED['gm-set.json'], rules: { ngram_size: RULES.ngram_size, overlap_limit: RULES.overlap_limit, article_run_limit_words: ARTICLE_RUN_LIMIT },
    summary: {
      rows: rows.length, law: rows.filter((r) => r.kind === 'law').length, article: rows.filter((r) => r.kind === 'article').length,
      anchors_found: rows.filter((r) => r.anchor_found).length, explanations_with_source: rows.filter((r) => !r.findings.includes('explanation names no source')).length,
      max_article_run_words: Math.max(0, ...rows.filter((r) => r.kind === 'article').map((r) => r.longest_shared_run_words)),
      max_stem_source_overlap_article: Math.max(0, ...rows.filter((r) => r.kind === 'article').map((r) => r.stem_source_overlap)),
      internal_stem_pairs_over_limit: internal.length, internal_pairs_unresolved: unresolved.length, held: Object.keys(GATE_HELD),
      rows_with_findings: flagged.length, pass: flagged.length === 0 && unresolved.length === 0,
    },
    internal_pairs: internal, rows,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = review();
  writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify(result.summary));
  process.exitCode = result.summary.pass ? 0 : 1;
}
