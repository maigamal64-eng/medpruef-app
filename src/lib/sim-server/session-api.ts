/**
 * Request logic of /api/sim/session (S2), with its dependencies injected so tests need no network.
 * Order: signed session (401), SIM_ENABLED (404), per-user rate limit (429), then the route's work.
 * The user id is the guard's, never the body's. Profile and case come from the registry; the body
 * only names a profile key and a case id. Event times are the server's clock (`now`), never the client's.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, type GuardSuccess } from "@/lib/auth-guard";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { SELF_MARKS } from "@/lib/sim/scoring";
import { PART_ID_RE, SLOT_RE } from "@/lib/sim/parts";
import { SESSION_MODES, UUID_RE, createSession, parseSession, reduce, serializeSession, sessionResult, type SimEvent, type SimSessionState } from "@/lib/sim/state";
import { findRegistration, type SimRegistration } from "./registry";
import type { SimCaseInput } from "@/lib/sim/case";
import { MAX_OPEN_SESSIONS, OPEN_STATUSES, abandonRow, insertSession, readOpenSessions, readOwnSession, saveSessionState, type SimSessionRow } from "./store";
import { simEnabled, type SimAccessGate } from "./gate";

export const SIM_RATE_LIMIT = 240;
export const SIM_RATE_WINDOW_MS = 60_000;
/** Largest request body read, in characters (a text slot is bounded by the profile; this bounds the rest). */
export const MAX_BODY_CHARS = 64_000;
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export interface SimApiDeps {
  /** Service-role client. */
  db: () => SupabaseClient;
  gate: SimAccessGate;
  /** Server clock, epoch ms. */
  now: () => number;
  newId: () => string;
  /** Test seam; defaults to the real guard. */
  requireUser?: (req: NextRequest) => Promise<GuardSuccess | { error: NextResponse }>;
}

/** Events a learner's client may send. `set_verdicts` and `ai_fallback` belong to the server (S5), never to the browser. */
const CLIENT_EVENTS = ["start", "save_text", "talk_turn", "examiner_ask", "submit_part", "self_mark", "confirm_part", "finish", "abandon", "resume"] as const;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => json({ error: code, code, ...extra }, status);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return null;
    const v: unknown = JSON.parse(text);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function dbFailure(r: { unavailable: boolean; error: unknown }, step: string): NextResponse {
  if (r.unavailable) return err(503, "SIM_UNAVAILABLE");
  // Never the raw PostgREST error: its details/hint can hold the failing row (the learner's typed text).
  const code = (r.error as { code?: unknown } | null)?.code;
  const safe = typeof code === "string" && /^[A-Za-z0-9_]{1,12}$/.test(code) ? code : "unknown";
  Sentry.captureException(new Error(`sim session db failure (${step})`), { tags: { route: "sim/session", step, db_code: safe } });
  return err(500, "LOOKUP_FAILED");
}

/** What the browser gets of a stored session: the restored state (never the raw column) and the version to send back. */
function view(row: SimSessionRow, state: SimSessionState, registration: SimRegistration) {
  return {
    id: row.id,
    status: state.status,
    state_version: row.state_version,
    state,
    result: state.status === "finished" ? sessionResult(registration.profile, state) : null,
  };
}

type Gate = { guard: GuardSuccess } | { error: NextResponse };

async function guardRequest(req: NextRequest, deps: SimApiDeps): Promise<Gate> {
  // Dark route: answer 404 before any session read, so a probe learns nothing and the users table is not touched.
  if (!simEnabled()) return { error: err(404, "SIM_DISABLED") };
  const g = await (deps.requireUser ?? requireUser)(req);
  if ("error" in g) return { error: g.error };
  const rl = checkRateLimit({ key: rateKey("sim", g.userId), limit: SIM_RATE_LIMIT, windowMs: SIM_RATE_WINDOW_MS });
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateLimitHeaders(rl, { limit: SIM_RATE_LIMIT }) } }) };
  return { guard: g };
}

/** Load the registry entry and the case a stored row names, then restore its state or refuse. */
async function restore(sb: SupabaseClient, row: SimSessionRow): Promise<{ ok: true; state: SimSessionState; registration: SimRegistration; caseInput: SimCaseInput } | { ok: false; response: NextResponse }> {
  const registration = findRegistration(row.profile_key);
  if (!registration) return { ok: false, response: err(404, "SESSION_NOT_FOUND") };
  const loaded = await registration.loadCase(sb, row.case_id);
  if (!loaded.ok) return { ok: false, response: dbFailure(loaded, "case") };
  if (!loaded.caseInput) return { ok: false, response: err(409, "CASE_UNAVAILABLE") };
  const state = parseSession(row.state, registration.profile, { caseInput: loaded.caseInput, aiAllowed: row.ai_marking });
  // The row's own columns must agree with the state they mirror (a hand-edited row reads as invalid).
  if (!state || state.sessionId !== row.id || state.status !== row.status || state.mode !== row.mode) return { ok: false, response: err(409, "SESSION_INVALID") };
  return { ok: true, state, registration, caseInput: loaded.caseInput };
}

