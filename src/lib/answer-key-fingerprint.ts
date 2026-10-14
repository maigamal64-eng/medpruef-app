/**
 * a-fo-07: stale-key guard for /api/answer. Pure, isomorphic (browser and
 * server), no Node or Web Crypto dependency.
 *
 * [name]'s 2026-04-16 lock stays: /api/questions keeps the MCQ correct flags,
 * the client grades, the route trusts the client's isCorrect. This module
 * only lets the route tell whether the client graded against the answer
 * key the row holds now. It never computes or overrides a verdict.
 *
 * The fingerprint is SHA-256 over the question id plus the sorted list of
 * (normalized option text, correct flag) pairs, so the per-load option
 * shuffle never changes it. It is computed over the canonical source
 * options exactly as /api/questions and the offline pack deliver them,
 * never over translated or display text (/api/translate only touches the
 * stem and explanations; options are never translated).
 */
import { filterDisplayableChoices } from "@/lib/mcq";

export const ANSWER_KEY_FINGERPRINT_VERSION = "k1";
const FINGERPRINT_RE = /^k1:[0-9a-f]{64}$/;

export interface KeyOption {
  text?: string | null;
  correct?: boolean | null;
}

/** The row columns the route reads to rebuild the delivered options. */
export interface AnswerKeyRow {
  answer?: string | null;
  choices?: unknown;
  distractors?: unknown;
}

/** One shared normalization: Unicode NFC, trim, collapse whitespace. */
export function normalizeOptionText(text: string | null | undefined): string {
  return String(text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * The options a learner sees for this row, unshuffled. Mirrors the three
 * branches of attachOptions in /api/questions and offlineToQuestion in the
 * quiz: structured choices (placeholders hidden by the same filter), else
 * the answer plus three stored distractors, else no options (open answer).
 */
export function answerKeyOptions(row: AnswerKeyRow): KeyOption[] | null {
  const choices = row.choices;
  if (Array.isArray(choices) && choices.length >= 2) {
    return filterDisplayableChoices(choices as { text?: string | null; correct?: boolean }[]).map((c) => ({ text: c?.text ?? "", correct: !!c?.correct }));
  }
  const distractors = Array.isArray(row.distractors) ? (row.distractors as unknown[]) : [];
  if (distractors.length >= 3) {
    return [
      { text: row.answer || "", correct: true },
      ...distractors.slice(0, 3).map((text) => ({ text: typeof text === "string" ? text : String(text ?? ""), correct: false })),
    ];
  }
  return null;
}

/** The canonical string that is hashed. Exported for tests. */
export function answerKeyCanonical(questionId: number, options: readonly KeyOption[] | null | undefined): string {
  const pairs = (options ?? [])
    .map((o) => [normalizeOptionText(o?.text), o?.correct ? 1 : 0] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return JSON.stringify([ANSWER_KEY_FINGERPRINT_VERSION, questionId, pairs]);
}

/**
 * Fingerprint of the key a client graded against. `options` null or empty
 * (an open-answer question) still yields a fingerprint, so a question that
 * gained or lost options is also a changed key.
 */
export function answerKeyFingerprint(questionId: number, options: readonly KeyOption[] | null | undefined): string {
  return `${ANSWER_KEY_FINGERPRINT_VERSION}:${sha256Hex(answerKeyCanonical(questionId, options))}`;
}

/** Server side: the fingerprint of the row as it is now. */
export function rowKeyFingerprint(questionId: number, row: AnswerKeyRow): string {
  return answerKeyFingerprint(questionId, answerKeyOptions(row));
}

export function isWellFormedFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}

export type AnswerKeyGuardMode = "off" | "shadow" | "enforce";

/** ANSWER_KEY_GUARD = off | shadow | enforce; anything else is the default, shadow. */
export function readAnswerKeyGuardMode(env: Record<string, string | undefined>): AnswerKeyGuardMode {
  const raw = (env.ANSWER_KEY_GUARD ?? "").trim().toLowerCase();
  return raw === "off" || raw === "enforce" ? raw : "shadow";
}

/** Outbox rows live at most this long (offlineSync GIVE_UP_AFTER_MS). */
export const LEGACY_FINGERPRINT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type AnswerKeyCheck =
  | { verdict: "skip" }
  | { verdict: "match" }
  | { verdict: "legacy_accept" }
  | { verdict: "legacy_refuse" }
  | { verdict: "mismatch"; refuse: boolean };

/**
 * Decide what the route does with one quiz answer. Pure.
 *
 * - off: never checked.
 * - shadow: a mismatch is reported, the answer is written as today.
 * - enforce: a mismatch is refused (409, nothing written). A request without
 *   a fingerprint (an outbox row queued before the deploy, an old tab) is
 *   accepted until LEGACY_FINGERPRINT_GRACE_MS after ANSWER_KEY_GUARD_ENFORCED_AT,
 *   then refused. Without a readable ENFORCED_AT, legacy requests stay accepted.
 */
export function checkAnswerKey(args: {
  mode: AnswerKeyGuardMode;
  sent: unknown;
  current: string;
  enforcedAt?: string | undefined;
  now?: number;
}): AnswerKeyCheck {
  const { mode, sent, current } = args;
  if (mode === "off") return { verdict: "skip" };
  if (sent === undefined || sent === null) {
    if (mode !== "enforce") return { verdict: "legacy_accept" };
    const since = args.enforcedAt ? Date.parse(args.enforcedAt) : Number.NaN;
    if (!Number.isFinite(since)) return { verdict: "legacy_accept" };
    const now = args.now ?? Date.now();
    return now - since <= LEGACY_FINGERPRINT_GRACE_MS ? { verdict: "legacy_accept" } : { verdict: "legacy_refuse" };
  }
  if (isWellFormedFingerprint(sent) && sent === current) return { verdict: "match" };
  return { verdict: "mismatch", refuse: mode === "enforce" };
}

/** The 409 body on a refused answer; offlineSync and the quiz match on it. */
export const QUESTION_CHANGED_ERROR = "question changed";

// ── SHA-256 (FIPS 180-4), synchronous so queued outbox rows and the route
// compute it without a secure-context or async Web Crypto dependency. ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8(input: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(input);
  const bytes: number[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(bytes);
}

export function sha256Hex(input: string): string {
  const msg = utf8(input);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
}
