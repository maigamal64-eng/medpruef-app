/**
 * Off-Mac heartbeats (a-fo-03). The Mac posts a beat to POST /api/cron/heartbeat:
 * the nightly backup (source "backup") after a successful medpruf upload, the
 * restart watchdog (source "watchdog") on every run. db-health-watch reads them
 * so an incident email says whether the Mac can still restart the database,
 * and it emails when the backup has been quiet for more than 26 hours.
 *
 * Storage is the Vercel Data Cache, never the database. A Data Cache entry
 * cannot be overwritten, so every beat writes write-once records keyed by a
 * time slot (first beat of a slot wins):
 *   - a 5-minute record (watchdog only, read back for the last hour), so the
 *     "last seen N min ago" line is exact while the Mac is awake;
 *   - a 1-hour record (both sources, read back for 48 hours);
 *   - a 1-day record (both sources, read back for 14 days), so a backup that
 *     stays silent past 48 hours keeps its "last seen" and its 12-hour alert
 *     cadence;
 *   - one "first" record, so a source that never beat stays silent instead of
 *     alerting from the deploy until track-A wires the scripts.
 * Reads peek (peekRecord), newest slot first, and stop at the first hit: a
 * typical run costs a handful of cache reads, at most 1 + 13 + 49 + 15 per
 * source. An hourly record keeps the FIRST beat of its hour, so beyond the
 * last hour the age is over-stated by under an hour (stated as "about N h");
 * beyond 48 hours a daily record over-states it by under a day.
 *
 * Without a shared cache (local runs) beats live in this instance's memory.
 */
import { claimOnce, peekRecord } from "@/lib/data-cache";

export const HEARTBEAT_SOURCES = ["backup", "watchdog"] as const;
export type HeartbeatSource = (typeof HEARTBEAT_SOURCES)[number];

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const FINE_SLOT_MS = 5 * MINUTE;
export const COARSE_SLOT_MS = HOUR;
export const FINE_LOOKBACK = 12;
export const COARSE_LOOKBACK = 48;
export const DAY_SLOT_MS = 24 * HOUR;
export const DAY_LOOKBACK = 14;
export const BACKUP_STALE_MS = 26 * HOUR;
export const BACKUP_REPEAT_MS = 12 * HOUR;

const KEY = "heartbeat-v1";
const FINE_SOURCES: ReadonlySet<HeartbeatSource> = new Set(["watchdog"]);

export function isHeartbeatSource(value: unknown): value is HeartbeatSource {
  return typeof value === "string" && (HEARTBEAT_SOURCES as readonly string[]).includes(value);
}

export interface Beat extends Record<string, unknown> {
  source: HeartbeatSource;
  at: number;
}

const local = new Map<string, Beat>();

/** Test seam. */
export function __resetLocalHeartbeats(): void {
  local.clear();
}

const fineKey = (source: HeartbeatSource, slot: number) => [KEY, source, "m5", String(slot)];
const coarseKey = (source: HeartbeatSource, slot: number) => [KEY, source, "h", String(slot)];
const dayKey = (source: HeartbeatSource, slot: number) => [KEY, source, "d", String(slot)];
const firstKey = (source: HeartbeatSource) => [KEY, source, "first"];

export async function recordHeartbeat(source: HeartbeatSource, now: number): Promise<{ shared: boolean }> {
  const beat: Beat = { source, at: now };
  const keys = [coarseKey(source, Math.floor(now / COARSE_SLOT_MS)), dayKey(source, Math.floor(now / DAY_SLOT_MS)), firstKey(source)];
  if (FINE_SOURCES.has(source)) keys.unshift(fineKey(source, Math.floor(now / FINE_SLOT_MS)));
  const claims = await Promise.all(keys.map((k) => claimOnce(k, beat)));
  local.set(source, beat);
  return { shared: claims.every((c) => c.shared) };
}

export interface HeartbeatStatus {
  /** Time of the newest beat found, null when none in the lookback. */
  lastAt: number | null;
  /** The source has beaten at least once (the alert is armed). */
  everSeen: boolean;
}

async function newest(keys: string[][]): Promise<number | null> {
  for (const k of keys) {
    const rec = await peekRecord<Beat>(k);
    if (rec && typeof rec.at === "number") return rec.at;
  }
  return null;
}

