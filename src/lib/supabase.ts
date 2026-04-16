import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

export const supabase: SupabaseClient = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as unknown as SupabaseClient) // build-time placeholder; never called at runtime

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Check Vercel env vars (must be scoped to Preview + Production).'
    )
  }
  return createClient(url, serviceKey)
}
