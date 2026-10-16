/**
 * a-public-selftest: the hash of what the self-check shows of a row (stem,
 * options with their correct flags in stored order, the answer column).
 * Server only. The allowlist pins it at review time; the route recomputes it
 * on every uncached read and drops a row whose text changed since the two
 * Medic reads, so an edited question never reaches the public page unread.
 * The explanation is not served and not hashed: an explanation-only fix keeps
 * the row eligible.
 */
import { createHash } from "node:crypto";

export const SERVED_HASH_VERSION = "s1";

export interface ServedRow {
  id: number;
  question?: string | null;
  choices?: unknown;
  answer?: string | null;
}

export function servedCanonical(row: ServedRow): string {
  const choices = Array.isArray(row.choices)
    ? (row.choices as { text?: unknown; correct?: unknown }[]).map((c) => [typeof c?.text === "string" ? c.text : String(c?.text ?? ""), c?.correct === true])
    : null;
  return JSON.stringify([SERVED_HASH_VERSION, row.id, row.question ?? null, choices, row.answer ?? null]);
}

export function servedContentHash(row: ServedRow): string {
  return createHash("sha256").update(servedCanonical(row)).digest("hex");
}