export async function readHeartbeat(source: HeartbeatSource, now: number): Promise<HeartbeatStatus> {
  const mine = local.get(source);
  const first = await peekRecord<Beat>(firstKey(source));
  if (!first && !mine) return { lastAt: null, everSeen: false };
  let lastAt: number | null = null;
  if (FINE_SOURCES.has(source)) {
    const slot = Math.floor(now / FINE_SLOT_MS);
    lastAt = await newest(Array.from({ length: FINE_LOOKBACK + 1 }, (_, i) => fineKey(source, slot - i)));
  }
  if (lastAt === null) {
    const slot = Math.floor(now / COARSE_SLOT_MS);
    lastAt = await newest(Array.from({ length: COARSE_LOOKBACK + 1 }, (_, i) => coarseKey(source, slot - i)));
  }
  if (lastAt === null) {
    const slot = Math.floor(now / DAY_SLOT_MS);
    lastAt = await newest(Array.from({ length: DAY_LOOKBACK + 1 }, (_, i) => dayKey(source, slot - i)));
  }
  if (mine && (lastAt === null || mine.at > lastAt)) lastAt = mine.at;
  return { lastAt, everSeen: true };
}

/** Whole minutes since `lastAt`, null when unknown. */
export function ageMinutes(lastAt: number | null, now: number): number | null {
  return lastAt === null ? null : Math.max(0, Math.floor((now - lastAt) / MINUTE));
}

export interface BackupStaleDecision {
  stale: boolean;
  /** Key of the 12-hour alert bucket of this stale episode, null when not stale. */
  bucket: string | null;
}

/**
 * Pure rule. Stale = armed and no beat for more than 26 hours (or none in the
 * 14-day lookback; that rare episode restarts its 12-hour buckets on the clock). One email per 12-hour bucket of the episode: the first
 * when it turns stale, the next 12 hours later, and so on. A source that
 * never beat is not stale (no alert before track-A wires the backup).
 */
export function decideBackupStale(status: HeartbeatStatus, now: number): BackupStaleDecision {
  if (!status.everSeen) return { stale: false, bucket: null };
  if (status.lastAt !== null && now - status.lastAt <= BACKUP_STALE_MS) return { stale: false, bucket: null };
  if (status.lastAt === null) return { stale: true, bucket: `unseen-${Math.floor(now / BACKUP_REPEAT_MS)}` };
  // Episode = the day of the last beat, so the episode survives the read moving
  // from an hourly to a daily record once the last beat is over 48 hours old.
  const episode = Math.floor(status.lastAt / DAY_SLOT_MS);
  return { stale: true, bucket: `${episode}-${Math.floor((now - status.lastAt - BACKUP_STALE_MS) / BACKUP_REPEAT_MS)}` };
}

const alertKey = (bucket: string) => [KEY, "backup-stale-alert", bucket];
const localAlerts = new Set<string>();

export async function backupAlertSent(bucket: string): Promise<boolean> {
  return localAlerts.has(bucket) || (await peekRecord(alertKey(bucket))) !== null;
}

export async function markBackupAlertSent(bucket: string, now: number): Promise<void> {
  localAlerts.add(bucket);
  await claimOnce(alertKey(bucket), { at: now });
}

/** Test seam. */
export function __resetLocalBackupAlerts(): void {
  localAlerts.clear();
}

function ago(min: number): string {
  if (min < 90) return `${min} min ago`;
  if (min < 48 * 60) return `about ${Math.round(min / 60)} h ago`;
  return `about ${Math.round(min / 1440)} days ago`;
}

/** The line every incident email carries. */
export function watchdogLine(status: HeartbeatStatus, now: number): string {
  const min = ageMinutes(status.lastAt, now);
  if (!status.everSeen) return "Mac watchdog: no heartbeat recorded yet, so automatic restart is unknown.";
  if (min === null) return `Mac watchdog: no heartbeat in the last ${DAY_LOOKBACK} days, so expect no automatic restart.`;
  return `Mac watchdog last seen ${ago(min)}.`;
}

export function backupLine(status: HeartbeatStatus, now: number): string {
  const min = ageMinutes(status.lastAt, now);
  if (!status.everSeen) return "Backup heartbeat: never recorded.";
  if (min === null) return `Backup heartbeat: none in the last ${DAY_LOOKBACK} days.`;
  return `Backup heartbeat: last ${ago(min)}.`;
}

const VIENNA = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Vienna" });

/** Internal ops mail (our own mailbox). */
export function backupStaleEmail(backup: HeartbeatStatus, watchdog: HeartbeatStatus, now: number): { subject: string; htmlBody: string } {
  const last = backup.lastAt !== null ? ` (last successful upload ${VIENNA.format(new Date(backup.lastAt))}, Vienna)` : "";
  return {
    subject: "[MedPrüf] Nightly backup missing",
    htmlBody: [
      `<p>No successful MedPrüf backup upload has reported in for more than 26 hours${last}.</p>`,
      `<p>${backupLine(backup, now)} ${watchdogLine(watchdog, now)}</p>`,
      `<p>Check the Mac: launchd com.[name].supabase-backup, ~/Backups/supabase/last-run.json and the GitHub release list.</p>`,
      `<p>You get this at most every 12 hours while it lasts.</p>`,
    ].join("\n"),
  };
}
