/**
 * An uncited "not officially confirmed" sentence is labelled with the unconfirmed fact it
 * is about (G1 fix, 16 Oct; gate un-ss27-en).
 *
 * get_dates lists the gaps its sources name as `unconfirmed` pointers ("Rezeptierkunde:
 * summer 2027 not published"). A pointer is not assertable, so citing it never shows a
 * source chip; the model says the gap in its own words, often in a block with no facts=
 * line, and the turn's only citation is then some other fact (live gate 2: the
 * registration-method rule). The gap the answer states is decided here in code: an
 * uncited block that says something is not confirmed or not published, about an exam and
 * topic for which this turn's get_dates returned exactly one pointer, becomes the
 * code-owned notice for that exam and topic (topicNotice) with the exam's official page.
 * Nothing else changes; a block that cannot be tied to one pointer stays as written.
 */

import type { MentorAnswerBlock, MentorLang } from "./contract";
import type { MentorExamKey, MentorFactTopic, ToolResult, ValidatedAnswer } from "./seam";
import { officialLinkForExam } from "./prompt/refusals";
import { isTopicNotice, topicNotice } from "./trust-copy";

export interface UnconfirmedRef {
  id: string;
  exam_key: MentorExamKey;
  topic: MentorFactTopic;
}

const EXAM_KEYS: ReadonlySet<string> = new Set(["sip4a", "sip5a", "stichprobentest", "rezeptierkunde", "gerichtsmedizin", "c1", "fsp", "general"]);

/** The unconfirmed pointers of this turn's get_dates results, deduplicated by id. */
export function unconfirmedFromDates(results: ReadonlyArray<{ name: string; result: ToolResult }>): UnconfirmedRef[] {
  const out = new Map<string, UnconfirmedRef>();
  for (const r of results) {
    if (r.name !== "get_dates" || r.result.isError) continue;
    let body: { unconfirmed?: unknown };
    try {
      body = JSON.parse(r.result.content) as { unconfirmed?: unknown };
    } catch {
      continue;
    }
    if (!Array.isArray(body.unconfirmed)) continue;
    for (const u of body.unconfirmed) {
      if (!u || typeof u !== "object") continue;
      const o = u as { fact_id?: unknown; topic?: unknown; exam_key?: unknown };
      if (typeof o.fact_id !== "string" || typeof o.topic !== "string") continue;
      const exam = typeof o.exam_key === "string" ? o.exam_key : o.fact_id.split(".")[0];
      if (!EXAM_KEYS.has(exam)) continue;
      out.set(o.fact_id, { id: o.fact_id, exam_key: exam as MentorExamKey, topic: o.topic as MentorFactTopic });
    }
  }
  return [...out.values()];
}

