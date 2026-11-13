/**
 * case-run: pure helpers for one KP-DE case (spec section 4). No React, no
 * fetch, no storage I/O. Built on the KAF helpers: the hint (suggestMark) only
 * says whether typed text equals a stored wording; the learner decides every mark.
 */
import { normalizeAnswerText } from "@/lib/master-exam";
import { cleanTyped, clampRequired, suggestMark, KAF_ANSWER_MAX_CHARS, type KafSuggestion } from "@/lib/kaf-run";
import { DE_KP_STEPS, type DeKpStep } from "./index";

export { suggestMark, cleanTyped, clampRequired };
export type { KafSuggestion };

export const DE_KP_MAX_ANAMNESE_LINES = 25;
export const DE_KP_LINE_MAX_CHARS = KAF_ANSWER_MAX_CHARS;
export const DE_KP_BERICHT_MAX_CHARS = 4000;
export const DE_KP_MAX_OTHERS = 4;
/** Optional practice clock for the Bericht step (a learner toggle, off by default). Never an exam time. */
export const DE_KP_BERICHT_PRACTICE_S = 30 * 60;

export const HISTORY_DOMAINS = ["aktuelle_beschwerden", "vorerkrankungen", "medikation", "allergien", "sozial", "familie", "vegetativ", "noxen"] as const;
export type HistoryDomain = (typeof HISTORY_DOMAINS)[number];
export const BERICHT_SECTIONS = ["anamnese", "diagnose", "prognose", "behandlungsplan", "epikrise"] as const;
export type BerichtSection = (typeof BERICHT_SECTIONS)[number];

export interface ChecklistPoint { id: string; domain: HistoryDomain; point_de: string; weight: number }
export interface RubricPoint { id: string; section: BerichtSection; point_de: string; weight: number; critical: boolean }
export interface DeKpDifferentials { leading: string[][]; others: string[][] }

// ── Anamnese: keyword table per domain (fixed, no AI). Matched on normalised stems of words. ──
export const DOMAIN_KEYWORDS: Readonly<Record<HistoryDomain, readonly string[]>> = {
  aktuelle_beschwerden: ["beschwerde", "schmerz", "seit wann", "beginn", "dauer", "lokalisation", "ausstrahl", "intensit", "charakter", "auslos", "begleit", "symptom", "luftnot", "atemnot", "husten", "fieber", "uebelkeit", "erbrechen", "stuhl", "wasserlassen"],
  vorerkrankungen: ["vorerkrank", "grunderkrank", "operation", "krankenhaus", "frueher", "bekannte erkrank", "diabetes", "bluthochdruck", "herzerkrank", "vorgeschichte", "impf"],
  medikation: ["medikament", "medikation", "tablette", "einnahme", "antikoag", "blutverduenn", "dauermedikation", "insulin", "praeparat"],
  allergien: ["allerg", "unvertraeglich", "intoleranz", "kontrastmittel"],
  sozial: ["beruf", "arbeit", "lebenssituation", "wohnsituation", "familienstand", "sozial", "alleine", "verheiratet", "reise", "tropen", "pflege"],
  familie: ["familie", "eltern", "geschwister", "verwandt", "erblich", "familiaer"],
  vegetativ: ["vegetativ", "appetit", "gewicht", "schlaf", "nachtschweiss", "stuhlgang", "miktion", "gewichtsverlust", "leistungsknick", "fieber"],
  noxen: ["rauch", "alkohol", "nikotin", "drogen", "noxen", "zigarette", "genussmittel", "konsum"],
};

