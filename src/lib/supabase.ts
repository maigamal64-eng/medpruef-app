import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createTimedFetch, supabaseFetchTimeoutMs } from '@/lib/db-unavailable'

// Env-guard: during Next.js build, static analysis / page-data
// collection may import this module before env vars are available
// (especially on Vercel preview deployments where NEXT_PUBLIC_*
// vars aren't scoped to the Preview target). The non-null assertions
// (!) were the root cause of the branch-preview build failure on
// 2026-04-15 — `supabaseUrl is required` thrown at build time.
//
// Now we default to empty strings (safe because every API route has
// `export const dynamic = 'force-dynamic'` so createClient is only
// called at runtime when env vars are actually present). The anon
// client is exported but never used by any code in the app (all
// data access goes through getServiceClient / service role); it
// exists only for potential future use.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Every server client uses the PostgREST deadline (a-db-timeouts): a frozen
 * database answers with a typed DbUnavailableError within
 * SUPABASE_FETCH_TIMEOUT_MS (default 8 s) instead of holding the function
 * for the platform limit. With DB_FAST_FAIL on, the deadline is 3 s while
 * this instance saw the database fail in the last 30 s (a-fo-08); that covers
 * the auth guard's lookup too. See src/lib/db-unavailable.ts.
 */
export const serverSupabaseOptions = { global: { fetch: createTimedFetch() } } as const

/**
 * Money and access paths (Whop and NOWPayments webhooks, grant verifications,
 * payment resolution, PUYP approve, admin Grant) keep the normal deadline even while DB_FAST_FAIL's breaker is
 * open: an abort does not stop a locking grant/revoke function in Postgres,
 * and a cut there only multiplies provider redeliveries. Usage:
 * `getServiceClient({ fastFail: false })` (a literal, so route tests that mock
 * this module need no extra export).
 */
const steadySupabaseOptions = { global: { fetch: createTimedFetch(undefined, () => supabaseFetchTimeoutMs()) } } as const

export const supabase: SupabaseClient = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey, serverSupabaseOptions)
  : (null as unknown as SupabaseClient) // build-time placeholder; never called at runtime

export function getServiceClient(options: { timeoutMs?: number; fastFail?: boolean } = {}): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Check Vercel env vars (must be scoped to Preview + Production).'
    )
  }
  // A caller may ask for a longer deadline (LONG_DB_TIMEOUT_MS) on a route
  // whose maxDuration allows it and keeps it fixed; everything else uses the
  // breaker-aware default (8 s, or 3 s with DB_FAST_FAIL while it is open).
  const opts = options.timeoutMs
    ? { global: { fetch: createTimedFetch(undefined, options.timeoutMs) } }
    : options.fastFail === false ? steadySupabaseOptions : serverSupabaseOptions
  return createClient(url, serviceKey, opts)
}
