// a44 Gerichtsmedizin delivery: shared loaders for the reviewed b27 set.
//
// The reviewed rows and both Content Medic reads live in the track-B report
// tree (never committed as a whole). Every script here pins their sha256, so a
// changed file fails loudly instead of being seeded. Placement follows
// decision:pick-gm-placement B: exam_type 'pharma', topic 'Gerichtsmedizin',
// tag 'field:gerichtsmedizin'. Pure Node, no dependencies.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, reviewHash } from '../gate/check.mjs';

export const TRACK_B_ROOT = process.env.A44_TRACK_B ?? './reports/track-b-2026-10-11';
export const SET_PATH = join(TRACK_B_ROOT, 'data/b27-gm-question-set/gm-set.json');
export const HANDOVER = join(TRACK_B_ROOT, 'handover/b27-gm-question-set');
export const PINNED = Object.freeze({
  'gm-set.json': '9fb55d0cf3ca7259e5cc80450619b6dc66f7057578a7575138f12ff8949839ca',
  'medic-read-1.json': 'faff44cce1987da22eaa4164a3b503903e86664df1baf94230284c9b26a6c62d',
  'medic-read-2.json': '7c7f339523ad1218ef5f30ee9617db2e02579f5112ee6730101547840efab662',
  'rights-basis.json': '509981f673ac968653a34262189de8d6e5cceb10f5664b4897f048ebacdac72f',
  'sources-manifest.json': 'ea8efb7d36803636026ce8fac808df14b2b50e282ccdc79298fbd930995890ae',
});
export const GM_TOPIC = 'Gerichtsmedizin';
export const GM_FIELD_TAG = 'field:gerichtsmedizin';
export const GM_SOURCE_FILE = 'TRACK_B_AUTHORED_GERICHTSMEDIZIN_2026_10';
export const EXPECTED_ROWS = 128;
/**
 * Rows the b20 gate would refuse for an overlap inside the set: seeded inactive
 * with the rest, never put in an activation batch. b27-078 ("Welcher Befund ist
 * typisch für einen Einschuss?") shares two of its three five-word grams with
 * b27-073 (overlap 0.667, gate limit 0.60) although it asks a different
 * question. A reworded stem needs a fresh pair of Medic reads.
 */
export const GATE_HELD = Object.freeze({ 'b27-078': 'stem 5-gram overlap 0.667 with b27-073 (gate limit 0.60); kept inactive until a reworded stem is re-reviewed' });
/** Insert columns, in order. Every other live column keeps its default. */
export const COLUMNS = ['topic', 'question', 'answer', 'explanation', 'exam_dates', 'difficulty', 'source_file', 'is_active',
  'tags', 'choices', 'distractors', 'image_urls', 'exam_type', 'anki_note_id', 'content_hash', 'content_hash_short'];

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function readPinned(name, path) {
  const text = readFileSync(path, 'utf8');
  const got = sha256(text);
  if (got !== PINNED[name]) throw new Error(`${name} sha256 ${got} does not match the pinned ${PINNED[name]}`);
  return JSON.parse(text);
}

/**
 * PostgreSQL returns jsonb object keys ordered by length, then bytewise. The
 * activation gate hashes the row it reads back, so every object we write is
 * normalised to that order first; the reviewed content does not change.
 */
export function jsonbOrder(value) {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => {
      const la = Buffer.byteLength(a), lb = Buffer.byteLength(b);
      return la - lb || Buffer.compare(Buffer.from(a), Buffer.from(b));
    });
    return Object.fromEntries(keys.map((k) => [k, jsonbOrder(value[k])]));
  }
  return value;
}

const DASH_OR_ARABIC = /[–—؀-ۿ]/;

