/**
 * Off-Mac database watch (a-db-relief-1). Run by /api/cron/db-health-watch
 * every 5 minutes on Vercel, so an outage is reported even while the Mac
 * that runs the restart watchdog sleeps.
 *
 * Each run probes the database (src/lib/db-health.ts); a failed probe is
 * retried once 10 seconds later in the same run. Two consecutive failed
 * probes (inside one run or across runs) count as down. While down, one
 * email to user-b7e46e80@example.com at most every 30 minutes; one more email when
 * the database answers again.
 *
 * State lives in the Vercel Data Cache, never in the database it watches:
 * every run writes one record for its 5-minute slot (claimOnce, write-once)
 * and reads the records of the previous hour. Without a shared cache (local
 * runs) each instance keeps its own records, so a warm instance still
 * throttles; a cold one alerts on its own two failed probes. Two cron
 * invocations that run at the same moment can both "claim" a record (the
 * Data Cache writes after the response), so a duplicated run can send a
 * duplicate email: accepted.
 *
 * Mail goes through sendZohoEmail directly, not sendUnlessSuppressed: the
 * do-not-email list lives in the database and fails closed when unreadable,
 * which would block exactly this alert. The recipient is our own mailbox.
 */
import { claimOnce } from "@/lib/data-cache";

export const WATCH_SLOT_MS = 5 * 60 * 1000;
export const WATCH_HISTORY_SLOTS = 12;
export const WATCH_ALERT_EVERY_MS = 30 * 60 * 1000;
export const WATCH_FAILS_TO_ALERT = 2;
export const WATCH_RETRY_DELAY_MS = 10_000;
export const WATCH_ALERT_TO = "user-b7e46e80@example.com";

export interface WatchRecord {
  outcome: "ok" | "fail" | "none";
  /** Consecutive failed probes up to the end of this run. */
  failStreak: number;
  at: number;
  alertAt: number | null;
  recoveryAt: number | null;
  /** a-fo-03: consecutive failed brownout probes while the health probe was green. */
  brownoutStreak?: number;
  brownoutAlertAt?: number | null;
}

export const NO_RECORD: WatchRecord = { outcome: "none", failStreak: 0, at: 0, alertAt: null, recoveryAt: null };

export function watchSlot(now: number): number {
  return Math.floor(now / WATCH_SLOT_MS);
}

export interface WatchDecision {
  outcome: "ok" | "fail";
  failStreak: number;
  sendAlert: boolean;
  sendRecovery: boolean;
}

/**
 * Pure rule. `probes` are this run's results in order (false = failed);
 * `history` is newest first (slot - 1, slot - 2, ...).
 */
export function decideWatch(probes: readonly boolean[], history: readonly WatchRecord[], now: number): WatchDecision {
  const last = probes.length ? probes[probes.length - 1] : true;
  // Failed probes at the end of this run.
  let tail = 0;
  for (let i = probes.length - 1; i >= 0 && !probes[i]; i--) tail++;
  // The latest earlier run within three slots (a skipped run is a gap, not a reset).
  const prev = history.slice(0, 3).find((r) => r.outcome !== "none");
  const carried = tail === probes.length && prev?.outcome === "fail" ? prev.failStreak : 0;
  const failStreak = last ? 0 : carried + tail;
  const lastAlertAt = Math.max(0, ...history.map((r) => r.alertAt ?? 0));
  const lastRecoveryAt = Math.max(0, ...history.map((r) => r.recoveryAt ?? 0));
  const outcome = last ? "ok" : "fail";
  return {
    outcome,
    failStreak,
    sendAlert: outcome === "fail" && failStreak >= WATCH_FAILS_TO_ALERT && (lastAlertAt === 0 || now - lastAlertAt >= WATCH_ALERT_EVERY_MS),
    sendRecovery: outcome === "ok" && lastAlertAt > 0 && lastRecoveryAt < lastAlertAt,
  };
}

export const BROWNOUT_FAILS_TO_ALERT = 2;

export interface BrownoutDecision {
  brownoutStreak: number;
  sendBrownout: boolean;
}

/**
 * Pure rule (a-fo-03). `probe` is this run's learner-read result, or null when
 * it did not run because the health probe failed (then the database-down rule
 * owns the incident and the streak resets). Two consecutive failed probes
 * while the health probe is green = one brownout email, at most every 30
 * minutes while it lasts. One probe per run, so the streak spans runs, with
 * the same gap tolerance as decideWatch.
 */