/** Lowercase with umlauts spelled out (ä to ae), so "Übelkeit" and "uebelkeit" meet. */
function fold(text: string): string {
  return normalizeAnswerText(text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue"));
}

/** Domains a typed line names. A line may name several. */
export function matchDomains(lines: readonly string[]): Set<HistoryDomain> {
  const out = new Set<HistoryDomain>();
  for (const raw of cleanLines(lines)) {
    const text = ` ${fold(raw)} `;
    for (const d of HISTORY_DOMAINS) {
      if (out.has(d)) continue;
      if (DOMAIN_KEYWORDS[d].some((k) => text.includes(fold(k)))) out.add(d);
    }
  }
  return out;
}

/** Trim, drop empty, cap length and count (the stored form). */
export function cleanLines(lines: readonly string[] | undefined): string[] {
  return (lines ?? [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, DE_KP_LINE_MAX_CHARS))
    .filter((s) => normalizeAnswerText(s) !== "")
    .slice(0, DE_KP_MAX_ANAMNESE_LINES);
}

/** Checklist point ids a set of matched domains reveals / auto-ticks. */
export function pointsForDomains(checklist: readonly Pick<ChecklistPoint, "id" | "domain">[], matched: ReadonlySet<HistoryDomain>): string[] {
  return checklist.filter((p) => matched.has(p.domain)).map((p) => p.id);
}

/** Patient answers for the points of the matched domains. */
export function revealAnswers(
  checklist: readonly Pick<ChecklistPoint, "id" | "domain">[],
  patientAnswers: Readonly<Record<string, string>>,
  matched: ReadonlySet<HistoryDomain>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of pointsForDomains(checklist, matched)) {
    const a = patientAnswers[id];
    if (typeof a === "string" && a.trim() !== "") out[id] = a;
  }
  return out;
}

function weightedShare<T extends { id: string; weight: number }>(points: readonly T[], marks: Readonly<Record<string, boolean | undefined>>, counts: (p: T) => boolean = () => true): number {
  let total = 0;
  let got = 0;
  for (const p of points) {
    const w = Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 0;
    total += w;
    if (marks[p.id] === true && counts(p)) got += w;
  }
  return total > 0 ? got / total : 0;
}

/** Anamnese score = ticked weight / total weight. Nothing typed means 0 (an empty answer is never right). */
export function historyScore(checklist: readonly ChecklistPoint[], lines: readonly string[] | undefined, marks: Readonly<Record<string, boolean | undefined>>): number {
  if (cleanLines(lines).length === 0) return 0;
  return weightedShare(checklist, marks);
}

/** Initial ticks after submit: every point of a matched domain. The learner may change each. */
export function autoHistoryMarks(checklist: readonly ChecklistPoint[], lines: readonly string[] | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of pointsForDomains(checklist, matchDomains(lines ?? []))) out[id] = true;
  return out;
}

export interface DifferentialAnswer { leading: string; others: string[] }
export interface DifferentialMarks { leading?: boolean; others?: Readonly<Record<string, boolean | undefined>> | readonly (boolean | undefined)[] }

export function cleanDifferentials(a: Partial<DifferentialAnswer> | undefined): DifferentialAnswer {
  const clip = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, DE_KP_LINE_MAX_CHARS) : "");
  return {
    leading: clip(a?.leading),
    others: (Array.isArray(a?.others) ? a!.others! : []).map(clip).filter((s) => normalizeAnswerText(s) !== "").slice(0, DE_KP_MAX_OTHERS),
  };
}

/** Hints per typed diagnosis: the leading one against `leading`, each other against every `others` wording group. */
export function differentialHints(answer: Partial<DifferentialAnswer>, diff: DeKpDifferentials): { leading: KafSuggestion; others: KafSuggestion[] } {
  const a = cleanDifferentials(answer);
  const pool = diff.others;
  return {
    leading: suggestMark(diff.leading, a.leading ? [a.leading] : []),
    others: a.others.map((t) => (pool.some((alts) => suggestMark([alts], [t]) === "matches") ? "matches" : "compare")),
  };
}

/** Score = (leading right x 0.5) + (others right / others required x 0.5). Empty answers are never right. */
export function differentialScore(answer: Partial<DifferentialAnswer>, marks: DifferentialMarks, diff: DeKpDifferentials): number {
  const a = cleanDifferentials(answer);
  const leading = a.leading !== "" && marks.leading === true ? 1 : 0;
  const required = Math.max(1, diff.others.length);
  let right = 0;
  a.others.forEach((_, i) => {
    const m = marks.others as Record<string, boolean | undefined> | undefined;
    if (m && m[String(i)] === true) right += 1;
  });
  return leading * 0.5 + (Math.min(right, required) / required) * 0.5;
}

