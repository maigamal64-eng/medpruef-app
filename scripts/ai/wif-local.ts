/**
 *
 * Local scripts (mentor eval, translation staging, TR-33, the explanation
 * regenerator through scripts/ai/claude-bridge.ts) used ANTHROPIC_API_KEY.
 * exchange production uses, fed by a Vercel DEVELOPMENT OIDC token:
 *
 *  1. `vercel env pull <tmp file> --environment=development --yes` into a
 *     fresh 0700 directory under the OS temp dir (never the repo). The CLI
 *     is pointed at the medpruef project with VERCEL_ORG_ID/VERCEL_PROJECT_ID,
 *     so no `.vercel/` link is needed. Only VERCEL_OIDC_TOKEN and the
 *     ANTHROPIC_WIF_* identifiers are read; every other line (the file may
 *     still hold secrets) is ignored. The directory is deleted in `finally`.
 *  2. The development token is exchanged at oidc.vercel.com/~token for an
 *     audience token with a fresh jti (what @vercel/oidc does in a function),
 *     then at POST /v1/oauth/token by exchangeWifToken from
 *     src/lib/ai/credentials.ts, unchanged.
 *  3. The bearer is cached in this process's memory until 120 s before it
 *     expires; the development token is re-pulled 5 minutes before its own
 *     expiry (development tokens live 12 h).
 *
 * Nothing here prints, logs, writes or returns a token in an error message.
 * Errors are WifExchangeError with a short code (see WIF_LOCAL_HINTS).
 *
 * The identifiers come from the Vercel development target, which
 * on workspace medpruef-dev). A target that points at the production rule or
 * workspace is refused, so a local run can never spend the production budget.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ADVISORY_REFRESH_MS,
  DEFAULT_WIF_AUDIENCE,
  WifExchangeError,
  exchangeWifToken,
  setLocalBearerProvider,
  type LocalBearerProvider,
  type WifConfig,
} from "@/lib/ai/credentials";

export const VERCEL_TEAM_ID = "team_redactedfa6e8de2";
export const VERCEL_PROJECT_ID = "prj_redactedf049deb8";
/** Production identifiers a development pull must never carry. */
export const PROD_RULE_ID = "[secret]";
export const PROD_WORKSPACE_ID = "[secret]";

/** The only names read from the pulled file. */
export const PULL_ALLOWLIST = [
  "VERCEL_OIDC_TOKEN",
  "ANTHROPIC_WIF_ORG_ID",
  "ANTHROPIC_WIF_RULE_ID",
  "ANTHROPIC_WIF_SERVICE_ACCOUNT_ID",
  "ANTHROPIC_WIF_WORKSPACE_ID",
  "ANTHROPIC_WIF_AUDIENCE",
] as const;

/** Re-pull the development token this long before it expires. */
export const BASE_TOKEN_MARGIN_MS = 5 * 60_000;
export const PULL_TIMEOUT_MS = 90_000;
/** After a failed pull or exchange, later calls fail fast for this long instead of starting another `vercel env pull`. */
export const LOCAL_FAILURE_COOLDOWN_MS = 30_000;

export const WIF_LOCAL_HINTS: Record<string, string> = {
  vercel_cli_missing: "The Vercel CLI was not found. Install it (npm i -g vercel) or set VERCEL_CLI to its path.",
  vercel_cli_failed: "`vercel env pull` failed. Run `vercel login` (the account needs access to the medpruef project) and retry.",
  vercel_cli_timeout: "`vercel env pull` took longer than 90 s.",
  no_oidc_token: "The development pull had no VERCEL_OIDC_TOKEN. Check Vercel > medpruef > Settings > Security > OIDC federation is on.",
  dev_wif_not_configured: "Keyless authentication failed.",
  dev_points_at_production: "Keyless authentication failed.",
  identity_token_unavailable: "oidc.vercel.com did not return an audience token. Retry; if it persists, re-run `vercel login`.",
  timeout: "The token exchange took longer than 5 s. Retry on a better connection.",
  http_400: "Keyless authentication failed.",
  http_401: "Keyless authentication failed.",
  http_403: "Anthropic refused the exchange. Check the service account is a member of medpruef-dev.",
};

