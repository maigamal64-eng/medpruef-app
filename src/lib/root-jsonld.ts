/**
 * The root structured data describes the Austrian organisation and its offers.
 * It must not sit on the Germany Kenntnisprüfung route (a-de-kp-int-1113).
 */
export const NO_ROOT_JSONLD_PREFIXES = ["/kenntnispruefung-deutschland"] as const;

export function rootJsonLdAllowed(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  return !NO_ROOT_JSONLD_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