export type BerichtAnswer = Partial<Record<BerichtSection, string>>;

export function cleanBericht(b: BerichtAnswer | undefined): Record<BerichtSection, string> {
  const out = {} as Record<BerichtSection, string>;
  for (const s of BERICHT_SECTIONS) {
    const v = b?.[s];
    out[s] = typeof v === "string" ? v.trim().slice(0, DE_KP_BERICHT_MAX_CHARS) : "";
  }
  return out;
}

/** A rubric point counts only when its section has text. */
function berichtCounts(bericht: Record<BerichtSection, string>) {
  return (p: RubricPoint) => normalizeAnswerText(bericht[p.section] ?? "") !== "";
}

export function berichtScore(rubric: readonly RubricPoint[], bericht: BerichtAnswer | undefined, marks: Readonly<Record<string, boolean | undefined>>): number {
  return weightedShare(rubric, marks, berichtCounts(cleanBericht(bericht)));
}

/** Critical rubric points the learner did not tick (or whose section is empty). */
export function criticalMissed(rubric: readonly RubricPoint[], bericht: BerichtAnswer | undefined, marks: Readonly<Record<string, boolean | undefined>>): RubricPoint[] {
  const counts = berichtCounts(cleanBericht(bericht));
  return rubric.filter((p) => p.critical && !(marks[p.id] === true && counts(p)));
}

export function criticalBucket(n: number): "0" | "1" | "2+" {
  return n <= 0 ? "0" : n === 1 ? "1" : "2+";
}

export interface FollowupRef { id: number; required: number }

/** Oral score: share of follow-ups the learner marked right. Unanswered is never right. */
export function followupScore(items: readonly FollowupRef[], answers: Readonly<Record<string, readonly string[] | undefined>>, marks: Readonly<Record<string, boolean | undefined>>): number {
  if (items.length === 0) return 0;
  let right = 0;
  for (const it of items) {
    const key = String(it.id);
    if (cleanTyped(answers[key] as string[] | undefined, it.required).length > 0 && marks[key] === true) right += 1;
  }
  return right / items.length;
}

export interface RunScores {
  history: number;
  differential: number;
  bericht: number;
  followup: number;
  criticalMissed: number;
}

export function scoreRun(input: {
  checklist: readonly ChecklistPoint[];
  rubric: readonly RubricPoint[];
  differentials: DeKpDifferentials;
  followups: readonly FollowupRef[];
  answers: { anamnese?: string[]; differentials?: Partial<DifferentialAnswer>; bericht?: BerichtAnswer; oral?: Record<string, string[]> };
  marks: { history?: Record<string, boolean>; differentials?: DifferentialMarks; bericht?: Record<string, boolean>; oral?: Record<string, boolean> };
}): RunScores {
  const { answers: a, marks: m } = input;
  return {
    history: historyScore(input.checklist, a.anamnese, m.history ?? {}),
    differential: differentialScore(a.differentials ?? {}, m.differentials ?? {}, input.differentials),
    bericht: berichtScore(input.rubric, a.bericht, m.bericht ?? {}),
    followup: followupScore(input.followups, a.oral ?? {}, m.oral ?? {}),
    criticalMissed: criticalMissed(input.rubric, a.bericht, m.bericht ?? {}).length,
  };
}

// ── Steps. The server advances the step; the key route reads it. ──

export function isStep(v: unknown): v is DeKpStep {
  return typeof v === "string" && (DE_KP_STEPS as readonly string[]).includes(v);
}

export function stepIndex(s: DeKpStep): number {
  return DE_KP_STEPS.indexOf(s);
}

/** A step can only move forward, one step at a time, never past "done". */
export function canAdvance(from: DeKpStep, to: DeKpStep): boolean {
  return stepIndex(to) === stepIndex(from) || stepIndex(to) === stepIndex(from) + 1;
}

/**
 * The key is released part by part, only after the learner submitted the step it
 * belongs to (the stored step is the step the learner is now on): the history
 * checklist once Anamnese is submitted, the differential wordings once the
 * differentials are, the rubric and model report once the Bericht is, and the
 * oral answers and sources once the oral part is.
 */
