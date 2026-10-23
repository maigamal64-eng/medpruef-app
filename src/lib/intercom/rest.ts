/**
 * Minimal Intercom REST client for the MedPruef workspace (server only).
 *
 * - Token: MEDPRUF_INTERCOM_ACCESS_TOKEN only. Never INTERCOM_ACCESS_TOKEN or
 *   any BLINK_* key (the old shared token belonged to BlinkOS EU).
 * - Version pinned per request with the Intercom-Version header.
 * - Host by MEDPRUF_INTERCOM_REGION (us default). This is the REST host, not
 *   the Messenger api-iam host of intercom-identity.ts.
 * - Every call has a 4 s deadline and never throws: network failures and
 *   timeouts come back as status 0.
 *
 * a-intercom-contact-sync may later add src/lib/intercom/api.ts with richer
 * helpers; this file stays the small transport both can share.
 */

export const INTERCOM_API_VERSION = "2.17";
export const INTERCOM_TIMEOUT_MS = 4000;

const REST_HOSTS: Record<string, string> = {
  us: "https://api.intercom.io",
  eu: "https://api.eu.intercom.io",
  au: "https://api.au.intercom.io",
};

export function intercomRestBase(region: string | undefined = process.env.MEDPRUF_INTERCOM_REGION): string | null {
  return REST_HOSTS[(region || "us").toLowerCase()] ?? null;
}

export function intercomToken(): string | null {
  const token = process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

export interface IntercomResult<T = Record<string, unknown>> {
  ok: boolean;
  /** HTTP status, or 0 when the request never got an answer (network, timeout, not configured). */
  status: number;
  data: T | null;
}

export async function intercomRequest<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<IntercomResult<T>> {
  const token = intercomToken();
  const base = intercomRestBase();
  if (!token || !base || !path.startsWith("/")) return { ok: false, status: 0, data: null };
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Intercom-Version": INTERCOM_API_VERSION,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(INTERCOM_TIMEOUT_MS),
      redirect: "error",
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
