/**
 * opsExternal — server-only fetchers for the two read-only ops surfaces
 * behind /admin/deploys and /admin/errors.
 *
 * ⚠️ SERVER-ONLY. This module reads tokens from `process.env` and must
 * never be imported (as a value) into a client component. The admin
 * pages import ONLY the response TYPES from here (`import type { ... }`),
 * which are erased at compile time. Importing any of the functions or
 * consts below into a "use client" file would bundle the secrets-reading
 * code (and crash the client/server boundary). The route handlers under
 * /api/admin/{deploys,errors} are the sole runtime callers.
 *
 * Token policy (hard rule): never hardcode a token. Each fetcher reads
 * `process.env.<NAME>` and, if the var is ABSENT, returns a tidy
 * `{ configured: false, missing: '<NAME>' }` so the tab renders a
 * "configure <NAME> to enable" empty-state instead of crashing. A token
 * that is present but REJECTED by the upstream (401/403 — e.g. a Sentry
 * source-map-upload token that lacks issue-read scope) returns
 * `{ configured: true, ok: false, status, reason }` so the tab can show a
 * precise degraded state rather than a generic error.
 *
 * Field mappings below were grounded against the live Sentry + Vercel
 * REST responses on 2026-06-23 (not from memory):
 *  - Vercel  GET https://api.vercel.com/v6/deployments?projectId=…&limit=15
 *  - Sentry  GET https://de.sentry.io/api/0/projects/medpruf/javascript-nextjs/issues/?statsPeriod=14d
 *
 * (No `import "server-only"` guard: that package isn't a dependency in this
 * repo. The boundary is enforced by discipline — the pages import only the
 * TYPES from here via `import type`, exactly as control-plane/page.tsx does.)
 */

// ─── Vercel project + Sentry project coordinates ────────────────────────────
// These are public identifiers (project id / org+project slug), NOT secrets —
// they appear in NOTES.md and in inspector URLs. Only the bearer tokens are
// secret, and those come from process.env at call time.
const VERCEL_PROJECT_ID = "prj_redactedf049deb8";
const SENTRY_REGION_HOST = "https://de.sentry.io"; // DSN region is de.sentry.io
const SENTRY_ORG = "medpruf";
const SENTRY_PROJECT = "javascript-nextjs";

// Revalidate window for both upstreams — long enough to dodge rate limits,
// short enough that the admin sees fresh-ish data. Mirrors the clarity route.
const REVALIDATE_SECONDS = 60;

// ════════════════════════════════════════════════════════════════════════════
// Shared result envelope
// ════════════════════════════════════════════════════════════════════════════

export interface OpsNotConfigured {
  configured: false;
  /** The env var name the admin must set to enable this surface. */
  missing: string;
}

export interface OpsUpstreamError {
  configured: true;
  ok: false;
  /** Upstream HTTP status, or 0 for a network/throw. */
  status: number;
  /** Human-readable, safe-to-render reason (never includes the token). */
  reason: string;
}

// ════════════════════════════════════════════════════════════════════════════
// DEPLOYS (Vercel)
// ════════════════════════════════════════════════════════════════════════════

export interface DeployRow {
  uid: string;
  /** READY | ERROR | BUILDING | QUEUED | CANCELED | INITIALIZING (Vercel readyState). */
  state: string;
  /** First 7 chars of the git SHA, or null if not a git deploy. */
  shaShort: string | null;
  /** First line of the commit message, trimmed. */
  commitSummary: string | null;
  /** Git branch (githubCommitRef), or null. */
  branch: string | null;
  /** "production" | "preview" | null. */
  target: string | null;
  /** Commit author display name, or null. */
  author: string | null;
  /** Epoch ms the deploy was created. */
  createdAt: number | null;
  /** Vercel dashboard inspector URL for this deploy. */
  inspectorUrl: string | null;
}

export interface DeploysOk {
  configured: true;
  ok: true;
  deployments: DeployRow[];
}

export type DeploysResult = OpsNotConfigured | OpsUpstreamError | DeploysOk;

interface RawVercelDeployment {
  uid?: string;
  url?: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  created?: number;
  createdAt?: number;
  inspectorUrl?: string;
  meta?: {
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubCommitRef?: string;
    githubCommitAuthorName?: string;
  };
}

function mapDeployment(d: RawVercelDeployment): DeployRow {
  const meta = d.meta ?? {};
  const sha = meta.githubCommitSha ?? null;
  const msg = meta.githubCommitMessage ?? null;
  return {
    uid: d.uid ?? "",
    state: d.readyState ?? d.state ?? "UNKNOWN",
    shaShort: sha ? sha.slice(0, 7) : null,
    commitSummary: msg ? msg.split("\n")[0].trim() : null,
    branch: meta.githubCommitRef ?? null,
    target: d.target ?? null,
    author: meta.githubCommitAuthorName ?? null,
    createdAt: d.created ?? d.createdAt ?? null,
    inspectorUrl: d.inspectorUrl ?? null,
  };
}

