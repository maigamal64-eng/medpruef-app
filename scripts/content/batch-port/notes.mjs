// Curated notes (Kompakt-Guides + per-question "Merke" notes) on Claude Message
// Batches (port of scripts/generate-notes.mjs, a-content-batch-port J8).
//
// Kept from the OpenAI version: clusters, prompts (grounded in our own questions
// only), note assembly caps (mirror of src/lib/notes.ts buildNoteRow), the PII
// guard, owner = MedPrüf Team system user, tag "kuratiert", visibility public.
// Changed: the output is notes-staged.jsonl only. An apply emitter
// (emit-notes.mjs) turns it into guarded SQL with verify and rollback; nothing in
// this file or in the three scripts writes to a database.
// Lektor copy rules for learner-visible wording: tag kuratiert, MedPrüf Team as
// owner, no exam-date or exam-format claims (refused at stage time, see COPY_RULES),
// no claim that the source questions are real exam questions.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { MODELS, SYSTEM_USER_ID, clamp, cleanDashes, latestResults, parseResult, readJson, readJsonl, sha, userItem, writeJson, writeJsonl } from './lib.mjs';

export const NOTES_RUN_TAG = 'notes-batch-2026-10';
export const OLD_NOTES_RUN_TAG = 'notes-2026-07-03';
export const NOTES_MODEL = MODELS.SONNET_5_5;

// The 22 clusters with >=15 active questions (SQL snapshot 2026-07-03).
export const CLUSTERS = [
  ['kenntnispruefung', 'Chirurgische Fächer'], ['kenntnispruefung', 'Innere Medizin'], ['kenntnispruefung', 'Notfall- und Intensivmedizin'],
  ['kenntnispruefung', 'Neurologie'], ['kenntnispruefung', 'Frauenheilkunde/Gynäkologie'], ['kenntnispruefung', 'Psychiatrie'],
  ['kenntnispruefung', 'Dermatologie und Venerologie'], ['kenntnispruefung', 'Kinder- und Jugendheilkunde'], ['kenntnispruefung', 'Hals-Nasen-Ohrenheilkunde'],
  ['kenntnispruefung', 'Augenheilkunde'], ['kmp_innsbruck', 'Neurologie'], ['kmp_innsbruck', 'Innere Medizin'], ['kmp_innsbruck', 'Psychiatrie'],
  ['kmp_innsbruck', 'Chirurgische Spezialfächer Und Anästhesie'], ['kmp_innsbruck', 'Augenheilkunde'], ['kmp_innsbruck', 'Allgemeine Chirurgie'],
  ['kmp_innsbruck', 'Frauenheilkunde/Gynäkologie'], ['kmp_innsbruck', 'Kinder Und Jugendheilkunde'], ['kmp_innsbruck', 'Dermatologie und Venerologie'],
  ['kmp_innsbruck', 'Hals-Nasen-Ohrenheilkunde'], ['kmp_innsbruck', 'Kinder Und Jugendpsychiatrie'], ['pharma', 'Pharmakologie'],
];
const EXAM_LABEL = { kenntnispruefung: 'Kenntnisprüfung', kmp_innsbruck: 'Stichprobentest', pharma: 'Pharmakologie' };

// ---- note assembly (mirrors src/lib/notes.ts caps) ----
const MAX_TITLE = 200, MAX_BLOCK_TEXT = 4000, MAX_BLOCKS = 60, MAX_TAGS = 25, MAX_TAG_LEN = 60, MAX_SEARCH = 16000;
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const PHONE_RE = /(?:\+|00)\d[\d\s().-]{7,}\d/;

