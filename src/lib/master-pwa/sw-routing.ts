/**
 * What the service worker (src/app/api/sw/route.ts) may store with its
 * cache-first rule (a-sw-rsc, 13 Oct). Only static public files: brand
 * images, icons, fonts, the manifest. Everything else on the origin, App
 * Router RSC payloads in particular, goes to the network untouched, so Vercel
 * skew protection always decides which build answers.
 *
 * Plain data on purpose: the route injects these lists with JSON.stringify.
 * Never inject a function via toString() (bundling changes its text).
 */

/** Exact paths served cache-first. */
export const SW_STATIC_PATHS: readonly string[] = ["/manifest.json", "/offline.html", "/apple-touch-icon.png", "/favicon.ico", "/favicon.svg"];

/** Public folders whose files are served cache-first. */
export const SW_STATIC_PREFIXES: readonly string[] = ["/brand/", "/question-images/"];

/** File extensions (lower case, no dot) served cache-first anywhere on the origin. */
export const SW_STATIC_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "woff", "woff2", "ttf", "otf"];

/** Content type of an App Router flight (RSC) response. */
export const RSC_CONTENT_TYPE = "text/x-component";
