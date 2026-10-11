/**
 * QLT-02 / CNT-33 / TR-03 image triage. Frozen tiers, version 2026-10-11.
 * guard: verbatim visual_guard.py VISUAL_REFERENCE (case insensitive).
 * strong: (abgebildet|dargestellt|gezeigt|siehe abbildung|abbildung|im bild|auf dem bild)
 * loose: (bild|abbildung|foto|photo|ekg|eeg|röntgen|roentgen|mrt|\bct\b)
 * Historical missing-media counts: guard 8 KP + 4 Innsbruck, strong 48 + 20,
 * loose approximately 600 + 112. Counts are observations, never assertions.
 * Match raw and normalized stems. Tiers are overlapping, highest tier wins.
 * Keywords nominate rows for review. They NEVER decide a medical mutation.
 */
export const TIERS = Object.freeze({
  guard: /\babgebildet\w*\b|\b(?:siehe|s\.)\s*(?:die\s+)?(?:abb\.?|abbildung|bild)\b|\b(?:folgende[snrm]?|gezeigte[snrm]?)\s+(?:EEG|EKG|Abbildung|Bild|Röntgenbild)\b|\b(?:auf|in)\s+(?:der|dem)\s+(?:Abbildung|Bild)\b/iu,
  strong: /(abgebildet|dargestellt|gezeigt|siehe abbildung|abbildung|im bild|auf dem bild)/iu,
  loose: /(bild|abbildung|foto|photo|ekg|eeg|röntgen|roentgen|mrt|\bct\b)/iu,
});

export function normalizeStem(stem) {
  const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' };
  return String(stem ?? '').replace(/<[^>]*>/gu, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
    if (!entity.startsWith('#')) return entities[entity] ?? match;
    const cp = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : match;
  }).replace(/\s+/gu, ' ').trim();
}

// Choice images and explanation images cannot replace a missing stem image.
export function hasStemMedia(row) {
  return [row.image_url, ...(Array.isArray(row.image_urls) ? row.image_urls : [])]
    .some(value => typeof value === 'string' && value.trim().length > 0);
}

export function matchingTiers(row) {
  if (row.is_active !== true || hasStemMedia(row)) return [];
  const raw = String(row.question ?? '');
  const normalized = normalizeStem(raw);
  return Object.entries(TIERS).filter(([, regex]) => regex.test(raw) || regex.test(normalized)).map(([tier]) => tier);
}

export function protectedReasons(row, freeze, allRows) {
  const reasons = [];
  for (const pick of freeze.open_picks ?? []) {
    if (pick.ids?.includes(row.id) || (pick.id_range && row.id >= pick.id_range[0] && row.id <= pick.id_range[1])) reasons.push(`open-pick:${pick.id}`);
  }
  if (freeze.protected?.ids?.includes(row.id)) reasons.push('protected-partner');
  const range = freeze.archive?.id_range;
  if ((range && row.id >= range[0] && row.id <= range[1]) || String(row.source_file ?? '').startsWith('ARCHIVE_ORIGINAL_')) reasons.push('archive');
  for (const tag of freeze.protected?.track-a_applied_tags ?? []) if (row.tags?.includes(tag)) reasons.push(`track-a-applied:${tag}`);
  if (allRows.some(other => (other.tags ?? []).some(tag => /^duplicate-of-(?:active-)?\d+$/u.test(tag) && Number(tag.match(/\d+$/u)[0]) === row.id))) reasons.push('duplicate-survivor');
  return [...new Set(reasons)];
}

export function inventory(rows, freeze) {
  return rows.flatMap(row => {
    const tiers = matchingTiers(row);
    if (tiers.length === 0) return [];
    return [{ id: row.id, exam_type: row.exam_type, topic: row.topic, tier: tiers[0], tiers,
      question: normalizeStem(row.question), answer: row.answer, choices: row.choices,
      source_file: row.source_file, anki_note_id: row.anki_note_id,
      protected_reasons: protectedReasons(row, freeze, rows), disposition: 'needs-semantic-review' }];
  });
}

export function validateDecisions(rows, decisions, freeze) {
  const candidates = inventory(rows, freeze);
  const byId = new Map(candidates.map(row => [row.id, row]));
  const seen = new Set();
  for (const decision of decisions) {
    const row = byId.get(decision.id);
    if (!row || seen.has(decision.id)) throw new Error(`Unknown or duplicate candidate ${decision.id}`);
    seen.add(decision.id);
    if (!['complete-without-image', 'deactivate', 'attach', 'needs-track-a', 'loose-follow-up'].includes(decision.disposition)) throw new Error(`Invalid disposition ${decision.id}`);
    if (!decision.reason?.trim()) throw new Error(`Missing semantic reason ${decision.id}`);
    if (['attach', 'deactivate'].includes(decision.disposition)) {
      if (row.protected_reasons.length) throw new Error(`Protected candidate ${decision.id}`);
      if (decision.self_check !== 'APPROVE' || !decision.source_evidence?.sha256 || !decision.source_evidence?.path) throw new Error(`Missing source self-check ${decision.id}`);
    }
    if (decision.disposition === 'attach' && (!decision.media?.length || decision.media.some(media => !media.sha256 || !media.object_path?.startsWith('track-b-b09/') || !media.local_path))) throw new Error(`Unverified media ${decision.id}`);
    if (row.tier !== 'loose' && decision.disposition === 'loose-follow-up') throw new Error(`Strong candidate cannot be deferred as loose ${decision.id}`);
  }
  for (const row of candidates) if (row.tier !== 'loose' && !seen.has(row.id)) throw new Error(`Unresolved strong/guard candidate ${row.id}`);
  return candidates.map(row => ({ ...row, ...(decisions.find(decision => decision.id === row.id) ?? {}) }));
}