// Lektor rules: curated wording never states exam dates or the exam format. Matches are
// refused (held with the rule name), never rewritten.
export const COPY_RULES = [
  ['exam_date', /\b(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+20\d\d\b|\b20(2[5-9]|3\d)\b|prüfungstermin|anmeldefrist|anmeldeschluss|termin der prüfung|\banmeldung\b|\bfrist\b|\d{1,2}\.\s*(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)|(prüfung|sitting|termin)[^.]{0,60}\b(frühjahr|sommer|herbst|winter|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\b|\b(frühjahr|sommer|herbst|winter|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\b[^.]{0,60}(prüfung|termin)/i],
  ['exam_format', /bestehensgrenze|bestehensquote|bestehquote|bestehen[^.]{0,40}(\d+\s*(%|prozent)|ab\s+\d+)|(\d+\s*(%|prozent))[^.]{0,40}bestehen|\b\d+\s*(minuten|min\.|stunden)\b[^.]{0,40}(prüfung|test)|(prüfung|test)[^.]{0,40}\b\d+\s*(minuten|stunden)\b|\b\d+\s*(mc-?fragen|multiple-choice-fragen|fragen)\b[^.]{0,40}(prüfung|test)|(prüfung|test)[^.]{0,40}\b\d+\s*(mc-?fragen|multiple-choice-fragen|fragen)\b|prüfung\s+umfasst|prüfungsformat|prüfungsablauf/i],
  ['real_exam_claim', /echte[nr]?\s+prüfungsfrage|original-?prüfungsfrage|aus der prüfung|prüfungsprotokoll/i],
];

export function normalizeBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw.slice(0, MAX_BLOCKS)) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'concept' && (b.front || b.back)) out.push({ type: 'concept', front: clamp(cleanDashes(b.front), MAX_BLOCK_TEXT), back: clamp(cleanDashes(b.back), MAX_BLOCK_TEXT) });
    else if (['keyfact', 'pitfall', 'mnemonic'].includes(b.type) && b.text) out.push({ type: b.type, text: clamp(cleanDashes(b.text), MAX_BLOCK_TEXT) });
  }
  return out;
}
export function normalizeTags(raw, extra = []) {
  const seen = new Set(), out = [];
  for (const t of [...(Array.isArray(raw) ? raw : []), ...extra]) {
    if (typeof t !== 'string') continue;
    const tag = clamp(cleanDashes(t).toLowerCase(), MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag); out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
// Throws 'no valid blocks', 'PII flag' or 'copy_rule:<name>'.
export function buildRow(out, { sourceType, sourceRef, examType, topic, metadata, extraTags }) {
  const blocks = normalizeBlocks(out.blocks);
  if (!blocks.length) throw new Error('no valid blocks');
  const title = clamp(cleanDashes(out.title), MAX_TITLE) || (blocks[0].type === 'concept' ? clamp(blocks[0].front, 80) : clamp(blocks[0].text, 80));
  // The owner tag is always present and listed first (Lektor: tag kuratiert).
  const tags = normalizeTags(out.tags, extraTags);
  if (!tags.includes('kuratiert')) tags.unshift('kuratiert');
  const content = { title, blocks, tags, refs: [] };
  const searchText = clamp([title, ...blocks.map((b) => (b.type === 'concept' ? `${b.front} ${b.back}` : b.text)), ...tags].join(' '), MAX_SEARCH);
  if (EMAIL_RE.test(searchText) || PHONE_RE.test(searchText)) throw new Error('PII flag');
  for (const [name, re] of COPY_RULES) if (re.test(searchText)) throw new Error(`copy_rule:${name}`);
  return { user_id: SYSTEM_USER_ID, source_type: sourceType, source_ref: sourceRef, title, content, tags, exam_type: examType, topic, metadata: { ...metadata, curated: true, run: NOTES_RUN_TAG }, search_text: searchText, visibility: 'public', is_active: true };
}

// A stable id per note key, so a re-stage or a re-run never creates a second note.
export function noteId(key) {
  const h = createHash('sha1').update(`${NOTES_RUN_TAG}:${key}`).digest('hex');
  const v = (parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v.toString(16).padStart(2, '0')}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export const NOTE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'blocks', 'tags'],
  properties: {
    title: { type: 'string' },
    blocks: { type: 'array', items: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['type', 'front', 'back'], properties: { type: { type: 'string', enum: ['concept'] }, front: { type: 'string' }, back: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'text'], properties: { type: { type: 'string', enum: ['keyfact', 'pitfall', 'mnemonic'] }, text: { type: 'string' } } },
    ] } },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

