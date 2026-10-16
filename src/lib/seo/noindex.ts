import type { Metadata } from "next";

/**
 * Login-gated app surfaces are not content (a-seo-from-gsc, 15 Oct 2026).
 * Search Console showed /quiz?exam=…&free=1, /login?intent=trial and
 * /quiz?topic=random in the results. Noindex, not a robots.txt Disallow:
 * an indexed URL must stay crawlable so Google can read the noindex.
 */
export const APP_NOINDEX: Metadata = { robots: { index: false, follow: false, nocache: true } };
