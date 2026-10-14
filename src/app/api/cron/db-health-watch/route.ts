import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { probeDatabase, probeLearnerRead } from "@/lib/db-health";
import { flushDeferredBankPurges } from "@/lib/bank-cache";
import { sendZohoEmail } from "@/lib/email/zoho";
import {
  WATCH_ALERT_TO,
  WATCH_RETRY_DELAY_MS,
  brownoutEmail,
  decideBrownout,
  decideWatch,
  readWatchHistory,
  watchEmail,
  writeWatchRecord,
  type WatchRecord,
} from "@/lib/db-health-watch";
import {
  ageMinutes,
  backupAlertSent,
  backupStaleEmail,
  decideBackupStale,
  markBackupAlertSent,
  readHeartbeat,
  watchdogLine,
  type HeartbeatStatus,
} from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/db-health-watch (a-db-relief-1), every 5 minutes.
 *
 * Probes the database and emails user-b7e46e80@example.com after two consecutive
 * failed probes, at most every 30 minutes while it lasts, plus once on
 * recovery (rule and state in src/lib/db-health-watch.ts). Writes nothing
 * to the database it watches, so it has no heartbeat row (cron health
 * lists it as "no run record"). Also flushes bank cache purges deferred by
 * the 15-minute debounce (src/lib/bank-cache.ts).
 *
 * a-fo-03 adds, in the same run and under the same state:
 *   - a brownout probe (src/lib/db-health.ts probeLearnerRead), only when this
 *     run's health probe is green, one read per run; two failed runs in a row
 *     = one brownout email, at most every 30 minutes;
 *   - the Mac heartbeats (src/lib/heartbeat.ts): every incident email says
 *     when the Mac watchdog was last seen (no alert on a quiet watchdog by
 *     itself, the Mac sleeps at night), and a backup heartbeat older than
 *     26 hours emails once, then every 12 hours while it stays stale.
 *
 * Always answers 200 with a small JSON body once authorised, also while the
 * database is down.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), got = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flushed = await flushDeferredBankPurges().catch(() => [] as string[]);

  const reasons: string[] = [];
  const probes: boolean[] = [];
  const first = await probeDatabase();
  probes.push(first.ok);
  if (!first.ok) {
    reasons.push(first.reason ?? "error");
    await sleep(WATCH_RETRY_DELAY_MS);
    const second = await probeDatabase();
    probes.push(second.ok);
    if (!second.ok) reasons.push(second.reason ?? "error");
  }

  // Brownout probe: one learner-path read, only while the health probe is green.
  let brownoutProbe: boolean | null = null;
  let brownoutReason = "error";
  if (probes[probes.length - 1]) {
    const read = await probeLearnerRead();
    brownoutProbe = read.ok;
    if (!read.ok) brownoutReason = read.reason ?? "error";
  }

  const now = Date.now();
  const unknown: HeartbeatStatus = { lastAt: null, everSeen: false };
  const [{ history, shared }, watchdog, backup] = await Promise.all([
    readWatchHistory(now).catch(() => ({ history: [] as WatchRecord[], shared: false })),
    readHeartbeat("watchdog", now).catch(() => unknown),
    readHeartbeat("backup", now).catch(() => unknown),
  ]);
  const decision = decideWatch(probes, history, now);
  const brownout = decideBrownout(brownoutProbe, history, now);
  const context = [watchdogLine(watchdog, now)];

  // The (at most three) mails go out in parallel so a slow Zoho during an
  // incident cannot push the run past maxDuration before the state write.
  const send = (mail: { subject: string; htmlBody: string }, label: string) =>
    sendZohoEmail({ to: WATCH_ALERT_TO, ...mail })
      .catch(() => ({ ok: false as const, reason: "send_failed" as const }))
      .then((sent) => {
        if (!sent.ok) console.error(`[db-health-watch] ${label} mail not sent`, { reason: sent.reason });
        return sent;
      });
  const skip = Promise.resolve(null);

  let watchMail: Promise<Awaited<ReturnType<typeof send>> | null> = skip;
  if (decision.sendAlert || decision.sendRecovery) {
    const lastRecovery = Math.max(0, ...history.map((r) => r.recoveryAt ?? 0));
    const alertsThisOutage = history.map((r) => r.alertAt ?? 0).filter((t) => t > lastRecovery);
    watchMail = send(watchEmail(decision.sendAlert ? "alert" : "recovery", {
      now,
      failStreak: decision.failStreak,
      reasons,
      downSince: alertsThisOutage.length ? Math.min(...alertsThisOutage) : null,
      context,
    }), "watch");
  }
  const brownoutMail = brownout.sendBrownout
    ? send(brownoutEmail({ now, streak: brownout.brownoutStreak, reason: brownoutReason, context }), "brownout")
    : skip;
  // Backup heartbeat older than 26 h: one email per 12-hour bucket of the episode.
  const backupStale = decideBackupStale(backup, now);
  const backupDue = backupStale.bucket !== null && !(await backupAlertSent(backupStale.bucket).catch(() => false));
  const backupMail = backupDue ? send(backupStaleEmail(backup, watchdog, now), "backup") : skip;

  const [watchSent, brownoutSent, backupSent] = await Promise.all([watchMail, brownoutMail, backupMail]);
  const alertAt = watchSent?.ok && decision.sendAlert ? now : null;
  const recoveryAt = watchSent?.ok && decision.sendRecovery ? now : null;
  const brownoutAlertAt = brownoutSent?.ok ? now : null;
  const backupAlerted = Boolean(backupSent?.ok);
  if (backupAlerted && backupStale.bucket) await markBackupAlertSent(backupStale.bucket, now).catch(() => undefined);
  const failed = [watchSent, brownoutSent, backupSent].find((s) => s && !s.ok);
  const mailError = failed && !failed.ok ? failed.reason : null;

  await writeWatchRecord(now, {
    outcome: decision.outcome,
    failStreak: decision.failStreak,
    at: now,
    alertAt,
    recoveryAt,
    brownoutStreak: brownout.brownoutStreak,
    brownoutAlertAt,
  }).catch(() => false);

  return NextResponse.json(
    {
      ok: true,
      db: decision.outcome === "ok" ? "ok" : "failing",
      failStreak: decision.failStreak,
      alerted: alertAt !== null,
      recovered: recoveryAt !== null,
      brownout: brownoutProbe === null ? "skipped" : brownoutProbe ? "ok" : "failing",
      brownoutStreak: brownout.brownoutStreak,
      brownoutAlerted: brownoutAlertAt !== null,
      backupStale: backupStale.stale,
      backupAlerted,
      watchdogAgeMin: ageMinutes(watchdog.lastAt, now),
      backupAgeMin: ageMinutes(backup.lastAt, now),
      mailError,
      stateShared: shared,
      flushed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