/** A failed restore that is about the row itself (not a database outage): the row can never be opened as it is. */
const unrestorable = (res: NextResponse) => res.status === 404 || res.status === 409;

/**
 * The learner's open sessions that can be restored, newest first. A row whose case is gone or whose state
 * no longer parses is marked abandoned (column-only update) and left out, so it cannot block resume or the cap.
 */
async function restorableOpen(sb: SupabaseClient, userId: string, now: number): Promise<{ ok: true; rows: Array<{ row: SimSessionRow; restored: Extract<Awaited<ReturnType<typeof restore>>, { ok: true }> }> } | { ok: false; response: NextResponse }> {
  const list = await readOpenSessions(sb, userId);
  if (!list.ok) return { ok: false, response: dbFailure(list, "list") };
  const rows: Array<{ row: SimSessionRow; restored: Extract<Awaited<ReturnType<typeof restore>>, { ok: true }> }> = [];
  for (const row of list.data) {
    const restored = await restore(sb, row);
    if (restored.ok) {
      rows.push({ row, restored });
      continue;
    }
    if (!unrestorable(restored.response)) return { ok: false, response: restored.response };
    const marked = await abandonRow(sb, userId, row, now);
    if (!marked.ok) return { ok: false, response: dbFailure(marked, "abandon") };
  }
  return { ok: true, rows };
}

/** GET: the learner's latest unfinished session, or one by `?id=` that belongs to them. */
export async function handleGet(req: NextRequest, deps: SimApiDeps): Promise<NextResponse> {
  const gate = await guardRequest(req, deps);
  if ("error" in gate) return gate.error;
  const userId = gate.guard.userId;
  const sb = deps.db();
  const id = new URL(req.url).searchParams.get("id");
  let row: SimSessionRow | null;
  if (id !== null) {
    if (!UUID_RE.test(id)) return err(400, "BAD_REQUEST");
    const r = await readOwnSession(sb, userId, id.toLowerCase());
    if (!r.ok) return dbFailure(r, "read");
    row = r.data;
    if (!row) return err(404, "SESSION_NOT_FOUND");
  } else {
    const open = await restorableOpen(sb, userId, deps.now());
    if (!open.ok) return open.response;
    const first = open.rows[0];
    if (!first) return json({ session: null });
    const allowedFirst = await deps.gate({ guard: gate.guard, profile: first.restored.registration.profile, caseInput: first.restored.caseInput, mode: first.row.mode });
    if (!allowedFirst.allowed) return err(403, "SIM_ACCESS_DENIED");
    return json({ session: view(first.row, first.restored.state, first.restored.registration) });
  }
  const restored = await restore(sb, row);
  if (!restored.ok) return restored.response;
  const allowed = await deps.gate({ guard: gate.guard, profile: restored.registration.profile, caseInput: restored.caseInput, mode: row.mode });
  if (!allowed.allowed) return err(403, "SIM_ACCESS_DENIED");
  return json({ session: view(row, restored.state, restored.registration) });
}