/** Says that something is not (officially) confirmed or not published, in the mentor languages. */
const NOT_CONFIRMED_RE: readonly RegExp[] = [
  /\bnot\s+(?:\p{L}+\s+){0,3}(?:confirmed|published)\b/iu,
  // "no <noun phrase> is/are (officially) confirmed", never "No, the date is confirmed".
  /\bno\s+(?:[\p{L}\p{N}-]+\s+){0,5}(?:is|are|was|were|has\s+been|have\s+been)\s+(?:yet\s+)?(?:officially\s+)?(?:confirmed|published|announced)\b/iu,
  /\bun(?:confirmed|published)\b/iu,
  /\bcan(?:no|')?t\s+(?:officially\s+)?confirm\b/iu,
  /nicht\s+(?:\p{L}+\s+){0,3}(?:bestätigt|veröffentlicht|bekannt\s+gegeben)/iu,
  // "kein(e) <Nomen> ist/sind/wurde(n) (noch) bestätigt", never "Keine Sorge, ... ist bestätigt" (review P2).
  /\bkeine?[nrms]?\s+(?!sorge\b)(?:[\p{L}\p{N}-]+\s+){0,5}(?:ist|sind|wurde|wurden)\s+(?:bisher\s+|noch\s+|bislang\s+)?(?:offiziell\s+)?(?:bestätigt|veröffentlicht)/iu,
  /pas\s+(?:\p{L}+\s+){0,2}(?:confirmé|publié)/iu,
  /не\s+(?:\p{L}+\s+){0,2}(?:подтвержд|опубликов|підтвердж|опубліков)/iu,
  /(?:doğrulanma|yayımlanma|yayınlanma)/iu,
];

const EXAM_NAMES: ReadonlyArray<readonly [MentorExamKey, RegExp]> = [
  ["sip4a", /\bSIP\s?4a?\b/i],
  ["sip5a", /\bSIP\s?5a?\b/i],
  ["stichprobentest", /Stichprobentest|\bSPT\b|\bSTP\b/i],
  ["rezeptierkunde", /Rezeptierkunde|Pharmakologie|pharmacology/i],
  ["gerichtsmedizin", /Gerichtsmedizin|forensic/i],
];

/** Registration or deadline wording: the gap is a registration point, otherwise a dates point. */
const REGISTRATION_RE = /anmeld|abmeld|registr|deadline|frist|einreich|регистр|реєстр|kayıt|inscription/iu;

function saysNotConfirmed(text: string): boolean {
  return NOT_CONFIRMED_RE.some((re) => re.test(text));
}

/** The one pointer this block is about, or null when it cannot be tied to exactly one. */
export function pointerForBlock(text: string, refs: readonly UnconfirmedRef[]): UnconfirmedRef | null {
  if (refs.length === 0) return null;
  // The block must name the exam: an unnamed gap sentence is never tied to a pointer (review P2).
  const named = new Set(EXAM_NAMES.filter(([, re]) => re.test(text)).map(([k]) => k));
  if (named.size === 0) return null;
  const byExam = refs.filter((r) => named.has(r.exam_key));
  const topic: MentorFactTopic = REGISTRATION_RE.test(text) ? "registration" : "dates";
  const hits = byExam.filter((r) => r.topic === topic);
  const pairs = new Set(hits.map((r) => `${r.exam_key}|${r.topic}`));
  return pairs.size === 1 ? hits[0] : null;
}

function citesExamTopic(blocks: readonly MentorAnswerBlock[], ref: UnconfirmedRef): boolean {
  return blocks.some((b) => !b.replaced && b.fact_ids.some((id) => id.startsWith(`sitting.${ref.exam_key}.`) || id.startsWith(`${ref.exam_key}.${ref.topic}.`)));
}

/**
 * Relabels uncited, unreplaced, non-explain blocks that state a gap with the notice of the
 * single matching get_dates pointer. A refusal is returned unchanged. A relabelled answer
 * counts as replaced (a notice is never charged, MUX-38 B).
 */
export function labelUncitedUnconfirmed(v: ValidatedAnswer, refs: readonly UnconfirmedRef[], lang: MentorLang): ValidatedAnswer {
  if (v.refused || refs.length === 0) return v;
  let changed = false;
  const blocks: MentorAnswerBlock[] = v.blocks.map((b) => {
    if (b.replaced || b.explain_layer || b.fact_ids.length > 0 || isTopicNotice(b.text) || !saysNotConfirmed(b.text)) return b;
    const ref = pointerForBlock(b.text, refs);
    if (!ref) return b;
    // The answer already cites a confirmed fact of that exam and topic (a sitting row, a dates or
    // registration rule): the unscoped notice would seem to cover it too (review P2), so the
    // model's own sentence stays.
    if (citesExamTopic(v.blocks, ref)) return b;
    changed = true;
    // A registration point that is not a window or deadline (deregistration) reads as a rule,
    // never as "the registration deadline".
    const topic: MentorFactTopic = ref.topic === "registration" && !/window|deadline|close|frist/i.test(ref.id) ? "documents" : ref.topic;
    return { text: topicNotice(lang, { exam_key: ref.exam_key, topic }), fact_ids: [], replaced: true, official_url: officialLinkForExam(ref.exam_key) };
  });
  if (!changed) return v;
  // One notice per exam and topic; replaced blocks follow the answered ones, as in the validator.
  const seen = new Set<string>();
  const unique = blocks.filter((b) => !b.replaced || !seen.has(b.text) && !!seen.add(b.text));
  return { ...v, blocks: [...unique.filter((b) => !b.replaced), ...unique.filter((b) => b.replaced)], replaced: true };
}
