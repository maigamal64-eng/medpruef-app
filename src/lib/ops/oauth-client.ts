/** Client-side check of the issuer return address before the browser leaves medpruf.com (a17). */

/** The issuer address must be the bare /auth/<uid> resume path on the issuer origin. */
export function issuerDestination(returnTo: unknown, issuer: unknown, binding?: unknown): string | null {
  if (typeof returnTo !== "string" || typeof issuer !== "string") return null;
  try {
    const url = new URL(returnTo);
    if (url.origin !== issuer || url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol) || !/^\/auth\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname)) return null;
    if (binding !== undefined) {
      if (typeof binding !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(binding)) return null;
      url.searchParams.set("bind", binding);
    }
    return url.href;
  } catch { return null; }
}
