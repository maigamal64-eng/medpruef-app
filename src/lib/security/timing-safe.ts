import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for secrets (cron bearer tokens, webhook
 * secrets, admin keys). Contract C11 of the 2026-10-10 plan: this is the
 * ONLY constant-time compare new code should use (W3-CRON and
 * W3-SEC-SWEEP import it).
 *
 * Rules, each one a failure mode we have seen elsewhere:
 * - Lengths are compared in BYTES (UTF-8), not UTF-16 code units.
 *   `timingSafeEqual` throws when the byte lengths differ, which can happen
 *   even when `.length` matches ("é" vs "e").
 * - On a length mismatch we still run one `timingSafeEqual` over equal-
 *   length input, so the false path does comparable work.
 * - Fails CLOSED: null, undefined, non-string input or an EMPTY value on
 *   either side returns false. `safeEqual(header, process.env.SECRET ?? "")`
 *   must never succeed when the secret is unset and the header is empty.
 *
 * Node runtime only (node:crypto). Do not import from Edge middleware.
 */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.byteLength !== bufB.byteLength) {
    // Length guard: keep the work comparable, then refuse.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
