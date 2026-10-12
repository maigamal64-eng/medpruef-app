/**
 * Anthropic credentials for callClaude (src/lib/ai/anthropic.ts).
 *
 * ANTHROPIC_AUTH_MODE selects how the Messages API is authenticated:
 *
 *  - "api_key" (default, also any value other than the literal "wif"):
 *    the static ANTHROPIC_API_KEY, sent as x-api-key. Unchanged behaviour.
 *    (audience ANTHROPIC_WIF_AUDIENCE, default https://api.anthropic.com) is
 *    exchanged at POST /v1/oauth/token (RFC 7523 jwt-bearer) for a short-lived
 *    sk-ant-oat01 bearer token, sent as Authorization: Bearer.
 *
 *  - The exchange is a separate fetch, so callClaude keeps exactly one
 *    Messages request per call.
 *  - One cached token per function instance; concurrent callers share one
 *    in-flight exchange. From 120 s before expiry a background refresh runs
 *    while the cached token is still served (registered with waitUntil so a
 *    frozen instance cannot strand it; a failed early refresh keeps the
 *    token); below 30 s the token is not used and callers wait for a new one.
 *  - 5 s budget for the identity token (with a custom audience @vercel/oidc
 *    itself calls oidc.vercel.com/~token) plus the exchange. A blocking
 *    exchange runs before callClaude's own timer, so a cold call can take up
 *    to 5 s longer than its timeoutMs.
 *  - If no usable token can be had: fall back to ANTHROPIC_API_KEY when it is
 *    set (reported to Sentry, tag auth_fallback), else AiUpstream
 *    "wif_exchange_failed" with reachedModel false, so routes return their
 *    existing "AI unavailable" answer. A failed exchange is not retried for
 *    30 s, so an outage does not add 5 s to every call.
 *  - The bearer token and the identity token are never logged, returned in
 *    an error message or stored outside this module's memory.
 *
 * Live behaviour of the exchange (beta headers, audience) mirrors the
 * GET /api/admin/ai-auth-check is the live proof.
 */

// Circular with ./anthropic by design: AiUpstream is only used at call time.
import { AiUpstream } from "./anthropic";

export const ANTHROPIC_OAUTH_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
export const DEFAULT_WIF_AUDIENCE = "https://api.anthropic.com";
export const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Sent by the official SDK on the exchange (oidc-federation.ts). */
export const WIF_EXCHANGE_BETA = "oauth-2025-04-20,oidc-federation-2026-04-01";
/** Sent by the official SDK on every request made with a federated token. */
export const OAUTH_REQUEST_BETA = "oauth-2025-04-20";
export const WIF_EXCHANGE_TIMEOUT_MS = 5_000;
export const ADVISORY_REFRESH_MS = 120_000;
export const MANDATORY_REFRESH_MS = 30_000;
export const FAILURE_COOLDOWN_MS = 30_000;
const FALLBACK_REPORT_INTERVAL_MS = 60 * 60_000;

export type AnthropicAuthMode = "api_key" | "wif";

export type AnthropicAuth =
  | { kind: "api_key"; value: string }
  | { kind: "bearer"; value: string; expiresAt: number };

export interface CredentialDeps {
  /** Fetch used for the token exchange only. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Returns the workload identity JWT. Defaults to @vercel/oidc. */
  getIdentityToken?: (audience: string) => Promise<string>;
  now?: () => number;
  /** Keeps a background promise alive after the response. Defaults to Vercel's request context. */
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface WifConfig {
  ruleId: string;
  organizationId: string;
  serviceAccountId: string;
  workspaceId: string | null;
  audience: string;
}

export interface WifExchangeResult {
  token: string;
  expiresAt: number;
  /** Milliseconds for identity token plus exchange. */
  ms: number;
}

export function anthropicAuthMode(): AnthropicAuthMode {
  return process.env.ANTHROPIC_AUTH_MODE === "wif" ? "wif" : "api_key";
}

function envValue(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function readWifConfig(): WifConfig | null {
  const ruleId = envValue("ANTHROPIC_WIF_RULE_ID");
  const organizationId = envValue("ANTHROPIC_WIF_ORG_ID");
  const serviceAccountId = envValue("ANTHROPIC_WIF_SERVICE_ACCOUNT_ID");
  if (!ruleId || !organizationId || !serviceAccountId) return null;
  return {
    ruleId,
    organizationId,
    serviceAccountId,
    workspaceId: envValue("ANTHROPIC_WIF_WORKSPACE_ID"),
    audience: envValue("ANTHROPIC_WIF_AUDIENCE") ?? DEFAULT_WIF_AUDIENCE,
  };
}

/**
 * True when a Claude call can be authenticated: the key in api_key mode;
 */
export function isClaudeConfigured(): boolean {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (anthropicAuthMode() === "api_key") return hasKey;
  return readWifConfig() !== null || hasKey;
}

// ─── Exchange ──────────────────────────────────────────────────────────

/** Failure of the identity token or the exchange. The message never holds a token. */
export class WifExchangeError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "WifExchangeError";
    this.code = code;
    this.status = status;
  }
}

