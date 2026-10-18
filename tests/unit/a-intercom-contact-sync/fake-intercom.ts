/** Scripted Intercom stand-in: answers by "METHOD /path" in order, records calls. */
export interface FakeCall { method: string; url: string; headers: Record<string, string>; body: unknown }
export interface Scripted { status: number; body?: unknown; headers?: Record<string, string> }

export function fakeIntercom(script: Record<string, Scripted[]>) {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ method, url, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const queue = script[`${method} ${path}`];
    const next = queue?.shift();
    if (!next) throw new Error(`unscripted ${method} ${path}`);
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export const LEARNER = {
  id: "11111111-2222-3333-4444-555555555555",
  email: "user-4ed88e9d@example.com",
  first_name: "Amira",
  last_name: "Haddad",
  role: "user",
  tier: "pro",
  tier_expires_at: "2026-12-01T10:00:00Z",
  active_exam: "kenntnispruefung",
  exam_date: "2026-11-23",
  language_code: "de",
  created_at: "2026-10-01T08:00:00Z",
  telegram_id: 123456,
  email_verified_at: "2026-10-02T09:00:00Z",
  email_status: "valid",
  is_banned: false,
};
