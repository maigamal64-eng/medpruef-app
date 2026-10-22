/**
 * Pure rules for /dashboard/exam-result (a24). No React, no network; the
 * DOM image step (`downscaleProof`) only touches browser APIs when called.
 *
 * pick-ux-exm-46 A: every learner can record "Nicht bestanden". Only a learner
 * whose Prüfungs-Kohorte guarantee can still pay out goes through the proof
 * claim; everyone else records the fail without proof, outside the admin
 * review queue (stored as a user_events row by /api/puyp/result).
 */
import type { PuypKey } from "@/lib/i18n-puyp";

/**
 * Mirrors of PUYP_COMPLETION_THRESHOLD_PCT / PUYP_MAX_EXTENSIONS in
 * src/lib/puyp.ts, which imports the server Supabase client and so stays out
 * of this client bundle. tests/unit/a24-puyp/rules.test.ts keeps them equal.
 */
export const PUYP_COMPLETION_THRESHOLD_PCT = 70;
export const PUYP_MAX_EXTENSIONS = 2;

export type ExamType = "kenntnispruefung" | "kmp_innsbruck" | "pharma";
export const EXAM_TYPES: ExamType[] = ["kenntnispruefung", "kmp_innsbruck", "pharma"];

export type PuypReasonCode = "no_subscription" | "tier_not_eligible" | "cap_reached";

export interface PuypStatus {
  eligible: boolean;
  reason?: string;
  reason_code?: PuypReasonCode;
  subscription?: { tier: string; expires_at: string | null; puyp_extensions_used: number };
  exam_type: ExamType | null;
  exam_date: string | null;
  qbank_completion_pct: number;
  qbank_answered: number;
  qbank_total: number;
  meets_completion_gate: boolean;
}

export type FailPath =
  | { mode: "claim" }
  | { mode: "record"; block: "no_plan" | "ticket" | "cap" | "below_gate" };

/**
 * a-v2-copy-surfaces-1021 (Lektor D): a Guarantee Ticket holder is not a PUYP
 * plan (the status route answers tier_not_eligible) but already owns the
 * extension on proof; it is requested on /ticket-renewal, never bought again.
 */
export function isTicketHolder(status: Pick<PuypStatus, "subscription">): boolean {
  return status.subscription?.tier === "guarantee_ticket";
}

/** Which "Nicht bestanden" flow this learner gets. The button is never dead. */
export function failPathFor(status: Pick<PuypStatus, "eligible" | "reason_code" | "subscription" | "meets_completion_gate">, maxExtensions = PUYP_MAX_EXTENSIONS): FailPath {
  if (status.eligible) return status.meets_completion_gate ? { mode: "claim" } : { mode: "record", block: "below_gate" };
  if (status.reason_code === "cap_reached") return { mode: "record", block: "cap" };
  if (!status.reason_code && (status.subscription?.puyp_extensions_used ?? 0) >= maxExtensions) return { mode: "record", block: "cap" };
  if (isTicketHolder(status)) return { mode: "record", block: "ticket" };
  return { mode: "record", block: "no_plan" };
}

/** Visible helper line under the fail button (no title tooltips). */
export function failHelperKey(path: FailPath): PuypKey {
  if (path.mode === "claim") return "failHelperClaim";
  if (path.block === "cap") return "failHelperCap";
  if (path.block === "below_gate") return "failHelperBelowGate";
  if (path.block === "ticket") return "failHelperTicket";
  return "failHelperNoPlan";
}

/** A guarantee plan is shown (extensions, progress) only when the learner has one. */
export function showsGuaranteePanel(status: Pick<PuypStatus, "eligible" | "reason_code">): boolean {
  return status.eligible || status.reason_code === "cap_reached";
}

export function isExamType(value: unknown): value is ExamType {
  return typeof value === "string" && (EXAM_TYPES as string[]).includes(value);
}

