/**
 * a-public-selftest: one switch for the public no-account self-check.
 *
 * Server and middleware read the runtime env PUBLIC_SELFTEST_ENABLED (only the
 * literal "true"); client entry links read the build mirror
 * NEXT_PUBLIC_PUBLIC_SELFTEST that next.config.ts copies at build. The sitemap
 * is built at deploy too, so flipping the switch needs a redeploy.
 */
export function publicSelftestEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PUBLIC_SELFTEST_ENABLED === "true";
}

/** Client-safe: the build-time mirror (inlined by Next). */
export function publicSelftestLinksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PUBLIC_SELFTEST === "true";
}
