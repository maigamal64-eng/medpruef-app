/**
 * Session state machine (PLAN.md 2.2 session model, TESTS.md a S1).
 *
 * Pure reducer: `reduce(profile, state, event)` returns the next state or a typed
 * refusal with the state unchanged. Every event carries its own time (`at`, epoch
 * ms); nothing here reads the clock. The state is plain JSON: S2 stores
 * `serializeSession(state)` and `parseSession(raw, profile)` restores it on any device.
 *
 * Lifecycle: ready -> running -> review -> finished, or abandoned from any open state.
 * - practice_part: the learner picks parts (profile order). Each part's key is
 *   released when it is submitted; the next part opens after the learner confirms
 *   the marks (as in the v1 runner).
 * - full_exam: every part in profile order; submitting a part opens the next one;
 *   no key is released until the last part is submitted ("review").
 * - review: every selected part is submitted; the learner marks and finishes.
 *   Unmarked items count as missing.
 */
import { SLOT_RE, TALK_SLOT, assertNever, isScored, type PartConfig } from "./parts";
import { findPart, type SimProfile } from "./profile";
import { AI_STATUSES, SELF_MARKS, checkVerdict, scorePart, totalScore, type ItemVerdict, type PartResult, type ScoredItem, type SelfMark } from "./scoring";
import type { SimCaseInput } from "./case";

