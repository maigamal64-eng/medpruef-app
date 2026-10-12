import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, isPaidAccess, type GuardSuccess } from "@/lib/auth-guard";

/**
 * Shared guard and pool read for the KAF practice routes (a24, SIM-04).
 * The pool = active kaf_items rows whose question is active and in the
 * Kenntnisprüfung bank. Two plain reads (no PostgREST embed), so the routes do
 * not depend on the foreign key being in the schema cache.
 */

const MISSING = new Set(["42P01", "PGRST205"]);
/** The reviewed pool is small (45 rows at seed time); one bounded page is enough. */
const POOL_READ_CAP = 1000;

export function kafEnabled(): boolean {
  return process.env.KAF_TIMED_ENABLED === "true";
}

/** requireUser, then the dark flag (404, keeps the feature invisible), then Pro (403). */
export async function guardKaf(req: NextRequest): Promise<{ guard: GuardSuccess } | { error: NextResponse }> {
  const guard = await requireUser(req);
  if ("error" in guard) return { error: guard.error };
  if (!kafEnabled()) return { error: NextResponse.json({ error: "Not found", code: "KAF_DISABLED" }, { status: 404 }) };
  if (!isPaidAccess(guard)) return { error: NextResponse.json({ error: "Pro required", code: "PRO_REQUIRED" }, { status: 403 }) };
  return { guard };
}

export interface PoolQuestion {
  id: number;
  topic: string | null;
  question: string | null;
  image_url: string | null;
}

export interface PoolItemRow {
  question_id: number;
  required: number;
  accepted?: unknown;
  model_answer?: string;
  key_points?: unknown;
}

export type PoolRead =
  | { ok: true; items: PoolItemRow[]; questions: Map<number, PoolQuestion> }
  | { ok: false; unavailable: boolean; error: unknown };

function isMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === "string" && MISSING.has(code);
}

/**
 * Read the pool. `ids` narrows it (answers route); `withKey` adds the answer
 * columns (only after submit). Question content is limited to id, topic, stem
 * and image: never choices, answer or explanation.
 */
export async function readKafPool(sb: SupabaseClient, opts: { ids?: number[]; withKey?: boolean } = {}): Promise<PoolRead> {
  let itemQuery = sb
    .from("kaf_items")
    .select(opts.withKey ? "question_id, required, accepted, model_answer, key_points" : "question_id, required")
    .eq("is_active", true);
  if (opts.ids) itemQuery = itemQuery.in("question_id", opts.ids);
  const { data: itemData, error: itemErr } = await itemQuery.order("question_id", { ascending: true }).range(0, POOL_READ_CAP - 1);
  if (itemErr) return { ok: false, unavailable: isMissing(itemErr), error: itemErr };
  const items = ((itemData ?? []) as unknown as PoolItemRow[]).filter((r) => Number.isInteger(r.question_id));
  const questions = new Map<number, PoolQuestion>();
  if (items.length === 0) return { ok: true, items, questions };

  const { data: qData, error: qErr } = await sb
    .from("questions")
    .select("id, topic, question, image_url")
    .in("id", items.map((r) => r.question_id))
    .eq("is_active", true)
    .eq("exam_type", "kenntnispruefung");
  if (qErr) return { ok: false, unavailable: isMissing(qErr), error: qErr };
  for (const q of (qData ?? []) as unknown as PoolQuestion[]) questions.set(q.id, q);
  return { ok: true, items: items.filter((r) => questions.has(r.question_id) && !!questions.get(r.question_id)?.question), questions };
}

export function unavailableResponse(): NextResponse {
  return NextResponse.json({ error: "KAF pool unavailable", code: "KAF_POOL_UNAVAILABLE" }, { status: 503 });
}
