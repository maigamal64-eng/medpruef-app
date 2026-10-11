/**
 * Mentor admin cost view: request handler without the Next/auth wrapper
 * (W3-COSTVIEW). route.ts owns requireAdmin and the rate limit; this owns the
 * outcome mapping, so it is testable with a stub client and a fixed clock.
 *
 *   200  MentorAdminSummary
 *   503  { error: "ledger_not_applied" }  mentor tables not installed yet
 *   503  { error: "row_cap_reached" }     refuses to return a short total
 *   503  { error: "db_error" }            reads or spend RPCs failed
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorConfig } from "@/lib/mentor/config";
import type { MentorAdminSummary } from "@/lib/mentor/contract";
import { loadRollupSummary, type MentorAdminTimezone } from "@/lib/mentor/admin-trends";
import { buildAdminSummary } from "./aggregate";
import { loadSummaryInputs, MentorAdminLoadError, type MentorAdminLoadErrorCode } from "./load";

export type MentorAdminResult =
  | { status: 200; body: MentorAdminSummary }
  | { status: 503; body: { error: MentorAdminLoadErrorCode }; cause?: unknown };

export async function handleMentorAdminSummary(
  client: SupabaseClient,
  config: MentorConfig,
  now: Date,
  timezone?: MentorAdminTimezone,
): Promise<MentorAdminResult> {
  try {
    if (timezone) return { status: 200, body: await loadRollupSummary(client, config, now, timezone) };
    const inputs = await loadSummaryInputs(client, config, now);
    return { status: 200, body: buildAdminSummary(inputs) };
  } catch (err) {
    if (err instanceof MentorAdminLoadError) return { status: 503, body: { error: err.code }, cause: err };
    // A thrown client (network, bad env) is a db_error too, never a 200 with zeros.
    return { status: 503, body: { error: "db_error" }, cause: err };
  }
}
