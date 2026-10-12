/**
 * The /materials official documents shelf (G27, TR-07): ids of the sourced
 * documents in src/lib/exam-formats.data.json that the page lists, in order.
 * One owner for the list so the page, scripts/linkcheck.mjs and the hub test
 * read the same ids. No runtime imports: linkcheck evaluates this file as data.
 * A URL listed here must not be repeated in src/lib/austrian-resources.ts.
 */
export const MATERIALS_OFFICIAL_DOC_IDS = [
  "source-03",
  "source-15",
  "source-04",
  "source-12",
  "source-21",
  "source-07",
  "source-08",
  "source-14",
  "source-16",
] as const;