async function create(req: NextRequest, body: Record<string, unknown>, guard: GuardSuccess, deps: SimApiDeps): Promise<NextResponse> {
  const registration = findRegistration(body.profileKey);
  if (!registration) return err(404, "PROFILE_NOT_FOUND");
  const { caseId, mode, sessionId } = body;
  if (typeof caseId !== "string" || caseId.length === 0 || caseId.length > 120) return err(400, "BAD_REQUEST");
  if (typeof mode !== "string" || !(SESSION_MODES as readonly string[]).includes(mode)) return err(400, "BAD_REQUEST");
  if (sessionId !== undefined && (typeof sessionId !== "string" || !UUID_RE.test(sessionId))) return err(400, "BAD_REQUEST");
  const partIds = body.partIds;
  if (partIds !== undefined && (!Array.isArray(partIds) || partIds.length > 12 || !partIds.every((p) => typeof p === "string"))) return err(400, "BAD_REQUEST");
  const sb = deps.db();
  const userId = guard.userId;

  const loaded = await registration.loadCase(sb, caseId);
  if (!loaded.ok) return dbFailure(loaded, "case");
  if (!loaded.caseInput) return err(404, "CASE_NOT_FOUND");
  const decision = await deps.gate({ guard, profile: registration.profile, caseInput: loaded.caseInput, mode: mode as (typeof SESSION_MODES)[number] });
  if (!decision.allowed) return err(403, "SIM_ACCESS_DENIED");

  const id = (sessionId ?? deps.newId()).toLowerCase();
  // A repeated create with the same id returns the saved session (retry safe); another user's id reads as not found.
  const existing = await readOwnSession(sb, userId, id);
  if (!existing.ok) return dbFailure(existing, "read");
  if (existing.data) {
    const d = existing.data;
    if (d.case_id !== caseId || d.profile_key !== registration.profile.key || d.mode !== mode) return err(409, "SESSION_ID_IN_USE");
    const again = await restore(sb, existing.data);
    return again.ok ? json({ session: view(existing.data, again.state, again.registration), duplicate: true }) : again.response;
  }
  const listed = await readOpenSessions(sb, userId);
  if (!listed.ok) return dbFailure(listed, "list");
  if (listed.data.length >= MAX_OPEN_SESSIONS) {
    // Rows that can no longer be restored do not count: sweep them, then count what is left.
    const open = await restorableOpen(sb, userId, deps.now());
    if (!open.ok) return open.response;
    if (open.rows.length >= MAX_OPEN_SESSIONS) return err(429, "TOO_MANY_OPEN_SESSIONS");
  }

  const made = createSession({
    sessionId: id,
    profile: registration.profile,
    caseInput: loaded.caseInput,
    mode: mode as (typeof SESSION_MODES)[number],
    partIds: partIds as string[] | undefined,
    aiMarking: decision.aiMarking,
    at: deps.now(),
  });
  if (!made.ok) return err(400, "BAD_REQUEST", { reason: made.error });
  const saved = await insertSession(sb, userId, made.state, decision.aiMarking);
  if (!saved.ok) {
    if (saved.duplicate) {
      const raced = await readOwnSession(sb, userId, id);
      if (raced.ok && raced.data) {
        const d = raced.data;
        if (d.case_id !== caseId || d.profile_key !== registration.profile.key || d.mode !== mode) return err(409, "SESSION_ID_IN_USE");
        const again = await restore(sb, raced.data);
        return again.ok ? json({ session: view(raced.data, again.state, again.registration), duplicate: true }) : again.response;
      }
      return err(404, "SESSION_NOT_FOUND");
    }
    return dbFailure(saved, "insert");
  }
  const row = await readOwnSession(sb, userId, id);
  if (!row.ok) return dbFailure(row, "reread");
  if (!row.data) return err(404, "SESSION_NOT_FOUND");
  return json({ session: view(row.data, made.state, registration), duplicate: false }, 201);
}

const isStr = (v: unknown): v is string => typeof v === "string";
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Longest text any slot of the profile accepts (a browser text field is bounded by it, never more). */
function maxTextChars(profile: SimRegistration["profile"]): number {
  return profile.parts.reduce((m, p) => Math.max(m, p.maxCharsPerSlot), 0);
}

/**
 * The browser's event, checked field by field before the reducer sees it; null = refuse (400 BAD_EVENT).
 * Only the fields each type owns are copied, so extra fields never travel; the client's own `at` is dropped
 * (the server's clock decides).
 */
function clientEvent(raw: unknown, at: number, maxText: number): SimEvent | null {
  if (!isObj(raw) || !isStr(raw.type) || !(CLIENT_EVENTS as readonly string[]).includes(raw.type)) return null;
  const keys = (allowed: string[]) => Object.keys(raw).every((k) => k === "type" || k === "at" || allowed.includes(k));
  const part = () => isStr(raw.partId) && PART_ID_RE.test(raw.partId);
  switch (raw.type) {
    case "start":
    case "finish":
    case "abandon":
    case "resume":
      return keys([]) ? ({ type: raw.type, at } as SimEvent) : null;
    case "save_text":
      return keys(["partId", "slot", "text"]) && part() && isStr(raw.slot) && SLOT_RE.test(raw.slot) && isStr(raw.text) && raw.text.length <= maxText ? { type: "save_text", at, partId: raw.partId as string, slot: raw.slot, text: raw.text } : null;
    case "talk_turn":
      return keys(["partId", "text"]) && part() && isStr(raw.text) && raw.text.length <= maxText ? { type: "talk_turn", at, partId: raw.partId as string, text: raw.text } : null;
    case "examiner_ask":
      return keys(["partId", "itemId", "bounded"]) && part() && isStr(raw.itemId) && ID_RE.test(raw.itemId) && typeof raw.bounded === "boolean" ? { type: "examiner_ask", at, partId: raw.partId as string, itemId: raw.itemId, bounded: raw.bounded } : null;
    case "submit_part":
    case "confirm_part":
      return keys(["partId"]) && part() ? ({ type: raw.type, at, partId: raw.partId as string } as SimEvent) : null;
    case "self_mark":
      return keys(["partId", "itemId", "mark"]) && part() && isStr(raw.itemId) && ID_RE.test(raw.itemId) && (raw.mark === null || (isStr(raw.mark) && (SELF_MARKS as readonly string[]).includes(raw.mark))) ? { type: "self_mark", at, partId: raw.partId as string, itemId: raw.itemId, mark: raw.mark as (typeof SELF_MARKS)[number] | null } : null;
    default:
      return null;
  }
}