// Prompts: unchanged rules, except that "echte Prüfungsfragen" became "Übungsfragen" (copy rule:
// the questions are practice material, never claimed as real exam questions).
export const GUIDE_SYSTEM = `Du bist medizinischer Fachredakteur für eine österreichische Arztprüfungs-Lernplattform. Du erstellst einen KOMPAKT-GUIDE (Lernnotiz) für ein Fachgebiet, AUSSCHLIESSLICH destilliert aus den mitgelieferten Übungsfragen + Erklärungen. Regeln:
- NUR Fakten verwenden, die in den mitgelieferten Fragen/Antworten/Erklärungen vorkommen oder unmittelbar daraus folgen. KEINE zusätzlichen Zahlen, Dosierungen oder Leitlinien-Behauptungen erfinden.
- Keine Aussagen über Prüfungstermine, Prüfungsablauf, Dauer, Fragenanzahl oder Bestehensgrenzen.
- Struktur: 6-9 keyfact-Blöcke (die häufigsten Kernaussagen, je 1-2 Sätze), 2-3 pitfall-Blöcke (typische Fallen/Verwechslungen aus den Fragen), 3-5 concept-Blöcke (Karteikarten: front = kurze Frage-Essenz, back = Kernantwort), optional 1 mnemonic NUR wenn er sich natürlich ergibt.
- Sprache: Deutsch, präzise, lernorientiert. Keine Anrede. KEINE Gedankenstriche. Kein Markdown in den Texten außer **fett** sparsam.
- title: "Kompakt: <Fachgebiet> (<Prüfung>)". tags: 4-8 kleingeschriebene Schlagwörter.`;
export const QNOTE_SYSTEM = `Du bist medizinischer Fachredakteur für eine österreichische Arztprüfungs-Lernplattform. Du erstellst zu EINER Übungsfrage eine kompakte "Merke"-Lernnotiz, AUSSCHLIESSLICH gegründet auf der mitgelieferten Frage, den Optionen, der korrekten Antwort und der Erklärung. Regeln:
- KEINE neuen Fakten/Zahlen/Dosierungen erfinden, die nicht in der Vorlage stehen oder unmittelbar daraus folgen.
- Keine Aussagen über Prüfungstermine, Prüfungsablauf, Dauer, Fragenanzahl oder Bestehensgrenzen.
- Struktur: genau 1 concept-Block (front = die Kernfrage in max. 15 Wörtern umformuliert, back = die Kernantwort in 1-2 Sätzen), 1-2 keyfact-Blöcke (das Warum), optional 1 pitfall (die verlockendste falsche Option und warum sie falsch ist), optional 1 mnemonic NUR wenn natürlich.
- title: prägnant, max. 80 Zeichen, das Kernthema der Frage (NICHT "Frage 123").
- Sprache: Deutsch, präzise. Keine Anrede. KEINE Gedankenstriche. tags: 3-6 kleingeschriebene Schlagwörter.`;

const guideCorpus = (qs) => qs.map((q, i) => `#${i + 1} FRAGE: ${clamp(q.question, 420)}\nANTWORT: ${clamp(q.answer || '', 200)}\nERKLÄRUNG: ${clamp(q.explanation || '', 550)}`).join('\n\n');
const guideUser = (examType, topic, qs) => `Fachgebiet: ${topic}\nPrüfung: ${EXAM_LABEL[examType] || examType}\n\nÜBUNGSFRAGEN + ERKLÄRUNGEN:\n\n${guideCorpus(qs)}`;
export function qnoteUser(q) {
  const options = Array.isArray(q.choices) && q.choices.length ? q.choices.map((c) => `${c.correct ? '[RICHTIG]' : '[falsch]'} ${c.text}`).join('\n') : '(offene Frage, keine Optionen)';
  return `FRAGE: ${clamp(q.question, 800)}\n\nOPTIONEN:\n${clamp(options, 900)}\n\nMUSTERANTWORT: ${clamp(q.answer || '', 300)}\n\nERKLÄRUNG: ${clamp(q.explanation, 900)}`;
}

export const guideKey = (examType, topic) => `guide:${examType}:${topic}`;
export const qnoteKey = (id) => `q:${id}`;
const fp = (s) => sha(s).slice(0, 10);

// plan: SELECTs only. `pilot` samples existing 2026-07-03 q-notes (read-only) so the new
// output can be compared with them; a pilot state never yields an apply file.
export async function plan({ client, out, phase = 'all', top = 450, model = NOTES_MODEL, pilot = 0, oldNotes }) {
  const items = [], guides = [], qs = {};
  if (pilot) {
    const old = oldNotes ?? (await client.restGet(`notes?select=id,title,content,source_ref,exam_type,topic&metadata->>run=eq.${OLD_NOTES_RUN_TAG}&source_type=eq.ai_explanation&order=created_at.asc&limit=${pilot}`));
    const ids = old.map((n) => n.source_ref?.question_id).filter(Number.isInteger);
    const bodies = ids.length ? await client.restGet(`questions?select=id,question,choices,answer,explanation,exam_type,topic&id=in.(${ids.join(',')})&explanation=not.is.null`) : [];
    for (const q of bodies) {
      qs[q.id] = q;
      items.push(userItem({ id: `note:${qnoteKey(q.id)}:${fp(qnoteUser(q))}`, model, effort: 'low', system: QNOTE_SYSTEM, user: qnoteUser(q), maxTokens: 3000, schema: NOTE_SCHEMA }));
    }
    writeJson(path.join(out, 'snapshot.json'), { kind: 'notes', run_tag: NOTES_RUN_TAG, pilot: true, model, created_at: new Date().toISOString(), guides: [], qs, old });
    writeJsonl(path.join(out, 'items.jsonl'), items);
    return { items: items.length };
  }
  if (phase === 'guides' || phase === 'all') {
    for (const [examType, topic] of CLUSTERS) {
      const rows = await client.restGet(`questions?select=question,answer,explanation&is_active=eq.true&exam_type=eq.${encodeURIComponent(examType)}&topic=eq.${encodeURIComponent(topic)}&explanation=not.is.null&order=id.asc&limit=22`);
      if (rows.length < 8) continue;
      const user = guideUser(examType, topic, rows);
      guides.push({ exam_type: examType, topic, user_fp: fp(user) });
      items.push(userItem({ id: `note:${guideKey(examType, topic)}:${fp(user)}`, model, effort: 'low', system: GUIDE_SYSTEM, user, maxTokens: 6000, schema: NOTE_SCHEMA }));
    }
  }
  if (phase === 'qnotes' || phase === 'all') {
    const pop = await client.restGet(`question_popularity?select=question_id,n&order=n.desc&limit=${top + 200}`);
    const ids = pop.map((p) => p.question_id).slice(0, top);
    for (let i = 0; i < ids.length; i += 80) {
      const batch = ids.slice(i, i + 80);
      for (const q of await client.restGet(`questions?select=id,question,choices,answer,explanation,exam_type,topic&id=in.(${batch.join(',')})&is_active=eq.true&explanation=not.is.null`)) {
        qs[q.id] = q;
        items.push(userItem({ id: `note:${qnoteKey(q.id)}:${fp(qnoteUser(q))}`, model, effort: 'low', system: QNOTE_SYSTEM, user: qnoteUser(q), maxTokens: 3000, schema: NOTE_SCHEMA }));
      }
    }
  }
  writeJson(path.join(out, 'snapshot.json'), { kind: 'notes', run_tag: NOTES_RUN_TAG, pilot: false, model, created_at: new Date().toISOString(), guides, qs });
  writeJsonl(path.join(out, 'items.jsonl'), items);
  return { items: items.length };
}