export const SESSION_MODES = ["practice_part", "full_exam"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const SESSION_STATUSES = ["ready", "running", "review", "finished", "abandoned"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const PART_PHASES = ["pending", "active", "submitted", "marked"] as const;
export type PartPhase = (typeof PART_PHASES)[number];

/** Most text slots kept per part (bounds what S2 stores). */
export const MAX_SLOTS_PER_PART = 20;

/** What the state keeps of an item: enough to apply the quote rule and score without the case file. */
export type StateItem = ScoredItem;

export interface SimPartState {
  partId: string;
  phase: PartPhase;
  startedAt: number | null;
  submittedAt: number | null;
  markedAt: number | null;
  items: StateItem[];
  /** Learner text per slot (a report section, a follow-up, the talk transcript of learner turns). */
  answers: Record<string, string>;
  /** Learner turns in a patient talk. */
  turns: number;
  /** Examiner round: items asked, with the bounded follow-ups used per item. */
  asked: Record<string, { bounded: number }>;
  selfMarks: Record<string, SelfMark>;
  /** AI suggestions after the quote rule. */
  verdicts: Record<string, ItemVerdict>;
}

export interface SimSessionState {
  v: 1;
  sessionId: string;
  profileKey: string;
  caseId: string;
  taxonomyCode: string;
  mode: SessionMode;
  status: SessionStatus;
  /** Decided at creation by `decideAccess`; turns false for good on `ai_fallback`. */
  aiMarking: boolean;
  aiFallbackReason: AiFallbackReason | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  abandonedAt: number | null;
  updatedAt: number;
  resumeCount: number;
  /** Selected parts in profile order. */
  parts: SimPartState[];
}

export type AiFallbackReason = "kill_switch" | "spend_cap" | "error" | "timeout";

export type SimEvent =
  | { type: "start"; at: number }
  | { type: "save_text"; at: number; partId: string; slot: string; text: string }
  | { type: "talk_turn"; at: number; partId: string; text: string }
  | { type: "examiner_ask"; at: number; partId: string; itemId: string; bounded: boolean }
  | { type: "submit_part"; at: number; partId: string }
  | { type: "set_verdicts"; at: number; partId: string; verdicts: readonly ItemVerdict[] }
  | { type: "self_mark"; at: number; partId: string; itemId: string; mark: SelfMark | null }
  | { type: "confirm_part"; at: number; partId: string }
  | { type: "ai_fallback"; at: number; reason: AiFallbackReason }
  | { type: "finish"; at: number }
  | { type: "abandon"; at: number }
  | { type: "resume"; at: number };

export type SimError =
  | "bad_time"
  | "closed"
  | "not_ready"
  | "not_running"
  | "unknown_part"
  | "part_not_active"
  | "wrong_kind"
  | "bad_slot"
  | "too_long"
  | "empty_text"
  | "talk_limit"
  | "unknown_item"
  | "item_limit"
  | "already_asked"
  | "not_asked"
  | "bounded_limit"
  | "key_not_released"
  | "not_marked_part"
  | "ai_off"
  | "not_submitted"
  | "not_in_review";

export type ReduceResult = { ok: true; state: SimSessionState } | { ok: false; error: SimError; state: SimSessionState };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Creating a session ──

export interface CreateInput {
  sessionId: string;
  profile: SimProfile;
  caseInput: SimCaseInput;
  mode: SessionMode;
  /** Practice only: the parts to run (profile order). Omitted = every part. */
  partIds?: readonly string[];
  aiMarking: boolean;
  at: number;
}

export type CreateError = "bad_session_id" | "bad_time" | "profile_mismatch" | "bad_parts" | "full_exam_needs_all_parts" | "no_scored_part";

export function createSession(i: CreateInput): { ok: true; state: SimSessionState } | { ok: false; error: CreateError } {
  if (!UUID_RE.test(i.sessionId)) return { ok: false, error: "bad_session_id" };
  if (!validTime(i.at)) return { ok: false, error: "bad_time" };
  if (i.caseInput.profileKey !== i.profile.key) return { ok: false, error: "profile_mismatch" };
  const all = i.profile.parts.map((p) => p.id);
  const wanted = i.partIds ?? all;
  if (wanted.length === 0 || new Set(wanted).size !== wanted.length || wanted.some((id) => !all.includes(id))) return { ok: false, error: "bad_parts" };
  if (i.mode === "full_exam" && wanted.length !== all.length) return { ok: false, error: "full_exam_needs_all_parts" };
  const selected = i.profile.parts.filter((p) => wanted.includes(p.id));
  if (!selected.some(isScored)) return { ok: false, error: "no_scored_part" };
  const aiUsable = i.aiMarking && selected.some((p) => p.marking === "ai");
  return {
    ok: true,
    state: {
      v: 1,
      sessionId: i.sessionId.toLowerCase(),
      profileKey: i.profile.key,
      caseId: i.caseInput.caseId,
      taxonomyCode: i.caseInput.taxonomyCode,
      mode: i.mode,
      status: "ready",
      aiMarking: aiUsable,
      aiFallbackReason: null,
      createdAt: i.at,
      startedAt: null,
      finishedAt: null,
      abandonedAt: null,
      updatedAt: i.at,
      resumeCount: 0,
      parts: selected.map((p) => ({
        partId: p.id,
        phase: "pending",
        startedAt: null,
        submittedAt: null,
        markedAt: null,
        items: (i.caseInput.items[p.id] ?? []).map(({ id, slot, critical, weight }) => ({ id, slot, critical, weight })),
        answers: {},
        turns: 0,
        asked: {},
        selfMarks: {},
        verdicts: {},
      })),
    },
  };
}

// ── Queries ──

/** True when the key (checklist, rubric, model text, follow-up answers) of this part may be shown. */
export function keyReleased(state: SimSessionState, partId: string): boolean {
  const ps = state.parts.find((p) => p.partId === partId);
  if (!ps) return false;
  if (state.mode === "full_exam") return state.status === "review" || state.status === "finished";
  return ps.phase === "submitted" || ps.phase === "marked";
}

export function activePart(state: SimSessionState): SimPartState | null {
  return state.parts.find((p) => p.phase === "active") ?? null;
}

// ── Reducer ──

function validTime(at: number): boolean {
  return typeof at === "number" && Number.isFinite(at) && at >= 0;
}

const OPEN: readonly SessionStatus[] = ["ready", "running", "review"];

export function reduce(profile: SimProfile, state: SimSessionState, e: SimEvent): ReduceResult {
  const fail = (error: SimError): ReduceResult => ({ ok: false, error, state });
  if (!validTime(e.at)) return fail("bad_time");
  if (!OPEN.includes(state.status)) return fail("closed");
  const next = step(profile, state, e);
  if (!next.ok) return fail(next.error);
  return { ok: true, state: { ...next.state, updatedAt: Math.max(state.updatedAt, e.at) } };
}

type Step = { ok: true; state: SimSessionState } | { ok: false; error: SimError };

function step(profile: SimProfile, s: SimSessionState, e: SimEvent): Step {
  const ok = (state: SimSessionState): Step => ({ ok: true, state });
  const no = (error: SimError): Step => ({ ok: false, error });
  switch (e.type) {
    case "start": {
      if (s.status !== "ready") return no("not_ready");
      return ok(openPart({ ...s, status: "running", startedAt: e.at }, 0, e.at));
    }
    case "resume":
      return ok({ ...s, resumeCount: s.resumeCount + 1 });
    case "abandon":
      return ok({ ...s, status: "abandoned", abandonedAt: e.at });
    case "ai_fallback":
      return ok({ ...s, aiMarking: false, aiFallbackReason: s.aiFallbackReason ?? e.reason });
    case "finish": {
      if (s.status !== "review") return no("not_in_review");
      return ok({ ...s, status: "finished", finishedAt: e.at });
    }
    case "save_text":
    case "talk_turn":
    case "examiner_ask":
    case "submit_part": {
      if (s.status !== "running") return no("not_running");
      const found = locate(profile, s, e.partId);
      if (!found) return no("unknown_part");
      const { part, idx, ps } = found;
      if (ps.phase !== "active") return no("part_not_active");
      if (e.type === "save_text") return withPart(s, idx, saveText(part, ps, e.slot, e.text));
      if (e.type === "talk_turn") return withPart(s, idx, talkTurn(part, ps, e.text));
      if (e.type === "examiner_ask") return withPart(s, idx, examinerAsk(part, ps, e.itemId, e.bounded));
      return ok(submitPart(s, idx, e.at));
    }
    case "set_verdicts":
    case "self_mark":
    case "confirm_part": {
      const found = locate(profile, s, e.partId);
      if (!found) return no("unknown_part");
      const { part, idx, ps } = found;
      if (ps.phase !== "submitted" && ps.phase !== "marked") return no("not_submitted");
      if (!keyReleased(s, ps.partId)) return no("key_not_released");
      if (part.marking === "none" && e.type !== "confirm_part") return no("not_marked_part");
      if (e.type === "set_verdicts") {
        if (!s.aiMarking || part.marking !== "ai") return no("ai_off");
        return withPart(s, idx, setVerdicts(ps, e.verdicts));
      }
      if (e.type === "self_mark") {
        if (!ps.items.some((it) => it.id === e.itemId)) return no("unknown_item");
        const selfMarks = { ...ps.selfMarks };
        if (e.mark === null) delete selfMarks[e.itemId];
        else selfMarks[e.itemId] = e.mark;
        return withPart(s, idx, { ok: true, ps: { ...ps, selfMarks } });
      }
      return ok(confirmPart(s, idx, e.at));
    }
    default:
      return assertNever(e);
  }
}

function locate(profile: SimProfile, s: SimSessionState, partId: string): { part: PartConfig; idx: number; ps: SimPartState } | null {
  const idx = s.parts.findIndex((p) => p.partId === partId);
  const part = findPart(profile, partId);
  return idx < 0 || !part ? null : { part, idx, ps: s.parts[idx] };
}

type PartStep = { ok: true; ps: SimPartState } | { ok: false; error: SimError };

function withPart(s: SimSessionState, idx: number, r: PartStep): Step {
  if (!r.ok) return r;
  const parts = s.parts.slice();
  parts[idx] = r.ps;
  return { ok: true, state: { ...s, parts } };
}

function openPart(s: SimSessionState, idx: number, at: number): SimSessionState {
  const parts = s.parts.slice();
  parts[idx] = { ...parts[idx], phase: "active", startedAt: at };
  return { ...s, parts };
}

function allSubmitted(s: SimSessionState): boolean {
  return s.parts.every((p) => p.phase === "submitted" || p.phase === "marked");
}

function submitPart(s: SimSessionState, idx: number, at: number): SimSessionState {
  const parts = s.parts.slice();
  parts[idx] = { ...parts[idx], phase: "submitted", submittedAt: at };
  const after = { ...s, parts };
  if (allSubmitted(after)) return { ...after, status: "review" };
  // full_exam moves straight on; practice waits for the learner to confirm the marks.
  return s.mode === "full_exam" ? openPart(after, idx + 1, at) : after;
}

function confirmPart(s: SimSessionState, idx: number, at: number): SimSessionState {
  const parts = s.parts.slice();
  parts[idx] = { ...parts[idx], phase: "marked", markedAt: parts[idx].markedAt ?? at };
  const after = { ...s, parts };
  const nextIdx = idx + 1;
  if (s.mode === "practice_part" && s.status === "running" && nextIdx < parts.length && parts[nextIdx].phase === "pending") return openPart(after, nextIdx, at);
  return after;
}

function slotAllowed(part: PartConfig, slot: string): boolean {
  if (!SLOT_RE.test(slot)) return false;
  switch (part.kind) {
    case "written_report":
      return part.sections.includes(slot);
    case "patient_talk": // learner text arrives as turns
    case "findings":
      return false;
    case "short_answers":
    case "examiner_round":
    case "presentation":
      return true;
    default:
      return assertNever(part);
  }
}

function saveText(part: PartConfig, ps: SimPartState, slot: string, text: string): PartStep {
  if (!slotAllowed(part, slot)) return { ok: false, error: "bad_slot" };
  if (!(slot in ps.answers) && Object.keys(ps.answers).length >= MAX_SLOTS_PER_PART) return { ok: false, error: "bad_slot" };
  if (text.length > part.maxCharsPerSlot) return { ok: false, error: "too_long" };
  return { ok: true, ps: { ...ps, answers: { ...ps.answers, [slot]: text } } };
}

function talkTurn(part: PartConfig, ps: SimPartState, text: string): PartStep {
  if (part.kind !== "patient_talk") return { ok: false, error: "wrong_kind" };
  if (ps.turns >= part.maxTurns) return { ok: false, error: "talk_limit" };
  const line = text.replace(/\s+/g, " ").trim();
  if (line === "") return { ok: false, error: "empty_text" };
  const prev = ps.answers[TALK_SLOT] ?? "";
  const transcript = prev === "" ? line : `${prev}\n${line}`;
  if (transcript.length > part.maxCharsPerSlot) return { ok: false, error: "too_long" };
  return { ok: true, ps: { ...ps, turns: ps.turns + 1, answers: { ...ps.answers, [TALK_SLOT]: transcript } } };
}

function examinerAsk(part: PartConfig, ps: SimPartState, itemId: string, bounded: boolean): PartStep {
  if (part.kind !== "examiner_round") return { ok: false, error: "wrong_kind" };
  if (!ps.items.some((it) => it.id === itemId)) return { ok: false, error: "unknown_item" };
  const seen = ps.asked[itemId];
  if (!bounded) {
    if (seen) return { ok: false, error: "already_asked" };
    if (Object.keys(ps.asked).length >= part.maxItems) return { ok: false, error: "item_limit" };
    return { ok: true, ps: { ...ps, asked: { ...ps.asked, [itemId]: { bounded: 0 } } } };
  }
  if (!seen) return { ok: false, error: "not_asked" };
  if (seen.bounded >= part.maxBoundedPerItem) return { ok: false, error: "bounded_limit" };
  return { ok: true, ps: { ...ps, asked: { ...ps.asked, [itemId]: { bounded: seen.bounded + 1 } } } };
}

/** Stores AI suggestions after the quote rule. Verdicts for items not in the part are refused as a whole. */
function setVerdicts(ps: SimPartState, verdicts: readonly ItemVerdict[]): PartStep {
  const byId = new Map(ps.items.map((it) => [it.id, it]));
  if (verdicts.some((v) => !byId.has(v.itemId))) return { ok: false, error: "unknown_item" };
  const out = { ...ps.verdicts };
  for (const v of verdicts) {
    const it = byId.get(v.itemId);
    if (it) out[v.itemId] = checkVerdict(v, it, ps.answers[it.slot] ?? "");
  }
  return { ok: true, ps: { ...ps, verdicts: out } };
}

// ── Result (what S9 aggregates) ──

export interface SimResult {
  v: 1;
  sessionId: string;
  profileKey: string;
  caseId: string;
  taxonomyCode: string;
  mode: SessionMode;
  status: SessionStatus;
  aiMarking: boolean;
  finishedAt: number | null;
  /** 0..1 over the scored parts that ran. */
  total: number;
  parts: PartResult[];
  /** "partId:itemId" of every critical item not marked covered (empty for v1 runs, which keep a count only). */
  criticalMissed: string[];
  criticalMissedCount: number;
}

export function sessionResult(profile: SimProfile, s: SimSessionState): SimResult {
  const scored: { part: PartConfig; result: PartResult }[] = [];
  for (const ps of s.parts) {
    const part = findPart(profile, ps.partId);
    if (!part || !isScored(part)) continue;
    scored.push({
      part,
      result: scorePart({ part, items: ps.items, answers: ps.answers, selfMarks: ps.selfMarks, verdicts: ps.verdicts }),
    });
  }
  const criticalMissed = scored.flatMap((x) => x.result.criticalMissed.map((id) => `${x.part.id}:${id}`));
  return {
    v: 1,
    sessionId: s.sessionId,
    profileKey: s.profileKey,
    caseId: s.caseId,
    taxonomyCode: s.taxonomyCode,
    mode: s.mode,
    status: s.status,
    aiMarking: s.aiMarking,
    finishedAt: s.finishedAt,
    total: totalScore(scored),
    parts: scored.map((x) => x.result),
    criticalMissed,
    criticalMissedCount: criticalMissed.length,
  };
}

// ── Serialise and restore (S2 stores the string) ──

export function serializeSession(s: SimSessionState): string {
  return JSON.stringify(s);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === "number" && validTime(v);
const isTimeOrNull = (v: unknown): v is number | null => v === null || isTime(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

function parseStrings(v: unknown, part: PartConfig): Record<string, string> | null {
  if (!isObj(v)) return null;
  const out: Record<string, string> = {};
  const entries = Object.entries(v);
  if (entries.length > MAX_SLOTS_PER_PART) return null;
  for (const [k, t] of entries) {
    if (typeof t !== "string" || t.length > part.maxCharsPerSlot) return null;
    if (!(part.kind === "patient_talk" ? k === TALK_SLOT : slotAllowed(part, k))) return null;
    out[k] = t;
  }
  return out;
}

function parseVerdict(v: unknown, itemId: string): ItemVerdict | null {
  if (!isObj(v) || v.itemId !== itemId || !oneOf(AI_STATUSES, v.status)) return null;
  if (!(v.quote === null || typeof v.quote === "string") || typeof v.model !== "string" || typeof v.promptVersion !== "string") return null;
  return { itemId, status: v.status, quote: v.quote, model: v.model, promptVersion: v.promptVersion };
}

function parsePart(v: unknown, part: PartConfig): SimPartState | null {
  if (!isObj(v) || v.partId !== part.id || !oneOf(PART_PHASES, v.phase)) return null;
  if (!isTimeOrNull(v.startedAt) || !isTimeOrNull(v.submittedAt) || !isTimeOrNull(v.markedAt)) return null;
  if (!Array.isArray(v.items)) return null;
  const items: StateItem[] = [];
  for (const it of v.items) {
    if (!isObj(it) || typeof it.id !== "string" || typeof it.slot !== "string" || !SLOT_RE.test(it.slot) || typeof it.critical !== "boolean") return null;
    if (typeof it.weight !== "number" || !(it.weight > 0) || !Number.isFinite(it.weight)) return null;
    items.push({ id: it.id, slot: it.slot, critical: it.critical, weight: it.weight });
  }
  const ids = new Set(items.map((it) => it.id));
  if (ids.size !== items.length) return null;
  const answers = parseStrings(v.answers, part);
  if (!answers) return null;
  if (typeof v.turns !== "number" || !Number.isInteger(v.turns) || v.turns < 0) return null;
  if (part.kind === "patient_talk" ? v.turns > part.maxTurns : v.turns !== 0) return null;
  if (!isObj(v.asked) || !isObj(v.selfMarks) || !isObj(v.verdicts)) return null;
  const asked: Record<string, { bounded: number }> = {};
  for (const [k, a] of Object.entries(v.asked)) {
    if (part.kind !== "examiner_round" || !ids.has(k) || !isObj(a)) return null;
    if (typeof a.bounded !== "number" || !Number.isInteger(a.bounded) || a.bounded < 0 || a.bounded > part.maxBoundedPerItem) return null;
    asked[k] = { bounded: a.bounded };
  }
  if (part.kind === "examiner_round" && Object.keys(asked).length > part.maxItems) return null;
  const selfMarks: Record<string, SelfMark> = {};
  for (const [k, m] of Object.entries(v.selfMarks)) {
    if (!ids.has(k) || !oneOf(SELF_MARKS, m)) return null;
    selfMarks[k] = m;
  }
  const verdicts: Record<string, ItemVerdict> = {};
  for (const [k, raw] of Object.entries(v.verdicts)) {
    const parsed = ids.has(k) ? parseVerdict(raw, k) : null;
    if (!parsed) return null;
    verdicts[k] = parsed;
  }
  return { partId: part.id, phase: v.phase, startedAt: v.startedAt, submittedAt: v.submittedAt, markedAt: v.markedAt, items, answers, turns: v.turns, asked, selfMarks, verdicts };
}

/** Phase order rules a stored session must meet; anything else is discarded. */
function consistent(s: SimSessionState): boolean {
  const phases = s.parts.map((p) => p.phase);
  if (phases.filter((p) => p === "active").length > 1) return false;
  const done = (p: PartPhase) => p === "submitted" || p === "marked";
  // Parts are worked in order: no pending or active part before a submitted one.
  const firstOpen = phases.findIndex((p) => !done(p));
  if (firstOpen >= 0 && phases.slice(firstOpen + 1).some((p) => p !== "pending")) return false;
  if (s.mode === "full_exam" && phases.some((p) => p === "marked") && s.status === "running") return false;
  const every = phases.every(done);
  switch (s.status) {
    case "ready":
      return phases.every((p) => p === "pending") && s.startedAt === null;
    case "running": {
      if (every || s.startedAt === null) return false;
      const prev = firstOpen > 0 ? phases[firstOpen - 1] : null;
      if (s.mode === "full_exam") return phases[firstOpen] === "active";
      // practice: the open part is active after the previous one was confirmed,
      // or still pending while the learner marks the previous one.
      if (phases[firstOpen] === "active") return prev === null || prev === "marked";
      return prev === "submitted";
    }
    case "review":
    case "finished":
      return every;
    case "abandoned":
      return s.abandonedAt !== null;
    default:
      return assertNever(s.status);
  }
}

/** Restore a stored session for this profile; anything malformed or inconsistent is null. */
export function parseSession(raw: unknown, profile: SimProfile): SimSessionState | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || v.v !== 1 || typeof v.sessionId !== "string" || !UUID_RE.test(v.sessionId)) return null;
  if (v.profileKey !== profile.key || typeof v.caseId !== "string" || v.caseId === "" || typeof v.taxonomyCode !== "string") return null;
  if (!oneOf(SESSION_MODES, v.mode) || !oneOf(SESSION_STATUSES, v.status) || typeof v.aiMarking !== "boolean") return null;
  if (!(v.aiFallbackReason === null || oneOf<AiFallbackReason>(["kill_switch", "spend_cap", "error", "timeout"], v.aiFallbackReason))) return null;
  if (!isTime(v.createdAt) || !isTimeOrNull(v.startedAt) || !isTimeOrNull(v.finishedAt) || !isTimeOrNull(v.abandonedAt) || !isTime(v.updatedAt)) return null;
  if (typeof v.resumeCount !== "number" || !Number.isInteger(v.resumeCount) || v.resumeCount < 0) return null;
  if (!Array.isArray(v.parts) || v.parts.length === 0) return null;
  const order = profile.parts.map((p) => p.id);
  const parts: SimPartState[] = [];
  let last = -1;
  for (const rp of v.parts) {
    const id = isObj(rp) ? rp.partId : undefined;
    const at = typeof id === "string" ? order.indexOf(id) : -1;
    if (at <= last) return null; // unknown, repeated or out of profile order
    last = at;
    const parsed = parsePart(rp, profile.parts[at]);
    if (!parsed) return null;
    parts.push(parsed);
  }
  if (v.mode === "full_exam" && parts.length !== order.length) return null;
  const state: SimSessionState = {
    v: 1,
    sessionId: v.sessionId.toLowerCase(),
    profileKey: profile.key,
    caseId: v.caseId,
    taxonomyCode: v.taxonomyCode,
    mode: v.mode,
    status: v.status,
    aiMarking: v.aiMarking,
    aiFallbackReason: v.aiFallbackReason,
    createdAt: v.createdAt,
    startedAt: v.startedAt,
    finishedAt: v.finishedAt,
    abandonedAt: v.abandonedAt,
    updatedAt: v.updatedAt,
    resumeCount: v.resumeCount,
    parts,
  };
  return consistent(state) ? state : null;
}
