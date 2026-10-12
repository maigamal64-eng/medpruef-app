/**
 * Cron health (a19, ADM-12 option B "interim reads", UX-ADM-09 first step).
 *
 * `cron_runs` has no writer, so it cannot answer "did the jobs run". This
 * module reads the evidence each scheduled job already leaves behind:
 *
 *   trial-reminder      user_events `cron_trial_reminder_heartbeat` (written
 *                       first thing on every authenticated invocation)
 *   admin-action-alert  user_events `cron_admin_action_alert_heartbeat`
 *   mentor-sweep        ai_mentor_job.last_run_at (job = 'sweep'); off while
 *                       the mentor is disabled, because the sweep is a no-op
 *   mentor-health       no record of its own (it only alerts Sentry)
 *
 * plus any `cron_runs` rows, should a writer appear later (option A).
 *
 * Staleness compares the last start with the job's schedule, not with a
 * fixed 24 hours: a daily job is "Late" after 1.5 days and "Overdue" after
 * 3 days; a 15-minute job after 23 and 45 minutes. A run still marked
 * running beyond twice its typical duration is "Stuck".
 *
 * `assessCronJob` is pure (tested in tests/unit/admin/a19-health/);
 * `loadCronHealth` performs the reads: a failed cron_runs read throws; a
 * failed heartbeat or mentor read makes that job "Could not read", never
 * "No run recorded".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type CronSource =
  | { kind: "event"; eventType: string }
  | { kind: "mentor_job"; job: string }
  | { kind: "none" };

export interface CronJobDef {
  /** Path segment under /api/cron and the vercel.json entry. */
  key: string;
  label: string;
  /** vercel.json schedule, shown verbatim. */
  schedule: string;
  /** Human schedule. */
  every: string;
  intervalMs: number;
  /** Typical run time, for the stuck rule on cron_runs rows. */
  typicalMs: number;
  source: CronSource;
}

/** Keep in step with vercel.json (a unit test compares the two). */
export const CRON_JOBS: readonly CronJobDef[] = [
  { key: "trial-reminder", label: "Trial reminder and expiry sweep", schedule: "0 7 * * *", every: "daily 07:00 UTC", intervalMs: DAY, typicalMs: 2 * MIN, source: { kind: "event", eventType: "cron_trial_reminder_heartbeat" } },
  { key: "admin-action-alert", label: "Admin action alert", schedule: "15 * * * *", every: "hourly", intervalMs: HOUR, typicalMs: MIN, source: { kind: "event", eventType: "cron_admin_action_alert_heartbeat" } },
  { key: "mentor-sweep", label: "Mentor sweep", schedule: "*/15 * * * *", every: "every 15 minutes", intervalMs: 15 * MIN, typicalMs: MIN, source: { kind: "mentor_job", job: "sweep" } },
  { key: "mentor-health", label: "Mentor health check", schedule: "0 * * * *", every: "hourly", intervalMs: HOUR, typicalMs: MIN, source: { kind: "none" } },
];

export type CronState = "ok" | "late" | "overdue" | "stuck" | "failed" | "never" | "off" | "not_recorded" | "unknown";

export interface CronAssessment {
  state: CronState;
  /** "ok" green, "warn" amber, "danger" red, "neutral" grey. */
  tone: "ok" | "warn" | "danger" | "neutral";
  /** Visible text, e.g. "Late: last run 2 d ago". */
  text: string;
}

