/**
 * Intercom REST client for the MedPrüf workspace (a-intercom-contact-sync).
 *
 * Reads exactly these env names, never anything else:
 *   MEDPRUF_INTERCOM_SYNC_ENABLED  only the literal "true" switches the sync on
 *   MEDPRUF_INTERCOM_ACCESS_TOKEN  the MedPrüf private app token
 *   MEDPRUF_INTERCOM_REGION        us (default) | eu | au
 * The generic INTERCOM_ACCESS_TOKEN and every BLINK_* name belong to other
 * workspaces and are never read here (a test fails if they are).
 *
 * a-intercom-suppression-sync adds (same file, same host table and version):
 *   MEDPRUF_INTERCOM_WEBHOOK_ENABLED  only "true" opens POST/HEAD /api/intercom/webhook
 *   MEDPRUF_INTERCOM_CLIENT_SECRET    signs webhook notifications (X-Hub-Signature)
 *
 * a-intercom-email-reach-1022 adds:
 *   MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED  only "true" lets the sync send an unproven address
 *
 * Every call has a 4 s deadline and the pinned API version 2.17. Callers get
 * a typed result, never a thrown network error; logs carry the path class
 * and status only, never an address, name or token.
 */

export const INTERCOM_API_VERSION = "2.17";
export const INTERCOM_TIMEOUT_MS = 4000;
/** Same deadline under the name a-intercom-suppression-sync uses. */
export const INTERCOM_FETCH_TIMEOUT_MS = INTERCOM_TIMEOUT_MS;
export const INTERCOM_WEBHOOK_FLAG = "MEDPRUF_INTERCOM_WEBHOOK_ENABLED";

export function intercomWebhookEnabled(): boolean {
  return process.env[INTERCOM_WEBHOOK_FLAG] === "true";
}

/**
 * a-intercom-email-reach-1022 (server runtime, default off, only the literal
 * "true"): the contact sync also sends an unproven account address when the
 * account has no active do-not-email row (src/lib/intercom/email-reach.ts).
 */
export const INTERCOM_EMAIL_REACH_FLAG = "MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED";

export function intercomEmailReachEnabled(): boolean {
  return process.env[INTERCOM_EMAIL_REACH_FLAG] === "true";
}

export function intercomAccessToken(): string | null {
  const token = process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN?.trim();
  return token ? token : null;
}

export function intercomClientSecret(): string | null {
  const secret = process.env.MEDPRUF_INTERCOM_CLIENT_SECRET?.trim();
  return secret ? secret : null;
}

export function intercomHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Intercom-Version": INTERCOM_API_VERSION,
  };
}

/** REST hosts (not the api-iam Messenger hosts of intercom-identity.ts). */
const REST_HOSTS: Record<string, string> = {
  us: "https://api.intercom.io",
  eu: "https://api.eu.intercom.io",
  au: "https://api.au.intercom.io",
};

export function intercomRestBase(region: string | undefined = process.env.MEDPRUF_INTERCOM_REGION): string | null {
  const key = (region ?? "us").trim().toLowerCase() || "us";
  return REST_HOSTS[key] ?? null;
}

/**
 * On only when the runtime flag and its build copy agree, so a learner is
 * never synced by a build whose privacy page does not name the sync
 * (next.config.ts copies MEDPRUF_INTERCOM_SYNC_ENABLED into
 * NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC at build). Scripts outside the Next
 * build pass requireBuildCopy:false.
 */
export function intercomSyncEnabled(opts: { requireBuildCopy?: boolean } = {}): boolean {
  if (process.env.MEDPRUF_INTERCOM_SYNC_ENABLED !== "true") return false;
  return opts.requireBuildCopy === false || process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC === "true";
}

export interface IntercomConfig {
  base: string;
  token: string;
}

/**
 * Null unless the flag is on and the MedPrüf token and region are valid.
 * The sync also needs region us: the privacy page names Intercom, Inc., USA.
 * Erasure passes requireFlag:false: a contact synced before the flag went
 * off must still be deletable while the token is set (any region).
 */
export function intercomConfig(opts: { requireFlag?: boolean; requireBuildCopy?: boolean } = {}): IntercomConfig | null {
  const requireFlag = opts.requireFlag !== false;
  if (requireFlag && !intercomSyncEnabled({ requireBuildCopy: opts.requireBuildCopy })) return null;
  const token = process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN?.trim();
  const base = intercomRestBase(process.env.MEDPRUF_INTERCOM_REGION);
  if (!token || !base) return null;
  if (requireFlag && base !== REST_HOSTS.us) return null;
  return { base, token };
}

export type IntercomResult =
  | { ok: true; status: number; body: unknown; headers: Headers }
  | { ok: false; status: number; body: unknown; headers: Headers | null; reason: "http" | "timeout" | "network" };

export interface RequestOptions {
  /** Test seam: a shorter deadline. Production always uses INTERCOM_TIMEOUT_MS. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function intercomRequest(
  cfg: IntercomConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<IntercomResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
    "Intercom-Version": INTERCOM_API_VERSION,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const res = await doFetch(`${cfg.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? INTERCOM_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (res.ok) return { ok: true, status: res.status, body: parsed, headers: res.headers };
    return { ok: false, status: res.status, body: parsed, headers: res.headers, reason: "http" };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timeout = name === "TimeoutError" || name === "AbortError";
    return { ok: false, status: 0, body: null, headers: null, reason: timeout ? "timeout" : "network" };
  }
}

/** First error code of an Intercom error.list body, for logs and branching. */
export function intercomErrorCode(body: unknown): string | null {
  const errors = (body as { errors?: Array<{ code?: unknown }> } | null)?.errors;
  const code = Array.isArray(errors) ? errors[0]?.code : null;
  return typeof code === "string" ? code.slice(0, 60) : null;
}

/** Canonical contact id from a 410 merged answer's Link header, if any. */
export function canonicalIdFromLink(headers: Headers | null): string | null {
  const link = headers?.get("link");
  if (!link) return null;
  const match = /\/contacts\/([A-Za-z0-9]+)/.exec(link);
  return match ? match[1] : null;
}

export function uid8(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}