export type KeyPart = "history" | "differentials" | "bericht" | "oral";
export function keyPartsReleased(step: DeKpStep): KeyPart[] {
  const i = stepIndex(step);
  const out: KeyPart[] = [];
  if (i >= stepIndex("differentials")) out.push("history");
  if (i >= stepIndex("bericht")) out.push("differentials");
  if (i >= stepIndex("oral")) out.push("bericht");
  if (i >= stepIndex("done")) out.push("oral");
  return out;
}

/** Answers the learner must have typed before a step may be submitted (the oral part may be skipped). */
export function stepHasAnswers(step: DeKpStep, a: StoredAnswers): boolean {
  switch (step) {
    case "anamnese": return a.anamnese.length > 0;
    case "differentials": return a.differentials.leading !== "";
    case "bericht": return BERICHT_SECTIONS.some((s) => a.bericht[s] !== "");
    default: return true;
  }
}

// ── Stored answers (attempt route) ──

export interface StoredAnswers {
  anamnese: string[];
  differentials: DifferentialAnswer;
  bericht: Record<BerichtSection, string>;
  oral: Record<string, string[]>;
}

/** Whitelist and cap the learner's typed text before it is stored. Unknown keys are dropped. */
export function sanitizeAnswers(raw: unknown): StoredAnswers {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const oralIn = o.oral && typeof o.oral === "object" && !Array.isArray(o.oral) ? (o.oral as Record<string, unknown>) : {};
  const oral: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(oralIn).slice(0, 8)) {
    if (!/^\d{1,9}$/.test(k) || !Array.isArray(v)) continue;
    const typed = cleanTyped(v as string[], 3);
    if (typed.length > 0) oral[k] = typed;
  }
  return {
    anamnese: cleanLines(Array.isArray(o.anamnese) ? (o.anamnese as string[]) : []),
    differentials: cleanDifferentials(o.differentials as Partial<DifferentialAnswer> | undefined),
    bericht: cleanBericht(o.bericht as BerichtAnswer | undefined),
    oral,
  };
}

/** Whitelist the learner's self-marks: only booleans under known sections, ids bounded. */
export function sanitizeMarks(raw: unknown): { history: Record<string, boolean>; differentials: { leading?: boolean; others: Record<string, boolean> }; bericht: Record<string, boolean>; oral: Record<string, boolean> } {
  const bools = (v: unknown, keyRe: RegExp, max: number): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    for (const [k, b] of Object.entries(v as Record<string, unknown>).slice(0, max)) if (keyRe.test(k) && typeof b === "boolean") out[k] = b;
    return out;
  };
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = o.differentials && typeof o.differentials === "object" && !Array.isArray(o.differentials) ? (o.differentials as Record<string, unknown>) : {};
  return {
    history: bools(o.history, /^[A-Za-z0-9_-]{1,40}$/, 40),
    differentials: { ...(typeof d.leading === "boolean" ? { leading: d.leading } : {}), others: bools(d.others, /^[0-3]$/, DE_KP_MAX_OTHERS) },
    bericht: bools(o.bericht, /^[A-Za-z0-9_-]{1,40}$/, 60),
    oral: bools(o.oral, /^\d{1,9}$/, 8),
  };
}

// ── Screens of the runner (3d). One input and one marking screen per step, then the result. ──

export const DE_KP_SCREENS = ["anamnese_input", "anamnese_mark", "diff_input", "diff_mark", "bericht_input", "bericht_mark", "oral_input", "oral_mark", "result"] as const;
export type DeKpScreen = (typeof DE_KP_SCREENS)[number];

export function isScreen(v: unknown): v is DeKpScreen {
  return typeof v === "string" && (DE_KP_SCREENS as readonly string[]).includes(v);
}

/** The step the server must hold for a screen: a marking screen needs the step after its input step, so the key part is released. */
export function screenStep(screen: DeKpScreen): DeKpStep {
  switch (screen) {
    case "anamnese_input": return "anamnese";
    case "anamnese_mark": case "diff_input": return "differentials";
    case "diff_mark": case "bericht_input": return "bericht";
    case "bericht_mark": case "oral_input": return "oral";
    default: return "done";
  }
}

