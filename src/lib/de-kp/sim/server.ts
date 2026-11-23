/**
 * KP registration for the simulation session API (S2). Reads one active case with its follow-ups
 * from the KP tables and maps it through the S1 adapter. Server only. A missing table reads as
 * `unavailable` (503), a case that does not parse reads as absent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SimRegistration } from "@/lib/sim-server/registry";
import { DE_KP_EXAM_KEY, deKpEnabled } from "../index";
import { parseKpCase, toSimCase } from "./case-adapter";
import { KP_SIM_PROFILE } from "./profile";

const MISSING = new Set(["42P01", "PGRST205"]);
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);
const unavailable = (error: unknown) => ({ ok: false as const, unavailable: MISSING.has((error as { code?: string } | null)?.code ?? ""), error });

export const kpSimRegistration: SimRegistration = {
  profile: KP_SIM_PROFILE,
  enabled: () => deKpEnabled(),
  async loadCase(sb: SupabaseClient, caseId: string) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(caseId) || caseId.length > 120) return { ok: true, caseInput: null };
    const base = "id, slug, subject, taxonomy_code, vignette_de, history_checklist, patient_answers_de, findings, differentials, bericht_rubric, model_bericht_de, sources, provenance, is_free";
    const read = (cols: string) => sb.from("de_kp_cases").select(cols).eq("slug", caseId).eq("exam_key", DE_KP_EXAM_KEY).eq("is_active", true).maybeSingle();
    // The S3 columns exist only after 20270119090000 is applied; until then read the S0 columns (no persona, no notes).
    let c = await read(`${base}, patient_persona_de, examiner_notes`);
    if (c.error && MISSING_COLUMN.has((c.error as { code?: string }).code ?? "")) c = await read(base);
    if (c.error) return unavailable(c.error);
    if (!c.data) return { ok: true, caseInput: null };
    const row = c.data as unknown as { id: number } & Record<string, unknown>;
    const f = await sb.from("de_kp_followups").select("position, scope, stem_de, required, accepted, model_answer_de, key_points").eq("case_id", row.id).eq("is_active", true).order("position", { ascending: true }).range(0, 7);
    if (f.error) return unavailable(f.error);
    const parsed = parseKpCase({ ...row, followups: f.data ?? [] });
    return { ok: true, caseInput: parsed ? toSimCase(parsed).sim : null };
  },
};
