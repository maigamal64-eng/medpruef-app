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
