/**
 * Shared test-user identities.
 *
 * NEVER hardcode a real production UUID here (S-1, 2026-06-02). Under the
 * pre-S-1 auth model the admin UUID was effectively an admin bearer
 * credential, so it must not live in source — and it has now been
 * scrubbed from every tracked file. Suites that need the REAL admin/user
 * row (e.g. hitting a live API instead of a mocked one) inject it via
 * environment:
 *
 *   E2E_ADMIN_USER_ID=<uuid>  E2E_SAMPLE_USER_ID=<uuid>  pnpm test:e2e
 *
 * Otherwise these synthetic, non-production UUIDs are used. They are
 * valid UUID-shaped values (so client UUID checks pass) but match no real
 * row — fine for the suites that mock every API or only assert
 * localStorage / DOM shape, which is all the suites that reference them.
 */

export const ADMIN_USER_ID =
  process.env.E2E_ADMIN_USER_ID ?? "00000000-0000-4000-8000-000000000001";

export const SAMPLE_USER_ID =
  process.env.E2E_SAMPLE_USER_ID ?? "00000000-0000-4000-8000-000000000002";
