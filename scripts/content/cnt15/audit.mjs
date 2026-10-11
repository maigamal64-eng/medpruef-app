import { createHash } from 'node:crypto';

export const TAG = 'track-b-b10-2026-10';
export const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export const normalize = text => String(text ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const candidateStem = q => normalize(q.question).toLocaleLowerCase('de-AT').slice(0, 120);
const choiceIdentity = c => canonical(Object.fromEntries(Object.entries(c).filter(([k]) => !['position', 'letter'].includes(k))));
const choiceSet = q => Array.isArray(q.choices) ? q.choices.filter(c => c.correct === true).map(c => [normalize(c.text), c.image_url ?? null]).sort((a,b) => canonical(a).localeCompare(canonical(b))) : q.choices;
const media = q => canonical([q.image_url ?? null, q.image_urls?.length ? q.image_urls : null]);

export function protection(rows, freeze) {
  const reasons = new Map();
  const add = (id, why) => reasons.set(id, [...(reasons.get(id) ?? []), why]);
  for (const pick of freeze.open_picks) for (const id of pick.ids ?? []) add(id, `open-pick:${pick.id}`);
  for (const id of freeze.protected.ids) add(id, 'FREEZE.protected');
  const [lo, hi] = freeze.archive.id_range;
  for (const row of rows) {
    if ((row.id >= lo && row.id <= hi) || row.source_file?.startsWith('ARCHIVE_ORIGINAL_')) add(row.id, 'archive');
    for (const tag of row.tags ?? []) {
      if (freeze.protected.track-a_applied_tags.includes(tag)) add(row.id, `track-a-applied:${tag}`);
      const match = /^duplicate-of-.*?(\d+)$/.exec(tag);
      if (match) add(Number(match[1]), `referenced-by:${row.id}:${tag}`);
    }
  }
  return reasons;
}

export function activeState(rows) {
  const byExam = {};
  for (const q of rows.filter(q => q.is_active).sort((a,b) => a.id-b.id)) {
    const bank = byExam[q.exam_type] ??= { count: 0, free_slice: [] };
    bank.count++;
    if (bank.free_slice.length < 150) bank.free_slice.push(q.id);
  }
  return byExam;
}

// Only byte-equivalent option bodies are deduped. No distractor is invented,
// no correct option is removed, and labels/positions on retained options stay.
export function dedupeOptions(q) {
  if (!Array.isArray(q.choices)) return null;
  const seen = new Map();
  const duplicates = [];
  for (const [index, c] of q.choices.entries()) {
    if (!c || typeof c.text !== 'string' || typeof c.correct !== 'boolean') return null;
    const key = normalize(c.text).toLocaleLowerCase('de-AT');
    if (seen.has(key)) duplicates.push({ first: seen.get(key), index });
    else seen.set(key, index);
  }
  if (!duplicates.length) return null;
  const result = { id: q.id, duplicates, decision: 'defer', reason: null, after: null };
  const reject = reason => ({ ...result, reason });
  if (duplicates.some(d => choiceIdentity(q.choices[d.first]) !== choiceIdentity(q.choices[d.index]))) return reject('Duplicate text has different key, image or metadata; medical review required.');
  if (duplicates.some(d => q.choices[d.index].correct || q.choices[d.index].is_correct)) return reject('Removing a correct choice can alter multi-answer scoring.');
  if (/\b(?:[Aa]ntwort|[Oo]ption|[Aa]ussage)\s*[A-E1-5]\b|[„“"'][A-E][„“"']|zweite Nennung|beiden anderen|andere[nr]? Optionen|Antwortmöglichkeiten|alle.*(?:oben|genannten)/u.test(q.explanation ?? '') || /\b(?:[Oo]ption|[Aa]ntwort|[Aa]ussage)\s*[A-E1-5]\b|[Aa]lle.*(?:oben|genannten)/u.test(q.question)) return reject('Explanation/stem references option positions or counts; re-authoring needs medical review.');
  if (!q.explanation?.trim()) return reject('No explanation available to revalidate.');
  const removed = new Set(duplicates.map(d => d.index));
  const after = q.choices.filter((_,i) => !removed.has(i));
  if (after.length < 2 || !after.some(c => c.correct)) return reject('Dedupe would leave an unusable option set.');
  return { ...result, decision: 'stage', reason: 'Only identical false options removed; all correct choices and retained labels unchanged. Explanation revalidation required before apply.', after };
}

export function audit(rows, freeze, claimedIds = []) {
  if (new Set(rows.map(q => q.id)).size !== rows.length) throw new Error('Snapshot contains duplicate ids.');
  const protectedRows = protection(rows, freeze);
  const claimed = new Set(claimedIds);
  const groups = new Map();
  for (const q of rows) {
    const stem = candidateStem(q);
    if (!stem) continue;
    const key = `${q.exam_type}\0${stem}`;
    const members = groups.get(key) ?? [];
    members.push(q);
    groups.set(key, members);
  }
  const decisions = [];
  const changes = [];
  const groupBlocked = new Map();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a,b) => a.id-b.id);
    const active = members.filter(q => q.is_active);
    const blocked = members.flatMap(q => (protectedRows.get(q.id) ?? []).map(reason => ({ id: q.id, reason })));
    const conflicts = members.filter(q => claimed.has(q.id)).map(q => ({ id: q.id, reason: 'other-package-active-claim' }));
    const entry = { group: hash([members[0].exam_type, candidateStem(members[0])]).slice(0,16), exam_type: members[0].exam_type, ids: members.map(q=>q.id), active_ids: active.map(q=>q.id), survivor: null, decision: 'defer', reason: null, blocked: [...blocked,...conflicts], subgroups: [] };
    if (blocked.length || conflicts.length) {
      entry.decision = 'skip-protected'; entry.reason = 'Whole candidate group excluded because at least one member is protected or claimed.';
      for (const q of members) groupBlocked.set(q.id, entry.group);
    } else if (active.length < 2) {
      entry.decision = 'already-resolved'; entry.survivor = active[0]?.id ?? null; entry.reason = 'At most one active member; no deactivation needed.';
    } else {
      // A 120-character prefix is only a candidate, never proof of duplication.
      const equivalent = new Map();
      for (const q of active) {
        const signature = canonical([normalize(q.question), q.answer, choiceSet(q), media(q)]);
        const siblings = equivalent.get(signature) ?? []; siblings.push(q); equivalent.set(signature, siblings);
      }
      for (const siblings of equivalent.values()) {
        const survivor = siblings.find(q => q.explanation?.trim()) ?? siblings[0];
        const usable = typeof survivor.answer === 'string' && survivor.answer.trim() && survivor.explanation?.trim() && (!Array.isArray(survivor.choices) || (survivor.choices.length >= 2 && survivor.choices.some(c=>c.correct === true)));
        const staged = siblings.length > 1 && usable;
        entry.subgroups.push({ ids: siblings.map(q=>q.id), survivor: survivor.id, decision: staged ? 'stage' : 'defer', reason: staged ? 'Full stem, answer, complete correct-choice set and media identical. Distractor variants do not change the retained key. First explained active id retains a usable explanation (lowest id breaks ties); key unchanged.' : 'No equivalent usable full-content twin; prefix similarity alone is insufficient.' });
        if (staged) for (const q of siblings.filter(q => q.id !== survivor.id)) changes.push({ id:q.id, kind:'deactivate', survivor:survivor.id, group:entry.group, before:q, after:{...q,is_active:false,tags:[...(q.tags??[]),TAG,`duplicate-of-${survivor.id}`]} });
      }
      entry.survivor = entry.subgroups.length === 1 ? entry.subgroups[0].survivor : null;
      entry.decision = entry.subgroups.some(s=>s.decision==='stage') ? 'stage' : 'defer';
      entry.reason = entry.subgroups.length > 1 ? 'Prefix group contains distinct full-content items; only exact subgroups may be staged.' : entry.subgroups[0].reason;
    }
    decisions.push(entry);
  }
  const options = [];
  for (const q of rows.filter(q=>q.is_active)) {
    const proposal = dedupeOptions(q);
    if (!proposal) continue;
    if (protectedRows.has(q.id) || groupBlocked.has(q.id) || claimed.has(q.id)) { proposal.decision='skip-protected'; proposal.reason='Protected row, protected candidate group or active claim.'; proposal.after=null; }
    if (changes.some(c=>c.id===q.id || c.survivor===q.id)) { proposal.decision='defer'; proposal.reason='Stem deactivation group staged; avoid concurrent option edits.'; proposal.after=null; }
    options.push(proposal);
    if (proposal.decision==='stage') changes.push({id:q.id,kind:'options',before:q,after:{...q,choices:proposal.after,tags:[...(q.tags??[]),TAG],ai_explanation:null,ai_explanation_generated_at:null,ai_explanation_lang:null}});
  }
  const after = new Map(changes.map(c=>[c.id,c.after]));
  const beforeState=activeState(rows), projected=activeState(rows.map(q=>after.get(q.id)??q));
  const freeDiff = Object.fromEntries(Object.entries(beforeState).map(([exam,s])=>[exam,{removed:s.free_slice.filter(id=>!projected[exam]?.free_slice.includes(id)),added:projected[exam]?.free_slice.filter(id=>!s.free_slice.includes(id))??[]}]));
  return { groups:decisions, options, changes, protected:[...protectedRows].map(([id,reasons])=>({id,reasons})), active_before:beforeState, active_projected:projected, free_slice_diff:freeDiff };
}
