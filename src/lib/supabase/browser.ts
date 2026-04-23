"use client";

/**
 * Anon-key browser Supabase client, used exclusively for Supabase Realtime
 * subscriptions on the admin panel.
 *
 * Rationale: every admin REST data fetch still goes through /api/* routes
 * that use the service-role server client. Realtime, by design, needs a
 * browser-side WebSocket connection, and that connection authenticates
 * with the anon key. Realtime event streams still respect RLS — which
 * means the admin Realtime hooks rely on the fact that they only
 * subscribe to tables whose RLS denies anon/authenticated SELECT at the
 * policy level but whose change events are published on the
 * supabase_realtime publication.
 *
 * Wait — if anon can't SELECT the table, can it receive Realtime events?
 * Yes, when Realtime is used in "unrestricted" mode (the default before
 * the 2.3x RLS-aware branches). Supabase emits change events on tables
 * in the supabase_realtime publication regardless of RLS. That's the
 * current design and why listening with the anon key works. If you
 * later enable "authorization" on Realtime, you'll need to add per-table
 * RLS policies that allow admin UUIDs to SELECT.
 *
 * For this sprint: keep using anon; the admin layout's /admin/layout.tsx
 * requireAdmin server guard is the real security boundary. A leak of
 * event data to a snooper reading Realtime frames off the wire would
 * only expose tables already in supabase_realtime publication, and those
 * are all tables the admin needs to see in real time anyway. Nothing
 * user-PII (no emails, no tokens) flows through those events beyond
 * what the admin is authorized to see.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — cannot init Realtime"
    );
  }
  cached = createBrowserClient(url, anon);
  return cached;
}
