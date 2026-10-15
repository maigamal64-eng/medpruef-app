// Question formatting + German explanation pipeline on Claude Message Batches
// (port of scripts/format-questions.mjs, a-content-batch-port J8).
//
// Same prompt and same code-enforced safety rules as the OpenAI version:
//   - the marked-correct flags are never changed,
//   - a stem edit is a proposal that is staged only when it is formatting-only
//     (normalized text identical before and after),
//   - an explanation is staged only where the live one is empty and the model did
//     not flag needs_medical_review (those rows go to held.json),
//   - option-text clean-ups are NOT a07 edits (choices is a key column: the applied
//     trigger would advance key_revision and clear the AI cache, and a07 then
//     demands the answer/distractor convention). They land in
//     held-choice-proposals.json for a separate decision.
// Output is staged files only (a07 edits.json, held.json, held-choice-proposals.json).
import { rmSync } from 'node:fs';
import path from 'node:path';
import { validateRowEdit, withStem } from '../a07/row-edit.mjs';
import { MODELS, PINNED, cleanDashes, latestResults, normalize, parseResult, readJson, same, sha, userItem, writeEditBatches, writeJson, writeJsonl } from './lib.mjs';

export const FORMAT_RUN_TAG = 'fmt-batch-2026-10';
export const OLD_FORMAT_RUN_TAG = 'fmt-2026-07-03';
export const FORMAT_MODEL = MODELS.SONNET_5_5;
export const FORMAT_MAX_TOKENS = 6000;

export const SYSTEM_PROMPT = `Du bist medizinischer Redakteur für eine österreichische Arztprüfungs-Lernplattform (Kenntnisprüfung Wien / Stichprobentest / Pharmakologie). Du bekommst eine Prüfungsfrage als JSON.

Aufgaben:
1. stem_cleaned: Bereinige AUSSCHLIESSLICH Formatierung/OCR-Artefakte im Fragentext: doppelte Leerzeichen, Leerzeichen vor Satzzeichen, mitten im Satz abgebrochene Zeilenumbrüche, fehlende Leerzeichen nach Satzzeichen. Ändere NIEMALS Wortlaut, medizinischen Inhalt, Zahlen, Einheiten, Reihenfolge. Wenn nichts zu bereinigen ist, gib den Text EXAKT unverändert zurück.
2. choices_cleaned: Falls Optionen übergeben wurden: gleiche Anzahl, gleiche Reihenfolge, nur Formatierung der Texte bereinigt (Regeln wie oben), sonst identisch. Falls keine Optionen übergeben wurden: null.
3. explanation_de: Falls needs_explanation true ist: schreibe eine präzise deutsche Erklärung (max. 170 Wörter): zuerst 1-2 Sätze, warum die als korrekt markierte(n) Antwort(en) richtig sind (mit Leitlinien- oder Pathophysiologie-Bezug, wenn eindeutig), danach je eine kurze Zeile, warum jede falsche Option nicht zutrifft. Kein Markdown außer **fett** für Schlüsselbegriffe. Keine Gedankenstriche. Sprich die Lernenden nicht an, keine Anrede, direkt zur Sache. Falls needs_explanation false ist: null.
4. needs_medical_review: true NUR wenn die als korrekt markierte Antwort medizinisch eindeutig falsch erscheint oder die Frage unbeantwortbar/widersprüchlich ist. Dann explanation_de = null und review_reason = kurze Begründung. Du änderst NIE, welche Antwort als korrekt gilt.
5. confidence: 0..1, deine Sicherheit, dass deine Ausgabe den Regeln entspricht.`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stem_cleaned', 'choices_cleaned', 'explanation_de', 'needs_medical_review', 'review_reason', 'confidence'],
  properties: {
    stem_cleaned: { type: 'string' },
    choices_cleaned: {
      anyOf: [
        { type: 'null' },
        { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } } },
      ],
    },
    explanation_de: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    needs_medical_review: { type: 'boolean' },
    review_reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    confidence: { type: 'number' },
  },
};

export function classify(q) {
  const stem = q.question || '';
  const fmt = /\s[,.;:](\s|$)/.test(stem) || /  /.test(stem) || /\n[A-F][).:]\s/.test(stem) || stem.length > 1500;
  const isOpenAnswerPharma = q.exam_type === 'pharma' && (!Array.isArray(q.choices) || !q.choices.length);
  // NULL and empty/whitespace explanations both need one.
  const needsExplanation = !q.explanation || q.explanation.trim() === '';
  return { fmt, needsExplanation, isOpenAnswerPharma, target: fmt || needsExplanation };
}

// Same row content -> same id, so a changed row is submitted again and an unchanged one never twice.
export const rowFingerprint = (q) => sha(JSON.stringify([q.question, q.choices, q.answer, q.explanation])).slice(0, 10);
export const customId = (q) => `fmt:${q.id}:${rowFingerprint(q)}`;