async function defaultIdentityToken(audience: string): Promise<string> {
  const { getVercelOidcToken } = await import("@vercel/oidc");
  // A fresh jti per exchange: @vercel/oidc caches custom-audience tokens by
  // (token, audience, jti), so without it an early refresh would resend the
  // same assertion, which Anthropic rejects as reused when it carries a jti.
  return getVercelOidcToken({ audience, jti: crypto.randomUUID() });
}

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new WifExchangeError("timeout", `WIF exchange took longer than ${ms} ms`));
    }, ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/**
 * One identity token plus one token exchange, bypassing the cache. Used by the
 * cache below and by the admin auth check. Throws WifExchangeError.
 */
export async function exchangeWifToken(config: WifConfig, deps: CredentialDeps = {}): Promise<WifExchangeResult> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetchImpl ?? fetch;
  const getIdentity = deps.getIdentityToken ?? defaultIdentityToken;
  const started = now();
  const controller = new AbortController();

  const run = async (): Promise<WifExchangeResult> => {
    let assertion: string;
    try {
      assertion = await getIdentity(config.audience);
    } catch (err) {
      if (err instanceof WifExchangeError) throw err;
      throw new WifExchangeError("identity_token_unavailable", "Could not read the workload identity token");
    }
    if (typeof assertion !== "string" || assertion.length === 0) {
      throw new WifExchangeError("identity_token_unavailable", "Workload identity token is empty");
    }

    const body: Record<string, string> = {
      grant_type: JWT_BEARER_GRANT,
      assertion,
      federation_rule_id: config.ruleId,
      organization_id: config.organizationId,
      service_account_id: config.serviceAccountId,
    };
    if (config.workspaceId) body.workspace_id = config.workspaceId;

    let res: Response;
    try {
      res = await doFetch(ANTHROPIC_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-beta": WIF_EXCHANGE_BETA,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new WifExchangeError("timeout", "WIF exchange timed out");
      throw new WifExchangeError("network_error", "Network error calling the Anthropic token endpoint");
    }

    if (!res.ok) {
      // Only the OAuth error code is kept (e.g. invalid_grant); the reason
      let oauthError = "";
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data?.error === "string") oauthError = data.error.replace(/[^a-z0-9_]/gi, "").slice(0, 40);
      } catch {
        /* ignore */
      }
      throw new WifExchangeError(
        `http_${res.status}`,
        `Anthropic token endpoint returned HTTP ${res.status}${oauthError ? ` (${oauthError})` : ""}`,
        res.status,
      );
    }

    let data: { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new WifExchangeError("bad_body", "Unreadable token endpoint response");
    }
    const token = data?.access_token;
    const expiresIn = data?.expires_in;
    if (typeof token !== "string" || token.length === 0) throw new WifExchangeError("bad_body", "Token endpoint response has no access_token");
    if (typeof data.token_type === "string" && data.token_type.toLowerCase() !== "bearer") {
      throw new WifExchangeError("bad_body", "Token endpoint returned a non-bearer token type");
    }
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new WifExchangeError("bad_body", "Token endpoint response has no valid expires_in");
    }
    const finished = now();
    return { token, expiresAt: finished + expiresIn * 1000, ms: finished - started };
  };

  return withDeadline(run(), WIF_EXCHANGE_TIMEOUT_MS, () => controller.abort());
}

