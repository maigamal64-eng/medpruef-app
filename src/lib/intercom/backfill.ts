/**
 * Contact backfill planner and runner (a-intercom-contact-sync). The CLI is
 * scripts/intercom/backfill-contacts.ts; everything with IO is injected so
 * the guards are unit-tested.
 *
 * Guards:
 *   dry run by default (no Intercom call at all, counts only);
 *   --apply needs CONFIRM=yes, MEDPRUF_INTERCOM_SYNC_ENABLED=true and the token;
 *   batch at most 50, limit at most 5000, a pause between batches;
 *   stops on the first 401/403 and after 5 failures in a row; a 429 waits
 *   10 s without counting (at most 10 waits a run);
 *   refuses to start when MEDPRUF_INTERCOM_BACKFILL_RUNNING is set (re-entry);
 *   the ledger holds uid8, outcome, status and time only, never an address.
 */
import { buildContactPayload, type SyncUserRow } from "./contact-payload";
import { shouldSkip, upsertContact, type SyncResult } from "./sync";
import { uid8, type IntercomConfig, type RequestOptions } from "./api";

export const BACKFILL_MAX_BATCH = 50;
export const BACKFILL_MAX_LIMIT = 5000;
export const BACKFILL_RUNNING_ENV = "MEDPRUF_INTERCOM_BACKFILL_RUNNING";
const MAX_CONSECUTIVE_FAILURES = 5;
/** A 429 waits this long, is not counted as a failure, and at most MAX_RATE_WAITS times per run. */
export const RATE_LIMIT_WAIT_MS = 10_000;
const MAX_RATE_WAITS = 10;

export interface BackfillRow extends SyncUserRow {
  /** Last study day (YYYY-MM-DD) or ISO time, for mp_last_active_at. */
  last_active?: string | null;
}

export interface BackfillCounts {
  total: number;
  would_sync: number;
  skipped_staff: number;
  skipped_banned: number;
  already_in_ledger: number;
  over_limit: number;
}

export function planBackfill(rows: BackfillRow[], opts: { limit: number; done?: ReadonlySet<string> }): { counts: BackfillCounts; toSync: BackfillRow[] } {
  const counts: BackfillCounts = { total: rows.length, would_sync: 0, skipped_staff: 0, skipped_banned: 0, already_in_ledger: 0, over_limit: 0 };
  const toSync: BackfillRow[] = [];
  for (const row of rows) {
    const skip = shouldSkip(row);
    if (skip === "skipped_staff") { counts.skipped_staff++; continue; }
    if (skip === "skipped_banned") { counts.skipped_banned++; continue; }
    if (opts.done?.has(uid8(row.id))) { counts.already_in_ledger++; continue; }
    if (toSync.length >= opts.limit) { counts.over_limit++; continue; }
    toSync.push(row);
    counts.would_sync++;
  }
  return { counts, toSync };
}

export interface BackfillArgs {
  apply: boolean;
  batch: number;
  limit: number;
}

export function clampArgs(raw: { apply?: boolean; batch?: number; limit?: number }): BackfillArgs {
  const int = (v: number | undefined, def: number, max: number) =>
    Number.isFinite(v) && (v as number) >= 1 ? Math.min(Math.floor(v as number), max) : def;
  return { apply: raw.apply === true, batch: int(raw.batch, 25, BACKFILL_MAX_BATCH), limit: int(raw.limit, 100, BACKFILL_MAX_LIMIT) };
}

/** Why an --apply run may not start, or null when it may. */
export function applyRefusal(env: Record<string, string | undefined>, cfg: IntercomConfig | null): string | null {
  if (env[BACKFILL_RUNNING_ENV]) return "another backfill is running in this process tree";
  if (env.CONFIRM !== "yes") return "set CONFIRM=yes to write to Intercom";
  if (!cfg) return "MEDPRUF_INTERCOM_SYNC_ENABLED=true, MEDPRUF_INTERCOM_ACCESS_TOKEN and region us are required";
  return null;
}

export interface LedgerEntry {
  uid8: string;
  outcome: SyncResult["outcome"];
  status: number;
  at: string;
}

export function lastActiveSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export interface RunDeps extends RequestOptions {
  cfg: IntercomConfig;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  writeLedger: (entry: LedgerEntry) => void;
  pauseMs?: number;
}

export interface RunSummary {
  attempted: number;
  outcomes: Record<string, number>;
  stopped: null | "auth" | "failures" | "rate_limited";
}

export async function runBackfill(rows: BackfillRow[], args: BackfillArgs, deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = { attempted: 0, outcomes: {}, stopped: null };
  let failuresInRow = 0;
  let rateWaits = 0;
  for (let start = 0; start < rows.length; start += args.batch) {
    if (start > 0) await deps.sleep(deps.pauseMs ?? 1000);
    for (const row of rows.slice(start, start + args.batch)) {
      const now = deps.now();
      const body = buildContactPayload(row, { now, lastActiveAt: lastActiveSeconds(row.last_active) });
      const result = await upsertContact(deps.cfg, body, deps);
      summary.attempted++;
      summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] ?? 0) + 1;
      deps.writeLedger({ uid8: uid8(row.id), outcome: result.outcome, status: result.status ?? 0, at: now.toISOString() });
      if (result.outcome === "failed") {
        if (result.status === 401 || result.status === 403) { summary.stopped = "auth"; return summary; }
        if (result.status === 429) {
          // Intercom's window is 10 s; this row is left for the next run (ledger says failed).
          if (++rateWaits > MAX_RATE_WAITS) { summary.stopped = "rate_limited"; return summary; }
          await deps.sleep(RATE_LIMIT_WAIT_MS);
          continue;
        }
        failuresInRow++;
        if (failuresInRow >= MAX_CONSECUTIVE_FAILURES) { summary.stopped = "failures"; return summary; }
      } else {
        failuresInRow = 0;
      }
    }
  }
  return summary;
}

/** uid8s already synced successfully according to a ledger's lines. */
export function doneFromLedger(lines: string[]): Set<string> {
  const done = new Set<string>();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Partial<LedgerEntry>;
      if (typeof entry.uid8 === "string" && entry.outcome && entry.outcome !== "failed" && entry.outcome !== "merged_skipped") done.add(entry.uid8);
    } catch {
      // ignore a torn line
    }
  }
  return done;
}