/** The 128 reviewed rows as live column values (non-column keys stripped), validated. */
export function loadRows() {
  const raw = readPinned('gm-set.json', SET_PATH);
  if (!Array.isArray(raw) || raw.length !== EXPECTED_ROWS) throw new Error(`Expected ${EXPECTED_ROWS} rows`);
  const seen = new Set();
  return raw.map((r) => {
    const errors = [];
    const correct = (r.choices ?? []).filter((c) => c.correct === true);
    if (r.topic !== GM_TOPIC || r.exam_type !== 'pharma' || r.source_file !== GM_SOURCE_FILE) errors.push('placement');
    if (r.is_active !== false) errors.push('active');
    if (!r.tags?.includes(GM_FIELD_TAG) || !r.tags?.includes('authored-track-b')) errors.push('tags');
    if (!Array.isArray(r.choices) || r.choices.length !== 5 || correct.length !== 1 || correct[0].text !== r.answer) errors.push('choices');
    if (r.choices?.some((c) => c.is_correct !== c.correct)) errors.push('flags');
    if (!/Quelle: .+/.test(r.explanation ?? '')) errors.push('source line');
    if (r.review?.medic_read_1 !== 'APPROVE' || r.review?.medic_read_2 !== 'APPROVE') errors.push('review');
    if (contentHash(r.question) !== r.content_hash || r.content_hash_short !== r.content_hash.slice(0, 12)) errors.push('hash');
    if (!Number.isSafeInteger(r.anki_note_id) || r.anki_note_id < 202610122700001 || r.anki_note_id > 202610122799999) errors.push('anki id');
    if (seen.has(r.anki_note_id)) errors.push('repeat'); seen.add(r.anki_note_id);
    if ([r.question, r.answer, r.explanation, ...(r.choices ?? []).map((c) => c.text)].some((t) => DASH_OR_ARABIC.test(t ?? ''))) errors.push('dash');
    if (errors.length) throw new Error(`${r.author_key}: ${errors.join(', ')}`);
    const row = {};
    for (const col of COLUMNS) row[col] = col === 'choices' ? jsonbOrder(r[col]) : r[col] ?? null;
    row.distractors = r.distractors ?? []; row.image_urls = r.image_urls ?? [];
    return { authorKey: r.author_key, authoring: r.authoring, row };
  });
}

/** Both Medic reads per author key, pinned. */
export function loadReads() {
  const reads = ['medic-read-1.json', 'medic-read-2.json'].map((name) => {
    const d = readPinned(name, join(HANDOVER, name));
    return { name, reader: d.reader, readOn: String(d.read_at).slice(0, 10), byId: new Map(d.verdicts.map((v) => [v.id, v])) };
  });
  if (reads[0].reader === reads[1].reader) throw new Error('The two reads must come from distinct readers');
  return reads;
}

export function loadRights() {
  const rights = readPinned('rights-basis.json', join(HANDOVER, 'rights-basis.json'));
  if (rights.basis !== 'original-authorship') throw new Error('Unexpected rights basis');
  return rights;
}

/**
 * The b20 gate manifest entry (minus the id, which only exists after the seed)
 * for one staged row: two APPROVE reviews tied to the exact reviewed content.
 * The hash is computed over the row as the live table returns it.
 */
export function receipt(item, reads) {
  const { row } = item;
  const reviews = reads.map((read) => {
    const v = read.byId.get(item.authorKey);
    if (!v || v.verdict !== 'APPROVE' || v.explanation_consistent_with_key !== 'yes') throw new Error(`${item.authorKey}: ${read.name} is not an APPROVE`);
    return {
      reviewer: read.reader, verdict: 'APPROVE', explanation_consistent_with_key: 'yes',
      reviewed_content_sha256: reviewHash(row), source_url: v.source_url, source_sha256: v.source_sha256,
      read_on: read.readOn, guideline_edition: v.guideline, verdict_ref: `b27-gm-question-set/${read.name}#${item.authorKey}`,
    };
  });
  return {
    anki_note_id: row.anki_note_id, content_hash: row.content_hash, author_key: item.authorKey, ...(GATE_HELD[item.authorKey] ? { held: GATE_HELD[item.authorKey] } : {}), reviews,
    rights_basis: { status: 'cleared', basis: 'original-authorship', evidence_ref: `b27-gm-question-set/rights-basis.json sha256:${PINNED['rights-basis.json']}`, recorded_by: 'track-B b27 2026-10-12, verified by track-A a44' },
  };
}