/** The screen after this one (the result is last). */
export function nextScreen(screen: DeKpScreen): DeKpScreen {
  const i = DE_KP_SCREENS.indexOf(screen);
  return DE_KP_SCREENS[Math.min(DE_KP_SCREENS.length - 1, i + 1)];
}

export function screenIndex(screen: DeKpScreen): number {
  return DE_KP_SCREENS.indexOf(screen);
}

/**
 * The next server step to post so the server catches up with the learner: the
 * attempt route only moves one step at a time and a new run starts at
 * "anamnese", so a replay posts every missing step in order. Null when the
 * server is already at (or past) the step the screen needs.
 */
export function nextServerStep(serverStep: DeKpStep | null, screen: DeKpScreen): DeKpStep | null {
  const target = screenStep(screen);
  if (serverStep === null) return "anamnese";
  if (stepIndex(serverStep) >= stepIndex(target)) return null;
  return DE_KP_STEPS[stepIndex(serverStep) + 1];
}

/** The final self-marks of the oral part are posted once more at "done" (same step, the server re-scores). */
export function needsFinalPost(session: Pick<DeKpSession, "screen" | "serverStep" | "finalAcked">): boolean {
  return session.screen === "result" && session.finalAcked !== true;
}

// ── Local session (own keys; never the /exam or KAF keys) ──

export interface DeKpSession {
  v: 1;
  attemptId: string;
  slug: string;
  startedAt: number;
  step: DeKpStep;
  source: "de_kp_landing" | "de_kp_hub" | null;
  answers: StoredAnswers;
  marks: ReturnType<typeof sanitizeMarks>;
  /** Practice clock for the Bericht step: null while off. */
  berichtClockStartedAt: number | null;
  savedAt: number;
  /** Runner screen the learner is on (3d). Older sessions without it start at the Anamnese input. */
  screen?: DeKpScreen;
  /** Last step the server acknowledged; null before the first post. The outbox replays from here. */
  serverStep?: DeKpStep | null;
  /** The result was saved with the final marks (set once the server acknowledged "done" after the oral marks). */
  finalAcked?: boolean;
}

export function sessionKey(userId: string): string | null {
  const id = userId.trim();
  return id ? `medpruef_dekp_session:v1:${encodeURIComponent(id)}` : null;
}

export function pendingKey(userId: string): string | null {
  const id = userId.trim();
  return id ? `medpruef_dekp_pending:v1:${encodeURIComponent(id)}` : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Parse a stored session; anything incompatible is discarded (null). */
export function parseSession(raw: string | null): DeKpSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as DeKpSession;
    if (!s || s.v !== 1 || typeof s.attemptId !== "string" || !UUID_RE.test(s.attemptId)) return null;
    if (typeof s.slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug)) return null;
    if (typeof s.startedAt !== "number" || !Number.isFinite(s.startedAt) || !isStep(s.step)) return null;
    return {
      ...s,
      source: s.source === "de_kp_landing" || s.source === "de_kp_hub" ? s.source : null,
      answers: sanitizeAnswers(s.answers),
      marks: sanitizeMarks(s.marks),
      berichtClockStartedAt: typeof s.berichtClockStartedAt === "number" ? s.berichtClockStartedAt : null,
      savedAt: typeof s.savedAt === "number" ? s.savedAt : 0,
      screen: isScreen(s.screen) ? s.screen : "anamnese_input",
      serverStep: isStep(s.serverStep) ? s.serverStep : null,
      finalAcked: s.finalAcked === true,
    };
  } catch {
    return null;
  }
}

/** Seconds left on the optional Bericht practice clock; null while the clock is off. */
export function berichtRemainingSeconds(session: Pick<DeKpSession, "berichtClockStartedAt">, now: number): number | null {
  if (session.berichtClockStartedAt == null) return null;
  return Math.max(0, DE_KP_BERICHT_PRACTICE_S - Math.floor((now - session.berichtClockStartedAt) / 1000));
}
