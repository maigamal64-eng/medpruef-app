import type { Metadata } from "next";

/**
 * Login-gated application surface. NOT content.
 *
 * Measured 2026-09-05 in Search Console: nine app routes were indexed and
 * drawing impressions (/library had 1 impression). The robots.txt rules meant to stop this had
 * TRAILING SLASHES ("Disallow: /settings/"), which never match "/settings",
 * so the block silently did nothing for years.
 *
 * The fix is noindex, not Disallow: an already-indexed URL has to stay
 * crawlable for Googlebot to read the noindex and drop it. Only once these
 * fall out of the index should a Disallow be added.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