export function wifLocalHint(code: string): string {
  return WIF_LOCAL_HINTS[code] ?? "Keyless authentication failed.";
}

export interface PullResult {
  code: number | null;
  /** Spawn error code (e.g. ENOENT) when the CLI could not start. */
  spawnError?: string;
  timedOut?: boolean;
}

export interface WifLocalDeps {
  /** Runs the CLI pull into `file`. Default: spawn the Vercel CLI. */
  runPull?: (file: string, env: NodeJS.ProcessEnv) => Promise<PullResult>;
  /** Exchanges the development token for an audience token. Default: @vercel/oidc. */
  exchangeAudience?: (token: string, audience: string, jti: string) => Promise<string>;
  /** Fetch for the Anthropic exchange. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Parent directory of the temp directory. Default os.tmpdir(). */
  tmpRoot?: string;
  env?: NodeJS.ProcessEnv;
}

// ─── Pull ──────────────────────────────────────────────────────────────

/** KEY=VALUE lines, allowlisted names only; surrounding quotes removed. */
export function parseAllowlisted(text: string, allow: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m || !allow.includes(m[1])) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    if (v) out[m[1]] = v;
  }
  return out;
}

/** exp of a JWT in ms, or null when it cannot be read. The signature is not checked (Anthropic checks it). */
export function jwtExpiryMs(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function defaultRunPull(file: string, env: NodeJS.ProcessEnv): Promise<PullResult> {
  const cli = env.VERCEL_CLI?.trim() || "vercel";
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: PullResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    // stdout/stderr are discarded: the CLI prints variable names only, but
    // nothing it says is needed and nothing should reach a log.
    const child = spawn(cli, ["env", "pull", file, "--environment=development", "--yes"], {
      cwd: path.dirname(file),
      env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ code: null, timedOut: true });
    }, PULL_TIMEOUT_MS);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({ code: null, spawnError: err.code ?? "spawn_error" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code });
    });
  });
}

export interface DevelopmentPull {
  token: string;
  /** ms epoch, null when the token has no readable exp. */
  expiresAt: number | null;
  config: WifConfig;
}

/**
 * One `vercel env pull` of the development target into a temp directory that
 * is always removed. Throws WifExchangeError.
 */
export async function pullDevelopmentIdentity(deps: WifLocalDeps = {}): Promise<DevelopmentPull> {
  const baseEnv = deps.env ?? process.env;
  const dir = fs.mkdtempSync(path.join(deps.tmpRoot ?? os.tmpdir(), "medpruef-oidc-"));
  let values: Record<string, string>;
  try {
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, ".env.development");
    const env: NodeJS.ProcessEnv = { ...baseEnv, VERCEL_ORG_ID: VERCEL_TEAM_ID, VERCEL_PROJECT_ID: VERCEL_PROJECT_ID };
    delete env.ANTHROPIC_API_KEY;
    delete env.VERCEL_OIDC_TOKEN;
    const r = await (deps.runPull ?? defaultRunPull)(file, env);
    if (r.spawnError === "ENOENT") throw new WifExchangeError("vercel_cli_missing", "Vercel CLI not found");
    if (r.timedOut) throw new WifExchangeError("vercel_cli_timeout", "vercel env pull timed out");
    if (r.spawnError || r.code !== 0) throw new WifExchangeError("vercel_cli_failed", `vercel env pull exited with ${r.spawnError ?? r.code}`);
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      throw new WifExchangeError("vercel_cli_failed", "vercel env pull wrote no file");
    }
    values = parseAllowlisted(text, PULL_ALLOWLIST);
    text = "";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const token = values.VERCEL_OIDC_TOKEN;
  if (!token) throw new WifExchangeError("no_oidc_token", "No VERCEL_OIDC_TOKEN in the development pull");
  const ruleId = values.ANTHROPIC_WIF_RULE_ID;
  const organizationId = values.ANTHROPIC_WIF_ORG_ID;
  const serviceAccountId = values.ANTHROPIC_WIF_SERVICE_ACCOUNT_ID;
  if (!ruleId || !organizationId || !serviceAccountId) {
    throw new WifExchangeError("dev_wif_not_configured", "The development target has no complete ANTHROPIC_WIF_* identifiers");
  }
  const workspaceId = values.ANTHROPIC_WIF_WORKSPACE_ID ?? null;
  if (ruleId === PROD_RULE_ID || workspaceId === PROD_WORKSPACE_ID) {
    throw new WifExchangeError("dev_points_at_production", "The development target names the production rule or workspace");
  }
  return {
    token,
    expiresAt: jwtExpiryMs(token),
    config: {
      ruleId,
      organizationId,
      serviceAccountId,
      workspaceId,
      audience: values.ANTHROPIC_WIF_AUDIENCE ?? DEFAULT_WIF_AUDIENCE,
    },
  };
}