export function decideBrownout(probe: boolean | null, history: readonly WatchRecord[], now: number): BrownoutDecision {
  if (probe !== false) return { brownoutStreak: 0, sendBrownout: false };
  const prev = history.slice(0, 3).find((r) => r.outcome !== "none");
  const brownoutStreak = (prev?.brownoutStreak ?? 0) + 1;
  const lastAlertAt = Math.max(0, ...history.map((r) => r.brownoutAlertAt ?? 0));
  return {
    brownoutStreak,
    sendBrownout: brownoutStreak >= BROWNOUT_FAILS_TO_ALERT && (lastAlertAt === 0 || now - lastAlertAt >= WATCH_ALERT_EVERY_MS),
  };
}

const KEY = "db-health-watch-v1";

// Fallback when the Data Cache is not reachable: this instance's own records,
// so a warm instance still throttles its alerts (never better than nothing).
const localRecords = new Map<number, WatchRecord>();

/** Test seam. */
export function __resetLocalWatchRecords(): void {
  localRecords.clear();
}

/** Records of the previous WATCH_HISTORY_SLOTS slots, newest first. */
export async function readWatchHistory(now: number): Promise<{ history: WatchRecord[]; shared: boolean }> {
  const slot = watchSlot(now);
  const slots = Array.from({ length: WATCH_HISTORY_SLOTS }, (_, i) => slot - 1 - i);
  const reads = await Promise.all(
    // A slot without a record gets a "none" record: that slot is over.
    slots.map((s) => claimOnce([KEY, "slot", String(s)], { ...NO_RECORD } as unknown as Record<string, unknown>)),
  );
  const shared = reads.every((r) => r.shared);
  if (!shared) return { history: slots.map((s) => localRecords.get(s) ?? NO_RECORD), shared: false };
  return { history: reads.map((r) => (r.claimed ? NO_RECORD : (r.value as unknown as WatchRecord))), shared: true };
}

export async function writeWatchRecord(now: number, record: WatchRecord): Promise<boolean> {
  const slot = watchSlot(now);
  localRecords.set(slot, record);
  for (const s of localRecords.keys()) if (s < slot - WATCH_HISTORY_SLOTS) localRecords.delete(s);
  const res = await claimOnce([KEY, "slot", String(slot)], record as unknown as Record<string, unknown>);
  return res.claimed;
}

const VIENNA = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Vienna" });

/** Internal ops mail (our own mailbox): plain facts, no infrastructure secrets. */
export function watchEmail(
  kind: "alert" | "recovery",
  info: { now: number; failStreak: number; reasons: string[]; downSince: number | null; context?: string[] },
): { subject: string; htmlBody: string } {
  const at = VIENNA.format(new Date(info.now));
  const context = info.context?.length ? `<p>${info.context.join(" ")}</p>` : "";
  if (kind === "alert") {
    return {
      subject: "[MedPrüf] Database not answering",
      htmlBody: [
        `<p>The MedPrüf database has failed ${info.failStreak} health probes in a row (last check ${at}, Vienna).</p>`,
        `<p>Probe result: ${info.reasons.join(", ") || "unavailable"}. Learners get a retry message; answers wait in their device outbox.</p>`,
        `<p>Check the Supabase project status and restart it if it reports healthy while data requests fail.</p>`,
        `<p>You get at most one of these every 30 minutes while it lasts, and one message when it recovers.</p>`,
        context,
      ].filter(Boolean).join("\n"),
    };
  }
  const since = info.downSince ? VIENNA.format(new Date(info.downSince)) : null;
  return {
    subject: "[MedPrüf] Database answering again",
    htmlBody: [
      `<p>The MedPrüf database answers health probes again (${at}, Vienna).</p>`,
      since ? `<p>First alert of this outage: ${since}.</p>` : "",
      context,
    ].filter(Boolean).join("\n"),
  };
}

/** Brownout mail (a-fo-03): the health probe answers, a real learner read does not. */
export function brownoutEmail(info: { now: number; streak: number; reason: string; context?: string[] }): { subject: string; htmlBody: string } {
  const at = VIENNA.format(new Date(info.now));
  return {
    subject: "[MedPrüf] Database brownout: learner reads failing",
    htmlBody: [
      `<p>/api/health/db is green, but a learner-path read (one random active question by id) has failed ${info.streak} checks in a row (last check ${at}, Vienna). Probe result: ${info.reason}.</p>`,
      `<p>Learners may see slow or failed questions while the health check looks fine. The Mac watchdog does not restart on this; check Supabase query performance and memory, and restart only if reads stay down.</p>`,
      info.context?.length ? `<p>${info.context.join(" ")}</p>` : "",
      `<p>You get at most one of these every 30 minutes while it lasts.</p>`,
    ].filter(Boolean).join("\n"),
  };
}
