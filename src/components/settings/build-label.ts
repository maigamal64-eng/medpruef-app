/**
 * Short build id for the Settings footer (UX-ACC-38), so a bug report can
 * name the deployed build. NEXT_PUBLIC_BUILD_ID is the 12-char commit SHA on
 * Vercel and the stable literal "dev-local" elsewhere (next.config.ts).
 */
export function settingsBuildLabel(buildId: string | undefined = process.env.NEXT_PUBLIC_BUILD_ID): string {
  const id = (buildId || "").trim();
  if (!id || id.startsWith("dev")) return "dev";
  return id.slice(0, 7);
}