// ─── Per-instance cache ────────────────────────────────────────────────

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<{ token: string; expiresAt: number }> | null = null;
let failedUntil = 0;
let lastFallbackReport = 0;

/** Test helper: forget the cached token, the in-flight exchange and the cooldown. */
export function resetAnthropicAuthCacheForTests(): void {
  cached = null;
  inflight = null;
  failedUntil = 0;
  lastFallbackReport = 0;
}

function refresh(config: WifConfig, deps: CredentialDeps): Promise<{ token: string; expiresAt: number }> {
  if (!inflight) {
    const now = deps.now ?? Date.now;
    const p: Promise<{ token: string; expiresAt: number }> = exchangeWifToken(config, deps)
      .then((r) => {
        cached = { token: r.token, expiresAt: r.expiresAt };
        failedUntil = 0;
        return cached;
      })
      .catch((err: unknown) => {
        failedUntil = now() + FAILURE_COOLDOWN_MS;
        throw err;
      })
      .finally(() => {
        if (inflight === p) inflight = null;
      });
    inflight = p;
  }
  return inflight;
}

/**
 * Vercel freezes an instance once the response is sent, so a background
 * refresh must be registered with the request context (the same symbol
 * @vercel/oidc and @vercel/functions read). No-op outside Vercel.
 */
function vercelWaitUntil(p: Promise<unknown>): void {
  try {
    const store = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[
      Symbol.for("@vercel/request-context")
    ];
    store?.get?.()?.waitUntil?.(p);
  } catch {
    /* outside a Vercel request */
  }
}

function reportFallback(reason: string, now: number): void {
  if (now - lastFallbackReport < FALLBACK_REPORT_INTERVAL_MS) return;
  lastFallbackReport = now;
  void (async () => {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureMessage("Anthropic WIF unavailable, using ANTHROPIC_API_KEY", {
        level: "warning",
        tags: { auth_fallback: "true", ai_auth_reason: reason },
      });
    } catch {
      /* Sentry unavailable: the console line below still records it */
    }
  })();
  console.warn(`[ai-auth] WIF unavailable (${reason}), using ANTHROPIC_API_KEY`);
}

function noKeyError(): AiUpstream {
  return new AiUpstream("ANTHROPIC_API_KEY is not set", { reachedModel: false, code: "no_api_key" });
}

/**
 * Credentials for one Messages call. api_key mode returns the key exactly as
 * before (or throws AiUpstream "no_api_key"). wif mode returns a cached or
 * freshly exchanged bearer token, the key as fallback, or throws AiUpstream
 * "wif_exchange_failed".
 */
export async function getAnthropicAuth(deps: CredentialDeps = {}): Promise<AnthropicAuth> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (anthropicAuthMode() === "api_key") {
    if (!key) throw noKeyError();
    return { kind: "api_key", value: key };
  }

  const now = deps.now ?? Date.now;
  const fallback = (reason: string): AnthropicAuth => {
    if (key) {
      reportFallback(reason, now());
      return { kind: "api_key", value: key };
    }
    throw new AiUpstream(`Anthropic WIF exchange failed (${reason})`, { reachedModel: false, code: "wif_exchange_failed" });
  };

  const config = readWifConfig();
  if (!config) return fallback("wif_not_configured");

  const t = now();
  if (cached && cached.expiresAt - t > ADVISORY_REFRESH_MS) {
    return { kind: "bearer", value: cached.token, expiresAt: cached.expiresAt };
  }

  // Advisory window: the cached token is still good. Refresh in the
  // background (single flight, failure only starts the cooldown) and answer
  // at once, so learners never wait on a rotation.
  if (cached && cached.expiresAt - t > MANDATORY_REFRESH_MS) {
    if (t >= failedUntil) (deps.waitUntil ?? vercelWaitUntil)(refresh(config, deps).catch(() => {}));
    return { kind: "bearer", value: cached.token, expiresAt: cached.expiresAt };
  }

  if (t < failedUntil && !inflight) return fallback("cooldown");

  try {
    const fresh = await refresh(config, deps);
    return { kind: "bearer", value: fresh.token, expiresAt: fresh.expiresAt };
  } catch (err) {
    return fallback(err instanceof WifExchangeError ? err.code : "exchange_error");
  }
}
