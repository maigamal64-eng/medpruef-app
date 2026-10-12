/**
 * FAQ anchor ids that were renamed (LX-27, a20 2026-10-12). Old links such as
 * /faq#crypto-only must keep landing on the right section. A hash never
 * reaches the server, so the remap runs in the page after it renders.
 */
export const LEGACY_FAQ_ANCHORS: Readonly<Record<string, string>> = {
  "crypto-only": "payment",
};

/** The current section id for a location hash ("#crypto-only" -> "payment"), or null. */
export function resolveFaqAnchor(hash: string): string | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, "")).trim();
  } catch {
    return null; // a broken percent code (for example "#%E0") is not an anchor
  }
  if (!id) return null;
  return LEGACY_FAQ_ANCHORS[id] ?? id;
}
