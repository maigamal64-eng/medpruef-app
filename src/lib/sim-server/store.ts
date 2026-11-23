/**
 * sim_sessions access (S2). Server only, service-role client. Every read and write names the
 * user id the caller got from the signed session; a row of another user reads as absent.
 * The stored `state` is only ever the output of `serializeSession`; it is restored through
 * `parseSession` with the case and the access decision the server holds, never trusted as is.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serializeSession, type SessionMode, type SessionStatus, type SimSessionState } from "@/lib/sim/state";

const MISSING = new Set(["42P01", "PGRST205"]);

export type Read<T> = { ok: true; data: T } | { ok: false; unavailable: boolean; error: unknown };

function fail<T>(error: unknown): Read<T> {
  const code = (error as { code?: string } | null)?.code;
  return { ok: false, unavailable: typeof code === "string" && MISSING.has(code), error };
}

export interface SimSessionRow {
  id: string;
  user_id: string;
  profile_key: string;
  case_id: string;
  mode: SessionMode;
  status: SessionStatus;
  ai_marking: boolean;
  state: unknown;
  state_version: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  abandoned_at: string | null;
}

const COLUMNS = "id, user_id, profile_key, case_id, mode, status, ai_marking, state, state_version, created_at, updated_at, finished_at, abandoned_at";
export const OPEN_STATUSES: readonly SessionStatus[] = ["ready", "running", "review"];
/** Most unfinished sessions one account may hold (storage bound; S11 owns retention). */
export const MAX_OPEN_SESSIONS = 10;

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** The columns that mirror the state, so the row can be listed and filtered without reading the JSON. */
export function columnsFromState(s: SimSessionState) {
  return {
    status: s.status,
    state: JSON.parse(serializeSession(s)) as unknown,
    updated_at: new Date(s.updatedAt).toISOString(),
    finished_at: iso(s.finishedAt),
    abandoned_at: iso(s.abandonedAt),
  };
}

export async function insertSession(sb: SupabaseClient, userId: string, state: SimSessionState, aiMarking: boolean): Promise<{ ok: true } | { ok: false; duplicate: boolean; unavailable: boolean; error: unknown }> {
  const { error } = await sb.from("sim_sessions").insert({
    id: state.sessionId,
    user_id: userId,
    profile_key: state.profileKey,
    case_id: state.caseId,
    mode: state.mode,
    ai_marking: aiMarking,
    state_version: 1,
    created_at: new Date(state.createdAt).toISOString(),
    ...columnsFromState(state),
  });
  if (!error) return { ok: true };
  const code = (error as { code?: string }).code;
  return { ok: false, duplicate: code === "23505", unavailable: typeof code === "string" && MISSING.has(code), error };
}

/** The caller's own session by id, or null. Another user's id reads as null. */
export async function readOwnSession(sb: SupabaseClient, userId: string, id: string): Promise<Read<SimSessionRow | null>> {
  const { data, error } = await sb.from("sim_sessions").select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: (data as unknown as SimSessionRow | null) ?? null };
}

/** The caller's unfinished sessions, newest first (at most MAX_OPEN_SESSIONS + 1 rows, enough to enforce the cap). */
export async function readOpenSessions(sb: SupabaseClient, userId: string): Promise<Read<SimSessionRow[]>> {
  const { data, error } = await sb
    .from("sim_sessions")
    .select(COLUMNS)
    .eq("user_id", userId)
    .in("status", [...OPEN_STATUSES])
    .order("created_at", { ascending: false })
    .range(0, MAX_OPEN_SESSIONS);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []) as unknown as SimSessionRow[] };
}

/**
 * Save the next state if the row is still at `expectedVersion` (optimistic concurrency).
 * `saved: false` means another write got there first (or the row is not the caller's).
 */
export async function saveSessionState(sb: SupabaseClient, userId: string, id: string, expectedVersion: number, next: SimSessionState): Promise<Read<{ saved: boolean; version: number }>> {
  const version = expectedVersion + 1;
  const { data, error } = await sb
    .from("sim_sessions")
    .update({ ...columnsFromState(next), state_version: version })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("state_version", expectedVersion)
    .select("id");
  if (error) return fail(error);
  return { ok: true, data: { saved: Array.isArray(data) && data.length === 1, version } };
}