// stage: results -> notes-staged.jsonl (+ held.json for refusals). Never a database write.
export function stage({ out }) {
  const snap = readJson(path.join(out, 'snapshot.json'));
  const results = latestResults(out);
  const staged = [], held = [];
  let missing = 0;
  for (const [id, line] of results) {
    if (!id.startsWith('note:')) continue;
    const m = /^note:((?:guide:[^:]+:.+)|(?:q:\d+)):([0-9a-f]{10})$/.exec(id);
    if (!m) continue;
    const key = m[1];
    const parsed = parseResult(line);
    if (!parsed.ok) { held.push({ key, reason: parsed.reason }); continue; }
    try {
      let spec;
      if (key.startsWith('q:')) {
        const q = snap.qs[key.slice(2)];
        if (!q) { held.push({ key, reason: 'row_not_in_snapshot' }); continue; }
        spec = { sourceType: 'ai_explanation', sourceRef: { question_id: q.id }, examType: q.exam_type, topic: q.topic, metadata: {}, extraTags: ['kuratiert'] };
      } else {
        const [, examType, ...rest] = key.split(':');
        spec = { sourceType: 'manual', sourceRef: { kind: 'topic_guide', exam_type: examType, topic: rest.join(':') }, examType, topic: rest.join(':'), metadata: { guide: true }, extraTags: ['kuratiert', 'guide'] };
      }
      const row = buildRow(parsed.value, spec);
      row.metadata = { ...row.metadata, source_model: parsed.model, batch_key: key };
      staged.push({ id: noteId(key), key, ...row });
    } catch (e) { held.push({ key, reason: e.message }); }
  }
  for (const it of readJsonl(path.join(out, 'items.jsonl'))) if (!results.has(it.custom_id)) missing++;
  if (snap.pilot) { writeJson(path.join(out, 'staged-pilot.json'), { kind: 'notes', rows: staged, held, missing }); return { pilot: true, rows: staged.length, held: held.length, missing }; }
  writeJsonl(path.join(out, 'notes-staged.jsonl'), staged);
  writeJson(path.join(out, 'held.json'), held);
  return { staged: staged.length, held: held.length, missing };
}
export function pilotReport({ out }) {
  const snap = readJson(path.join(out, 'snapshot.json'));
  const staged = readJson(path.join(out, 'staged-pilot.json'));
  const oldBy = new Map((snap.old ?? []).map((n) => [n.source_ref?.question_id, n]));
  const rows = staged.rows.map((n) => {
    const o = oldBy.get(n.source_ref.question_id);
    return { question_id: n.source_ref.question_id, old_title: o?.title ?? null, new_title: n.title, old_blocks: o?.content?.blocks?.length ?? null, new_blocks: n.content.blocks.length, model: n.metadata.source_model, old_content: o?.content ?? null, new_content: n.content };
  });
  return { kind: 'notes', items: rows.length, held: staged.held, missing: staged.missing, note: 'Content Medic reads every pilot note before any full run; Lektor checks the wording.', rows };
}