// ─── Provider ──────────────────────────────────────────────────────────

async function defaultExchangeAudience(token: string, audience: string, jti: string): Promise<string> {
  const { exchangeVercelOidcToken } = await import("@vercel/oidc");
  // skipCache plus a fresh jti, as credentials.ts does through getVercelOidcToken.
  return exchangeVercelOidcToken({ token, audience, jti, skipCache: true });
}

export interface WifLocalProvider {
  /** The bearer for one call (cached, single flight). Throws WifExchangeError. */
  get: LocalBearerProvider;
  /** Forget the cached tokens (tests, and the probe's fresh run). */
  reset: () => void;
  /** Expiry of the cached development token, for the probe. Never the token. */
  developmentTokenExpiresAt: () => number | null;
}

export function createWifLocalProvider(deps: WifLocalDeps = {}): WifLocalProvider {
  const now = deps.now ?? Date.now;
  const exchangeAudience = deps.exchangeAudience ?? defaultExchangeAudience;
  let base: DevelopmentPull | null = null;
  let bearer: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<{ token: string; expiresAt: number }> | null = null;
  let lastFailure: { at: number; err: unknown } | null = null;

  const baseUsable = (t: number) => base !== null && (base.expiresAt === null || base.expiresAt - t > BASE_TOKEN_MARGIN_MS);

  const get: LocalBearerProvider = async () => {
    if (bearer && bearer.expiresAt - now() > ADVISORY_REFRESH_MS) return bearer;
    if (!inflight && lastFailure && now() - lastFailure.at < LOCAL_FAILURE_COOLDOWN_MS) throw lastFailure.err;
    if (!inflight) {
      const p = (async () => {
        if (!baseUsable(now())) base = await pullDevelopmentIdentity(deps);
        const pulled = base as DevelopmentPull;
        const r = await exchangeWifToken(pulled.config, {
          fetchImpl: deps.fetchImpl,
          now,
          getIdentityToken: (audience) => exchangeAudience(pulled.token, audience, randomUUID()),
        });
        bearer = { token: r.token, expiresAt: r.expiresAt };
        lastFailure = null;
        return bearer;
      })()
        .catch((err: unknown) => {
          lastFailure = { at: now(), err };
          throw err;
        })
        .finally(() => {
          if (inflight === p) inflight = null;
        });
      inflight = p;
    }
    return inflight;
  };

  return {
    get,
    reset: () => {
      lastFailure = null;
      base = null;
      bearer = null;
      inflight = null;
    },
    developmentTokenExpiresAt: () => base?.expiresAt ?? null,
  };
}

/**
 * registers the provider with credentials.ts and removes ANTHROPIC_API_KEY
 * from process.env so no child process or later code can fall back to it.
 */
export function installWifLocal(env: NodeJS.ProcessEnv = process.env, deps: WifLocalDeps = {}): WifLocalProvider | null {
  if (env.ANTHROPIC_AUTH_MODE !== "wif-local") return null;
  if (env.VERCEL || env.VERCEL_ENV) throw new Error("wif-local is for local scripts only and refuses to run on Vercel");
  delete env.ANTHROPIC_API_KEY;
  if (env !== process.env) delete process.env.ANTHROPIC_API_KEY;
  const provider = createWifLocalProvider({ ...deps, env: deps.env ?? env });
  setLocalBearerProvider(provider.get);
  return provider;
}

/** "code: hint" for a failure, never a token. */
export function describeWifLocalError(err: unknown): string {
  const code = err instanceof WifExchangeError ? err.code : "exchange_error";
  return `${code}: ${wifLocalHint(code)}`;
}
