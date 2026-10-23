/**
 * Minimal Intercom REST client for the MedPruef workspace (x1d573f1), used by
 * the feedback tickets (a-intercom-feedback-tickets; moved from api.ts by
 * a-intercom-into-n2n3-1021 because contact-sync's api.ts has another
 * intercomRequest signature). Same token, version, host table and deadline.
 *
 * Reads ONLY MEDPRUF_INTERCOM_ACCESS_TOKEN: never the old shared
 * INTERCOM_ACCESS_TOKEN or any other workspace's credential. Every call has a 4 s
 * budget and never throws; callers get a typed result. Bodies and the token
 * are never logged.
 */

export const INTERCOM_VERSION = "2.17";
export const INTERCOM_TIMEOUT_MS = 4000;

const HOSTS: Record<string, string> = {
  us: "https://api.intercom.io",
  eu: "https://api.eu.intercom.io",
  au: "https://api.au.intercom.io",
};

export function intercomRestBase(region: string | undefined = process.env.MEDPRUF_INTERCOM_REGION): string | null {
  return HOSTS[(region || "us").trim().toLowerCase()] ?? null;
}

export function intercomToken(): string | null {
  const token = process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN?.trim();
  return token ? token : null;
}

export type IntercomResult =
  | { ok: true; status: number; json: Record<string, unknown> }
  | { ok: false; status: number; reason: "no_token" | "bad_region" | "timeout" | "network" | "http" };

export type IntercomFetch = typeof fetch;

export async function intercomRequest(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  fetchImpl: IntercomFetch = fetch,
): Promise<IntercomResult> {
  const token = intercomToken();
  if (!token) return { ok: false, status: 0, reason: "no_token" };
  const base = intercomRestBase();
  if (!base) return { ok: false, status: 0, reason: "bad_region" };
  try {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Intercom-Version": INTERCOM_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(INTERCOM_TIMEOUT_MS),
      redirect: "error",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, reason: "http" };
    return { ok: true, status: res.status, json };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { ok: false, status: 0, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}
