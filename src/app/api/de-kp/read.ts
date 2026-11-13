import type { SupabaseClient } from "@supabase/supabase-js";
import { DE_KP_EXAM_KEY } from "@/lib/de-kp";
import { isStep } from "@/lib/de-kp/case-run";

/**
 * Plain reads for the KP-DE routes (two simple reads, no PostgREST embed, so the
 * routes do not depend on the foreign key being in the schema cache). A missing
 * table (changeset not applied) is `unavailable`, answered 503 DE_KP_UNAVAILABLE.
 * Key columns are selected only by the functions that name them.
 */
const MISSING = new Set(["42P01", "PGRST205"]);

export type Read<T> = { ok: true; data: T } | { ok: false; unavailable: boolean; error: unknown };

function fail<T>(error: unknown): Read<T> {
  const code = (error as { code?: string } | null)?.code;
  return { ok: false, unavailable: typeof code === "string" && MISSING.has(code), error };
}

export interface CaseHead {
  id: number;
  slug: string;
  subject: string;
  title_de: string;
  title_en: string;
  is_free: boolean;
}

export interface CaseOpen extends CaseHead {
  vignette_de: string;
  history_checklist: { domain?: string }[];
}

const HEAD = "id, slug, subject, title_de, title_en, is_free";

export async function readCaseHeads(sb: SupabaseClient): Promise<Read<CaseHead[]>> {
  const { data, error } = await sb.from("de_kp_cases").select(HEAD).eq("exam_key", DE_KP_EXAM_KEY).eq("is_active", true).order("id", { ascending: true }).range(0, 199);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []) as unknown as CaseHead[] };
}

/** One active case without any key column: vignette and checklist domains only. */
export async function readCaseOpen(sb: SupabaseClient, slug: string): Promise<Read<CaseOpen | null>> {
  const { data, error } = await sb.from("de_kp_cases").select(`${HEAD}, vignette_de, history_checklist`).eq("slug", slug).eq("exam_key", DE_KP_EXAM_KEY).eq("is_active", true).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: (data as unknown as CaseOpen | null) ?? null };
}

export interface AttemptRow {
  id: string;
  user_id: string;
  case_id: number;
  step: string;
  started_at?: string;
  completed_at: string | null;
  history_score: number | null;
  differential_score: number | null;
  bericht_score: number | null;
  followup_score: number | null;
  critical_missed: number | null;
  source?: string | null;
  answers?: unknown;
  marks?: unknown;
}

const ATTEMPT_SUMMARY = "id, user_id, case_id, step, started_at, completed_at, history_score, differential_score, bericht_score, followup_score, critical_missed";

/** The caller's own attempt by id, or null. Another user's attempt id reads as null (404, never a hint it exists). */
export async function readOwnAttempt(sb: SupabaseClient, userId: string, id: string, withText = false): Promise<Read<AttemptRow | null>> {
  const { data, error } = await sb
    .from("de_kp_case_attempts")
    .select(withText ? `${ATTEMPT_SUMMARY}, source, answers, marks` : ATTEMPT_SUMMARY)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: (data as unknown as AttemptRow | null) ?? null };
}

/** The caller's recent runs for the hub: scores and step only, never the typed text. */
export async function readOwnAttempts(sb: SupabaseClient, userId: string): Promise<Read<AttemptRow[]>> {
  const { data, error } = await sb.from("de_kp_case_attempts").select(ATTEMPT_SUMMARY).eq("user_id", userId).order("started_at", { ascending: false }).range(0, 49);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as unknown as AttemptRow[]).filter((r) => isStep(r.step)) };
}

export interface FollowupOpen { id: number; position: number; scope: string; stem_de: string; required: number }

/** Oral follow-up stems only (no accepted wordings, model answer or key points). */
export async function readFollowupStems(sb: SupabaseClient, caseId: number): Promise<Read<FollowupOpen[]>> {
  const { data, error } = await sb.from("de_kp_followups").select("id, position, scope, stem_de, required").eq("case_id", caseId).eq("is_active", true).order("position", { ascending: true }).range(0, 7);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []) as unknown as FollowupOpen[] };
}

export interface CaseKeyRow {
  id: number;
  history_checklist: unknown;
  patient_answers_de: unknown;
  findings: unknown;
  differentials: unknown;
  bericht_rubric: unknown;
  model_bericht_de: string;
  sources: unknown;
}

/** The key columns of one active case. Callers release only what the attempt step allows. */
export async function readCaseKey(sb: SupabaseClient, slug: string): Promise<Read<CaseKeyRow | null>> {
  const { data, error } = await sb
    .from("de_kp_cases")
    .select("id, history_checklist, patient_answers_de, findings, differentials, bericht_rubric, model_bericht_de, sources")
    .eq("slug", slug).eq("exam_key", DE_KP_EXAM_KEY).eq("is_active", true).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: (data as unknown as CaseKeyRow | null) ?? null };
}

export interface FollowupKeyRow extends FollowupOpen { accepted: unknown; model_answer_de: string; key_points: unknown }

export async function readFollowupKeys(sb: SupabaseClient, caseId: number): Promise<Read<FollowupKeyRow[]>> {
  const { data, error } = await sb.from("de_kp_followups").select("id, position, scope, stem_de, required, accepted, model_answer_de, key_points").eq("case_id", caseId).eq("is_active", true).order("position", { ascending: true }).range(0, 7);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []) as unknown as FollowupKeyRow[] };
}

/** True when any user holds this attempt id. Used only to answer 404 for an id that is not the caller's. */
export async function attemptIdTaken(sb: SupabaseClient, id: string): Promise<Read<boolean>> {
  const { data, error } = await sb.from("de_kp_case_attempts").select("id").eq("id", id).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data != null };
}