/** A status body is usable only when it carries the fields the page reads. */
export function parseStatus(body: unknown): PuypStatus | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.eligible !== "boolean" || typeof b.meets_completion_gate !== "boolean") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    eligible: b.eligible,
    reason: typeof b.reason === "string" ? b.reason : undefined,
    reason_code: b.reason_code === "no_subscription" || b.reason_code === "tier_not_eligible" || b.reason_code === "cap_reached" ? b.reason_code : undefined,
    subscription: b.subscription && typeof b.subscription === "object" ? (b.subscription as PuypStatus["subscription"]) : undefined,
    exam_type: isExamType(b.exam_type) ? b.exam_type : null,
    exam_date: typeof b.exam_date === "string" ? b.exam_date : null,
    qbank_completion_pct: num(b.qbank_completion_pct),
    qbank_answered: num(b.qbank_answered),
    qbank_total: num(b.qbank_total),
    meets_completion_gate: b.meets_completion_gate,
  };
}

// ── Proof upload (EXM-47) ────────────────────────────────────────────

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
export const MAX_PROOF_EDGE = 2000;
export const PROOF_JPEG_QUALITY = 0.8;
export const UPLOAD_TIMEOUT_MS = 120_000;
export const ALLOWED_PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;

export function isAllowedProofType(type: string): boolean {
  return (ALLOWED_PROOF_TYPES as readonly string[]).includes(type);
}

/** Images are re-encoded (EXIF upright, smaller); PDFs are sent as they are. */
export function shouldDownscale(file: { type: string }): boolean {
  return file.type.startsWith("image/");
}

/** Scale (w, h) to fit inside max x max, never up. */
export function fitWithin(width: number, height: number, max = MAX_PROOF_EDGE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function jpegName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name) || "nachweis";
  return `${base}.jpg`;
}

/** Choose the file to keep: the compressed one when it is allowed and smaller, else the original. */
export function pickProof<T extends { type: string; size: number }>(original: T, compressed: T | null): T {
  if (!compressed || !isAllowedProofType(compressed.type)) return original;
  if (!isAllowedProofType(original.type)) return compressed;
  return compressed.size < original.size ? compressed : original;
}

/** Selection check after preparation: null when the file may be uploaded. */
export function proofProblem(file: { type: string; size: number }): PuypKey | null {
  if (!isAllowedProofType(file.type)) return "proofWrongType";
  if (file.size > MAX_PROOF_BYTES) return "proofTooLarge";
  return null;
}

export function formatFileSize(bytes: number, locale: string): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
}

/** Map a thrown error or a server status to the learner line. Never the raw server text. */
export function uploadErrorKey(input: { error?: unknown; status?: number }): PuypKey {
  const name = input.error && typeof input.error === "object" ? (input.error as { name?: unknown }).name : undefined;
  if (name === "AbortError" || name === "TimeoutError") return "uploadTooSlow";
  if (input.error instanceof TypeError) return "uploadOffline";
  if (input.status === 413) return "proofTooLarge";
  if (input.status === 415) return "proofWrongType";
  if (input.status === 403 || input.status === 409) return "uploadNotEligible";
  if (input.status === 422) return "uploadBelowGate";
  return "uploadFailed";
}

/** Stable per (account, exam, date, prepared file): a retry reuses the same action key. */
export function proofSignature(userId: string, examType: string, attemptDate: string, file: { name: string; size: number; lastModified: number }): string {
  return `${userId}:${examType}:${attemptDate}:${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Downscale one photo in the browser: EXIF orientation applied, longest edge
 * at most 2000 px, JPEG 0.8. Any decode or encode failure (HEIC outside
 * Safari, huge images, no canvas) returns the original file.
 */
export async function downscaleProof(file: File): Promise<File> {
  if (!shouldDownscale(file) || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PROOF_JPEG_QUALITY));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) return file;
    const compressed = new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
    return pickProof(file, compressed);
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
