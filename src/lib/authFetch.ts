"use client";

/**
 * Client-side fetch wrapper that automatically adds the `x-user-id`
 * header that the server-side guards in `src/lib/auth-guard.ts`
 * expect.
 *
 * Usage:
 *   import { authFetch } from "@/lib/authFetch";
 *   const r = await authFetch("/api/stats/admin/users");
 *
 * Signature mirrors `fetch()` — drop-in replacement. It reads the
 * user id from the stored session (same source the rest of the app
 * uses) and merges the header into whatever the caller passed.
 *
 * Context: this is the client half of the stopgap session layer the
 * 2026-04-15 audit introduced. See `src/lib/auth-guard.ts` for the
 * server half and the rationale.
 */

import { getStoredSession } from "@/lib/auth";

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const session = getStoredSession();
  const userId = session?.user?.id;

  const headers = new Headers(init.headers);
  if (userId) headers.set("x-user-id", userId);

  return fetch(input, { ...init, headers });
}
