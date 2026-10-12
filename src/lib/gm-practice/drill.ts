/**
 * Oral drill model for Gerichtsmedizin (a44, SIM-07). Pure: no React, no
 * storage, no network.
 *
 * A session is one 10-minute run with no preparation time: the clock starts
 * with the first prompt. Each prompt is a reviewed question stem shown (and
 * optionally read aloud) without its options; the learner answers aloud,
 * reveals the model answer (the keyed option plus the reviewed explanation
 * and its source line) and scores themselves. Self-scores never reach the
 * server: they are not graded answers and must not touch XP, the free
 * allowance or the review schedule.
 */
import { GM_DRILL_SECONDS, isGmTopic } from "./index";

export type DrillScore = "known" | "partial" | "unknown";
export const DRILL_SCORES: readonly DrillScore[] = ["known", "partial", "unknown"];

export interface DrillItem {
  id: number;
  prompt: string;
  answer: string;
  explanation: string;
  source: string | null;
}

export interface DrillSession {
  v: 1;
  startedAt: number;
  durationS: number;
  items: DrillItem[];
  idx: number;
  revealed: boolean;
  scores: Record<string, DrillScore>;
  finishedAt: number | null;
  timeUp: boolean;
}

/** Splits "… Quelle: X" into the explanation body and its source line. */
export function splitSource(explanation: string): { body: string; source: string | null } {
  const at = explanation.search(/\s*Quelle:\s/);
  if (at < 0) return { body: explanation.trim(), source: null };
  return { body: explanation.slice(0, at).trim(), source: explanation.slice(at).replace(/^\s*Quelle:\s*/, "").trim() || null };
}

/**
 * Drill items from an /api/questions response (an array of rows). Only rows
 * of the subject with a non-empty stem and model answer are kept; anything
 * else (a free-allowance object, malformed rows) yields an empty list.
 */
export function toDrillItems(raw: unknown): DrillItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = Number(o.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !isGmTopic(o.topic as string)) return [];
    const prompt = typeof o.question === "string" ? o.question.trim() : "";
    const choices = Array.isArray(o.choices) ? (o.choices as { text?: unknown; correct?: unknown }[]) : [];
    const keyed = choices.filter((c) => c?.correct === true && typeof c.text === "string").map((c) => String(c.text).trim());
    const answer = keyed.length === 1 ? keyed[0] : typeof o.answer === "string" ? o.answer.trim() : "";
    if (!prompt || !answer) return [];
    seen.add(id);
    const { body, source } = splitSource(typeof o.explanation === "string" ? o.explanation : "");
    return [{ id, prompt, answer, explanation: body, source }];
  });
}

/** Fisher-Yates with an injectable random source (tests pass a seeded one). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function startSession(items: DrillItem[], now: number, random?: () => number): DrillSession {
  return { v: 1, startedAt: now, durationS: GM_DRILL_SECONDS, items: shuffle(items, random), idx: 0, revealed: false, scores: {}, finishedAt: null, timeUp: false };
}

export function reveal(s: DrillSession): DrillSession {
  return s.finishedAt ? s : { ...s, revealed: true };
}

/** Records the score for the current prompt and moves on; the last prompt ends the run. */
export function score(s: DrillSession, value: DrillScore, now: number): DrillSession {
  const item = s.items[s.idx];
  if (s.finishedAt || !s.revealed || !item) return s;
  const scores = { ...s.scores, [String(item.id)]: value };
  const idx = s.idx + 1;
  if (idx >= s.items.length) return { ...s, scores, idx: s.idx, finishedAt: now };
  return { ...s, scores, idx, revealed: false };
}

/** Ends the run (learner choice or the clock). The open prompt stays unscored. */
export function finish(s: DrillSession, now: number, timeUp = false): DrillSession {
  if (s.finishedAt) return s;
  return { ...s, finishedAt: timeUp ? Math.min(now, s.startedAt + s.durationS * 1000) : now, timeUp };
}

export interface DrillSummary {
  known: number;
  partial: number;
  unknown: number;
  scored: number;
  /** Prompts to look at again (partial first, then unknown), in run order. */
  review: DrillItem[];
}

export function summarize(s: DrillSession): DrillSummary {
  const counts = { known: 0, partial: 0, unknown: 0 };
  for (const v of Object.values(s.scores)) counts[v]++;
  const pick = (v: DrillScore) => s.items.filter((it) => s.scores[String(it.id)] === v);
  return { ...counts, scored: counts.known + counts.partial + counts.unknown, review: [...pick("unknown"), ...pick("partial")] };
}

/** A stored session is usable only when it has the current shape. */
export function parseSession(raw: string | null): DrillSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as DrillSession;
    if (s?.v !== 1 || !Array.isArray(s.items) || !s.items.length || typeof s.startedAt !== "number" || s.durationS !== GM_DRILL_SECONDS) return null;
    if (!Number.isInteger(s.idx) || s.idx < 0 || s.idx >= s.items.length || typeof s.scores !== "object" || s.scores === null) return null;
    if (s.items.some((it) => !Number.isInteger(it?.id) || typeof it.prompt !== "string" || typeof it.answer !== "string")) return null;
    return s;
  } catch {
    return null;
  }
}

export const drillStorageKey = (userId: string) => `medpruef_gm_drill_v1:${userId}`;