/**
 * Fetch the most recent Vercel deployments for the MedPrüf project.
 * Reads VERCEL_TOKEN from the env; degrades cleanly if absent/rejected.
 */
export async function fetchVercelDeployments(
  limit = 15
): Promise<DeploysResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return { configured: false, missing: "VERCEL_TOKEN" };
  }

  const url = `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=${limit}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (err) {
    return {
      configured: true,
      ok: false,
      status: 0,
      reason: `Could not reach Vercel: ${(err as Error).message}`,
    };
  }

  if (!res.ok) {
    return {
      configured: true,
      ok: false,
      status: res.status,
      reason:
        res.status === 401 || res.status === 403
          ? "VERCEL_TOKEN was rejected (check scope / team access)."
          : `Vercel API returned HTTP ${res.status}.`,
    };
  }

  const body = (await res.json()) as { deployments?: RawVercelDeployment[] };
  const deployments = (body.deployments ?? []).map(mapDeployment);
  return { configured: true, ok: true, deployments };
}

// ════════════════════════════════════════════════════════════════════════════
// ERRORS (Sentry)
// ════════════════════════════════════════════════════════════════════════════

export interface IssueRow {
  id: string;
  /** e.g. "MED-1A". */
  shortId: string | null;
  title: string;
  culprit: string | null;
  /** Total event count for the issue in the window (Sentry returns a string). */
  count: number;
  /** Distinct users affected. */
  userCount: number;
  level: string | null;
  /** ISO timestamp. */
  lastSeen: string | null;
  firstSeen: string | null;
  /** "unresolved" | "resolved" | "ignored". */
  status: string | null;
  /** Deep link straight to the issue in Sentry. */
  permalink: string | null;
}

export interface ErrorsOk {
  configured: true;
  ok: true;
  issues: IssueRow[];
}

export type ErrorsResult = OpsNotConfigured | OpsUpstreamError | ErrorsOk;

interface RawSentryIssue {
  id?: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  count?: string | number;
  userCount?: number;
  level?: string;
  lastSeen?: string;
  firstSeen?: string;
  status?: string;
  permalink?: string;
}

function mapIssue(i: RawSentryIssue): IssueRow {
  const countNum =
    typeof i.count === "string" ? parseInt(i.count, 10) || 0 : i.count ?? 0;
  return {
    id: i.id ?? "",
    shortId: i.shortId ?? null,
    title: i.title ?? "(untitled issue)",
    culprit: i.culprit ?? null,
    count: countNum,
    userCount: i.userCount ?? 0,
    level: i.level ?? null,
    lastSeen: i.lastSeen ?? null,
    firstSeen: i.firstSeen ?? null,
    status: i.status ?? null,
    permalink: i.permalink ?? null,
  };
}

/**
 * Fetch recent unresolved-leaning Sentry issues for the JS project.
 * Reads SENTRY_AUTH_TOKEN; degrades cleanly if absent or scope-rejected.
 *
 * NOTE: a Sentry *source-map upload* token (project:releases scope, used by
 * sentry-cli in CI) does NOT have permission to read issues and will come
 * back 403 here. That surfaces as a precise degraded state, never a crash.
 */
export async function fetchSentryIssues(
  statsPeriod = "14d",
  limit = 25
): Promise<ErrorsResult> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    return { configured: false, missing: "SENTRY_AUTH_TOKEN" };
  }

  const url =
    `${SENTRY_REGION_HOST}/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/` +
    `?statsPeriod=${encodeURIComponent(statsPeriod)}&limit=${limit}&query=${encodeURIComponent(
      "is:unresolved"
    )}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (err) {
    return {
      configured: true,
      ok: false,
      status: 0,
      reason: `Could not reach Sentry: ${(err as Error).message}`,
    };
  }

  if (!res.ok) {
    return {
      configured: true,
      ok: false,
      status: res.status,
      reason:
        res.status === 401 || res.status === 403
          ? "SENTRY_AUTH_TOKEN was rejected — it likely lacks the event:read / project:read scope (a source-map-upload token can't read issues)."
          : `Sentry API returned HTTP ${res.status}.`,
    };
  }

  const body = (await res.json()) as RawSentryIssue[] | { detail?: string };
  if (!Array.isArray(body)) {
    return {
      configured: true,
      ok: false,
      status: res.status,
      reason: body?.detail || "Unexpected Sentry response shape.",
    };
  }

  return { configured: true, ok: true, issues: body.map(mapIssue) };
}
