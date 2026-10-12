/**
 * Free note allowance (UX-STU-51, pick-ux-stu-51 B, [name] 2026-10-12): a free
 * account may create FREE_NOTE_LIMIT notes in its lifetime. Deleting a note
 * removes the card but never returns a slot.
 *
 * The lifetime total lives in public.note_creation_counts (changeset
 * 20261224090000, fed by an AFTER INSERT trigger on notes). Until that
 * changeset is applied the relation is missing and this helper falls back to
 * the live note count with `lifetime: false`; callers must then refuse free
 * deletes (a delete would silently free a slot).
 *
 * Server-only (service-role client). Every route that enforces the free cap
 * reads it here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_NOTE_LIMIT } from "./notes";

export interface NoteAllowance {
  /** Notes counted against the allowance (lifetime when `lifetime`). */
  used: number;
  limit: number;
  /** True when `used` is the lifetime creation total, false on the live-count fallback. */
  lifetime: boolean;
}

/** PostgREST / PostgreSQL codes for a relation or function that does not exist yet. */
const MISSING_CODES = new Set(["42P01", "PGRST205", "42883", "PGRST202"]);

export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && MISSING_CODES.has(code);
}

export class NoteAllowanceError extends Error {
  constructor(readonly detail: unknown) {
    super("Failed to read note allowance");
  }
}

/** The service-role client (tests pass a cast mock). */
export type AllowanceClient = Pick<SupabaseClient, "from">;

/** Live count of the account's active notes (the pre-changeset rule, unchanged). */
async function liveCount(sb: AllowanceClient, userId: string): Promise<number> {
  const { count, error } = await sb
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) throw new NoteAllowanceError(error);
  return count ?? 0;
}

/**
 * Read the free note allowance for one account. Throws NoteAllowanceError on
 * a read failure (callers answer 500 and never grant a slot on doubt).
 */
export async function readNoteAllowance(sb: AllowanceClient, userId: string): Promise<NoteAllowance> {
  const { data, error } = await sb
    .from("note_creation_counts")
    .select("created_total")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (!isMissingRelationError(error)) throw new NoteAllowanceError(error);
    return { used: await liveCount(sb, userId), limit: FREE_NOTE_LIMIT, lifetime: false };
  }
  const total = Number((data as { created_total?: unknown } | null)?.created_total ?? 0);
  return { used: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0, limit: FREE_NOTE_LIMIT, lifetime: true };
}

/** Slots left in the allowance (never negative). */
export function remainingNotes(allowance: NoteAllowance): number {
  return Math.max(0, allowance.limit - allowance.used);
}

/**
 * A free account may delete a note only while lifetime counting is live,
 * otherwise the delete would hand back a slot (pick-ux-stu-51 B).
 */
export function canFreeAccountDelete(allowance: Pick<NoteAllowance, "lifetime"> | null | undefined): boolean {
  return allowance?.lifetime === true;
}

/** Client side: read the `cap` block of GET /api/notes (null for paid or malformed). */
export function parseNoteAllowance(value: unknown): NoteAllowance | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Number.isInteger(v.used) || !Number.isInteger(v.limit) || typeof v.lifetime !== "boolean") return null;
  if ((v.used as number) < 0 || (v.limit as number) <= 0) return null;
  return { used: v.used as number, limit: v.limit as number, lifetime: v.lifetime };
}
