/**
 * Pure rules for offline packs (LX-16). Shared by GET /api/offline/questions
 * and the client downloader (src/lib/offline-pack.ts); no DOM, no fetch.
 *
 * A pack is a whole topic or a whole bank, fetched as disjoint chunks ordered
 * by question id: each call returns rows with id > afterId, and the cursor is
 * the last id of a full chunk (null once a chunk comes back short).
 */
import { renderLang, type UiLanguage } from "./language-model";
import { formatNumberText } from "./master-locale/format";

/** Hard ceiling per call, unchanged from the original route. */
export const OFFLINE_MAX_PER_CALL = 500;
/** The client always asks for chunks of this size (ACC-50). */
export const OFFLINE_CHUNK_SIZE = 100;
/**
 * Average serialised size of one offline row (stem, choices, explanations,
 * metadata), used only for the "ca." line before a download. The real size
 * of every chunk is returned as sizeBytes and summed afterwards.
 */
export const AVG_QUESTION_TEXT_BYTES = 2_500;
/**
 * Average question image (a 2026-10-12 sample of Supabase storage objects is
 * about 160 KB). Used only for the "ca." image line; the warmer sums the
 * real content-length of what it stores.
 */
export const AVG_IMAGE_BYTES = 160_000;
/** At most this many images are stored per download. */
export const OFFLINE_MAX_IMAGES_PER_PACK = 400;

export function parseAfterId(raw: string | null): number | null | "invalid" {
  if (raw === null || raw === "") return null;
  if (!/^\d{1,12}$/.test(raw)) return "invalid";
  return Number(raw);
}

/** Next cursor: the last id when the chunk was full, else null (pack complete). */
export function nextCursor(ids: readonly number[], requested: number): number | null {
  if (ids.length < requested || ids.length === 0) return null;
  return ids[ids.length - 1];
}

export function estimatePackTextBytes(total: number): number {
  return Math.max(0, Math.round(total)) * AVG_QUESTION_TEXT_BYTES;
}

export function estimatePackImageBytes(images: number): number {
  return Math.min(Math.max(0, Math.round(images)), OFFLINE_MAX_IMAGES_PER_PACK) * AVG_IMAGE_BYTES;
}

/** Megabytes with one decimal under 10 MB, whole numbers above; anything under 0.1 MB reads 0.1. */
export function formatMegabytes(bytes: number, lang: string): string {
  const mb = Math.max(bytes / 1_000_000, 0.1);
  const l = renderLang(lang as UiLanguage);
  return mb < 10
    ? formatNumberText(Math.round(mb * 10) / 10, l)
    : formatNumberText(Math.round(mb), l);
}

/** localStorage key holding the resume cursor of one pack scope. */
export function packCursorKey(examType: string, topic: string | null): string {
  return `medpruef_offline_cursor:${examType}:${topic ?? "*"}`;
}
