/**
 * One-row database probe (a-db-relief-1, T0d). Shared by GET /api/health/db
 * and the db-health-watch cron.
 *
 * A single primary-key lookup through PostgREST (`questions.id = 0`, an id
 * that never exists, so the answer is an empty result read from the index
 * alone) with its own short deadline. It replaces the watchdog's question
 * draw, which cost about 1,400 full requests a day. Limit, stated in the
 * release note: a one-row read stays in memory and can answer while only the
 * heavy RPCs time out (the 12 Oct partial brownouts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase";
import { isDbUnavailable } from "@/lib/db-unavailable";

export const DB_PROBE_TIMEOUT_MS = 5_000;

export interface DbProbeResult {
  ok: boolean;
  /** Round trip in ms. */
  ms: number;
  /** Failure class; never an upstream message. */
  reason?: "timeout" | "unavailable" | "error" | "config";
}

export async function probeDatabase(client?: SupabaseClient): Promise<DbProbeResult> {
  const started = Date.now();
  let sb: SupabaseClient;
  try {
    sb = client ?? getServiceClient({ timeoutMs: DB_PROBE_TIMEOUT_MS });
  } catch {
    return { ok: false, ms: 0, reason: "config" };
  }
  try {
    const { error } = await sb.from("questions").select("id").eq("id", 0).maybeSingle();
    const ms = Date.now() - started;
    if (!error) return { ok: true, ms };
    const message = typeof error.message === "string" ? error.message : "";
    return { ok: false, ms, reason: /did not answer within/i.test(message) ? "timeout" : isDbUnavailable(error) ? "unavailable" : "error" };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, reason: isDbUnavailable(err) ? "unavailable" : "error" };
  }
}

// One database read per instance every 5 seconds for the public route:
// concurrent and repeated probes share the last result.
const SHARED_MS = 5_000;
let shared: { at: number; result: Promise<DbProbeResult> } | null = null;

export function probeDatabaseShared(now: number = Date.now()): Promise<DbProbeResult> {
  if (shared && now - shared.at < SHARED_MS) return shared.result;
  const entry = { at: now, result: probeDatabase() };
  shared = entry;
  return entry.result;
}

/** Test seam. */
export function __resetDbProbeShare(): void {
  shared = null;
}

/**
 * Brownout probe (a-fo-03): one learner-path read, a random active question
 * by id with its content columns, so it reads a heap page the way a quiz
 * does (the id = 0 probe above is answered from the index alone and stayed
 * green through the 12 Oct partial brownouts). Index-backed: primary key
 * range from a random start, first active row. Ids run 54,504 to 114,657 on
 * 14 Oct; the range below is wider on purpose, and an empty answer (a start
 * past the last active id) still counts as a successful round trip.
 */
export const BROWNOUT_ID_MIN = 54_000;
export const BROWNOUT_ID_MAX = 116_000;

export async function probeLearnerRead(client?: SupabaseClient, random: () => number = Math.random): Promise<DbProbeResult> {
  const started = Date.now();
  let sb: SupabaseClient;
  try {
    sb = client ?? getServiceClient({ timeoutMs: DB_PROBE_TIMEOUT_MS });
  } catch {
    return { ok: false, ms: 0, reason: "config" };
  }
  const from = BROWNOUT_ID_MIN + Math.floor(random() * (BROWNOUT_ID_MAX - BROWNOUT_ID_MIN));
  try {
    const { error } = await sb
      .from("questions")
      .select("id,question,choices")
      .eq("is_active", true)
      .gte("id", from)
      .order("id", { ascending: true })
      .limit(1);
    const ms = Date.now() - started;
    if (!error) return { ok: true, ms };
    const message = typeof error.message === "string" ? error.message : "";
    return { ok: false, ms, reason: /did not answer within/i.test(message) ? "timeout" : isDbUnavailable(error) ? "unavailable" : "error" };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, reason: isDbUnavailable(err) ? "unavailable" : "error" };
  }
}