export function buildPayload(q, needsExplanation) {
  return {
    exam_type: q.exam_type,
    fachgebiet: q.topic,
    frage: q.question,
    optionen: Array.isArray(q.choices) && q.choices.length ? q.choices.map((c) => ({ text: c.text, korrekt: !!c.correct })) : null,
    musterantwort: q.answer || null,
    needs_explanation: needsExplanation,
  };
}

export function buildItem(q, needsExplanation, model = FORMAT_MODEL) {
  return userItem({ id: customId(q), model, effort: 'low', system: SYSTEM_PROMPT, user: JSON.stringify(buildPayload(q, needsExplanation)), maxTokens: FORMAT_MAX_TOKENS, schema: RESPONSE_SCHEMA });
}

const EXAM_ORDER = { kenntnispruefung: 0, kmp_innsbruck: 1, pharma: 2 };
export function selectTargets(rows, limit = Infinity) {
  return rows
    .map((q) => ({ q, c: classify(q) }))
    .filter((x) => x.c.target)
    .sort((a, b) => (b.c.fmt ? 1 : 0) - (a.c.fmt ? 1 : 0) || (EXAM_ORDER[a.q.exam_type] ?? 9) - (EXAM_ORDER[b.q.exam_type] ?? 9) || a.q.id - b.q.id)
    .slice(0, limit)
    .map((x) => x.q);
}

// plan: read-only SELECTs -> snapshot.json + items.jsonl. `pilot` re-asks rows the
// 2026-07-03 OpenAI run already fixed (from their stored before-image), so the answers
// can be compared like for like; a pilot state can never produce an apply file.
export async function plan({ client, out, limit, model = FORMAT_MODEL, pilot = 0, oldRows }) {
  let rows, source = 'active';
  if (pilot) {
    const old = oldRows ?? (await client.restGet(`question_format_fixes?select=question_id,before,after,applied_fields,needs_medical_review,model&run_tag=eq.${OLD_FORMAT_RUN_TAG}&order=question_id.asc&limit=1000`));
    const picked = old.filter((o) => (o.applied_fields ?? []).includes('explanation') && !o.before?.explanation).slice(0, pilot);
    const ids = picked.map((o) => o.question_id);
    const meta = ids.length ? await client.restGet(`questions?select=${PINNED.join(',')}&id=in.(${ids.join(',')})`) : [];
    const byId = new Map(meta.map((r) => [r.id, r]));
    rows = picked.filter((o) => byId.has(o.question_id)).map((o) => ({ ...byId.get(o.question_id), question: o.before.question, choices: o.before.choices, explanation: o.before.explanation }));
    source = 'pilot';
  } else {
    rows = selectTargets(await client.restAll(`questions?select=${PINNED.join(',')}&is_active=eq.true&order=id.asc`), limit);
  }
  const items = rows.map((q) => buildItem(q, classify(q).needsExplanation, model));
  writeJson(path.join(out, 'snapshot.json'), { kind: 'format', run_tag: FORMAT_RUN_TAG, source, pilot: pilot > 0, model, created_at: new Date().toISOString(), rows });
  writeJsonl(path.join(out, 'items.jsonl'), items);
  return { items: items.length };
}

// Apply the code-enforced rules to one parsed model answer. Returns the staged after-row
// (or null), a held-choice proposal and a hold reason.
export function decide(before, out, needsExplanation) {
  const after = { ...before };
  const applied = [];
  const proposals = {};
  let hold = null;
  if (typeof out.stem_cleaned === 'string' && out.stem_cleaned !== before.question) {
    if (normalize(out.stem_cleaned) === normalize(before.question)) {
      Object.assign(after, withStem(before, out.stem_cleaned)); applied.push('question');
    } else proposals.stem_change_skipped = out.stem_cleaned;
  }
  if (Array.isArray(out.choices_cleaned) && Array.isArray(before.choices) && out.choices_cleaned.length === before.choices.length) {
    let changed = false, safe = true;
    before.choices.forEach((orig, i) => {
      const nt = out.choices_cleaned[i]?.text;
      if (typeof nt === 'string' && nt !== orig.text) { if (normalize(nt) === normalize(orig.text)) changed = true; else safe = false; }
    });
    if (changed && safe) proposals.choices_formatting = out.choices_cleaned.map((c) => c.text);
    else if (!safe) proposals.choices_change_skipped = out.choices_cleaned.map((c) => c.text);
  }
  if (out.needs_medical_review) hold = { reason: 'needs_medical_review', detail: out.review_reason ?? null };
  else if (needsExplanation && typeof out.explanation_de === 'string') {
    const e = cleanDashes(out.explanation_de).trim();
    if (e.length > 40) { after.explanation = e; applied.push('explanation'); }
    else proposals.explanation_too_short = true;
  }
  return { after, applied, proposals, hold };
}