async function applyEvent(body: Record<string, unknown>, guard: GuardSuccess, deps: SimApiDeps): Promise<NextResponse> {
  const { sessionId, expectedVersion } = body;
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) return err(400, "BAD_REQUEST");
  if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1) return err(400, "BAD_REQUEST");
  if (!isObj(body.event) || typeof body.event.type !== "string") return err(400, "BAD_REQUEST");
  if (!(CLIENT_EVENTS as readonly string[]).includes(body.event.type)) return err(400, "EVENT_NOT_ALLOWED");
  const sb = deps.db();
  const userId = guard.userId;

  const found = await readOwnSession(sb, userId, sessionId.toLowerCase());
  if (!found.ok) return dbFailure(found, "read");
  const row = found.data;
  if (!row) return err(404, "SESSION_NOT_FOUND");
  const restored = await restore(sb, row);
  if (!restored.ok) {
    // An open row that cannot be restored (case gone, state invalid) can still be given up, without a restore.
    if (body.event.type === "abandon" && unrestorable(restored.response) && (OPEN_STATUSES as readonly string[]).includes(row.status)) {
      if (row.state_version !== expectedVersion) return err(409, "VERSION_CONFLICT");
      const marked = await abandonRow(sb, userId, row, deps.now());
      if (!marked.ok) return dbFailure(marked, "abandon");
      if (!marked.data.saved) return err(409, "VERSION_CONFLICT");
      return json({ session: { id: row.id, status: "abandoned", state_version: row.state_version + 1, state: null, result: null } });
    }
    return restored.response;
  }
  const allowed = await deps.gate({ guard, profile: restored.registration.profile, caseInput: restored.caseInput, mode: row.mode });
  if (!allowed.allowed) return err(403, "SIM_ACCESS_DENIED");
  if (row.state_version !== expectedVersion) return err(409, "VERSION_CONFLICT", { session: view(row, restored.state, restored.registration) });

  // Server time, never earlier than the last stored change (a skewed instance clock cannot move time backwards).
  const event = clientEvent(body.event, Math.max(deps.now(), restored.state.updatedAt), maxTextChars(restored.registration.profile));
  if (!event) return err(400, "BAD_EVENT");
  const result = reduce(restored.registration.profile, restored.state, event);
  if (!result.ok) return err(422, "EVENT_REFUSED", { reason: result.error });
  // Belt: what is about to be stored must read back, or the session would be bricked for good.
  if (!parseSession(JSON.parse(serializeSession(result.state)), restored.registration.profile, { caseInput: restored.caseInput, aiAllowed: row.ai_marking })) return err(422, "EVENT_REFUSED", { reason: "bad_event" });

  const saved = await saveSessionState(sb, userId, row.id, expectedVersion, result.state);
  if (!saved.ok) return dbFailure(saved, "save");
  if (!saved.data.saved) {
    const latest = await readOwnSession(sb, userId, row.id);
    if (latest.ok && latest.data) {
      const again = await restore(sb, latest.data);
      if (again.ok) return err(409, "VERSION_CONFLICT", { session: view(latest.data, again.state, again.registration) });
    }
    return err(409, "VERSION_CONFLICT");
  }
  return json({ session: view({ ...row, state_version: saved.data.version, status: result.state.status }, result.state, restored.registration) });
}

/** POST: `{action:"create", profileKey, caseId, mode, partIds?, sessionId?}` or `{action:"event", sessionId, expectedVersion, event}`. */
export async function handlePost(req: NextRequest, deps: SimApiDeps): Promise<NextResponse> {
  const gate = await guardRequest(req, deps);
  if ("error" in gate) return gate.error;
  const body = await readBody(req);
  if (!body) return err(400, "BAD_REQUEST");
  if (body.action === "create") return create(req, body, gate.guard, deps);
  if (body.action === "event") return applyEvent(body, gate.guard, deps);
  return err(400, "BAD_REQUEST");
}
