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
import { SESSION_MODES, UUID_RE, createSession, parseSession, reduce, sessionResult, type SimEvent, type SimSessionState } from "@/lib/sim/state";
import { findRegistration, type SimRegistration } from "./registry";
import type { SimCaseInput } from "@/lib/sim/case";
import { MAX_OPEN_SESSIONS, insertSession, readOpenSessions, readOwnSession, saveSessionState, type SimSessionRow } from "./store";
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
  Sentry.captureException(r.error, { tags: { route: "sim/session", step } });
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
  const g = await (deps.requireUser ?? requireUser)(req);
  if ("error" in g) return { error: g.error };
  if (!simEnabled()) return { error: err(404, "SIM_DISABLED") };
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
    const r = await readOpenSessions(sb, userId);
    if (!r.ok) return dbFailure(r, "list");
    row = r.data[0] ?? null;
    if (!row) return json({ session: null });
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
    const again = await restore(sb, existing.data);
    return again.ok ? json({ session: view(existing.data, again.state, again.registration), duplicate: true }) : again.response;
  }
  const open = await readOpenSessions(sb, userId);
  if (!open.ok) return dbFailure(open, "list");
  if (open.data.length >= MAX_OPEN_SESSIONS) return err(429, "TOO_MANY_OPEN_SESSIONS");

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

function clientEvent(raw: unknown, at: number): SimEvent | null {
  if (!isObj(raw) || typeof raw.type !== "string" || !(CLIENT_EVENTS as readonly string[]).includes(raw.type)) return null;
  // The client's own `at` (if any) is dropped: the server's clock decides.
  const { at: _ignored, ...rest } = raw;
  void _ignored;
  return { ...rest, at } as unknown as SimEvent;
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
  if (!restored.ok) return restored.response;
  const allowed = await deps.gate({ guard, profile: restored.registration.profile, caseInput: restored.caseInput, mode: row.mode });
  if (!allowed.allowed) return err(403, "SIM_ACCESS_DENIED");
  if (row.state_version !== expectedVersion) return err(409, "VERSION_CONFLICT", { session: view(row, restored.state, restored.registration) });

  // Server time, never earlier than the last stored change (a skewed instance clock cannot move time backwards).
  const event = clientEvent(body.event, Math.max(deps.now(), restored.state.updatedAt));
  if (!event) return err(400, "EVENT_NOT_ALLOWED");
  const result = reduce(restored.registration.profile, restored.state, event);
  if (!result.ok) return err(422, "EVENT_REFUSED", { reason: result.error });

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