export function stage({ out }) {
  const snap = readJson(path.join(out, 'snapshot.json'));
  const results = latestResults(out);
  const edits = [], refs = {}, held = [], choiceProposals = [], rejected = [], pilotRows = [];
  let missing = 0;
  for (const before of snap.rows) {
    const id = customId(before);
    const parsed = parseResult(results.get(id));
    if (!parsed.ok) { if (parsed.reason === 'no_result') missing++; else rejected.push({ id: before.id, reason: parsed.reason }); continue; }
    const { after, applied, proposals, hold } = decide(before, parsed.value, classify(before).needsExplanation);
    const confidence = typeof parsed.value.confidence === 'number' ? parsed.value.confidence : null;
    if (snap.pilot) { pilotRows.push({ id: before.id, applied, proposals, hold, confidence, new_explanation: after.explanation ?? null, model: parsed.model }); continue; }
    if (hold) { held.push({ id: before.id, ...hold, topic: before.topic, exam_type: before.exam_type }); continue; }
    if (proposals.choices_formatting || proposals.choices_change_skipped) choiceProposals.push({ id: before.id, before_choices: before.choices.map((c) => c.text), ...proposals });
    if (!applied.length) continue;
    let edit = { before: pickPinned(before), after: pickPinned(after) };
    try { validateRowEdit(edit); } catch (e1) {
      // A stem edit on a row without an active MCQ shape cannot pass the a07 rules; keep the explanation only.
      const onlyExplanation = applied.includes('explanation') ? { before: edit.before, after: { ...edit.before, explanation: after.explanation } } : null;
      try { if (!onlyExplanation) throw e1; validateRowEdit(onlyExplanation); edit = onlyExplanation; if (applied.includes('question')) proposals.stem_edit_not_a07_compatible = after.question; }
      catch (e2) { rejected.push({ id: before.id, reason: `a07_validation: ${e2.message}` }); continue; }
    }
    edits.push(edit);
    refs[before.id] = { run: FORMAT_RUN_TAG, model: parsed.model, confidence, stop_reason: parsed.stop_reason, custom_id: id, needs_reads: edit.after.explanation !== edit.before.explanation || edit.after.question !== edit.before.question ? 2 : 0 };
  }
  if (snap.pilot) { writeJson(path.join(out, 'staged-pilot.json'), { kind: 'format', rows: pilotRows, rejected, missing }); return { pilot: true, rows: pilotRows.length, rejected: rejected.length, missing }; }
  rmSync(path.join(out, 'edits'), { recursive: true, force: true }); // a re-stage never leaves older batches behind
  const dirs = writeEditBatches(out, 'fmt-batch', edits, refs, `Formatting and German explanations from the Claude batch run ${FORMAT_RUN_TAG}; explanations need two independent Content Medic reads before apply`);
  writeJson(path.join(out, 'held.json'), held);
  writeJson(path.join(out, 'held-choice-proposals.json'), choiceProposals);
  writeJson(path.join(out, 'rejected.json'), rejected);
  return { edits: edits.length, files: dirs.length, held: held.length, choiceProposals: choiceProposals.length, rejected: rejected.length, missing };
}
export const pickPinned = (row) => Object.fromEntries(PINNED.map((k) => [k, row[k] ?? null]));

// pilot: staged pilot output vs the old OpenAI outputs (read-only).
export async function pilotReport({ out, client, oldRows }) {
  const staged = readJson(path.join(out, 'staged-pilot.json'));
  const old = oldRows ?? (await client.restGet(`question_format_fixes?select=question_id,after,needs_medical_review,model&run_tag=eq.${OLD_FORMAT_RUN_TAG}&limit=1000`));
  const oldBy = new Map(old.map((o) => [o.question_id, o]));
  const rows = staged.rows.map((n) => {
    const o = oldBy.get(n.id);
    const oldExp = o?.after?.patch?.explanation ?? null;
    return {
      id: n.id, old_model: o?.model ?? null, new_model: n.model,
      old_explanation_len: oldExp ? oldExp.length : null, new_explanation_len: n.new_explanation ? n.new_explanation.length : null,
      old_flagged: o ? !!o.needs_medical_review : null, new_flagged: !!n.hold,
      stem_formatting_agree: o ? same(!!o.after?.patch?.question, n.applied.includes('question')) : null,
      confidence: n.confidence, old_explanation: oldExp, new_explanation: n.new_explanation,
    };
  });
  const report = { kind: 'format', items: rows.length, rejected: staged.rejected.length, missing: staged.missing, flag_disagreements: rows.filter((r) => r.old_flagged !== null && r.old_flagged !== r.new_flagged).length, note: 'Content Medic reads every pilot explanation before any full run.', rows };
  return report;
}