export function formatAgo(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

export interface CronEvidence {
  lastStartedAt: string | null;
  lastFinishedAt?: string | null;
  /** cron_runs status when the evidence is a cron_runs row; heartbeats count as started. */
  lastStatus?: string | null;
  off?: boolean;
  readFailed?: boolean;
}

export function assessCronJob(job: Pick<CronJobDef, "intervalMs" | "typicalMs" | "source">, ev: CronEvidence, now: Date): CronAssessment {
  if (ev.readFailed) return { state: "unknown", tone: "neutral", text: "Could not read" };
  if (ev.off) return { state: "off", tone: "neutral", text: "Off (feature disabled)" };
  if (!ev.lastStartedAt) {
    if (job.source.kind === "none") return { state: "not_recorded", tone: "neutral", text: "No run record (alerts only)" };
    return { state: "never", tone: "danger", text: "No run recorded" };
  }
  const started = Date.parse(ev.lastStartedAt);
  if (!Number.isFinite(started)) return { state: "unknown", tone: "neutral", text: "Could not read" };
  const age = now.getTime() - started;
  const ago = `last run ${formatAgo(age)} ago`;
  if (ev.lastStatus === "running" && !ev.lastFinishedAt && age > 2 * job.typicalMs) {
    return { state: "stuck", tone: "danger", text: `Stuck: running for ${formatAgo(age)}` };
  }
  if (ev.lastStatus === "failed") return { state: "failed", tone: "danger", text: `Failed: ${ago}` };
  // Grace of 10 minutes so a run that fires a few minutes late is not amber.
  if (age > 3 * job.intervalMs + 10 * MIN) return { state: "overdue", tone: "danger", text: `Overdue: ${ago}` };
  if (age > 1.5 * job.intervalMs + 10 * MIN) return { state: "late", tone: "warn", text: `Late: ${ago}` };
  return { state: "ok", tone: "ok", text: `OK: ${ago}` };
}

export interface CronJobHealth extends CronAssessment {
  key: string;
  label: string;
  schedule: string;
  every: string;
  last_started_at: string | null;
  /** Where the evidence came from, shown under the job name. */
  evidence: string;
}

export interface CronRunRow {
  id: string;
  cron_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_affected: number | null;
  error: string | null;
}

/** Latest cron_runs row per job name (rows sorted newest first). */
export function latestRunByJob(rows: readonly CronRunRow[]): Map<string, CronRunRow> {
  const out = new Map<string, CronRunRow>();
  for (const r of rows) if (!out.has(r.cron_name)) out.set(r.cron_name, r);
  return out;
}

/** Combine the evidence for one job: a newer cron_runs row wins over a heartbeat. */
export function jobHealth(job: CronJobDef, ev: CronEvidence, run: CronRunRow | undefined, now: Date): CronJobHealth {
  let evidence: CronEvidence = ev;
  let source = job.source.kind === "event" ? "heartbeat event" : job.source.kind === "mentor_job" ? "mentor job record" : "none";
  if (run && (!ev.lastStartedAt || Date.parse(run.started_at) >= Date.parse(ev.lastStartedAt))) {
    evidence = { lastStartedAt: run.started_at, lastFinishedAt: run.finished_at, lastStatus: run.status, off: ev.off };
    source = "cron_runs";
  }
  const a = assessCronJob(job, evidence, now);
  return { key: job.key, label: job.label, schedule: job.schedule, every: job.every, last_started_at: evidence.lastStartedAt, evidence: source, ...a };
}

export interface CronHealthSnapshot {
  jobs: CronJobHealth[];
  /** cron_runs plus heartbeat rows of the last `windowHours`, newest first. */
  runs: CronRunRow[];
  runs_total: number | null;
  window_hours: number;
}

/** Counts for the Today system line. */
export function summarizeCronHealth(jobs: readonly CronJobHealth[]): { ok: number; late: number; failing: number; unknown: number; names_needing_attention: string[] } {
  let ok = 0, late = 0, failing = 0, unknown = 0;
  const names: string[] = [];
  for (const j of jobs) {
    if (j.tone === "ok") ok += 1;
    else if (j.tone === "warn") { late += 1; names.push(j.label); }
    else if (j.tone === "danger") { failing += 1; names.push(j.label); }
    else if (j.state === "unknown") unknown += 1;
  }
  return { ok, late, failing, unknown, names_needing_attention: names };
}

export async function loadCronHealth(
  sb: SupabaseClient,
  now: Date,
  opts: { mentorEnabled: boolean; windowHours?: number; runLimit?: number },
): Promise<CronHealthSnapshot> {
  const windowHours = opts.windowHours ?? 48;
  const since = new Date(now.getTime() - windowHours * HOUR).toISOString();
  const eventTypes = CRON_JOBS.flatMap((j) => (j.source.kind === "event" ? [j.source.eventType] : []));

  const [runsRes, latestEvents, windowEvents, mentorJob] = await Promise.all([
    sb.from("cron_runs")
      .select("id, cron_name, started_at, finished_at, status, rows_affected, error", { count: "exact" })
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(opts.runLimit ?? 500),
    // Latest heartbeat per job, however old (a job silent for a week must say so).
    Promise.all(eventTypes.map(async (eventType) => {
      const r = await sb.from("user_events").select("created_at").eq("event_type", eventType).order("created_at", { ascending: false }).limit(1);
      return { eventType, at: r.error ? undefined : ((r.data?.[0]?.created_at as string | undefined) ?? null) };
    })),
    sb.from("user_events").select("id, event_type, created_at").in("event_type", eventTypes).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    opts.mentorEnabled
      ? sb.from("ai_mentor_job").select("last_run_at").eq("job", "sweep").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // A failed cron_runs read fails the whole snapshot (ADM-Q05/Q07): the page
  // shows "Could not load, Retry", never an all-clear built on half the data.
  if (runsRes.error) throw runsRes.error;
  const runs = (runsRes.data ?? []) as CronRunRow[];
  const latestRuns = latestRunByJob(runs);
  const heartbeatAt = new Map(latestEvents.map((e) => [e.eventType, e.at]));

  const jobs = CRON_JOBS.map((job) => {
    let ev: CronEvidence;
    if (job.source.kind === "event") {
      const at = heartbeatAt.get(job.source.eventType);
      ev = at === undefined ? { lastStartedAt: null, readFailed: true } : { lastStartedAt: at };
    } else if (job.source.kind === "mentor_job") {
      if (!opts.mentorEnabled) ev = { lastStartedAt: null, off: true };
      else if (mentorJob.error) ev = { lastStartedAt: null, readFailed: true };
      else ev = { lastStartedAt: ((mentorJob.data as { last_run_at?: string } | null)?.last_run_at) ?? null };
    } else {
      ev = { lastStartedAt: null };
    }
    return jobHealth(job, ev, latestRuns.get(job.key), now);
  });

  const heartbeatRows: CronRunRow[] = windowEvents.error ? [] : ((windowEvents.data ?? []) as Array<{ id: string | number; event_type: string; created_at: string }>).map((e) => ({
    id: `hb-${e.id}`,
    cron_name: CRON_JOBS.find((j) => j.source.kind === "event" && j.source.eventType === e.event_type)?.key ?? e.event_type,
    started_at: e.created_at,
    finished_at: null,
    status: "fired",
    rows_affected: null,
    error: null,
  }));
  const merged = [...runs, ...heartbeatRows].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const total = windowEvents.error ? null : (runsRes.count ?? runs.length) + heartbeatRows.length;

  return { jobs, runs: merged, runs_total: total, window_hours: windowHours };
}
